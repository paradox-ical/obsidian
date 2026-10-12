import { randomUUID } from "node:crypto";

import {
  assessCaptchaSubmit,
  beginOwnershipProof,
  captchaAnswerHash,
  generateCaptchaCode,
  grantHoldsRole,
  isAccountProvider,
  nativeEligibility,
  nextPanelSelection,
  normalisePanelSelection,
  panelPresentation,
  providerStatuses,
  renderCaptchaPng,
  roleStillHeld,
  selfSelectDecision,
  stackExpiry,
  pauseRemaining,
  validateAccessPlan,
  type CommunitySettingsInput,
  type EntitlementView,
  type NativeMemberState,
  type ProviderCredentialStatus,
  type RoleDescriptor,
} from "@collective/domain";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

import { actorCan, enqueueJob, enqueueOutbox, writeAudit, type Writer } from "./platform.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const VERIFIED_SOURCE = "verification";
const VERIFIED_SOURCE_ID = "verified";

export class CommunityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommunityError";
  }
}

function asSettings(value: unknown): CommunitySettingsInput | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<CommunitySettingsInput>;
  if (!record.verifiedRoleId || !Array.isArray(record.channels)) {
    return null;
  }
  return record as CommunitySettingsInput;
}

function viewOf(grant: {
  kind: string;
  expiresAt: Date | null;
  pausedRemainingMs: number | null;
  endedAt: Date | null;
}): EntitlementView {
  return {
    kind: grant.kind === "permanent" ? "permanent" : "temporary",
    expiresAt: grant.expiresAt,
    pausedRemainingMs: grant.pausedRemainingMs,
    endedAt: grant.endedAt,
  };
}

async function settingsOf(db: Writer, guildId: string): Promise<CommunitySettingsInput | null> {
  const row = await db.communitySettings.findUnique({ where: { guildId } });
  return row ? asSettings(row.document) : null;
}

async function syncRole(db: Writer, input: { guildId: string; userId: string; roleId: string; now: Date }) {
  const grants = await db.roleEntitlement.findMany({
    where: { guildId: input.guildId, userId: input.userId, roleId: input.roleId },
  });
  const held = roleStillHeld(grants.map(viewOf), input.now);
  const action = held ? "add" : "remove";
  await enqueueOutbox(db, {
    guildId: input.guildId,
    eventType: "discord.role.update",
    payload: { guildId: input.guildId, userId: input.userId, roleId: input.roleId, action },
    idempotencyKey: `role-sync:${input.guildId}:${input.userId}:${input.roleId}:${action}:${grants.filter((grant) => grantHoldsRole(viewOf(grant), input.now)).length}`,
  });
}

async function scheduleExpiry(db: Writer, guildId: string, grantId: string, expiresAt: Date) {
  await enqueueJob(db, {
    guildId,
    jobType: "community.role.expire",
    payload: { grantId },
    idempotencyKey: `role-expire:${grantId}:${expiresAt.toISOString()}`,
    runAt: expiresAt,
  });
}

export async function saveCommunitySettings(
  db: Writer,
  input: { guildId: string; settings: CommunitySettingsInput; roles: readonly RoleDescriptor[]; actorUserId: string; reason: string },
) {
  const errors = validateAccessPlan(input.settings, input.roles);
  if (errors.length > 0) {
    return { ok: false as const, errors };
  }
  await db.communitySettings.upsert({
    where: { guildId: input.guildId },
    create: { guildId: input.guildId, document: input.settings as unknown as Prisma.InputJsonValue, updatedAt: new Date() },
    update: { document: input.settings as unknown as Prisma.InputJsonValue },
  });
  await seedRoleCategories(db, input.guildId);
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "community.settings",
    targetType: "community_settings",
    targetId: input.guildId,
    reason: input.reason,
  });
  return { ok: true as const };
}

export async function seedRoleCategories(db: Writer, guildId: string) {
  for (const name of ["Interest", "Region", "Platform", "Notification"]) {
    const existing = await db.rolePanel.findFirst({ where: { guildId, name } });
    if (existing) {
      continue;
    }
    await db.rolePanel.create({
      data: { id: randomUUID(), guildId, name, mode: "button", selection: "multiple" },
    });
  }
}

export function readCommunitySettings(db: Writer, guildId: string) {
  return settingsOf(db, guildId);
}

async function verificationOf(db: Writer, guildId: string, userId: string) {
  return db.verificationRecord.findUnique({ where: { guildId_userId: { guildId, userId } } });
}

