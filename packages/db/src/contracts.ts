import { randomUUID } from "node:crypto";

import {
  CONTRACT_CAPS,
  CONTRACT_SEEDS,
  answerHash,
  answerMatches,
  chatXpDecision,
  completionDelivery,
  contentHash,
  contractRewardKey,
  cycleDeadline,
  cycleId,
  evaluateObjective,
  exampleProgressionSettings,
  isContractBoard,
  isObjectiveKind,
  objectiveAvailability,
  pickObjectives,
  refreshDelivery,
  rerollDecision,
  timezoneIsValid,
  versionApplies,
  voiceXpDecision,
  type ContractBoard,
} from "@collective/domain";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

import { grantCharacterXp } from "./characters.js";
import { postContractIssue } from "./ledger.js";
import { actorCan, enqueueJob, ensureGuild, moduleIsAvailable, writeAudit, type Writer } from "./platform.js";

type Root = PrismaClient;
type Tx = Prisma.TransactionClient;

export type ContractDelivery = (input: {
  guildId: string;
  userId: string;
  delivery: "dm" | "channel";
  channelId: string;
  body: string;
}) => Promise<"sent" | "closed" | "setup_required">;

export const setupRequiredContractDelivery: ContractDelivery = async () => "setup_required";

interface ObjectiveSnapshot {
  id: string;
  revisionId: string;
  version: number;
  kind: string;
  title: string;
  prompt: string;
  band: string;
  target: number;
  rewardMarks: number;
  characterXp: number;
  availability: string;
}

interface AssignmentLock {
  id: string;
  guildId: string;
  userId: string;
  board: string;
  cycleId: string;
  definitionId: string;
  status: string;
  progress: number;
  target: number;
  rewardMarks: number;
  rewardKey: string;
  title: string;
  kind: string;
  version: number;
  revisionId: string;
  prompt: string;
  slot: number;
  payoutMarks: number;
  payoutStatus: string;
  characterXp: number;
}

