import { createHash, randomUUID } from "node:crypto";

import {
  activeWarningPoints,
  attributeAuditActor,
  evaluateRules,
  examplePolicy,
  hierarchyDecision,
  logContent,
  preparePolicy,
  type AuditCandidate,
  type ModerationAction,
  type ModerationPolicyInput,
  type WarningView,
} from "@collective/domain";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

import { actorCan, enqueueJob, enqueueOutbox, writeAudit, type Writer } from "./platform.js";
import { openTicket } from "./tickets.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export class ModerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModerationError";
  }
}

function asPolicy(value: unknown): ModerationPolicyInput | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<ModerationPolicyInput>;
  if (!Array.isArray(record.rules) || !Array.isArray(record.escalation)) {
    return null;
  }
  return record as ModerationPolicyInput;
}

function contentHash(content: string | null): string | null {
  if (!content) {
    return null;
  }
  return createHash("sha256").update(content.trim().toLowerCase()).digest("hex");
}

export async function readModerationPolicy(db: Writer, guildId: string) {
  const row = await db.moderationPolicy.findUnique({ where: { guildId } });
  if (!row) {
    return { stored: false as const, version: 0, policy: examplePolicy() };
  }
  return { stored: true as const, version: row.version, policy: asPolicy(row.document) ?? examplePolicy() };
}

export async function ensureModerationPolicy(db: Writer, guildId: string) {
  const current = await readModerationPolicy(db, guildId);
  if (current.stored) {
    return current;
  }
  const prepared = preparePolicy(examplePolicy());
  await db.moderationPolicy.create({
    data: {
      guildId,
      version: 1,
      label: prepared.policy.label,
      document: prepared.policy as unknown as Prisma.InputJsonValue,
      updatedAt: new Date(),
    },
  });
  return { stored: true as const, version: 1, policy: prepared.policy };
}

export async function saveModerationPolicy(
  db: Writer,
  input: { guildId: string; policy: ModerationPolicyInput; actorUserId: string; reason: string },
) {
  const prepared = preparePolicy(input.policy);
  const current = await db.moderationPolicy.findUnique({ where: { guildId: input.guildId } });
  const version = (current?.version ?? 0) + 1;
  await db.moderationPolicy.upsert({
    where: { guildId: input.guildId },
    create: {
      guildId: input.guildId,
      version,
      label: prepared.policy.label,
      document: prepared.policy as unknown as Prisma.InputJsonValue,
      updatedAt: new Date(),
    },
    update: { version, label: prepared.policy.label, document: prepared.policy as unknown as Prisma.InputJsonValue },
  });
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "moderation.policy",
    targetType: "moderation_policy",
    targetId: input.guildId,
    reason: input.reason,
  });
  return { ok: true as const, version, banRemoved: prepared.banRemoved, policy: prepared.policy };
}

export async function ingestMessage(
  db: Writer,
  input: {
    guildId: string;
    userId: string;
    channelId: string;
    content: string | null;
    mentionCount: number;
    roleIds: readonly string[];
    targetPosition: number;
    botPosition: number;
    botPermissions: string;
    targetIsOwner: boolean;
    messageId?: string | null;
    now: Date;
  },
) {
  const loaded = await ensureModerationPolicy(db, input.guildId);
  const policy = loaded.policy;
  const logged = await recordStaffLog(db, {
    guildId: input.guildId,
    kind: "message",
    channelId: input.channelId,
    targetId: input.messageId ?? input.userId,
    content: input.content,
    excludedChannelIds: policy.logExcludedChannelIds,
    candidates: [],
    action: "message_create",
    occurredAt: input.now,
    now: input.now,
  });
  const hash = contentHash(input.content);
  await db.moderationSignal.create({
    data: {
      id: randomUUID(),
      guildId: input.guildId,
      userId: input.userId,
      channelId: input.channelId,
      kind: "message",
      contentHash: hash,
      mentionCount: input.mentionCount,
      createdAt: input.now,
    },
  });
  const recentCount = await countSignals(db, input.guildId, input.userId, "message", null, windowStart(policy, "flood", input.now));
  const repeatedCount = hash
    ? await countSignals(db, input.guildId, input.userId, "message", hash, windowStart(policy, "repeat", input.now))
    : 0;
  const active = await warningTotal(db, input.guildId, input.userId, input.now);
  const decision = evaluateRules(policy, {
    kind: "message",
    channelId: input.channelId,
    roleIds: input.roleIds,
    content: input.content,
    mentionCount: input.mentionCount,
    recentCount,
    repeatedCount,
  }, active);
  const cases = [];
  for (const action of decision.actions) {
    cases.push(await openCase(db, {
      guildId: input.guildId,
      targetUserId: input.userId,
      actorUserId: "automation",
      actorKind: "automation",
      action,
      reason: `Example or saved rule matched ${decision.matches.map((match) => match.ruleId).join(", ") || action}.`,
      evidence: { ruleIds: decision.matches.map((match) => match.ruleId), contentLabel: logged.contentLabel },
      ruleId: decision.matches[0]?.ruleId ?? null,
      ruleVersion: loaded.version,
      points: action === "warn" ? decision.pointsAdded : 0,
      channelId: input.channelId,
      messageId: input.messageId ?? null,
      targetPosition: input.targetPosition,
      botPosition: input.botPosition,
      botPermissions: input.botPermissions,
      targetIsOwner: input.targetIsOwner,
      actorPosition: input.botPosition,
      automated: true,
      alertChannelId: policy.alertChannelId,
      timeoutMinutes: action === "containment" ? policy.containmentMinutes : policy.timeoutMinutes,
      warningDays: policy.retentionDays,
      now: input.now,
    }));
  }
  return { matches: decision.matches, actions: decision.actions, banApplied: decision.ban.applied, cases };
}