export async function startCaptcha(
  db: Writer,
  input: { guildId: string; userId: string; native: NativeMemberState; now: Date },
) {
  const settings = await settingsOf(db, input.guildId);
  if (!settings) {
    return { result: "setup_required" as const };
  }
  const eligibility = nativeEligibility(input.native, settings);
  if (!eligibility.eligible) {
    return { result: "ineligible" as const, reason: eligibility.reason };
  }
  const record = await verificationOf(db, input.guildId, input.userId);
  if (record?.status === "verified") {
    return { result: "already_verified" as const };
  }
  if (record?.cooldownUntil && record.cooldownUntil.getTime() > input.now.getTime()) {
    return { result: "cooldown" as const, cooldownUntil: record.cooldownUntil };
  }
  const code = generateCaptchaCode();
  const id = randomUUID();
  let image: Uint8Array;
  try {
    image = renderCaptchaPng(code);
  } catch {
    throw new CommunityError("CAPTCHA image could not be drawn.");
  }
  await db.captchaChallenge.updateMany({
    where: { guildId: input.guildId, userId: input.userId, invalidatedAt: null },
    data: { invalidatedAt: input.now },
  });
  await db.captchaChallenge.create({
    data: {
      id,
      guildId: input.guildId,
      userId: input.userId,
      answerHash: captchaAnswerHash(id, code),
      expiresAt: new Date(input.now.getTime() + 5 * 60 * 1000),
    },
  });
  if (record?.cooldownUntil && record.cooldownUntil.getTime() <= input.now.getTime()) {
    await db.verificationRecord.update({
      where: { id: record.id },
      data: { failureCount: 0, cooldownUntil: null },
    });
  }
  return { result: "challenge" as const, challengeId: id, image, expiresAt: new Date(input.now.getTime() + 5 * 60 * 1000) };
}

export async function submitCaptcha(
  db: Writer,
  input: { guildId: string; userId: string; challengeId: string; answer: string; now: Date },
) {
  const settings = await settingsOf(db, input.guildId);
  if (!settings) {
    return { result: "setup_required" as const };
  }
  const challenge = await db.captchaChallenge.findUnique({ where: { id: input.challengeId } });
  const record = await verificationOf(db, input.guildId, input.userId);
  if (!challenge || challenge.guildId !== input.guildId || challenge.userId !== input.userId) {
    return { result: "invalidated" as const };
  }
  const assessed = assessCaptchaSubmit({
    now: input.now,
    expiresAt: challenge.expiresAt,
    invalidated: Boolean(challenge.invalidatedAt),
    expectedHash: challenge.answerHash,
    challengeId: challenge.id,
    answer: input.answer,
    failureCount: record?.failureCount ?? 0,
    cooldownUntil: record?.cooldownUntil ?? null,
  });
  if (assessed.result === "incorrect") {
    await db.verificationRecord.upsert({
      where: { guildId_userId: { guildId: input.guildId, userId: input.userId } },
      create: {
        id: randomUUID(),
        guildId: input.guildId,
        userId: input.userId,
        status: "unverified",
        failureCount: assessed.failureCount,
        cooldownUntil: assessed.cooldownUntil,
        updatedAt: input.now,
      },
      update: { failureCount: assessed.failureCount, cooldownUntil: assessed.cooldownUntil },
    });
    return { result: "incorrect" as const, failureCount: assessed.failureCount, cooldownUntil: assessed.cooldownUntil };
  }
  if (assessed.result !== "correct") {
    return { result: assessed.result };
  }
  await db.captchaChallenge.update({ where: { id: challenge.id }, data: { invalidatedAt: input.now } });
  await markVerified(db, {
    guildId: input.guildId,
    userId: input.userId,
    method: "captcha",
    roleId: settings.verifiedRoleId,
    now: input.now,
    actorUserId: input.userId,
    reason: "Member passed the CAPTCHA.",
  });
  return { result: "verified" as const };
}

async function markVerified(
  db: Writer,
  input: { guildId: string; userId: string; method: string; roleId: string; now: Date; actorUserId: string; reason: string },
) {
  await db.verificationRecord.upsert({
    where: { guildId_userId: { guildId: input.guildId, userId: input.userId } },
    create: {
      id: randomUUID(),
      guildId: input.guildId,
      userId: input.userId,
      status: "verified",
      method: input.method,
      failureCount: 0,
      verifiedAt: input.now,
      updatedAt: input.now,
    },
    update: {
      status: "verified",
      method: input.method,
      failureCount: 0,
      cooldownUntil: null,
      verifiedAt: input.now,
      revokedAt: null,
    },
  });
  await ensurePermanentGrant(db, {
    guildId: input.guildId,
    userId: input.userId,
    roleId: input.roleId,
    source: VERIFIED_SOURCE,
    sourceId: VERIFIED_SOURCE_ID,
    now: input.now,
  });
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "verification.grant",
    targetType: "verification_record",
    targetId: input.userId,
    reason: input.reason,
  });
}