function isUnique(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

async function lockKey(tx: Tx, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

async function ensureSettings(db: Writer, guildId: string) {
  await ensureGuild(db, { guildId });
  const existing = await db.contractSettings.findUnique({ where: { guildId } });
  if (existing) {
    return existing;
  }
  try {
    return await db.contractSettings.create({
      data: {
        guildId,
        timezone: "Australia/Perth",
        completionChannelId: "",
        dailyCount: 3,
        dailyCap: CONTRACT_CAPS.daily,
        weeklyCap: CONTRACT_CAPS.weekly,
        monthlyCap: CONTRACT_CAPS.monthly,
      },
    });
  } catch (error) {
    if (!isUnique(error)) {
      throw error;
    }
    const again = await db.contractSettings.findUnique({ where: { guildId } });
    if (!again) {
      throw error;
    }
    return again;
  }
}

async function ensurePreference(db: Writer, guildId: string, userId: string) {
  const existing = await db.contractPreference.findUnique({ where: { guildId_userId: { guildId, userId } } });
  if (existing) {
    return existing;
  }
  try {
    return await db.contractPreference.create({
      data: {
        id: randomUUID(),
        guildId,
        userId,
        refreshDaily: true,
        refreshWeekly: false,
        refreshMonthly: false,
        delivery: "dm",
        channelId: "",
        completionPings: true,
      },
    });
  } catch (error) {
    if (!isUnique(error)) {
      throw error;
    }
    const again = await db.contractPreference.findUnique({ where: { guildId_userId: { guildId, userId } } });
    if (!again) {
      throw error;
    }
    return again;
  }
}

async function ensureCatalog(db: Root, guildId: string, now: Date) {
  await ensureGuild(db, { guildId });
  if ((await db.contractDefinition.count({ where: { guildId } })) > 0) {
    return;
  }
  await db.$transaction(async (tx) => {
    await lockKey(tx, `contract-catalog:${guildId}`);
    if ((await tx.contractDefinition.count({ where: { guildId } })) > 0) {
      return;
    }
    for (const seed of CONTRACT_SEEDS) {
      const id = randomUUID();
      const revisionId = randomUUID();
      const availability = objectiveAvailability(seed.kind);
      const hashed = seed.answer ? answerHash(seed.answer) : "";
      await tx.contractRevision.create({
        data: {
          id: revisionId,
          guildId,
          definitionId: id,
          version: 1,
          kind: seed.kind,
          title: seed.title,
          prompt: seed.prompt,
          band: seed.band,
          target: seed.target,
          rewardMarks: seed.rewardMarks,
          answerHash: hashed,
          createdAt: now,
        },
      });
      await tx.contractDefinition.create({
        data: {
          id,
          guildId,
          slug: seed.slug,
          kind: seed.kind,
          title: seed.title,
          prompt: seed.prompt,
          band: seed.band,
          target: seed.target,
          rewardMarks: seed.rewardMarks,
          version: 1,
          answerHash: hashed,
          dailyPool: seed.dailyPool && availability === "ready",
          weeklyPool: seed.weeklyPool && availability === "ready",
          monthlyPool: seed.monthlyPool && availability === "ready",
          availability,
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
      });
    }
  });
}

function capFor(board: string, settings: { dailyCap: number; weeklyCap: number; monthlyCap: number }): number {
  if (board === "weekly") {
    return settings.weeklyCap;
  }
  if (board === "monthly") {
    return settings.monthlyCap;
  }
  return settings.dailyCap;
}

function present(row: {
  id: string;
  title: string;
  prompt: string;
  kind: string;
  board: string;
  cycleId: string;
  progress: number;
  target: number;
  rewardMarks: number;
  payoutMarks: number;
  payoutStatus: string;
  status: string;
  version: number;
  rewardKey: string;
  characterXp: number;
}, timeZone: string, cap: number) {
  let disclosure = `Shares the ${cap} Mark ${row.board} contract cap.`;
  if (row.payoutStatus === "reduced") {
    disclosure = `${disclosure} Paid ${row.payoutMarks} of ${row.rewardMarks} because the cap was reached.`;
  } else if (row.payoutStatus === "capped") {
    disclosure = `${disclosure} Completed with no payout because the cap was reached.`;
  }
  return {
    ...row,
    deadline: cycleDeadline(row.cycleId, timeZone).toISOString(),
    capMarks: cap,
    disclosure,
    characterXp: row.characterXp ?? 0,
  };
}

async function snapshotOf(db: Writer, definitionId: string, version: number): Promise<ObjectiveSnapshot | null> {
  const definition = await db.contractDefinition.findUnique({ where: { id: definitionId } });
  const revision = await db.contractRevision.findUnique({ where: { definitionId_version: { definitionId, version } } });
  if (!definition || !revision) {
    return null;
  }
  return {
    id: definition.id,
    revisionId: revision.id,
    version: revision.version,
    kind: revision.kind,
    title: revision.title,
    prompt: revision.prompt,
    band: revision.band,
    target: revision.target,
    rewardMarks: revision.rewardMarks,
    characterXp: revision.characterXp,
    availability: definition.availability,
  };
}

async function pool(db: Writer, guildId: string, board: ContractBoard): Promise<ObjectiveSnapshot[]> {
  const rows = await db.contractDefinition.findMany({ where: { guildId, status: "active", availability: "ready" } });
  const selected = rows.filter((row) => (board === "daily" ? row.dailyPool : board === "weekly" ? row.weeklyPool : row.monthlyPool));
  const snapshots = await Promise.all(selected.map((row) => snapshotOf(db, row.id, row.version)));
  return snapshots.filter((row): row is ObjectiveSnapshot => row !== null && objectiveAvailability(row.kind) === "ready");
}

function assignmentCreate(input: { guildId: string; userId: string; board: string; cycleId: string; slot: number; objective: ObjectiveSnapshot; now: Date }) {
  return {
    id: randomUUID(),
    guildId: input.guildId,
    userId: input.userId,
    board: input.board,
    cycleId: input.cycleId,
    slot: input.slot,
    definitionId: input.objective.id,
    revisionId: input.objective.revisionId,
    version: input.objective.version,
    kind: input.objective.kind,
    title: input.objective.title,
    prompt: input.objective.prompt,
    target: input.objective.target,
    progress: 0,
    rewardMarks: input.objective.rewardMarks,
    characterXp: input.objective.characterXp,
    payoutMarks: 0,
    payoutStatus: "pending",
    status: "assigned",
    rewardKey: contractRewardKey(input.guildId, input.userId, input.objective.id, input.cycleId),
    createdAt: input.now,
    updatedAt: input.now,
  };
}

async function queueNotice(db: Root, input: {
  guildId: string;
  userId: string;
  kind: "refresh" | "completion";
  board: string;
  cycleId: string;
  assignmentId: string;
  delivery: "dm" | "channel" | "skip";
  status: "pending" | "skipped" | "failed";
  reason: string;
  publicBody: string;
  now: Date;
}) {
  if (input.delivery === "skip" && input.status === "pending") {
    return;
  }
  const id = randomUUID();
  try {
    await db.contractNotice.create({
      data: {
        id,
        guildId: input.guildId,
        userId: input.userId,
        kind: input.kind,
        board: input.board,
        cycleId: input.cycleId,
        assignmentId: input.assignmentId,
        delivery: input.delivery === "skip" ? "channel" : input.delivery,
        status: input.status,
        reason: input.reason,
        attempts: 0,
        publicBody: input.delivery === "dm" ? "" : input.publicBody,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
  } catch (error) {
    if (isUnique(error)) {
      return;
    }
    throw error;
  }
  if (input.status === "pending") {
    await enqueueJob(db, {
      guildId: input.guildId,
      jobType: "contract.notify",
      payload: { noticeId: id },
      idempotencyKey: `contract-notice:${id}`,
      runAt: input.now,
    });
  }
}

async function queueRefresh(db: Root, input: { guildId: string; userId: string; board: ContractBoard; cycleId: string; titles: string[]; now: Date }) {
  const preference = await ensurePreference(db, input.guildId, input.userId);
  const settings = await ensureSettings(db, input.guildId);
  const enabled = input.board === "daily" ? preference.refreshDaily : input.board === "weekly" ? preference.refreshWeekly : preference.refreshMonthly;
  const delivery = refreshDelivery({ enabled, delivery: preference.delivery === "channel" ? "channel" : "dm" });
  if (delivery === "skip") {
    return;
  }
  const channelId = preference.channelId || settings.completionChannelId;
  if (delivery === "channel" && !channelId) {
    await queueNotice(db, { guildId: input.guildId, userId: input.userId, kind: "refresh", board: input.board, cycleId: input.cycleId, assignmentId: "", delivery: "channel", status: "failed", reason: "missing_channel", publicBody: "", now: input.now });
    return;
  }
  const publicBody = delivery === "channel" ? `Your ${input.board} contracts: ${input.titles.join(", ")}` : "";
  await queueNotice(db, { guildId: input.guildId, userId: input.userId, kind: "refresh", board: input.board, cycleId: input.cycleId, assignmentId: "", delivery, status: "pending", reason: "", publicBody, now: input.now });
}

async function queueCompletion(db: Root, input: { guildId: string; userId: string; board: string; cycleId: string; assignmentId: string; title: string; now: Date }) {
  const preference = await ensurePreference(db, input.guildId, input.userId);
  const settings = await ensureSettings(db, input.guildId);
  if (completionDelivery(preference.completionPings) === "skip") {
    await queueNotice(db, { ...input, kind: "completion", delivery: "skip", status: "skipped", reason: "pings_off", publicBody: "" });
    return;
  }
  if (!settings.completionChannelId) {
    await queueNotice(db, { ...input, kind: "completion", delivery: "channel", status: "failed", reason: "missing_channel", publicBody: "" });
    return;
  }
  await queueNotice(db, {
    ...input,
    kind: "completion",
    delivery: "channel",
    status: "pending",
    reason: "",
    publicBody: `<@${input.userId}> completed ${input.title}.`,
  });
}

async function payAssignment(tx: Tx, row: AssignmentLock, now: Date) {
  if (row.rewardMarks <= 0) {
    return { amountMarks: 0, payoutStatus: "posted" as const };
  }
  const settings = await ensureSettings(tx, row.guildId);
  const subcapScope = row.board === "weekly" ? "contract_weekly" as const : row.board === "monthly" ? "contract_monthly" as const : "contract_daily" as const;
  const paid = await postContractIssue(tx, {
    guildId: row.guildId,
    userId: row.userId,
    amountMarks: row.rewardMarks,
    subcapMarks: capFor(row.board, settings),
    subcapScope,
    subcapPeriod: row.cycleId,
    source: `contract.${row.board}`,
    sourceId: row.cycleId,
    idempotencyKey: row.rewardKey,
    reason: `Contract ${row.board} ${row.title}`,
    actorUserId: "system",
    now,
  });
  if (paid.result === "capped" || paid.result === "invalid") {
    return { amountMarks: 0, payoutStatus: "capped" as const };
  }
  const payoutStatus = paid.amountMarks <= 0 ? "capped" as const : paid.amountMarks < row.rewardMarks ? "reduced" as const : "posted" as const;
  return { amountMarks: paid.amountMarks, payoutStatus };
}

async function advanceAssignment(db: Root, id: string, delta: number, now: Date) {
  const step = Math.max(0, Math.trunc(delta));
  if (step <= 0) {
    return { result: "ignored" as const };
  }
  try {
    const outcome = await db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<AssignmentLock[]>`
        SELECT "id", "guildId", "userId", "board", "cycleId", "definitionId", "status", "progress", "target", "rewardMarks", "rewardKey", "title", "kind", "version", "revisionId", "prompt", "slot", "payoutMarks", "payoutStatus", "characterXp"
        FROM "contract_assignment" WHERE "id" = ${id} FOR UPDATE
      `;
      const row = rows[0];
      if (!row) {
        return { result: "missing" as const };
      }
      if (row.status !== "assigned") {
        return { result: "already_recorded" as const, payoutMarks: row.payoutMarks, guildId: row.guildId, userId: row.userId, rewardKey: row.rewardKey, characterXp: Number(row.characterXp) };
      }
      const evaluated = evaluateObjective({ kind: row.kind, progress: Number(row.progress), target: Number(row.target), delta: step });
      if (evaluated.result === "module_not_built") {
        return { result: "module_not_built" as const };
      }
      if (!evaluated.complete) {
        await tx.contractAssignment.update({ where: { id }, data: { progress: evaluated.progress, updatedAt: now } });
        return { result: "progress" as const, progress: evaluated.progress };
      }
      const paid = await payAssignment(tx, { ...row, progress: Number(row.progress), target: Number(row.target), rewardMarks: Number(row.rewardMarks), slot: Number(row.slot), version: Number(row.version) }, now);
      await tx.contractAssignment.update({
        where: { id },
        data: { progress: evaluated.progress, status: "completed", payoutMarks: paid.amountMarks, payoutStatus: paid.payoutStatus, updatedAt: now },
      });
      return {
        result: "completed" as const,
        payoutMarks: paid.amountMarks,
        payoutStatus: paid.payoutStatus,
        guildId: row.guildId,
        userId: row.userId,
        board: row.board,
        cycleId: row.cycleId,
        title: row.title,
        assignmentId: row.id,
        rewardKey: row.rewardKey,
        characterXp: Number(row.characterXp),
      };
    });
    if (outcome.result === "completed") {
      await queueCompletion(db, { guildId: outcome.guildId, userId: outcome.userId, board: outcome.board, cycleId: outcome.cycleId, assignmentId: outcome.assignmentId, title: outcome.title, now });
      if (outcome.characterXp > 0) {
        await grantCharacterXp(db, { guildId: outcome.guildId, userId: outcome.userId, amount: outcome.characterXp, source: "contract", idempotencyKey: `${outcome.rewardKey}:character-xp`, now });
      }
    }
    if (outcome.result === "already_recorded" && outcome.characterXp > 0) {
      await grantCharacterXp(db, { guildId: outcome.guildId, userId: outcome.userId, amount: outcome.characterXp, source: "contract", idempotencyKey: `${outcome.rewardKey}:character-xp`, now });
    }
    return outcome;
  } catch (error) {
    if (!isUnique(error)) {
      throw error;
    }
    const current = await db.contractAssignment.findUnique({ where: { id } });
    if (current && current.characterXp > 0) {
      await grantCharacterXp(db, { guildId: current.guildId, userId: current.userId, amount: current.characterXp, source: "contract", idempotencyKey: `${current.rewardKey}:character-xp`, now });
    }
    return { result: "already_recorded" as const, payoutMarks: current?.payoutMarks ?? 0 };
  }
}

async function participation(db: Writer, guildId: string) {
  const example = exampleProgressionSettings();
  const row = await db.progressionSettings.findUnique({ where: { guildId } });
  if (!row || !row.document || typeof row.document !== "object") {
    return example;
  }
  const document = row.document as Partial<ReturnType<typeof exampleProgressionSettings>>;
  return {
    ...example,
    messageCooldownSeconds: document.messageCooldownSeconds ?? example.messageCooldownSeconds,
    minimumMessageLength: document.minimumMessageLength ?? example.minimumMessageLength,
    repeatWindowSeconds: document.repeatWindowSeconds ?? example.repeatWindowSeconds,
    excludedChannelIds: document.excludedChannelIds ?? example.excludedChannelIds,
    voiceMinHumans: document.voiceMinHumans ?? example.voiceMinHumans,
  };
}

export async function saveContractSettings(
  db: Root,
  input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; timezone?: string; completionChannelId?: string; now: Date },
) {
  if (!(await moduleIsAvailable(db, input.guildId, "contracts"))) {
    return { result: "maintenance" as const };
  }
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "event_management" })) !== "allowed") {
    return { result: "denied" as const };
  }
  const current = await ensureSettings(db, input.guildId);
  const timezone = input.timezone?.trim() || current.timezone;
  if (!timezoneIsValid(timezone)) {
    return { result: "invalid" as const };
  }
  const saved = await db.contractSettings.update({
    where: { guildId: input.guildId },
    data: { timezone, completionChannelId: input.completionChannelId ?? current.completionChannelId, updatedAt: input.now },
  });
  await writeAudit(db, { guildId: input.guildId, actorUserId: input.actorUserId, action: "contract.settings", targetType: "contract_settings", targetId: input.guildId, reason: "Contract settings" });
  return { result: "saved" as const, settings: saved };
}