export async function ingestJoin(
  db: Writer,
  input: { guildId: string; userId: string; now: Date },
) {
  const loaded = await ensureModerationPolicy(db, input.guildId);
  await db.moderationSignal.create({
    data: { id: randomUUID(), guildId: input.guildId, userId: input.userId, kind: "join", mentionCount: 0, createdAt: input.now },
  });
  const joinCount = await countSignals(db, input.guildId, null, "join", null, windowStart(loaded.policy, "join_spike", input.now));
  const decision = evaluateRules(loaded.policy, { kind: "join", roleIds: [], joinCount });
  await recordStaffLog(db, {
    guildId: input.guildId,
    kind: "join",
    channelId: null,
    targetId: input.userId,
    content: null,
    excludedChannelIds: [],
    candidates: [],
    action: "member_join",
    occurredAt: input.now,
    now: input.now,
  });
  return { joinCount, actions: decision.actions, banApplied: decision.ban.applied };
}

export async function manualSanction(
  db: Writer,
  input: {
    guildId: string;
    actorUserId: string;
    actorRoleIds: readonly string[];
    targetUserId: string;
    action: ModerationAction;
    reason: string;
    points: number;
    days: number | null;
    actorPosition: number;
    targetPosition: number;
    botPosition: number;
    botPermissions: string;
    targetIsOwner: boolean;
    channelId?: string | null;
    messageId?: string | null;
    now: Date;
  },
) {
  const allowed = await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "moderation" });
  if (allowed === "denied") {
    return { result: "denied" as const };
  }
  const policy = (await ensureModerationPolicy(db, input.guildId)).policy;
  const timeoutMinutes = input.days !== null && input.days > 0 ? input.days * 24 * 60 : policy.timeoutMinutes;
  const opened = await openCase(db, {
    ...input,
    actorKind: "staff",
    evidence: { staff: true },
    ruleId: null,
    ruleVersion: null,
    points: input.action === "warn" ? input.points : 0,
    channelId: input.channelId ?? null,
    messageId: input.messageId ?? null,
    automated: false,
    alertChannelId: policy.alertChannelId,
    timeoutMinutes,
    warningDays: input.days ?? policy.retentionDays,
  });
  return opened;
}