async function ensurePermanentGrant(
  db: Writer,
  input: { guildId: string; userId: string; roleId: string; source: string; sourceId: string; now: Date },
) {
  const existing = await db.roleEntitlement.findUnique({
    where: {
      guildId_userId_roleId_source_sourceId: {
        guildId: input.guildId,
        userId: input.userId,
        roleId: input.roleId,
        source: input.source,
        sourceId: input.sourceId,
      },
    },
  });
  if (!existing) {
    await db.roleEntitlement.create({
      data: {
        id: randomUUID(),
        guildId: input.guildId,
        userId: input.userId,
        roleId: input.roleId,
        kind: "permanent",
        source: input.source,
        sourceId: input.sourceId,
        updatedAt: input.now,
      },
    });
  } else if (existing.endedAt) {
    await db.roleEntitlement.update({
      where: { id: existing.id },
      data: { kind: "permanent", endedAt: null, endReason: null, expiresAt: null, pausedRemainingMs: null },
    });
  }
  await syncRole(db, input);
}

export async function requestAssistance(
  db: Writer,
  input: { guildId: string; userId: string; note: string; now: Date },
) {
  const note = input.note.trim();
  if (!note) {
    throw new CommunityError("Assistance needs a note.");
  }
  const id = randomUUID();
  await db.assistanceRequest.create({
    data: { id, guildId: input.guildId, userId: input.userId, note, status: "open" },
  });
  await enqueueOutbox(db, {
    guildId: input.guildId,
    eventType: "community.assistance",
    payload: { requestId: id, guildId: input.guildId, userId: input.userId },
    idempotencyKey: `assistance:${id}`,
  });
  return { result: "requested" as const, requestId: id, access: "unchanged" as const };
}

export async function reviewVerification(
  db: Writer,
  input: {
    guildId: string;
    actorUserId: string;
    actorRoleIds: readonly string[];
    userId: string;
    reason: string;
    revoke: boolean;
    now: Date;
  },
) {
  const allowed = await actorCan(db, {
    guildId: input.guildId,
    roleIds: input.actorRoleIds,
    capability: "verification_override",
  });
  if (allowed === "denied") {
    return { result: "denied" as const };
  }
  const settings = await settingsOf(db, input.guildId);
  if (!settings) {
    return { result: "setup_required" as const };
  }
  if (input.revoke) {
    await db.verificationRecord.upsert({
      where: { guildId_userId: { guildId: input.guildId, userId: input.userId } },
      create: {
        id: randomUUID(),
        guildId: input.guildId,
        userId: input.userId,
        status: "revoked",
        revokedAt: input.now,
        updatedAt: input.now,
      },
      update: { status: "revoked", revokedAt: input.now },
    });
    await endGrant(db, {
      guildId: input.guildId,
      userId: input.userId,
      roleId: settings.verifiedRoleId,
      source: VERIFIED_SOURCE,
      sourceId: VERIFIED_SOURCE_ID,
      now: input.now,
      endReason: "revoked",
    });
    await writeAudit(db, {
      guildId: input.guildId,
      actorUserId: input.actorUserId,
      action: "verification.revoke",
      targetType: "verification_record",
      targetId: input.userId,
      reason: input.reason,
    });
    return { result: "revoked" as const };
  }
  await markVerified(db, {
    guildId: input.guildId,
    userId: input.userId,
    method: "staff",
    roleId: settings.verifiedRoleId,
    now: input.now,
    actorUserId: input.actorUserId,
    reason: input.reason,
  });
  await db.assistanceRequest.updateMany({
    where: { guildId: input.guildId, userId: input.userId, status: "open" },
    data: { status: "resolved", resolvedAt: input.now },
  });
  return { result: "verified" as const };
}

async function endGrant(
  db: Writer,
  input: { guildId: string; userId: string; roleId: string; source: string; sourceId: string; now: Date; endReason: string },
) {
  const existing = await db.roleEntitlement.findUnique({
    where: {
      guildId_userId_roleId_source_sourceId: {
        guildId: input.guildId,
        userId: input.userId,
        roleId: input.roleId,
        source: input.source,
        sourceId: input.sourceId,
      },
    },
  });
  if (existing && !existing.endedAt) {
    await db.roleEntitlement.update({
      where: { id: existing.id },
      data: { endedAt: input.now, endReason: input.endReason },
    });
  }
  await syncRole(db, input);
}