export async function saveContractPreference(
  db: Root,
  input: { guildId: string; userId: string; refreshDaily?: boolean; refreshWeekly?: boolean; refreshMonthly?: boolean; delivery?: string; channelId?: string; completionPings?: boolean; now: Date },
) {
  if (!(await moduleIsAvailable(db, input.guildId, "contracts"))) {
    return { result: "maintenance" as const };
  }
  const current = await ensurePreference(db, input.guildId, input.userId);
  const delivery = input.delivery === "channel" || input.delivery === "dm" ? input.delivery : current.delivery;
  const saved = await db.contractPreference.update({
    where: { id: current.id },
    data: {
      refreshDaily: input.refreshDaily ?? current.refreshDaily,
      refreshWeekly: input.refreshWeekly ?? current.refreshWeekly,
      refreshMonthly: input.refreshMonthly ?? current.refreshMonthly,
      delivery,
      channelId: input.channelId ?? current.channelId,
      completionPings: input.completionPings ?? current.completionPings,
      updatedAt: input.now,
    },
  });
  return { result: "saved" as const, preference: saved };
}

export async function saveContractObjective(
  db: Root,
  input: {
    guildId: string;
    actorUserId: string;
    actorRoleIds: readonly string[];
    id?: string;
    title: string;
    prompt: string;
    kind: string;
    band?: string;
    target: number;
    rewardMarks: number;
    characterXp?: number;
    answer?: string;
    dailyPool?: boolean;
    weeklyPool?: boolean;
    monthlyPool?: boolean;
    policy?: "preserve" | "migrate";
    now: Date;
  },
) {
  if (!(await moduleIsAvailable(db, input.guildId, "contracts"))) {
    return { result: "maintenance" as const };
  }
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "event_management" })) !== "allowed") {
    return { result: "denied" as const };
  }
  await ensureCatalog(db, input.guildId, input.now);
  const characterXp = Math.max(0, Math.trunc(input.characterXp ?? 0));
  if (!isObjectiveKind(input.kind) || !input.title.trim() || !Number.isInteger(input.target) || input.target < 1 || !Number.isInteger(input.rewardMarks) || input.rewardMarks < 0 || !Number.isInteger(characterXp)) {
    return { result: "invalid" as const };
  }
  const availability = objectiveAvailability(input.kind);
  const band = input.band === "easy" || input.band === "hard" ? input.band : "medium";
  const pools = availability === "ready"
    ? { dailyPool: input.dailyPool ?? false, weeklyPool: input.weeklyPool ?? false, monthlyPool: input.monthlyPool ?? false }
    : { dailyPool: false, weeklyPool: false, monthlyPool: false };
  const hashed = input.answer?.trim() ? answerHash(input.answer) : "";
  const policy = input.policy === "migrate" ? "migrate" : "preserve";
  if (!input.id) {
    const id = randomUUID();
    const revisionId = randomUUID();
    const slug = `${input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "objective"}-${id.slice(0, 8)}`;
    await db.contractRevision.create({
      data: { id: revisionId, guildId: input.guildId, definitionId: id, version: 1, kind: input.kind, title: input.title.trim(), prompt: input.prompt.trim(), band, target: input.target, rewardMarks: input.rewardMarks, characterXp, answerHash: hashed, createdAt: input.now },
    });
    const created = await db.contractDefinition.create({
      data: { id, guildId: input.guildId, slug, kind: input.kind, title: input.title.trim(), prompt: input.prompt.trim(), band, target: input.target, rewardMarks: input.rewardMarks, characterXp, version: 1, answerHash: hashed, ...pools, availability, status: "active", createdAt: input.now, updatedAt: input.now },
    });
    await writeAudit(db, { guildId: input.guildId, actorUserId: input.actorUserId, action: "contract.objective", targetType: "contract_definition", targetId: id, reason: "Create objective" });
    return { result: availability === "ready" ? "saved" as const : "module_not_built" as const, objectiveId: created.id, version: 1 };
  }
  const current = await db.contractDefinition.findUnique({ where: { id: input.id } });
  if (!current || current.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  const version = current.version + 1;
  const revisionId = randomUUID();
  const nextHash = input.answer?.trim() ? hashed : current.answerHash;
  await db.contractRevision.create({
    data: { id: revisionId, guildId: input.guildId, definitionId: current.id, version, kind: input.kind, title: input.title.trim(), prompt: input.prompt.trim(), band, target: input.target, rewardMarks: input.rewardMarks, characterXp, answerHash: nextHash, createdAt: input.now },
  });
  await db.contractDefinition.update({
    where: { id: current.id },
    data: { kind: input.kind, title: input.title.trim(), prompt: input.prompt.trim(), band, target: input.target, rewardMarks: input.rewardMarks, characterXp, version, answerHash: nextHash, ...pools, availability, updatedAt: input.now },
  });
  if (policy === "migrate") {
    const openRows = await db.contractAssignment.findMany({ where: { guildId: input.guildId, definitionId: current.id, status: "assigned", progress: 0 } });
    for (const row of openRows) {
      if (versionApplies("migrate", row.progress) === "migrate") {
        await db.contractAssignment.update({
          where: { id: row.id },
          data: { revisionId, version, kind: input.kind, title: input.title.trim(), prompt: input.prompt.trim(), target: input.target, rewardMarks: input.rewardMarks, characterXp, updatedAt: input.now },
        });
      }
    }
    await db.contractBoardSlot.updateMany({
      where: { guildId: input.guildId, definitionId: current.id },
      data: { revisionId, version, kind: input.kind, title: input.title.trim(), prompt: input.prompt.trim(), band, target: input.target, rewardMarks: input.rewardMarks },
    });
  }
  await writeAudit(db, { guildId: input.guildId, actorUserId: input.actorUserId, action: "contract.objective", targetType: "contract_definition", targetId: current.id, reason: policy });
  return { result: availability === "ready" ? "saved" as const : "module_not_built" as const, objectiveId: current.id, version };
}