async function openCase(
  db: Writer,
  input: {
    guildId: string;
    targetUserId: string;
    actorUserId: string;
    actorKind: string;
    action: ModerationAction;
    reason: string;
    evidence: Prisma.InputJsonValue;
    ruleId: string | null;
    ruleVersion: number | null;
    points: number;
    channelId: string | null;
    messageId: string | null;
    actorPosition: number;
    targetPosition: number;
    botPosition: number;
    botPermissions: string;
    targetIsOwner: boolean;
    automated: boolean;
    alertChannelId: string | null;
    timeoutMinutes: number;
    warningDays: number;
    now: Date;
  },
) {
  if (input.action === "ban" && input.automated) {
    const id = randomUUID();
    await db.moderationCase.create({
      data: caseData(id, input, "failed", "automatic_ban_disabled"),
    });
    return { result: "failed" as const, caseId: id, outcome: "failed" as const, reason: "automatic_ban_disabled" as const };
  }
  const hierarchy = hierarchyDecision({
    action: input.action,
    actorPosition: input.actorPosition,
    targetPosition: input.targetPosition,
    botPosition: input.botPosition,
    botPermissions: input.botPermissions,
    targetIsOwner: input.targetIsOwner,
    automated: input.automated,
  });
  const id = randomUUID();
  if (!hierarchy.ok) {
    await db.moderationCase.create({ data: caseData(id, input, "failed", hierarchy.reason) });
    return { result: "failed" as const, caseId: id, outcome: "failed" as const, reason: hierarchy.reason };
  }
  if (input.action === "delete" && !input.messageId) {
    await db.moderationCase.create({ data: caseData(id, input, "failed", "missing_message") });
    return { result: "failed" as const, caseId: id, outcome: "failed" as const, reason: "missing_message" as const };
  }
  if (input.action === "alert" && !input.alertChannelId) {
    await db.moderationCase.create({ data: caseData(id, input, "failed", "alert_channel_unset") });
    return { result: "failed" as const, caseId: id, outcome: "failed" as const, reason: "alert_channel_unset" as const };
  }
  const temporary = input.action === "timeout" || input.action === "containment";
  const expiresAt = temporary ? new Date(input.now.getTime() + input.timeoutMinutes * 60 * 1000) : null;
  await db.moderationCase.create({
    data: {
      ...caseData(id, input, temporary || input.action === "delete" || input.action === "kick" || input.action === "alert" ? "pending" : "applied", null),
      expiresAt,
    },
  });
  if (input.action === "warn" && input.points > 0) {
    const warningId = randomUUID();
    const warningExpires = new Date(input.now.getTime() + input.warningDays * DAY_MS);
    await db.warningPoint.create({
      data: {
        id: warningId,
        guildId: input.guildId,
        userId: input.targetUserId,
        caseId: id,
        points: input.points,
        status: "active",
        expiresAt: warningExpires,
        createdAt: input.now,
      },
    });
    await enqueueJob(db, {
      guildId: input.guildId,
      jobType: "moderation.warning.expire",
      payload: { warningId },
      idempotencyKey: `warning-expire:${warningId}:${warningExpires.toISOString()}`,
      runAt: warningExpires,
    });
  }
  if (temporary && expiresAt) {
    await enqueueJob(db, {
      guildId: input.guildId,
      jobType: "moderation.sanction.expire",
      payload: { caseId: id },
      idempotencyKey: `sanction-expire:${id}:${expiresAt.toISOString()}`,
      runAt: expiresAt,
    });
  }
  if (input.action === "delete" || input.action === "timeout" || input.action === "containment" || input.action === "kick") {
    await enqueueOutbox(db, {
      guildId: input.guildId,
      eventType: "discord.moderation",
      payload: {
        caseId: id,
        guildId: input.guildId,
        action: input.action,
        targetUserId: input.targetUserId,
        channelId: input.channelId,
        messageId: input.messageId,
        expiresAt: expiresAt?.toISOString() ?? null,
      },
      idempotencyKey: `moderation:${id}`,
    });
  }
  if (input.action === "alert" && input.alertChannelId) {
    await enqueueOutbox(db, {
      guildId: input.guildId,
      eventType: "moderation.alert",
      payload: { caseId: id, guildId: input.guildId, channelId: input.alertChannelId },
      idempotencyKey: `moderation-alert:${id}`,
    });
  }
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: `moderation.${input.action}`,
    targetType: "moderation_case",
    targetId: id,
    reason: input.reason,
  });
  return { result: "recorded" as const, caseId: id, outcome: temporary || input.action === "delete" ? ("pending" as const) : ("applied" as const) };
}

function caseData(
  id: string,
  input: {
    guildId: string;
    targetUserId: string;
    actorUserId: string;
    actorKind: string;
    action: string;
    reason: string;
    evidence: Prisma.InputJsonValue;
    ruleId: string | null;
    ruleVersion: number | null;
    points: number;
    now: Date;
  },
  outcome: string,
  failureReason: string | null,
) {
  return {
    id,
    guildId: input.guildId,
    targetUserId: input.targetUserId,
    actorUserId: input.actorUserId,
    actorKind: input.actorKind,
    action: input.action,
    outcome,
    failureReason,
    reason: input.reason,
    evidence: input.evidence,
    ruleId: input.ruleId,
    ruleVersion: input.ruleVersion,
    points: input.points,
    updatedAt: input.now,
  };
}