export async function reconcileMember(
  db: Writer,
  input: { guildId: string; userId: string; native: NativeMemberState; now: Date },
) {
  const settings = await settingsOf(db, input.guildId);
  if (!settings) {
    return { result: "setup_required" as const, captchaIssued: false as const };
  }
  const record = await verificationOf(db, input.guildId, input.userId);
  const eligibility = nativeEligibility(input.native, settings);
  if (!record || record.status !== "verified") {
    return {
      result: record?.status === "revoked" ? ("revoked" as const) : ("unverified" as const),
      captchaIssued: false as const,
      eligibility: eligibility.eligible ? ("eligible" as const) : eligibility.reason,
    };
  }
  if (!eligibility.eligible) {
    if (eligibility.reason !== "missing_eligibility") {
      await endGrant(db, {
        guildId: input.guildId,
        userId: input.userId,
        roleId: settings.verifiedRoleId,
        source: VERIFIED_SOURCE,
        sourceId: VERIFIED_SOURCE_ID,
        now: input.now,
        endReason: "native_incomplete",
      });
    }
    return { result: "waiting_for_native" as const, reason: eligibility.reason, captchaIssued: false as const };
  }
  await ensurePermanentGrant(db, {
    guildId: input.guildId,
    userId: input.userId,
    roleId: settings.verifiedRoleId,
    source: VERIFIED_SOURCE,
    sourceId: VERIFIED_SOURCE_ID,
    now: input.now,
  });
  return { result: "restored" as const, captchaIssued: false as const };
}

export async function publishPanel(
  db: Writer,
  input: {
    guildId: string;
    name: string;
    mode: "reaction" | "button" | "select";
    selection: "single" | "multiple";
    options: Array<{ roleId: string; label: string; emoji?: string | null; exclusiveGroup?: string | null; prerequisiteRoleIds?: string[] }>;
    roles: readonly RoleDescriptor[];
    botHighestPosition: number;
    actorUserId: string;
    reason: string;
  },
) {
  const settings = await settingsOf(db, input.guildId);
  if (!settings) {
    return { ok: false as const, reason: "setup_required" as const };
  }
  const staff = await db.capabilityGrant.findMany({ where: { guildId: input.guildId } });
  for (const option of input.options) {
    const role = input.roles.find((item) => item.id === option.roleId);
    if (!role) {
      return { ok: false as const, reason: "missing_role" as const };
    }
    const decision = selfSelectDecision({
      role,
      verifiedRoleId: settings.verifiedRoleId,
      staffRoleIds: staff.map((grant) => grant.roleId),
      progressionRoleIds: settings.progressionRoleIds,
      botHighestPosition: input.botHighestPosition,
    });
    if (!decision.ok) {
      return { ok: false as const, reason: decision.reason };
    }
  }
  const presentation = panelPresentation({
    panelId: "publish",
    name: input.name,
    mode: input.mode,
    selection: input.selection,
    options: input.options.map((option) => ({ roleId: option.roleId, label: option.label, emoji: option.emoji ?? null })),
  });
  if (!presentation.ok) {
    return { ok: false as const, reason: presentation.reason };
  }
  const panel = await db.rolePanel.create({
    data: { id: randomUUID(), guildId: input.guildId, name: input.name, mode: input.mode, selection: input.selection },
  });
  for (const option of input.options) {
    await db.rolePanelOption.create({
      data: {
        id: randomUUID(),
        panelId: panel.id,
        roleId: option.roleId,
        label: option.label,
        exclusiveGroup: option.exclusiveGroup ?? null,
        prerequisiteRoleIds: (option.prerequisiteRoleIds ?? []) as Prisma.InputJsonValue,
        emoji: option.emoji ?? null,
      },
    });
  }
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "roles.panel",
    targetType: "role_panel",
    targetId: panel.id,
    reason: input.reason,
  });
  return { ok: true as const, panelId: panel.id };
}

export async function togglePanelRole(
  db: Writer,
  input: {
    guildId: string;
    userId: string;
    roleId: string;
    clear: boolean;
    toggle?: boolean;
    heldRoleIds: readonly string[];
    now: Date;
    assignment?: { roles: readonly RoleDescriptor[]; botHighestPosition: number };
  },
) {
  const option = await db.rolePanelOption.findFirst({ where: { roleId: input.roleId } });
  if (!option) {
    return { ok: false as const, reason: "unknown_role" as const };
  }
  const panel = await db.rolePanel.findUnique({ where: { id: option.panelId } });
  if (!panel || panel.guildId !== input.guildId || panel.retiredAt) {
    return { ok: false as const, reason: "retired" as const };
  }
  const options = await db.rolePanelOption.findMany({ where: { panelId: panel.id } });
  const selected = await selectedRoleIds(db, input.guildId, input.userId, panel.id);
  const clear = input.toggle ? selected.includes(input.roleId) : input.clear;
  if (!clear) {
    const allowed = await assignmentDecision(db, input.guildId, input.roleId, input.assignment);
    if (!allowed.ok) {
      return allowed;
    }
  }
  const next = nextPanelSelection({
    selection: panel.selection === "single" ? "single" : "multiple",
    options: options.map(optionRule),
    heldRoleIds: input.heldRoleIds,
    selectedRoleIds: selected,
    roleId: input.roleId,
    clear,
  });
  if (!next.ok) {
    return next;
  }
  await applyRoleSet(db, { guildId: input.guildId, userId: input.userId, panelId: panel.id, previous: selected, next: next.next, now: input.now });
  return { ok: true as const, selected: next.next };
}