export async function openContractBoard(db: Root, input: { guildId: string; userId: string; board?: string; now: Date }) {
  if (!(await moduleIsAvailable(db, input.guildId, "contracts"))) {
    return { result: "maintenance" as const };
  }
  const board = isContractBoard(input.board ?? "daily") ? (input.board ?? "daily") as ContractBoard : "daily";
  await ensureCatalog(db, input.guildId, input.now);
  const settings = await ensureSettings(db, input.guildId);
  const cycle = cycleId(input.now, board, settings.timezone);
  let rows;
  try {
    rows = await db.$transaction(async (tx) => {
    await lockKey(tx, `contract:${input.guildId}:${board}:${cycle}:${input.userId}`);
    if (board !== "daily") {
      await lockKey(tx, `contract-board:${input.guildId}:${board}:${cycle}`);
      const slots = await tx.contractBoardSlot.findMany({ where: { guildId: input.guildId, board, cycleId: cycle }, orderBy: { slot: "asc" } });
      if (slots.length === 0) {
        const objectives = (await pool(tx, input.guildId, board)).sort((left, right) => left.band.localeCompare(right.band) || left.title.localeCompare(right.title));
        for (const [index, objective] of objectives.entries()) {
          await tx.contractBoardSlot.create({
            data: {
              id: randomUUID(),
              guildId: input.guildId,
              board,
              cycleId: cycle,
              slot: index + 1,
              definitionId: objective.id,
              revisionId: objective.revisionId,
              version: objective.version,
              kind: objective.kind,
              title: objective.title,
              prompt: objective.prompt,
              band: objective.band,
              target: objective.target,
              rewardMarks: objective.rewardMarks,
              createdAt: input.now,
            },
          });
        }
      }
    }
    const current = await tx.contractAssignment.findMany({ where: { guildId: input.guildId, userId: input.userId, board, cycleId: cycle, status: { not: "rerolled" } }, orderBy: { slot: "asc" } });
    if (board === "daily" ? current.length >= settings.dailyCount : current.length > 0) {
      return current;
    }
    if (board === "daily") {
      const objectives = await pool(tx, input.guildId, "daily");
      const chosen = pickObjectives(objectives, settings.dailyCount - current.length, `${input.userId}:${cycle}`, current.map((row) => row.definitionId));
      for (const [index, objective] of chosen.entries()) {
        await tx.contractAssignment.create({ data: assignmentCreate({ guildId: input.guildId, userId: input.userId, board, cycleId: cycle, slot: current.length + index + 1, objective, now: input.now }) });
      }
    } else {
      const slots = await tx.contractBoardSlot.findMany({ where: { guildId: input.guildId, board, cycleId: cycle }, orderBy: { slot: "asc" } });
      for (const slot of slots) {
        const revision = await tx.contractRevision.findUnique({ where: { id: slot.revisionId } });
        const objective: ObjectiveSnapshot = { id: slot.definitionId, revisionId: slot.revisionId, version: slot.version, kind: slot.kind, title: slot.title, prompt: slot.prompt, band: slot.band, target: slot.target, rewardMarks: slot.rewardMarks, characterXp: revision?.characterXp ?? 0, availability: "ready" };
        await tx.contractAssignment.create({ data: assignmentCreate({ guildId: input.guildId, userId: input.userId, board, cycleId: cycle, slot: slot.slot, objective, now: input.now }) });
      }
    }
    return tx.contractAssignment.findMany({ where: { guildId: input.guildId, userId: input.userId, board, cycleId: cycle, status: { not: "rerolled" } }, orderBy: { slot: "asc" } });
    });
  } catch (error) {
    if (!isUnique(error)) {
      throw error;
    }
    rows = await db.contractAssignment.findMany({ where: { guildId: input.guildId, userId: input.userId, board, cycleId: cycle, status: { not: "rerolled" } }, orderBy: { slot: "asc" } });
  }
  if (rows.length > 0) {
    await queueRefresh(db, { guildId: input.guildId, userId: input.userId, board, cycleId: cycle, titles: rows.map((row) => row.title), now: input.now });
  }
  const reroll = board === "daily" ? await db.contractReroll.findUnique({ where: { guildId_userId_cycleId: { guildId: input.guildId, userId: input.userId, cycleId: cycle } } }) : null;
  return {
    result: "ready" as const,
    board,
    cycleId: cycle,
    deadline: cycleDeadline(cycle, settings.timezone).toISOString(),
    capMarks: capFor(board, settings),
    rerollsRemaining: board === "daily" && !reroll ? 1 : 0,
    assignments: rows.map((row) => present(row, settings.timezone, capFor(board, settings))),
  };
}