export async function deliverModeration(
  db: PrismaClient,
  payload: unknown,
  apply: (change: {
    guildId: string;
    action: string;
    targetUserId: string;
    channelId: string | null;
    messageId: string | null;
  }) => Promise<"applied" | "setup_required" | "hierarchy" | "permission" | "missing_message">,
) {
  const change = payload as {
    caseId?: string;
    guildId?: string;
    action?: string;
    targetUserId?: string;
    channelId?: string | null;
    messageId?: string | null;
  };
  if (!change.caseId || !change.guildId || !change.action || !change.targetUserId) {
    throw new ModerationError("Moderation delivery payload is incomplete.");
  }
  const result = await apply({
    guildId: change.guildId,
    action: change.action,
    targetUserId: change.targetUserId,
    channelId: change.channelId ?? null,
    messageId: change.messageId ?? null,
  });
  if (result === "setup_required") {
    throw new ModerationError("Discord moderation delivery is setup_required.");
  }
  await db.moderationCase.update({
    where: { id: change.caseId },
    data: result === "applied" ? { outcome: "applied", failureReason: null } : { outcome: "failed", failureReason: result },
  });
  return { outcome: result === "applied" ? "applied" as const : "failed" as const, reason: result };
}

export async function expireWarning(db: PrismaClient, warningId: string, now: Date) {
  const warning = await db.warningPoint.findUnique({ where: { id: warningId } });
  if (!warning || warning.status !== "active" || !warning.expiresAt || warning.expiresAt.getTime() > now.getTime()) {
    return { changed: false as const };
  }
  await db.warningPoint.update({ where: { id: warning.id }, data: { status: "expired" } });
  return { changed: true as const };
}

export async function sweepExpiredWarnings(db: PrismaClient, now: Date) {
  const due = await db.warningPoint.findMany({
    where: { status: "active", expiresAt: { lte: now } },
    take: 50,
  });
  let changed = 0;
  for (const warning of due) {
    const result = await expireWarning(db, warning.id, now);
    if (result.changed) {
      changed += 1;
    }
  }
  return { changed };
}

export async function expireSanction(db: PrismaClient, caseId: string, now: Date) {
  const record = await db.moderationCase.findUnique({ where: { id: caseId } });
  if (!record || !record.expiresAt || record.expiresAt.getTime() > now.getTime() || record.outcome === "reversed" || record.outcome === "failed") {
    return { changed: false as const };
  }
  await db.moderationCase.update({ where: { id: record.id }, data: { outcome: "expired" } });
  return { changed: true as const, outcome: "expired" as const };
}

export async function warningTotal(db: Writer, guildId: string, userId: string, now: Date) {
  const rows = await db.warningPoint.findMany({ where: { guildId, userId } });
  const views: WarningView[] = rows.map((row) => ({
    points: row.points,
    status: row.status === "reversed" || row.status === "expired" ? row.status : "active",
    expiresAt: row.expiresAt,
  }));
  return activeWarningPoints(views, now);
}

export async function reverseCase(
  db: Writer,
  input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; caseId: string; reason: string; now: Date },
) {
  const allowed = await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "moderation" });
  if (allowed === "denied") {
    return { result: "denied" as const };
  }
  const record = await db.moderationCase.findUnique({ where: { id: input.caseId } });
  if (!record || record.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  await db.moderationCase.update({ where: { id: record.id }, data: { outcome: "reversed", failureReason: null } });
  await db.warningPoint.updateMany({ where: { caseId: record.id, status: "active" }, data: { status: "reversed" } });
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "moderation.reverse",
    targetType: "moderation_case",
    targetId: record.id,
    reason: input.reason,
  });
  return { result: "reversed" as const, caseId: record.id };
}

export async function submitReport(
  db: Writer,
  input: { guildId: string; reporterUserId: string; targetUserId: string; note: string },
) {
  const note = input.note.trim();
  if (!note) {
    throw new ModerationError("A report needs a note.");
  }
  const id = randomUUID();
  await db.memberReport.create({
    data: {
      id,
      guildId: input.guildId,
      reporterUserId: input.reporterUserId,
      targetUserId: input.targetUserId,
      note,
      status: "open",
      ticketStatus: "pending",
    },
  });
  const opened = await openTicket(db, {
    guildId: input.guildId,
    userId: input.reporterUserId,
    categoryId: "moderation",
    answers: { note },
    source: "report",
    now: new Date(),
  });
  const ticketStatus = opened.result === "opened" ? "linked" : opened.result;
  await db.memberReport.update({
    where: { id },
    data: { ticketStatus, ...(opened.result === "opened" ? { ticketId: opened.ticketId } : {}) },
  });
  return {
    result: "submitted" as const,
    reportId: id,
    ticketStatus,
    ticketId: opened.result === "opened" ? opened.ticketId : null,
    grantsGeneralAccess: false as const,
  };
}