export async function setPanelSelection(
  db: Writer,
  input: {
    guildId: string;
    userId: string;
    panelId: string;
    roleIds: readonly string[];
    heldRoleIds: readonly string[];
    now: Date;
    assignment?: { roles: readonly RoleDescriptor[]; botHighestPosition: number };
  },
) {
  const panel = await db.rolePanel.findUnique({ where: { id: input.panelId } });
  if (!panel || panel.guildId !== input.guildId || panel.retiredAt) {
    return { ok: false as const, reason: "retired" as const };
  }
  const options = await db.rolePanelOption.findMany({ where: { panelId: panel.id } });
  const next = normalisePanelSelection({
    selection: panel.selection === "single" ? "single" : "multiple",
    options: options.map(optionRule),
    heldRoleIds: input.heldRoleIds,
    roleIds: input.roleIds,
  });
  if (!next.ok) {
    return next;
  }
  const selected = await selectedRoleIds(db, input.guildId, input.userId, panel.id);
  for (const roleId of next.next) {
    if (selected.includes(roleId)) {
      continue;
    }
    const allowed = await assignmentDecision(db, input.guildId, roleId, input.assignment);
    if (!allowed.ok) {
      return allowed;
    }
  }
  await applyRoleSet(db, {
    guildId: input.guildId,
    userId: input.userId,
    panelId: panel.id,
    previous: selected,
    next: next.next,
    now: input.now,
  });
  return { ok: true as const, selected: next.next };
}

function optionRule(item: { roleId: string; exclusiveGroup: string | null; prerequisiteRoleIds: unknown }) {
  return {
    roleId: item.roleId,
    exclusiveGroup: item.exclusiveGroup,
    prerequisiteRoleIds: Array.isArray(item.prerequisiteRoleIds) ? item.prerequisiteRoleIds.map(String) : [],
  };
}

async function assignmentDecision(
  db: Writer,
  guildId: string,
  roleId: string,
  assignment: { roles: readonly RoleDescriptor[]; botHighestPosition: number } | undefined,
) {
  const settings = await settingsOf(db, guildId);
  const role = assignment?.roles.find((item) => item.id === roleId);
  if (!settings || !role || !assignment) {
    return { ok: false as const, reason: "missing_role" as const };
  }
  const staff = await db.capabilityGrant.findMany({ where: { guildId } });
  return selfSelectDecision({
    role,
    verifiedRoleId: settings.verifiedRoleId,
    staffRoleIds: staff.map((grant) => grant.roleId),
    progressionRoleIds: settings.progressionRoleIds,
    botHighestPosition: assignment.botHighestPosition,
  });
}

async function applyRoleSet(
  db: Writer,
  input: { guildId: string; userId: string; panelId: string; previous: readonly string[]; next: readonly string[]; now: Date },
) {
  const previous = new Set(input.previous);
  const desired = new Set(input.next);
  for (const roleId of previous) {
    if (!desired.has(roleId)) {
      await endGrant(db, {
        guildId: input.guildId,
        userId: input.userId,
        roleId,
        source: "panel",
        sourceId: `${input.panelId}:${roleId}`,
        now: input.now,
        endReason: "deselected",
      });
    }
  }
  for (const roleId of desired) {
    if (!previous.has(roleId)) {
      await ensurePermanentGrant(db, {
        guildId: input.guildId,
        userId: input.userId,
        roleId,
        source: "panel",
        sourceId: `${input.panelId}:${roleId}`,
        now: input.now,
      });
    }
  }
}

async function selectedRoleIds(db: Writer, guildId: string, userId: string, panelId: string) {
  const grants = await db.roleEntitlement.findMany({
    where: { guildId, userId, source: "panel", endedAt: null },
  });
  return grants
    .filter((grant) => grant.sourceId.startsWith(`${panelId}:`))
    .map((grant) => grant.roleId);
}