export async function rerollContract(db: Root, input: { guildId: string; userId: string; assignmentId: string; now: Date }) {
  if (!(await moduleIsAvailable(db, input.guildId, "contracts"))) {
    return { result: "maintenance" as const };
  }
  const settings = await ensureSettings(db, input.guildId);
  const cycle = cycleId(input.now, "daily", settings.timezone);
  try {
    return await db.$transaction(async (tx) => {
      await lockKey(tx, `contract:${input.guildId}:daily:${cycle}:${input.userId}`);
      const rows = await tx.$queryRaw<AssignmentLock[]>`
        SELECT "id", "guildId", "userId", "board", "cycleId", "definitionId", "status", "progress", "target", "rewardMarks", "rewardKey", "title", "kind", "version", "revisionId", "prompt", "slot", "payoutMarks", "payoutStatus"
        FROM "contract_assignment" WHERE "id" = ${input.assignmentId} FOR UPDATE
      `;
      const row = rows[0];
      if (!row || row.guildId !== input.guildId || row.userId !== input.userId) {
        return { result: "missing" as const };
      }
      const used = await tx.contractReroll.findUnique({ where: { guildId_userId_cycleId: { guildId: input.guildId, userId: input.userId, cycleId: cycle } } });
      const decision = rerollDecision({ board: row.board, progress: Number(row.progress), rerollsUsed: used || row.cycleId !== cycle || row.status !== "assigned" ? 1 : 0 });
      if (row.status !== "assigned" || row.cycleId !== cycle) {
        return { result: row.board === "daily" ? "used" as const : "wrong_board" as const };
      }
      if (decision !== "allowed") {
        return { result: decision };
      }
      const taken = await tx.contractAssignment.findMany({ where: { guildId: input.guildId, userId: input.userId, cycleId: cycle, status: { not: "rerolled" } } });
      const next = pickObjectives(await pool(tx, input.guildId, "daily"), 1, `${input.userId}:${cycle}:reroll`, taken.map((item) => item.definitionId))[0];
      if (!next) {
        return { result: "empty" as const };
      }
      await tx.contractReroll.create({ data: { id: randomUUID(), guildId: input.guildId, userId: input.userId, cycleId: cycle, assignmentId: row.id, createdAt: input.now } });
      await tx.contractAssignment.update({ where: { id: row.id }, data: { status: "rerolled", updatedAt: input.now } });
      const created = await tx.contractAssignment.create({ data: assignmentCreate({ guildId: input.guildId, userId: input.userId, board: "daily", cycleId: cycle, slot: Number(row.slot), objective: next, now: input.now }) });
      return { result: "rerolled" as const, assignment: present(created, settings.timezone, settings.dailyCap) };
    });
  } catch (error) {
    if (isUnique(error)) {
      return { result: "used" as const };
    }
    throw error;
  }
}

