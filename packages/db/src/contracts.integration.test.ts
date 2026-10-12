import { randomUUID } from "node:crypto";

import { exampleProgressionSettings, routineMonthlyMarks } from "@collective/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "./client.js";
import {
  approveContract,
  assignContract,
  deliverContractNotices,
  noteContractSignal,
  openContractBoard,
  readContractStaff,
  rerollContract,
  retryContractNotice,
  saveContractObjective,
  saveContractPreference,
  saveContractSettings,
  submitContract,
  sweepContractNotices,
  type ContractDelivery,
} from "./contracts.js";
import { saveProgressionSettings } from "./progression.js";
import { grantCapability } from "./platform.js";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.");
}

const db = createPrismaClient(databaseUrl);
const guildId = `guild-${randomUUID()}`;
const staffRoles = ["event-role"];
const now = new Date("2026-10-11T04:00:00.000Z");
const staff = { guildId, actorUserId: "judge", actorRoleIds: staffRoles, now };

beforeAll(async () => {
  await grantCapability(db, { guildId, roleId: "event-role", capability: "event_management", actorUserId: "owner", reason: "Open contracts" });
  await saveProgressionSettings(db, {
    guildId,
    settings: { ...exampleProgressionSettings(), messageCooldownSeconds: 0, repeatWindowSeconds: 0 },
    actorUserId: "owner",
    reason: "Contract participation filters",
  });
});

afterAll(async () => {
  await db.contractSubmission.deleteMany({ where: { guildId } });
  await db.contractNotice.deleteMany({ where: { guildId } });
  await db.contractAssignment.deleteMany({ where: { guildId } });
  await db.contractReroll.deleteMany({ where: { guildId } });
  await db.contractPreference.deleteMany({ where: { guildId } });
  await db.contractBoardSlot.deleteMany({ where: { guildId } });
  await db.contractRevision.deleteMany({ where: { guildId } });
  await db.contractDefinition.deleteMany({ where: { guildId } });
  await db.contractCursor.deleteMany({ where: { guildId } });
  await db.contractSettings.deleteMany({ where: { guildId } });
  await db.ledgerEntry.deleteMany({ where: { guildId } });
  await db.wallet.deleteMany({ where: { guildId } });
  await db.issuanceBudget.deleteMany({ where: { guildId } });
  await db.economySettings.deleteMany({ where: { guildId } });
  await db.progressionSettings.deleteMany({ where: { guildId } });
  await db.outboxMessage.deleteMany({ where: { guildId } });
  await db.job.deleteMany({ where: { guildId } });
  await db.auditRecord.deleteMany({ where: { guildId } });
  await db.capabilityGrant.deleteMany({ where: { guildId } });
  await db.guild.deleteMany({ where: { guildId } });
  await db.$disconnect();
});