export async function grantTemporaryRole(
  db: Writer,
  input: {
    guildId: string;
    actorUserId: string;
    actorRoleIds: readonly string[];
    userId: string;
    roleId: string;
    days: number;
    reason: string;
    now: Date;
    sourceId?: string;
  },
) {
  const allowed = await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "moderation" });
  if (allowed === "denied") {
    return { result: "denied" as const };
  }
  if (!Number.isInteger(input.days) || input.days < 1) {
    throw new CommunityError("A grant needs a whole number of days.");
  }
  const sourceId = input.sourceId ?? "staff";
  const existing = await db.roleEntitlement.findUnique({
    where: {
      guildId_userId_roleId_source_sourceId: {
        guildId: input.guildId,
        userId: input.userId,
        roleId: input.roleId,
        source: "staff",
        sourceId,
      },
    },
  });
  const addMs = input.days * DAY_MS;
  const expiresAt =
    existing && !existing.endedAt && existing.expiresAt
      ? stackExpiry(existing.expiresAt, input.now, addMs)
      : new Date(input.now.getTime() + addMs);
  const grant = existing
    ? await db.roleEntitlement.update({
        where: { id: existing.id },
        data: { kind: "temporary", expiresAt, pausedRemainingMs: null, endedAt: null, endReason: null },
      })
    : await db.roleEntitlement.create({
        data: {
          id: randomUUID(),
          guildId: input.guildId,
          userId: input.userId,
          roleId: input.roleId,
          kind: "temporary",
          source: "staff",
          sourceId,
          expiresAt,
          updatedAt: input.now,
        },
      });
  await scheduleExpiry(db, input.guildId, grant.id, expiresAt);
  await syncRole(db, { guildId: input.guildId, userId: input.userId, roleId: input.roleId, now: input.now });
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "temprole.grant",
    targetType: "role_entitlement",
    targetId: grant.id,
    reason: input.reason,
  });
  return { result: "granted" as const, expiresAt };
}

export async function grantSystemRole(
  db: Writer,
  input: {
    guildId: string;
    userId: string;
    roleId: string;
    source: string;
    sourceId: string;
    kind: "permanent" | "temporary";
    expiresAt: Date | null;
    now: Date;
  },
) {
  if (input.kind === "permanent") {
    await ensurePermanentGrant(db, input);
    return { result: "granted" as const, expiresAt: null };
  }
  if (!input.expiresAt) {
    throw new CommunityError("A temporary grant needs an expiry.");
  }
  const existing = await db.roleEntitlement.findUnique({
    where: {
      guildId_userId_roleId_source_sourceId: {
        guildId: input.guildId,
        userId: input.userId,
        roleId: input.roleId,
        source: input.source,
        sourceId: input.sourceId,
      },
    },
  });
  const grant = existing
    ? await db.roleEntitlement.update({
        where: { id: existing.id },
        data: { kind: "temporary", expiresAt: input.expiresAt, pausedRemainingMs: null, endedAt: null, endReason: null },
      })
    : await db.roleEntitlement.create({
        data: {
          id: randomUUID(),
          guildId: input.guildId,
          userId: input.userId,
          roleId: input.roleId,
          kind: "temporary",
          source: input.source,
          sourceId: input.sourceId,
          expiresAt: input.expiresAt,
          updatedAt: input.now,
        },
      });
  await scheduleExpiry(db, input.guildId, grant.id, input.expiresAt);
  await syncRole(db, input);
  return { result: "granted" as const, expiresAt: input.expiresAt, grantId: grant.id };
}

export async function endSystemGrant(
  db: Writer,
  input: { guildId: string; userId: string; roleId: string; source: string; sourceId: string; now: Date; endReason: string },
) {
  await endGrant(db, input);
  return { result: "ended" as const };
}

export async function setExactExpiry(
  db: Writer,
  input: {
    guildId: string;
    actorUserId: string;
    actorRoleIds: readonly string[];
    userId: string;
    roleId: string;
    expiresAt: Date;
    reason: string;
    now: Date;
  },
) {
  const allowed = await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "moderation" });
  if (allowed === "denied") {
    return { result: "denied" as const };
  }
  const existing = await db.roleEntitlement.findFirst({
    where: { guildId: input.guildId, userId: input.userId, roleId: input.roleId, source: "staff", endedAt: null },
  });
  if (!existing) {
    return { result: "missing" as const };
  }
  await db.roleEntitlement.update({
    where: { id: existing.id },
    data: { expiresAt: input.expiresAt, pausedRemainingMs: null },
  });
  await scheduleExpiry(db, input.guildId, existing.id, input.expiresAt);
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "temprole.expiry",
    targetType: "role_entitlement",
    targetId: existing.id,
    reason: input.reason,
  });
  return { result: "updated" as const, expiresAt: input.expiresAt };
}