export async function assignContract(
  db: Root,
  input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; userId: string; definitionId: string; board?: string; now: Date },
) {
  if (!(await moduleIsAvailable(db, input.guildId, "contracts"))) {
    return { result: "maintenance" as const };
  }
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "event_management" })) !== "allowed") {
    return { result: "denied" as const };
  }
  const settings = await ensureSettings(db, input.guildId);
  const definition = await db.contractDefinition.findUnique({ where: { id: input.definitionId } });
  if (!definition || definition.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  if (definition.availability !== "ready") {
    return { result: "module_not_built" as const };
  }
  const board = isContractBoard(input.board ?? "daily") ? (input.board ?? "daily") as ContractBoard : "daily";
  const objective = await snapshotOf(db, definition.id, definition.version);
  if (!objective) {
    return { result: "missing" as const };
  }
  const cycle = cycleId(input.now, board, settings.timezone);
  const existing = await db.contractAssignment.findFirst({ where: { guildId: input.guildId, userId: input.userId, cycleId: cycle, definitionId: definition.id, status: { not: "rerolled" } } });
  if (existing) {
    return { result: "already_assigned" as const, assignment: present(existing, settings.timezone, capFor(board, settings)) };
  }
  const slots = await db.contractAssignment.findMany({ where: { guildId: input.guildId, userId: input.userId, cycleId: cycle, status: { not: "rerolled" } } });
  const slot = Math.max(0, ...slots.map((row) => row.slot)) + 1;
  const created = await db.contractAssignment.create({ data: assignmentCreate({ guildId: input.guildId, userId: input.userId, board, cycleId: cycle, slot, objective, now: input.now }) });
  await writeAudit(db, { guildId: input.guildId, actorUserId: input.actorUserId, action: "contract.assign", targetType: "contract_assignment", targetId: created.id, reason: "Assign objective" });
  return { result: "assigned" as const, assignment: present(created, settings.timezone, capFor(board, settings)) };
}