describe("contract boards, rerolls, and caps", () => {
  it("refreshes one personal board and spends the single unstarted reroll once", async () => {
    const userId = "refresh-user";
    const [first, second] = await Promise.all([
      openContractBoard(db, { guildId, userId, board: "daily", now }),
      openContractBoard(db, { guildId, userId, board: "daily", now }),
    ]);
    expect(first.result).toBe("ready");
    expect(second.result).toBe("ready");
    if (first.result !== "ready" || second.result !== "ready") {
      return;
    }
    expect(first.assignments).toHaveLength(3);
    expect(second.assignments).toHaveLength(3);
    expect(new Set([...first.assignments, ...second.assignments].map((row) => row.id)).size).toBe(3);
    expect(first.assignments.every((row) => !row.kind.startsWith("rpg_"))).toBe(true);
    const stored = await db.contractAssignment.count({ where: { guildId, userId, status: { not: "rerolled" } } });
    expect(stored).toBe(3);

    const assignmentId = first.assignments[0]?.id ?? "";
    const [left, right] = await Promise.all([
      rerollContract(db, { guildId, userId, assignmentId, now }),
      rerollContract(db, { guildId, userId, assignmentId, now }),
    ]);
    expect([left.result, right.result].sort()).toEqual(["rerolled", "used"]);
    const replacement = left.result === "rerolled" ? left.assignment.id : right.result === "rerolled" ? right.assignment.id : "";
    expect((await rerollContract(db, { guildId, userId, assignmentId: replacement, now })).result).toBe("used");
    expect(await db.contractAssignment.count({ where: { guildId, userId, status: { not: "rerolled" } } })).toBe(3);

    const started = await openContractBoard(db, { guildId, userId: "started-user", board: "daily", now });
    expect(started.result).toBe("ready");
    if (started.result !== "ready") {
      return;
    }
    const voice = started.assignments.find((row) => row.kind === "voice_minutes");
    expect(voice).toBeTruthy();
    await noteContractSignal(db, { guildId, userId: "started-user", kind: "voice_minutes", amount: 1, eligibleHumans: 2, now });
    expect((await rerollContract(db, { guildId, userId: "started-user", assignmentId: voice?.id ?? "", now })).result).toBe("started");

    const weekly = await openContractBoard(db, { guildId, userId: "weekly-one", board: "weekly", now });
    const shared = await openContractBoard(db, { guildId, userId: "weekly-two", board: "weekly", now });
    expect(weekly.result).toBe("ready");
    expect(shared.result).toBe("ready");
    if (weekly.result !== "ready" || shared.result !== "ready") {
      return;
    }
    expect(shared.assignments.map((row) => row.title).sort()).toEqual(weekly.assignments.map((row) => row.title).sort());
    expect((await rerollContract(db, { guildId, userId: "weekly-one", assignmentId: weekly.assignments[0]?.id ?? "", now })).result).toBe("wrong_board");
  });

  it("pays a raced completion once", async () => {
    const userId = "race-chat";
    const saved = await saveContractObjective(db, { ...staff, title: "One useful note", prompt: "Send one useful message.", kind: "chat_messages", target: 1, rewardMarks: 15 });
    expect(saved.result).toBe("saved");
    if (saved.result !== "saved") {
      return;
    }
    const assigned = await assignContract(db, { ...staff, userId, definitionId: saved.objectiveId, board: "daily" });
    expect(assigned.result).toBe("assigned");
    if (assigned.result !== "assigned") {
      return;
    }
    await Promise.all([
      noteContractSignal(db, { guildId, userId, kind: "chat_messages", amount: 1, content: "a useful race note one", channelId: "general", now }),
      noteContractSignal(db, { guildId, userId, kind: "chat_messages", amount: 1, content: "a useful race note two", channelId: "general", now }),
    ]);
    expect(await db.ledgerEntry.count({ where: { guildId, userId, idempotencyKey: assigned.assignment.rewardKey } })).toBe(1);
    expect((await db.contractAssignment.findUnique({ where: { id: assigned.assignment.id } }))?.status).toBe("completed");
  });

  it("reduces payouts at the daily cap without charging the weekly cap to that daily pool", async () => {
    const userId = "cap-user";
    const first = await objective("Bring the first note", "manual", 50);
    const second = await objective("Bring the second note", "manual", 50);
    const weekly = await objective("Weekly milestone", "manual", 250);
    const firstAssignment = await assignContract(db, { ...staff, userId, definitionId: first, board: "daily" });
    const secondAssignment = await assignContract(db, { ...staff, userId, definitionId: second, board: "daily" });
    const weeklyAssignment = await assignContract(db, { ...staff, userId, definitionId: weekly, board: "weekly" });
    expect(firstAssignment.result).toBe("assigned");
    expect(secondAssignment.result).toBe("assigned");
    expect(weeklyAssignment.result).toBe("assigned");
    if (firstAssignment.result !== "assigned" || secondAssignment.result !== "assigned" || weeklyAssignment.result !== "assigned") {
      return;
    }
    const firstPaid = await approve(userId, firstAssignment.assignment.id);
    const secondPaid = await approve(userId, secondAssignment.assignment.id);
    expect(firstPaid.result).toBe("completed");
    expect(secondPaid.result).toBe("completed");
    if (firstPaid.result !== "completed" || secondPaid.result !== "completed") {
      return;
    }
    expect(firstPaid.payoutMarks).toBe(50);
    expect(secondPaid.payoutMarks).toBe(30);
    expect(secondPaid.payoutStatus).toBe("reduced");
    const daily = await budget("contract_daily", "daily:2026-10-11", userId);
    expect(daily).toBe(8000n);
    const weeklyPaid = await approve(userId, weeklyAssignment.assignment.id);
    expect(weeklyPaid.result).toBe("completed");
    if (weeklyPaid.result !== "completed") {
      return;
    }
    expect(weeklyPaid.payoutMarks).toBe(250);
    expect(await budget("contract_daily", "daily:2026-10-11", userId)).toBe(8000n);
    expect(await budget("contract_weekly", weeklyAssignment.assignment.cycleId, userId)).toBe(25000n);
    expect((await db.wallet.findUnique({ where: { guildId_userId_currency: { guildId, userId, currency: "marks" } } }))?.availableMinor).toBe(33000n);

    const cappedUser = "capped-user";
    const full = BigInt(routineMonthlyMarks().routineMarks) * 100n;
    await db.issuanceBudget.create({
      data: { guildId, scope: "member_routine", periodKey: "2026-10", subjectId: cappedUser, authorizedMinor: full, spentMinor: full },
    });
    const blocked = await objective("Unpaid errand", "manual", 40);
    const blockedAssignment = await assignContract(db, { ...staff, userId: cappedUser, definitionId: blocked, board: "daily" });
    expect(blockedAssignment.result).toBe("assigned");
    if (blockedAssignment.result !== "assigned") {
      return;
    }
    const blockedPaid = await approve(cappedUser, blockedAssignment.assignment.id);
    expect(blockedPaid.result).toBe("completed");
    if (blockedPaid.result !== "completed") {
      return;
    }
    expect(blockedPaid.payoutMarks).toBe(0);
    expect(blockedPaid.payoutStatus).toBe("capped");
    expect((await db.contractAssignment.findUnique({ where: { id: blockedAssignment.assignment.id } }))?.status).toBe("completed");
    expect(await db.ledgerEntry.count({ where: { guildId, userId: cappedUser } })).toBe(0);
  });

  it("keeps Perth cycle identities on either side of midnight", async () => {
    const early = await openContractBoard(db, { guildId, userId: "zone-user", board: "daily", now: new Date("2026-10-11T15:59:00.000Z") });
    const late = await openContractBoard(db, { guildId, userId: "zone-user", board: "daily", now: new Date("2026-10-11T16:00:00.000Z") });
    expect(early.result).toBe("ready");
    expect(late.result).toBe("ready");
    if (early.result !== "ready" || late.result !== "ready") {
      return;
    }
    expect(early.cycleId).toBe("daily:2026-10-11");
    expect(late.cycleId).toBe("daily:2026-10-12");
    expect(early.assignments).toHaveLength(3);
    expect(late.assignments).toHaveLength(3);
    const earlyWeek = await openContractBoard(db, { guildId, userId: "zone-user", board: "weekly", now: new Date("2026-10-11T15:59:00.000Z") });
    const lateWeek = await openContractBoard(db, { guildId, userId: "zone-user", board: "weekly", now: new Date("2026-10-11T16:00:00.000Z") });
    expect(earlyWeek.result === "ready" && earlyWeek.cycleId).toBe("weekly:2026-W41");
    expect(lateWeek.result === "ready" && lateWeek.cycleId).toBe("weekly:2026-W42");
  });

  it("migrates only unstarted assignments and preserves the rest", async () => {
    const saved = await saveContractObjective(db, { ...staff, title: "Patrol chat", prompt: "Send useful patrol notes.", kind: "chat_messages", target: 5, rewardMarks: 10 });
    expect(saved.result).toBe("saved");
    if (saved.result !== "saved") {
      return;
    }
    const keep = await assignContract(db, { ...staff, userId: "keep-user", definitionId: saved.objectiveId });
    const move = await assignContract(db, { ...staff, userId: "move-user", definitionId: saved.objectiveId });
    expect(keep.result).toBe("assigned");
    expect(move.result).toBe("assigned");
    if (keep.result !== "assigned" || move.result !== "assigned") {
      return;
    }
    await noteContractSignal(db, { guildId, userId: "keep-user", kind: "chat_messages", amount: 1, content: "a useful patrol note", channelId: "general", now });
    const migrated = await saveContractObjective(db, { ...staff, id: saved.objectiveId, title: "Patrol chat", prompt: "Send useful patrol notes.", kind: "chat_messages", target: 5, rewardMarks: 12, policy: "migrate" });
    expect(migrated.result).toBe("saved");
    expect((await db.contractAssignment.findUnique({ where: { id: keep.assignment.id } }))?.rewardMarks).toBe(10);
    expect((await db.contractAssignment.findUnique({ where: { id: keep.assignment.id } }))?.progress).toBe(1);
    expect((await db.contractAssignment.findUnique({ where: { id: move.assignment.id } }))?.rewardMarks).toBe(12);
    await saveContractObjective(db, { ...staff, id: saved.objectiveId, title: "Patrol chat", prompt: "Send useful patrol notes.", kind: "chat_messages", target: 5, rewardMarks: 15, policy: "preserve" });
    expect((await db.contractAssignment.findUnique({ where: { id: keep.assignment.id } }))?.rewardMarks).toBe(10);
    expect((await db.contractAssignment.findUnique({ where: { id: move.assignment.id } }))?.rewardMarks).toBe(12);
  });

  it("pays an authored riddle once and accepts a crafting objective", async () => {
    const userId = "riddle-user";
    const saved = await saveContractObjective(db, { ...staff, title: "Night question", prompt: "Which star stays still?", kind: "riddle", target: 1, rewardMarks: 20, answer: "north star" });
    expect(saved.result).toBe("saved");
    if (saved.result !== "saved") {
      return;
    }
    const assigned = await assignContract(db, { ...staff, userId, definitionId: saved.objectiveId });
    expect(assigned.result).toBe("assigned");
    if (assigned.result !== "assigned") {
      return;
    }
    expect((await submitContract(db, { guildId, userId, assignmentId: assigned.assignment.id, answer: "a planet", now })).result).toBe("incorrect");
    const paid = await submitContract(db, { guildId, userId, assignmentId: assigned.assignment.id, answer: "North Star", now });
    expect(paid.result).toBe("completed");
    expect((await submitContract(db, { guildId, userId, assignmentId: assigned.assignment.id, answer: "north star", now })).result).toBe("already_recorded");
    expect(await db.ledgerEntry.count({ where: { guildId, userId, idempotencyKey: assigned.assignment.rewardKey } })).toBe(1);
    const catalog = await readContractStaff(db, { guildId, actorRoleIds: staffRoles, now });
    expect(catalog.result).toBe("ready");
    if (catalog.result === "ready") {
      expect(JSON.stringify(catalog)).not.toContain("north star");
      expect(catalog.objectives.find((row) => row.id === saved.objectiveId)?.answerSet).toBe(true);
    }
    expect((await noteContractSignal(db, { guildId, userId: "rpg-user", kind: "rpg_crafting", amount: 1, now })).result).toBe("noted");
    const rpg = await saveContractObjective(db, { ...staff, title: "Craft once", prompt: "Craft one published recipe.", kind: "rpg_crafting", target: 1, rewardMarks: 10 });
    expect(rpg.result).toBe("saved");
  });

  it("keeps a muted completion ping from blocking the reward and retries a closed DM without a second payout", async () => {
    const quiet = "quiet-user";
    await saveContractPreference(db, { guildId, userId: quiet, completionPings: false, now });
    const quietObjective = await objective("Quiet errand", "manual", 25);
    const quietAssignment = await assignContract(db, { ...staff, userId: quiet, definitionId: quietObjective });
    expect(quietAssignment.result).toBe("assigned");
    if (quietAssignment.result !== "assigned") {
      return;
    }
    const quietPaid = await approve(quiet, quietAssignment.assignment.id);
    expect(quietPaid.result).toBe("completed");
    if (quietPaid.result === "completed") {
      expect(quietPaid.payoutMarks).toBe(25);
    }
    expect((await db.contractNotice.findFirst({ where: { guildId, userId: quiet, kind: "completion" } }))?.status).toBe("skipped");
    expect(await db.ledgerEntry.count({ where: { guildId, userId: quiet } })).toBe(1);

    const setupUser = "setup-user";
    const setupBoard = await openContractBoard(db, { guildId, userId: setupUser, board: "daily", now });
    expect(setupBoard.result).toBe("ready");
    await sweepContractNotices(db, now);
    const setupNotice = await db.contractNotice.findFirst({ where: { guildId, userId: setupUser, kind: "refresh" } });
    expect(setupNotice?.status).toBe("setup_required");
    expect(setupNotice?.publicBody).toBe("");
    expect(await db.outboxMessage.count({ where: { guildId } })).toBe(0);
    expect(await db.ledgerEntry.count({ where: { guildId, userId: setupUser } })).toBe(0);

    const dmUser = "dm-user";
    await openContractBoard(db, { guildId, userId: dmUser, board: "daily", now });
    const calls: Array<{ delivery: string; body: string; userId: string }> = [];
    const closed: ContractDelivery = async (input) => {
      calls.push({ delivery: input.delivery, body: input.body, userId: input.userId });
      return "closed";
    };
    await deliverContractNotices(db, now, closed);
    const dmNotice = await db.contractNotice.findFirst({ where: { guildId, userId: dmUser, kind: "refresh" } });
    expect(dmNotice?.status).toBe("failed");
    expect(dmNotice?.publicBody).toBe("");
    expect(calls.some((call) => call.userId === dmUser && call.delivery === "dm" && call.body.length > 0)).toBe(true);
    expect(await db.ledgerEntry.count({ where: { guildId, userId: dmUser } })).toBe(0);

    await saveContractSettings(db, { ...staff, completionChannelId: "completion-channel" });
    const paidUser = "mention-user";
    const paidObjective = await objective("Mentioned errand", "manual", 10);
    const paidAssignment = await assignContract(db, { ...staff, userId: paidUser, definitionId: paidObjective });
    expect(paidAssignment.result).toBe("assigned");
    if (paidAssignment.result !== "assigned" || !dmNotice) {
      return;
    }
    const paid = await approve(paidUser, paidAssignment.assignment.id);
    expect(paid.result).toBe("completed");
    await deliverContractNotices(db, now, closed);
    expect(await db.ledgerEntry.count({ where: { guildId, userId: paidUser, idempotencyKey: paidAssignment.assignment.rewardKey } })).toBe(1);
    const completion = await db.contractNotice.findFirst({ where: { guildId, userId: paidUser, kind: "completion" } });
    expect(completion?.status).toBe("failed");
    expect((await retryContractNotice(db, { guildId, noticeId: dmNotice.id, now })).result).toBe("pending");
    expect(completion && (await retryContractNotice(db, { guildId, noticeId: completion.id, now })).result).toBe("pending");
    await deliverContractNotices(db, now, async () => "sent");
    expect((await db.contractNotice.findUnique({ where: { id: dmNotice.id } }))?.status).toBe("sent");
    expect((await db.contractNotice.findUnique({ where: { id: dmNotice.id } }))?.publicBody).toBe("");
    expect((await db.contractNotice.findUnique({ where: { id: completion?.id ?? "" } }))?.status).toBe("sent");
    expect(await db.ledgerEntry.count({ where: { guildId, userId: paidUser, idempotencyKey: paidAssignment.assignment.rewardKey } })).toBe(1);
    expect(await db.outboxMessage.count({ where: { guildId } })).toBe(0);
  });
});

async function objective(title: string, kind: string, rewardMarks: number): Promise<string> {
  const saved = await saveContractObjective(db, { ...staff, title, prompt: title, kind, target: 1, rewardMarks });
  if (saved.result !== "saved") {
    throw new Error(`Objective ${title} was ${saved.result}.`);
  }
  return saved.objectiveId;
}

async function approve(userId: string, assignmentId: string) {
  const submitted = await submitContract(db, { guildId, userId, assignmentId, body: "Done.", now });
  if (submitted.result !== "pending") {
    throw new Error(`Submission was ${submitted.result}.`);
  }
  return approveContract(db, { ...staff, submissionId: submitted.submissionId });
}

async function budget(scope: string, periodKey: string, subjectId: string): Promise<bigint> {
  const row = await db.issuanceBudget.findUnique({ where: { guildId_scope_periodKey_subjectId: { guildId, scope, periodKey, subjectId } } });
  return row?.spentMinor ?? 0n;
}