export async function expireDueGrant(db: PrismaClient, grantId: string, now: Date) {
  const grant = await db.roleEntitlement.findUnique({ where: { id: grantId } });
  if (!grant || grant.endedAt || grant.kind === "permanent" || grant.pausedRemainingMs !== null) {
    return { changed: false as const };
  }
  if (!grant.expiresAt || grant.expiresAt.getTime() > now.getTime()) {
    return { changed: false as const };
  }
  await db.roleEntitlement.update({
    where: { id: grant.id },
    data: { endedAt: now, endReason: "expired" },
  });
  await syncRole(db, { guildId: grant.guildId, userId: grant.userId, roleId: grant.roleId, now });
  return { changed: true as const, roleId: grant.roleId };
}

export async function sweepExpiredGrants(db: PrismaClient, now: Date) {
  const due = await db.roleEntitlement.findMany({
    where: { kind: "temporary", endedAt: null, pausedRemainingMs: null, expiresAt: { lte: now } },
    take: 50,
  });
  let changed = 0;
  for (const grant of due) {
    const result = await expireDueGrant(db, grant.id, now);
    if (result.changed) {
      changed += 1;
    }
  }
  return { changed };
}

export async function noteMemberAbsence(
  db: Writer,
  input: { guildId: string; userId: string; now: Date },
) {
  const settings = await settingsOf(db, input.guildId);
  if (!settings?.pauseEntitlementsWhileAbsent) {
    return { paused: false as const };
  }
  const grants = await db.roleEntitlement.findMany({
    where: { guildId: input.guildId, userId: input.userId, kind: "temporary", endedAt: null, pausedRemainingMs: null },
  });
  for (const grant of grants) {
    if (!grant.expiresAt) {
      continue;
    }
    await db.roleEntitlement.update({
      where: { id: grant.id },
      data: { pausedRemainingMs: pauseRemaining(grant.expiresAt, input.now), expiresAt: null },
    });
  }
  return { paused: true as const, count: grants.length };
}

export async function noteMemberReturn(
  db: Writer,
  input: { guildId: string; userId: string; native: NativeMemberState; now: Date },
) {
  const grants = await db.roleEntitlement.findMany({
    where: { guildId: input.guildId, userId: input.userId, endedAt: null, pausedRemainingMs: { not: null } },
  });
  for (const grant of grants) {
    if (grant.pausedRemainingMs === null) {
      continue;
    }
    const expiresAt = new Date(input.now.getTime() + grant.pausedRemainingMs);
    await db.roleEntitlement.update({
      where: { id: grant.id },
      data: { expiresAt, pausedRemainingMs: null },
    });
    await scheduleExpiry(db, input.guildId, grant.id, expiresAt);
  }
  return reconcileMember(db, input);
}

export async function saveHandle(
  db: Writer,
  input: { guildId: string; userId: string; provider: string; handle: string },
) {
  if (!isAccountProvider(input.provider)) {
    return { result: "unknown_provider" as const };
  }
  const handle = input.handle.trim();
  if (!handle) {
    throw new CommunityError("A handle is required.");
  }
  await db.linkedAccount.upsert({
    where: { guildId_userId_provider: { guildId: input.guildId, userId: input.userId, provider: input.provider } },
    create: {
      id: randomUUID(),
      guildId: input.guildId,
      userId: input.userId,
      provider: input.provider,
      handle,
      visibility: "private",
      ownership: "self_reported",
      updatedAt: new Date(),
    },
    update: { handle, ownership: "self_reported", providerSubject: null, unlinkedAt: null },
  });
  return { result: "saved" as const, ownership: "self_reported" as const, ordinaryAccess: "unaffected" as const };
}

export async function setAccountVisibility(
  db: Writer,
  input: { guildId: string; userId: string; provider: string; visibility: string },
) {
  if (input.visibility !== "public" && input.visibility !== "private") {
    return { result: "invalid_visibility" as const };
  }
  const account = await db.linkedAccount.findUnique({
    where: { guildId_userId_provider: { guildId: input.guildId, userId: input.userId, provider: input.provider } },
  });
  if (!account || account.unlinkedAt) {
    return { result: "missing" as const };
  }
  await db.linkedAccount.update({ where: { id: account.id }, data: { visibility: input.visibility } });
  return { result: "updated" as const, ordinaryAccess: "unaffected" as const };
}