export async function noteContractSignal(
  db: Root,
  input: { guildId: string; userId: string; kind: string; amount: number; now: Date; content?: string | null; channelId?: string; afk?: boolean; muted?: boolean; deafened?: boolean; eligibleHumans?: number },
) {
  if (objectiveAvailability(input.kind) !== "ready") {
    return { result: "module_not_built" as const };
  }
  if (!(await moduleIsAvailable(db, input.guildId, "contracts"))) {
    return { result: "maintenance" as const };
  }
  if (input.kind === "riddle" || input.kind === "manual") {
    return { result: "awaiting_submission" as const };
  }
  const settings = await ensureSettings(db, input.guildId);
  const filters = await participation(db, input.guildId);
  let amount = Math.max(0, Math.trunc(input.amount));
  if (input.kind === "chat_messages") {
    const cursor = await db.contractCursor.findUnique({ where: { guildId_userId: { guildId: input.guildId, userId: input.userId } } });
    const decision = chatXpDecision({
      content: input.content ?? null,
      channelId: input.channelId ?? "contract",
      excludedChannelIds: filters.excludedChannelIds,
      now: input.now,
      lastMessageAt: cursor?.lastMessageAt ?? null,
      cooldownSeconds: filters.messageCooldownSeconds,
      lastHash: cursor?.lastHash || null,
      lastHashAt: cursor?.lastHashAt ?? null,
      repeatWindowSeconds: filters.repeatWindowSeconds,
      minimumLength: filters.minimumMessageLength,
      dailyXp: 0,
      dailyCap: Number.MAX_SAFE_INTEGER,
      messageXp: 1,
    });
    if (decision !== "award" || !input.content) {
      return { result: decision, updated: 0 };
    }
    try {
      await db.contractCursor.upsert({
        where: { guildId_userId: { guildId: input.guildId, userId: input.userId } },
        create: { id: randomUUID(), guildId: input.guildId, userId: input.userId, lastMessageAt: input.now, lastHash: contentHash(input.content), lastHashAt: input.now },
        update: { lastMessageAt: input.now, lastHash: contentHash(input.content), lastHashAt: input.now, updatedAt: input.now },
      });
    } catch (error) {
      if (!isUnique(error)) {
        throw error;
      }
    }
    amount = 1;
  } else if (input.kind === "voice_minutes") {
    const decision = voiceXpDecision({
      afk: input.afk ?? false,
      muted: input.muted ?? false,
      deafened: input.deafened ?? false,
      eligibleHumans: input.eligibleHumans ?? 2,
      minHumans: filters.voiceMinHumans,
      minutes: amount,
      dailyXp: 0,
      dailyCap: Number.MAX_SAFE_INTEGER,
      xpPerMinute: 1,
    });
    if (decision.result !== "award") {
      return { result: decision.result, updated: 0 };
    }
  }
  if (amount <= 0) {
    return { result: "ignored" as const, updated: 0 };
  }
  const cycles = (["daily", "weekly", "monthly"] as const).map((board) => cycleId(input.now, board, settings.timezone));
  const rows = await db.contractAssignment.findMany({ where: { guildId: input.guildId, userId: input.userId, kind: input.kind, status: "assigned", cycleId: { in: cycles } } });
  const updates = [];
  for (const row of rows) {
    updates.push(await advanceAssignment(db, row.id, amount, input.now));
  }
  return { result: "noted" as const, updated: updates.length, updates };
}

export async function submitContract(
  db: Root,
  input: { guildId: string; userId: string; assignmentId: string; answer?: string; body?: string; now: Date },
) {
  if (!(await moduleIsAvailable(db, input.guildId, "contracts"))) {
    return { result: "maintenance" as const };
  }
  const assignment = await db.contractAssignment.findUnique({ where: { id: input.assignmentId } });
  if (!assignment || assignment.guildId !== input.guildId || assignment.userId !== input.userId) {
    return { result: "missing" as const };
  }
  if (assignment.status !== "assigned") {
    return { result: "already_recorded" as const, payoutMarks: assignment.payoutMarks };
  }
  if (assignment.kind === "riddle") {
    const revision = await db.contractRevision.findUnique({ where: { id: assignment.revisionId } });
    if (!revision || !answerMatches(input.answer ?? "", revision.answerHash)) {
      return { result: "incorrect" as const };
    }
    return advanceAssignment(db, assignment.id, assignment.target, input.now);
  }
  if (assignment.kind === "manual") {
    const pending = await db.contractSubmission.findFirst({ where: { assignmentId: assignment.id, status: "pending" } });
    if (pending) {
      return { result: "pending" as const, submissionId: pending.id };
    }
    const submission = await db.contractSubmission.create({
      data: { id: randomUUID(), guildId: input.guildId, assignmentId: assignment.id, userId: input.userId, body: (input.body ?? "").slice(0, 1000), status: "pending", reason: "", createdAt: input.now, updatedAt: input.now },
    });
    return { result: "pending" as const, submissionId: submission.id };
  }
  return { result: "not_submittable" as const };
}

export async function approveContract(
  db: Root,
  input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; submissionId: string; now: Date },
) {
  if (!(await moduleIsAvailable(db, input.guildId, "contracts"))) {
    return { result: "maintenance" as const };
  }
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "event_management" })) !== "allowed") {
    return { result: "denied" as const };
  }
  const submission = await db.contractSubmission.findUnique({ where: { id: input.submissionId } });
  if (!submission || submission.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  if (submission.status === "approved") {
    const assignment = await db.contractAssignment.findUnique({ where: { id: submission.assignmentId } });
    return { result: "already_recorded" as const, payoutMarks: assignment?.payoutMarks ?? 0 };
  }
  if (submission.status !== "pending") {
    return { result: "missing" as const };
  }
  const assignment = await db.contractAssignment.findUnique({ where: { id: submission.assignmentId } });
  if (!assignment) {
    return { result: "missing" as const };
  }
  const paid = await advanceAssignment(db, assignment.id, assignment.target, input.now);
  await db.contractSubmission.update({ where: { id: submission.id }, data: { status: "approved", reason: "", updatedAt: input.now } });
  await writeAudit(db, { guildId: input.guildId, actorUserId: input.actorUserId, action: "contract.approve", targetType: "contract_submission", targetId: submission.id, reason: "Approve submission" });
  return paid;
}

export async function rejectContract(
  db: Root,
  input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; submissionId: string; reason: string; now: Date },
) {
  if (!(await moduleIsAvailable(db, input.guildId, "contracts"))) {
    return { result: "maintenance" as const };
  }
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "event_management" })) !== "allowed") {
    return { result: "denied" as const };
  }
  const submission = await db.contractSubmission.findUnique({ where: { id: input.submissionId } });
  if (!submission || submission.guildId !== input.guildId || submission.status !== "pending") {
    return { result: "missing" as const };
  }
  await db.contractSubmission.update({ where: { id: submission.id }, data: { status: "rejected", reason: input.reason.slice(0, 200), updatedAt: input.now } });
  await writeAudit(db, { guildId: input.guildId, actorUserId: input.actorUserId, action: "contract.reject", targetType: "contract_submission", targetId: submission.id, reason: input.reason });
  return { result: "rejected" as const };
}