export async function listReports(
  db: Writer,
  input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; ownOnly: boolean },
) {
  if (!input.ownOnly) {
    const allowed = await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "moderation" });
    if (allowed === "denied") {
      return { result: "denied" as const, reports: [] };
    }
  }
  const reports = await db.memberReport.findMany({
    where: { guildId: input.guildId, ...(input.ownOnly ? { reporterUserId: input.actorUserId } : {}) },
  });
  return {
    result: "ok" as const,
    reports: reports.map((report) => ({
      id: report.id,
      targetUserId: input.ownOnly && report.reporterUserId !== input.actorUserId ? null : report.targetUserId,
      note: report.reporterUserId === input.actorUserId || !input.ownOnly ? report.note : null,
      ticketStatus: report.ticketStatus,
    })),
  };
}

export async function submitAppeal(
  db: Writer,
  input: { guildId: string; userId: string; caseId: string; note: string },
) {
  const record = await db.moderationCase.findUnique({ where: { id: input.caseId } });
  if (!record || record.guildId !== input.guildId || record.targetUserId !== input.userId) {
    return { result: "missing" as const };
  }
  const note = input.note.trim();
  if (!note) {
    throw new ModerationError("An appeal needs a note.");
  }
  const id = randomUUID();
  await db.moderationAppeal.create({
    data: { id, guildId: input.guildId, caseId: input.caseId, userId: input.userId, note, status: "open" },
  });
  const opened = await openTicket(db, {
    guildId: input.guildId,
    userId: input.userId,
    categoryId: "moderation",
    answers: { note },
    source: "appeal",
    now: new Date(),
    caseId: input.caseId,
  });
  const ticketStatus = opened.result === "opened" ? "linked" : opened.result;
  if (opened.result === "opened") {
    await db.moderationAppeal.update({ where: { id }, data: { ticketId: opened.ticketId } });
  }
  return { result: "submitted" as const, appealId: id, ticketStatus, ticketId: opened.result === "opened" ? opened.ticketId : null };
}

export async function resolveAppeal(
  db: Writer,
  input: {
    guildId: string;
    actorUserId: string;
    actorRoleIds: readonly string[];
    appealId: string;
    accept: boolean;
    reason: string;
    now: Date;
  },
) {
  const allowed = await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "moderation" });
  if (allowed === "denied") {
    return { result: "denied" as const };
  }
  const appeal = await db.moderationAppeal.findUnique({ where: { id: input.appealId } });
  if (!appeal || appeal.guildId !== input.guildId || appeal.status !== "open") {
    return { result: "missing" as const };
  }
  if (input.accept) {
    await reverseCase(db, {
      guildId: input.guildId,
      actorUserId: input.actorUserId,
      actorRoleIds: input.actorRoleIds,
      caseId: appeal.caseId,
      reason: input.reason,
      now: input.now,
    });
  }
  await db.moderationAppeal.update({
    where: { id: appeal.id },
    data: { status: input.accept ? "accepted" : "denied", resolution: input.reason, resolvedAt: input.now },
  });
  return { result: input.accept ? ("accepted" as const) : ("denied" as const) };
}

export async function recordStaffLog(
  db: Writer,
  input: {
    guildId: string;
    kind: string;
    channelId: string | null;
    targetId: string | null;
    content: string | null;
    excludedChannelIds: readonly string[];
    candidates: readonly AuditCandidate[];
    action: string;
    occurredAt: Date;
    now: Date;
  },
) {
  const policy = (await readModerationPolicy(db, input.guildId)).policy;
  const body = logContent({ content: input.content, channelId: input.channelId, excludedChannelIds: input.excludedChannelIds });
  const actor = attributeAuditActor({
    candidates: input.candidates,
    action: input.action,
    targetId: input.targetId ?? "",
    occurredAt: input.occurredAt,
    windowMs: 5_000,
  });
  const id = randomUUID();
  const retainUntil = new Date(input.now.getTime() + policy.retentionDays * DAY_MS);
  await db.staffLog.create({
    data: {
      id,
      guildId: input.guildId,
      kind: input.kind,
      channelId: input.channelId,
      actorUserId: actor.actorUserId,
      actorConfidence: actor.confidence,
      targetId: input.targetId,
      content: body.content,
      contentLabel: body.contentLabel,
      createdAt: input.now,
      retainUntil,
    },
  });
  await enqueueJob(db, {
    guildId: input.guildId,
    jobType: "moderation.log.retain",
    payload: { logId: id },
    idempotencyKey: `log-retain:${id}:${retainUntil.toISOString()}`,
    runAt: retainUntil,
  });
  return { id, ...body, actorUserId: actor.actorUserId, actorConfidence: actor.confidence };
}