export async function unlinkAccount(db: Writer, input: { guildId: string; userId: string; provider: string; now: Date }) {
  const account = await db.linkedAccount.findUnique({
    where: { guildId_userId_provider: { guildId: input.guildId, userId: input.userId, provider: input.provider } },
  });
  if (!account || account.unlinkedAt) {
    return { result: "missing" as const };
  }
  await db.linkedAccount.update({ where: { id: account.id }, data: { unlinkedAt: input.now } });
  return { result: "unlinked" as const, ordinaryAccess: "unaffected" as const };
}

export async function listOwnAccounts(db: Writer, input: { guildId: string; userId: string }) {
  const accounts = await db.linkedAccount.findMany({
    where: { guildId: input.guildId, userId: input.userId, unlinkedAt: null },
  });
  return accounts.map((account) => ({
    provider: account.provider,
    handle: account.handle,
    visibility: account.visibility,
    ownership: account.ownership,
  }));
}

export interface OwnershipAdapter {
  prove(input: { provider: string; handle: string }): Promise<{ verified: false; reason: string } | { verified: true; subject: string }>;
}

export const shippedOwnershipAdapter: OwnershipAdapter = {
  async prove() {
    return { verified: false, reason: "live_exchange_unavailable" };
  },
};

export async function proveOwnership(
  db: Writer,
  input: {
    guildId: string;
    userId: string;
    provider: string;
    credentials: Record<string, string | undefined>;
    adapter?: OwnershipAdapter;
  },
) {
  if (!isAccountProvider(input.provider)) {
    return { result: "unknown_provider" as const };
  }
  const status = providerStatuses(input.credentials).find((item) => item.provider === input.provider);
  const account = await db.linkedAccount.findUnique({
    where: { guildId_userId_provider: { guildId: input.guildId, userId: input.userId, provider: input.provider } },
  });
  if (!status || !account || account.unlinkedAt) {
    return { result: "setup_required" as const, ownership: "self_reported" as const };
  }
  if (status.status !== "ready" || status.ownershipProof === "unavailable") {
    const boundary = beginOwnershipProof(status);
    return { result: boundary.status, reason: boundary.reason, ownership: account.ownership, adapterCalled: false as const };
  }
  const proof = await (input.adapter ?? shippedOwnershipAdapter).prove({ provider: input.provider, handle: account.handle });
  if (!proof.verified) {
    return { result: "setup_required" as const, reason: proof.reason, ownership: "self_reported" as const, adapterCalled: true as const };
  }
  await db.linkedAccount.update({
    where: { id: account.id },
    data: { ownership: "verified", providerSubject: proof.subject },
  });
  return { result: "verified" as const, ownership: "verified" as const, adapterCalled: true as const };
}

function panelMode(value: string): "reaction" | "button" | "select" {
  if (value === "reaction" || value === "select") {
    return value;
  }
  return "button";
}

export async function listRolePanels(db: Writer, guildId: string) {
  const panels = await db.rolePanel.findMany({ where: { guildId, retiredAt: null }, orderBy: { createdAt: "asc" } });
  const options = await db.rolePanelOption.findMany({ where: { panelId: { in: panels.map((panel) => panel.id) } } });
  return panels
    .map((panel) => ({
      id: panel.id,
      name: panel.name,
      mode: panelMode(panel.mode),
      selection: panel.selection === "single" ? ("single" as const) : ("multiple" as const),
      options: options
        .filter((option) => option.panelId === panel.id)
        .map((option) => ({ roleId: option.roleId, label: option.label, emoji: option.emoji })),
    }))
    .filter((panel) => panel.options.length > 0);
}

export async function bindPanelPost(
  db: Writer,
  input: { messageId: string; guildId: string; channelId: string; panelId: string },
) {
  await db.rolePanelPost.upsert({
    where: { messageId: input.messageId },
    create: input,
    update: { guildId: input.guildId, channelId: input.channelId, panelId: input.panelId },
  });
}

export async function panelPostForMessage(db: Writer, messageId: string) {
  return db.rolePanelPost.findUnique({ where: { messageId } });
}

export function listProviderStatuses(credentials: Record<string, string | undefined>): ProviderCredentialStatus[] {
  return providerStatuses(credentials);
}

export async function deliverRoleUpdate(
  payload: unknown,
  apply: (change: { guildId: string; userId: string; roleId: string; action: "add" | "remove" }) => Promise<"applied" | "setup_required">,
) {
  const change = payload as { guildId?: string; userId?: string; roleId?: string; action?: string };
  if (!change.guildId || !change.userId || !change.roleId || (change.action !== "add" && change.action !== "remove")) {
    throw new CommunityError("Role update payload is incomplete.");
  }
  const result = await apply({
    guildId: change.guildId,
    userId: change.userId,
    roleId: change.roleId,
    action: change.action,
  });
  if (result === "setup_required") {
    throw new CommunityError("Discord role changes are setup_required.");
  }
}