export async function readContractStaff(db: Root, input: { guildId: string; actorRoleIds: readonly string[]; now: Date }) {
  if (!(await moduleIsAvailable(db, input.guildId, "contracts"))) {
    return { result: "maintenance" as const };
  }
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "event_management" })) !== "allowed") {
    return { result: "denied" as const };
  }
  await ensureCatalog(db, input.guildId, input.now);
  const settings = await ensureSettings(db, input.guildId);
  const objectives = await db.contractDefinition.findMany({ where: { guildId: input.guildId }, orderBy: { title: "asc" } });
  const assignments = await db.contractAssignment.findMany({ where: { guildId: input.guildId, status: { not: "rerolled" } }, orderBy: { updatedAt: "desc" }, take: 40 });
  const submissions = await db.contractSubmission.findMany({ where: { guildId: input.guildId, status: "pending" }, orderBy: { createdAt: "asc" } });
  return {
    result: "ready" as const,
    settings: { timezone: settings.timezone, completionChannelId: settings.completionChannelId, dailyCap: settings.dailyCap, weeklyCap: settings.weeklyCap, monthlyCap: settings.monthlyCap },
    objectives: objectives.map((row) => ({ id: row.id, slug: row.slug, kind: row.kind, title: row.title, prompt: row.prompt, band: row.band, target: row.target, rewardMarks: row.rewardMarks, version: row.version, dailyPool: row.dailyPool, weeklyPool: row.weeklyPool, monthlyPool: row.monthlyPool, availability: row.availability, answerSet: row.answerHash.length > 0 })),
    assignments: assignments.map((row) => present(row, settings.timezone, capFor(row.board, settings))),
    submissions: submissions.map((row) => ({ id: row.id, assignmentId: row.assignmentId, userId: row.userId, body: row.body, status: row.status })),
  };
}

async function noticeBody(db: Writer, notice: { guildId: string; userId: string; kind: string; board: string; cycleId: string; delivery: string; publicBody: string }) {
  if (notice.delivery !== "dm") {
    return notice.publicBody;
  }
  const rows = await db.contractAssignment.findMany({ where: { guildId: notice.guildId, userId: notice.userId, board: notice.board, cycleId: notice.cycleId, status: { not: "rerolled" } } });
  return rows.map((row) => `${row.title}: ${row.progress}/${row.target}, ${row.rewardMarks} Marks`).join("\n");
}

async function settleNotice(db: Writer, notice: { id: string; delivery: string; publicBody: string; attempts: number }, outcome: "sent" | "closed" | "setup_required", now: Date) {
  const status = outcome === "sent" ? "sent" : outcome === "closed" ? "failed" : "setup_required";
  await db.contractNotice.update({
    where: { id: notice.id },
    data: {
      status,
      reason: outcome === "sent" ? "" : outcome,
      attempts: notice.attempts + 1,
      publicBody: notice.delivery === "dm" ? "" : notice.publicBody,
      updatedAt: now,
    },
  });
  return status;
}

export async function deliverContractNotices(db: Root, now: Date, deliver: ContractDelivery = setupRequiredContractDelivery) {
  const pending = await db.contractNotice.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" }, take: 40 });
  const completions = pending.filter((notice) => notice.kind === "completion" && notice.delivery === "channel");
  const rest = pending.filter((notice) => !completions.includes(notice));
  const handled = new Set<string>();
  for (const notice of completions) {
    if (handled.has(notice.id)) {
      continue;
    }
    const batch = completions.filter((row) => row.guildId === notice.guildId && !handled.has(row.id)).slice(0, 10);
    for (const row of batch) {
      handled.add(row.id);
    }
    const settings = await ensureSettings(db, notice.guildId);
    const outcome = await deliver({
      guildId: notice.guildId,
      userId: notice.userId,
      delivery: "channel",
      channelId: settings.completionChannelId,
      body: batch.map((row) => row.publicBody).filter(Boolean).join("\n"),
    });
    for (const row of batch) {
      await settleNotice(db, row, outcome, now);
    }
  }
  for (const notice of rest) {
    const settings = await ensureSettings(db, notice.guildId);
    const preference = await ensurePreference(db, notice.guildId, notice.userId);
    const channelId = notice.kind === "completion" ? settings.completionChannelId : preference.channelId || settings.completionChannelId;
    if (notice.delivery === "channel" && !channelId) {
      await db.contractNotice.update({ where: { id: notice.id }, data: { status: "failed", reason: "missing_channel", attempts: notice.attempts + 1, publicBody: notice.publicBody, updatedAt: now } });
      continue;
    }
    const outcome = await deliver({
      guildId: notice.guildId,
      userId: notice.userId,
      delivery: notice.delivery === "channel" ? "channel" : "dm",
      channelId,
      body: await noticeBody(db, notice),
    });
    await settleNotice(db, notice, outcome, now);
  }
  return { delivered: pending.length };
}

export async function retryContractNotice(db: Root, input: { guildId: string; noticeId: string; now: Date }) {
  const notice = await db.contractNotice.findUnique({ where: { id: input.noticeId } });
  if (!notice || notice.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  if (notice.status === "sent" || notice.status === "skipped" || notice.status === "pending") {
    return { result: "already_recorded" as const };
  }
  if (notice.attempts >= 3) {
    return { result: "exhausted" as const };
  }
  await db.contractNotice.update({ where: { id: notice.id }, data: { status: "pending", updatedAt: input.now } });
  return { result: "pending" as const };
}

export async function sweepContractNotices(db: Root, now: Date) {
  return deliverContractNotices(db, now, setupRequiredContractDelivery);
}