export async function searchLogs(
  db: Writer,
  input: { guildId: string; actorRoleIds: readonly string[]; query: string },
) {
  const allowed = await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "moderation" });
  if (allowed === "denied") {
    return { result: "denied" as const, logs: [] };
  }
  const logs = await db.staffLog.findMany({ where: { guildId: input.guildId }, orderBy: { createdAt: "desc" }, take: 50 });
  const query = input.query.trim().toLowerCase();
  return {
    result: "ok" as const,
    logs: logs
      .filter((log) => !query || log.kind.includes(query) || (log.content ?? "").toLowerCase().includes(query))
      .map(publicLog),
  };
}

export async function exportLogs(
  db: Writer,
  input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; reason: string },
) {
  const found = await searchLogs(db, { guildId: input.guildId, actorRoleIds: input.actorRoleIds, query: "" });
  if (found.result === "denied") {
    return found;
  }
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "moderation.logs.export",
    targetType: "staff_log",
    targetId: input.guildId,
    reason: input.reason,
  });
  return { result: "ok" as const, logs: found.logs };
}

function publicLog(log: {
  id: string;
  kind: string;
  content: string | null;
  contentLabel: string;
  actorUserId: string | null;
  actorConfidence: string;
}) {
  return {
    id: log.id,
    kind: log.kind,
    content: log.contentLabel === "available" ? log.content : null,
    contentLabel: log.contentLabel,
    actorUserId: log.actorConfidence === "reliable" ? log.actorUserId : null,
    actorConfidence: log.actorConfidence,
  };
}

export async function retainLog(db: PrismaClient, logId: string, now: Date) {
  const log = await db.staffLog.findUnique({ where: { id: logId } });
  if (!log || log.retainUntil.getTime() > now.getTime() || log.contentLabel === "expired") {
    return { changed: false as const };
  }
  await db.staffLog.update({ where: { id: log.id }, data: { content: null, contentLabel: "expired" } });
  return { changed: true as const };
}

export async function sweepLogRetention(db: PrismaClient, now: Date) {
  const due = await db.staffLog.findMany({
    where: { retainUntil: { lte: now }, contentLabel: { not: "expired" } },
    take: 50,
  });
  let changed = 0;
  for (const log of due) {
    const result = await retainLog(db, log.id, now);
    if (result.changed) {
      changed += 1;
    }
  }
  return { changed };
}

async function countSignals(
  db: Writer,
  guildId: string,
  userId: string | null,
  kind: string,
  contentHash: string | null,
  since: Date,
) {
  return db.moderationSignal.count({
    where: {
      guildId,
      kind,
      createdAt: { gte: since },
      ...(userId ? { userId } : {}),
      ...(contentHash ? { contentHash } : {}),
    },
  });
}

function windowStart(policy: ModerationPolicyInput, kind: ModerationPolicyInput["rules"][number]["kind"], now: Date) {
  const rule = policy.rules.find((item) => item.kind === kind);
  const seconds = rule?.windowSeconds ?? 10;
  return new Date(now.getTime() - seconds * 1000);
}

export async function listCases(db: Writer, input: { guildId: string; actorRoleIds: readonly string[] }) {
  const allowed = await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "moderation" });
  if (allowed === "denied") {
    return { result: "denied" as const, cases: [] };
  }
  const cases = await db.moderationCase.findMany({ where: { guildId: input.guildId }, orderBy: { createdAt: "desc" }, take: 50 });
  return {
    result: "ok" as const,
    cases: cases.map((record) => ({
      id: record.id,
      targetUserId: record.targetUserId,
      action: record.action,
      outcome: record.outcome,
      failureReason: record.failureReason,
      points: record.points,
    })),
  };
}
