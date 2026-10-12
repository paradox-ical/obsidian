import { randomUUID } from "node:crypto";

import { SHOP_KEY_DETAIL } from "@collective/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  addGiveawayBonus,
  awardContest,
  cancelGiveaway,
  cancelPrediction,
  castContestBallot,
  claimGiveaway,
  closeContest,
  closeGiveaway,
  correctContest,
  createContest,
  createGiveaway,
  createPrediction,
  disqualifyGiveaway,
  drawGiveaway,
  editContestEntry,
  editPredictionOutcomes,
  enterGiveaway,
  enterPrediction,
  lockPrediction,
  publishContest,
  rerollGiveaway,
  resolvePrediction,
  reversePrediction,
  savePrizeStock,
  submitContestEntry,
} from "./activities.js";
import { createPrismaClient } from "./client.js";
import { fundExceptional, issueMarks } from "./ledger.js";
import { grantCapability } from "./platform.js";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.");
}

const db = createPrismaClient(databaseUrl);
const guildId = `guild-${randomUUID()}`;
const staffRoles = ["event-role"];
const now = new Date("2026-10-11T00:00:00.000Z");
const later = new Date("2026-10-12T00:00:00.000Z");
const staff = { guildId, actorUserId: "judge", actorRoleIds: staffRoles, now };

beforeAll(async () => {
  await grantCapability(db, { guildId, roleId: "event-role", capability: "event_management", actorUserId: "owner", reason: "Open activities" });
  await grantCapability(db, { guildId, roleId: "event-role", capability: "economy_operations", actorUserId: "owner", reason: "Fund prizes" });
});

afterAll(async () => {
  await db.prizeFulfilment.deleteMany({ where: { guildId } });
  await db.giveawayDraw.deleteMany({ where: { guildId } });
  await db.giveawayEntry.deleteMany({ where: { guildId } });
  await db.giveaway.deleteMany({ where: { guildId } });
  await db.contestResult.deleteMany({ where: { guildId } });
  await db.contestBallot.deleteMany({ where: { guildId } });
  await db.contestEntry.deleteMany({ where: { guildId } });
  await db.contestCriterion.deleteMany({ where: { guildId } });
  await db.contest.deleteMany({ where: { guildId } });
  await db.predictionEntry.deleteMany({ where: { guildId } });
  await db.predictionOutcome.deleteMany({ where: { guildId } });
  await db.predictionScore.deleteMany({ where: { guildId } });
  await db.prediction.deleteMany({ where: { guildId } });
  await db.prizeStock.deleteMany({ where: { guildId } });
  await db.ledgerEntry.deleteMany({ where: { guildId } });
  await db.wallet.deleteMany({ where: { guildId } });
  await db.issuanceBudget.deleteMany({ where: { guildId } });
  await db.economySettings.deleteMany({ where: { guildId } });
  await db.outboxMessage.deleteMany({ where: { guildId } });
  await db.job.deleteMany({ where: { guildId } });
  await db.auditRecord.deleteMany({ where: { guildId } });
  await db.capabilityGrant.deleteMany({ where: { guildId } });
  await db.guild.deleteMany({ where: { guildId } });
  await db.$disconnect();
});

async function credit(userId: string, amountMarks: number) {
  const posted = await issueMarks(db, {
    guildId,
    userId,
    amountMarks,
    source: "staff_adjustment",
    sourceId: `${userId}:${amountMarks}`,
    pace: "routine",
    idempotencyKey: `seed:${guildId}:${userId}:${amountMarks}`,
    reason: "Seed activity wallet",
    actorUserId: "owner",
    now,
  });
  if (posted.result !== "posted") {
    throw new Error(posted.result);
  }
}

async function supply(userIds: string[]) {
  const wallets = await db.wallet.findMany({ where: { guildId, currency: "marks", userId: { in: userIds } } });
  return wallets.reduce((sum, wallet) => sum + wallet.availableMinor + wallet.escrowMinor, 0n);
}

describe("predictions, contests, and giveaways", () => {
  it("locks stakes, pays the pool once, and refunds ties, cancellations, and short reversals", async () => {
    expect(await createPrediction(db, {
      ...staff,
      title: "Closed",
      mode: "free",
      rules: "Rules",
      evidence: "Shown first",
      outcomes: ["Yes", "No"],
      lockAt: later,
      actorRoleIds: [],
    })).toMatchObject({ result: "denied" });

    const free = await createPrediction(db, {
      ...staff,
      title: "Free call",
      mode: "free",
      rules: "Free rules",
      evidence: "Shown before entry",
      outcomes: ["Yes", "No"],
      lockAt: later,
      points: 1,
      prizeMarks: 5,
    });
    if (free.result !== "open") {
      throw new Error(free.result);
    }
    expect(free.prediction.houseFeeBps).toBe(0);
    const yes = free.outcomes[0];
    const no = free.outcomes[1];
    if (!yes || !no) {
      throw new Error("missing outcome");
    }
    const preview = await enterPrediction(db, {
      guildId,
      predictionId: free.prediction.id,
      userId: "eve",
      outcomeId: yes.id,
      stakeMarks: 0,
      roleIds: [],
      accountAgeDays: 30,
      acknowledged: false,
      now,
    });
    expect(preview.result).toBe("preview");
    expect(await db.predictionEntry.count({ where: { predictionId: free.prediction.id } })).toBe(0);
    expect(await enterPrediction(db, {
      guildId,
      predictionId: free.prediction.id,
      userId: "eve",
      outcomeId: yes.id,
      stakeMarks: 0,
      roleIds: [],
      accountAgeDays: 30,
      acknowledged: true,
      now,
    })).toMatchObject({ result: "recorded" });
    await lockPrediction(db, { ...staff, predictionId: free.prediction.id });
    const unfunded = await resolvePrediction(db, { ...staff, predictionId: free.prediction.id, outcomeId: yes.id, evidence: "The official result is yes." });
    expect(unfunded).toMatchObject({ result: "unfunded", rule: "unfunded" });
    expect(await resolvePrediction(db, { ...staff, predictionId: free.prediction.id, outcomeId: yes.id, evidence: "The official result is yes." })).toMatchObject({ result: "already_resolved" });
    expect(await db.predictionScore.findUnique({ where: { guildId_userId: { guildId, userId: "eve" } } })).toMatchObject({ points: 1 });
    expect(await db.ledgerEntry.count({ where: { guildId, userId: "eve", source: "prediction.prize" } })).toBe(0);

    await fundExceptional(db, { guildId, amountMarks: 5, idempotencyKey: `fund:${guildId}`, reason: "Fund one prediction prize", actorUserId: "judge", actorRoleIds: staffRoles, now });
    const funded = await createPrediction(db, {
      ...staff,
      title: "Funded call",
      mode: "free",
      rules: "Funded rules",
      evidence: "Shown before entry",
      outcomes: ["Yes", "No"],
      lockAt: later,
      points: 1,
      prizeMarks: 5,
    });
    if (funded.result !== "open" || !funded.outcomes[0]) {
      throw new Error("funded prediction");
    }
    await enterPrediction(db, {
      guildId,
      predictionId: funded.prediction.id,
      userId: "ida",
      outcomeId: funded.outcomes[0].id,
      stakeMarks: 0,
      roleIds: [],
      accountAgeDays: 30,
      acknowledged: true,
      now,
    });
    await lockPrediction(db, { ...staff, predictionId: funded.prediction.id });
    expect(await resolvePrediction(db, { ...staff, predictionId: funded.prediction.id, outcomeId: funded.outcomes[0].id, evidence: "Recorded evidence" })).toMatchObject({ result: "resolved" });
    expect(await resolvePrediction(db, { ...staff, predictionId: funded.prediction.id, outcomeId: funded.outcomes[0].id, evidence: "Recorded evidence" })).toMatchObject({ result: "already_resolved" });
    expect(await db.ledgerEntry.count({ where: { guildId, source: "prediction.prize", userId: "ida" } })).toBe(1);

    await credit("alice", 500);
    await credit("bob", 500);
    const pooled = await createPrediction(db, {
      ...staff,
      title: "Pool",
      mode: "staked",
      rules: "Staked rules",
      evidence: "Shown before entry",
      outcomes: ["Alpha", "Beta"],
      lockAt: later,
    });
    if (pooled.result !== "open" || !pooled.outcomes[0] || !pooled.outcomes[1]) {
      throw new Error("pool");
    }
    expect(await enterPrediction(db, { guildId, predictionId: pooled.prediction.id, userId: "alice", outcomeId: pooled.outcomes[0].id, stakeMarks: 30, roleIds: [], accountAgeDays: 30, acknowledged: true, now })).toMatchObject({ result: "recorded" });
    expect(await enterPrediction(db, { guildId, predictionId: pooled.prediction.id, userId: "alice", outcomeId: pooled.outcomes[0].id, stakeMarks: 40, roleIds: [], accountAgeDays: 30, acknowledged: true, now })).toMatchObject({ result: "stake_fixed" });
    expect(await enterPrediction(db, { guildId, predictionId: pooled.prediction.id, userId: "bob", outcomeId: pooled.outcomes[1].id, stakeMarks: 20, roleIds: [], accountAgeDays: 30, acknowledged: true, now })).toMatchObject({ result: "recorded" });
    await lockPrediction(db, { ...staff, predictionId: pooled.prediction.id });
    expect(await resolvePrediction(db, { ...staff, predictionId: pooled.prediction.id, outcomeId: pooled.outcomes[0].id, evidence: "Alpha happened" })).toMatchObject({ result: "resolved", rule: "proportional" });
    expect(await resolvePrediction(db, { ...staff, predictionId: pooled.prediction.id, outcomeId: pooled.outcomes[0].id, evidence: "Alpha happened" })).toMatchObject({ result: "already_resolved" });
    expect(await supply(["alice", "bob"])).toBe(100_000n);
    expect(await db.ledgerEntry.count({ where: { guildId, source: "prediction.pool", kind: "prediction_payout", sourceId: pooled.prediction.id } })).toBe(1);
    expect(await reversePrediction(db, { ...staff, predictionId: pooled.prediction.id, reason: "Undo the call" })).toMatchObject({ result: "reversed" });
    expect(await reversePrediction(db, { ...staff, predictionId: pooled.prediction.id, reason: "Undo the call" })).toMatchObject({ result: "already_reversed" });
    expect(await supply(["alice", "bob"])).toBe(100_000n);
    const alice = await db.wallet.findUnique({ where: { guildId_userId_currency: { guildId, userId: "alice", currency: "marks" } } });
    const bob = await db.wallet.findUnique({ where: { guildId_userId_currency: { guildId, userId: "bob", currency: "marks" } } });
    expect(alice?.availableMinor).toBe(50_000n);
    expect(bob?.availableMinor).toBe(50_000n);

    await credit("carol", 50);
    await credit("dave", 50);
    const drained = await createPrediction(db, {
      ...staff,
      title: "Drain",
      mode: "staked",
      rules: "Staked rules",
      evidence: "Shown before entry",
      outcomes: ["Alpha", "Beta"],
      lockAt: later,
    });
    if (drained.result !== "open" || !drained.outcomes[0] || !drained.outcomes[1]) {
      throw new Error("drain");
    }
    await enterPrediction(db, { guildId, predictionId: drained.prediction.id, userId: "carol", outcomeId: drained.outcomes[0].id, stakeMarks: 30, roleIds: [], accountAgeDays: 30, acknowledged: true, now });
    await enterPrediction(db, { guildId, predictionId: drained.prediction.id, userId: "dave", outcomeId: drained.outcomes[1].id, stakeMarks: 20, roleIds: [], accountAgeDays: 30, acknowledged: true, now });
    await lockPrediction(db, { ...staff, predictionId: drained.prediction.id });
    await resolvePrediction(db, { ...staff, predictionId: drained.prediction.id, outcomeId: drained.outcomes[0].id, evidence: "Alpha happened" });
    await db.wallet.update({ where: { guildId_userId_currency: { guildId, userId: "carol", currency: "marks" } }, data: { availableMinor: 0n } });
    expect(await reversePrediction(db, { ...staff, predictionId: drained.prediction.id, reason: "Wallet is short" })).toMatchObject({ result: "insufficient" });
    const carol = await db.wallet.findUnique({ where: { guildId_userId_currency: { guildId, userId: "carol", currency: "marks" } } });
    expect(carol?.availableMinor).toBe(0n);
    expect(await db.prediction.findUnique({ where: { id: drained.prediction.id } })).toMatchObject({ status: "resolved" });

    const tied = await createPrediction(db, { ...staff, title: "Tie", mode: "staked", rules: "Staked rules", evidence: "Shown before entry", outcomes: ["Alpha", "Beta"], lockAt: later });
    if (tied.result !== "open" || !tied.outcomes[0] || !tied.outcomes[1]) {
      throw new Error("tie");
    }
    await credit("erin", 10);
    await credit("frank", 10);
    await enterPrediction(db, { guildId, predictionId: tied.prediction.id, userId: "erin", outcomeId: tied.outcomes[0].id, stakeMarks: 4, roleIds: [], accountAgeDays: 30, acknowledged: true, now });
    await enterPrediction(db, { guildId, predictionId: tied.prediction.id, userId: "frank", outcomeId: tied.outcomes[1].id, stakeMarks: 6, roleIds: [], accountAgeDays: 30, acknowledged: true, now });
    await lockPrediction(db, { ...staff, predictionId: tied.prediction.id });
    expect(await resolvePrediction(db, { ...staff, predictionId: tied.prediction.id, outcomeId: "tie", evidence: "Both sides finished level" })).toMatchObject({ result: "refunded", rule: "tie" });
    expect(await supply(["erin", "frank"])).toBe(2_000n);

    const empty = await createPrediction(db, { ...staff, title: "Empty", mode: "staked", rules: "Staked rules", evidence: "Shown before entry", outcomes: ["Alpha", "Beta"], lockAt: later });
    if (empty.result !== "open" || !empty.outcomes[1]) {
      throw new Error("empty");
    }
    await credit("gina", 8);
    await enterPrediction(db, { guildId, predictionId: empty.prediction.id, userId: "gina", outcomeId: empty.outcomes[0]?.id ?? "", stakeMarks: 8, roleIds: [], accountAgeDays: 30, acknowledged: true, now });
    await lockPrediction(db, { ...staff, predictionId: empty.prediction.id });
    expect(await resolvePrediction(db, { ...staff, predictionId: empty.prediction.id, outcomeId: empty.outcomes[1].id, evidence: "Nobody picked the result" })).toMatchObject({ result: "refunded", rule: "no_winner" });
    expect((await db.wallet.findUnique({ where: { guildId_userId_currency: { guildId, userId: "gina", currency: "marks" } } }))?.availableMinor).toBe(800n);

    const voided = await createPrediction(db, { ...staff, title: "Void", mode: "staked", rules: "Staked rules", evidence: "Shown before entry", outcomes: ["Alpha", "Beta"], lockAt: later });
    if (voided.result !== "open" || !voided.outcomes[0]) {
      throw new Error("void");
    }
    await credit("hank", 7);
    await enterPrediction(db, { guildId, predictionId: voided.prediction.id, userId: "hank", outcomeId: voided.outcomes[0].id, stakeMarks: 7, roleIds: [], accountAgeDays: 30, acknowledged: true, now });
    expect(await cancelPrediction(db, { ...staff, predictionId: voided.prediction.id })).toMatchObject({ result: "cancelled", rule: "cancel" });
    expect(await cancelPrediction(db, { ...staff, predictionId: voided.prediction.id })).toMatchObject({ result: "already_cancelled" });
    expect((await db.wallet.findUnique({ where: { guildId_userId_currency: { guildId, userId: "hank", currency: "marks" } } }))?.availableMinor).toBe(700n);

    const raced = await createPrediction(db, { ...staff, title: "Race", mode: "staked", rules: "Staked rules", evidence: "Shown before entry", outcomes: ["Alpha", "Beta"], lockAt: later });
    if (raced.result !== "open" || !raced.outcomes[0] || !raced.outcomes[1]) {
      throw new Error("race");
    }
    await credit("ivy", 30);
    await credit("joel", 20);
    await enterPrediction(db, { guildId, predictionId: raced.prediction.id, userId: "ivy", outcomeId: raced.outcomes[0].id, stakeMarks: 30, roleIds: [], accountAgeDays: 30, acknowledged: true, now });
    await enterPrediction(db, { guildId, predictionId: raced.prediction.id, userId: "joel", outcomeId: raced.outcomes[1].id, stakeMarks: 20, roleIds: [], accountAgeDays: 30, acknowledged: true, now });
    await lockPrediction(db, { ...staff, predictionId: raced.prediction.id });
    await Promise.all([
      resolvePrediction(db, { ...staff, predictionId: raced.prediction.id, outcomeId: raced.outcomes[0].id, evidence: "Race evidence" }),
      cancelPrediction(db, { ...staff, predictionId: raced.prediction.id }),
    ]);
    const racedEntries = await db.predictionEntry.findMany({ where: { predictionId: raced.prediction.id } });
    const refunded = racedEntries.every((entry) => entry.status === "refunded");
    const settled = racedEntries.every((entry) => entry.status === "paid" || entry.status === "lost");
    expect(refunded || settled).toBe(true);
    expect(await supply(["ivy", "joel"])).toBe(5_000n);

    const late = await createPrediction(db, { ...staff, title: "Late", mode: "free", rules: "Free rules", evidence: "Shown before entry", outcomes: ["Yes", "No"], lockAt: later, requiredRoleId: "raiders" });
    if (late.result !== "open" || !late.outcomes[0]) {
      throw new Error("late");
    }
    expect(await enterPrediction(db, { guildId, predictionId: late.prediction.id, userId: "kate", outcomeId: late.outcomes[0].id, stakeMarks: 0, roleIds: [], accountAgeDays: 30, acknowledged: true, now })).toMatchObject({ result: "role" });
    await db.prediction.update({ where: { id: late.prediction.id }, data: { lockAt: new Date("2026-10-10T00:00:00.000Z"), requiredRoleId: "" } });
    const [first, second] = await Promise.all([
      enterPrediction(db, { guildId, predictionId: late.prediction.id, userId: "kate", outcomeId: late.outcomes[0].id, stakeMarks: 0, roleIds: [], accountAgeDays: 30, acknowledged: true, now }),
      enterPrediction(db, { guildId, predictionId: late.prediction.id, userId: "leo", outcomeId: late.outcomes[0].id, stakeMarks: 0, roleIds: [], accountAgeDays: 30, acknowledged: true, now }),
    ]);
    expect([first.result, second.result]).toEqual(["locked", "locked"]);
    expect(await db.predictionEntry.count({ where: { predictionId: late.prediction.id } })).toBe(0);
    expect(await editPredictionOutcomes(db, { ...staff, predictionId: late.prediction.id, outcomes: ["North", "South"] })).toMatchObject({ result: "locked" });
    expect(await db.job.count({ where: { guildId, jobType: "prediction.lock" } })).toBeGreaterThan(0);
  });

  it("publishes a contest tie, then awards one stocked prize after a correction", async () => {
    const ribbon = await savePrizeStock(db, { ...staff, name: "Ribbon", kind: "item", onHand: 1 });
    if (ribbon.result !== "stocked") {
      throw new Error(ribbon.result);
    }
    const contest = await createContest(db, {
      ...staff,
      title: "Banner",
      mode: "vote",
      rules: "One ballot each. No self votes.",
      category: "art",
      allowedTypes: ["text"],
      closesAt: later,
      selfVote: false,
      tiePolicy: "publish",
      stockId: ribbon.stock.id,
      prizeQuantity: 1,
    });
    if (contest.result !== "draft") {
      throw new Error(contest.result);
    }
    expect(await submitContestEntry(db, { guildId, contestId: contest.contest.id, userId: "maker", title: "Lamp", mediaType: "text", body: "A lamp", roleIds: [], now })).toMatchObject({ result: "unpublished" });
    await publishContest(db, { ...staff, contestId: contest.contest.id });
    expect(await submitContestEntry(db, { guildId, contestId: contest.contest.id, userId: "maker", title: "Lamp", mediaType: "video", body: "A lamp", roleIds: [], now })).toMatchObject({ result: "invalid" });
    const maker = await submitContestEntry(db, { guildId, contestId: contest.contest.id, userId: "maker", title: "Lamp", mediaType: "text", body: "A lamp", roleIds: [], now });
    const rival = await submitContestEntry(db, { guildId, contestId: contest.contest.id, userId: "rival", title: "Map", mediaType: "text", body: "A map", roleIds: [], now });
    if (maker.result !== "submitted" || rival.result !== "submitted") {
      throw new Error("entries");
    }
    expect(await castContestBallot(db, { guildId, contestId: contest.contest.id, entryId: maker.entryId, voterUserId: "maker", roleIds: [], now })).toMatchObject({ result: "self_vote" });
    await castContestBallot(db, { guildId, contestId: contest.contest.id, entryId: maker.entryId, voterUserId: "voter-a", roleIds: [], now });
    await castContestBallot(db, { guildId, contestId: contest.contest.id, entryId: rival.entryId, voterUserId: "voter-b", roleIds: [], now });
    await db.contest.update({ where: { id: contest.contest.id }, data: { closesAt: new Date(now.getTime() - 1000) } });
    const [edited] = await Promise.all([
      editContestEntry(db, { guildId, contestId: contest.contest.id, userId: "maker", title: "Lamp", body: "Changed after the deadline", now }),
      closeContest(db, { ...staff, contestId: contest.contest.id }),
    ]);
    expect(edited.result).toBe("closed");
    expect(await db.contestEntry.findUnique({ where: { id: maker.entryId } })).toMatchObject({ revision: 1, body: "A lamp" });
    expect(await awardContest(db, { ...staff, contestId: contest.contest.id, reason: "Award the published result" })).toMatchObject({ result: "tie_published" });
    expect(await db.prizeStock.findUnique({ where: { id: ribbon.stock.id } })).toMatchObject({ onHand: 1 });
    expect(await correctContest(db, { ...staff, contestId: contest.contest.id, entryId: rival.entryId, reason: "Entry broke the media rule" })).toMatchObject({ result: "corrected" });
    expect(await correctContest(db, { ...staff, contestId: contest.contest.id, entryId: maker.entryId, reason: "" })).toMatchObject({ result: "invalid" });
    expect(await awardContest(db, { ...staff, contestId: contest.contest.id, reason: "Award the remaining entry" })).toMatchObject({ result: "awarded", fulfilment: "fulfilled" });
    expect(await awardContest(db, { ...staff, contestId: contest.contest.id, reason: "Award the remaining entry" })).toMatchObject({ result: "already_recorded" });
    expect(await db.prizeStock.findUnique({ where: { id: ribbon.stock.id } })).toMatchObject({ onHand: 0 });
    expect(await db.prizeFulfilment.count({ where: { guildId, source: "contest.prize", sourceId: contest.contest.id } })).toBe(1);

    const judged = await createContest(db, {
      ...staff,
      title: "Judged",
      mode: "judge",
      rules: "Weighted staff scores.",
      category: "lore",
      allowedTypes: ["text"],
      closesAt: later,
      criteria: [{ name: "craft", weight: 1 }, { name: "lore", weight: 3 }],
      prizeQuantity: 0,
    });
    if (judged.result !== "draft") {
      throw new Error(judged.result);
    }
    await publishContest(db, { ...staff, contestId: judged.contest.id });
    const entry = await submitContestEntry(db, { guildId, contestId: judged.contest.id, userId: "maker", title: "Saga", mediaType: "text", body: "A saga", roleIds: [], now });
    if (entry.result !== "submitted") {
      throw new Error(entry.result);
    }
    const criteria = await db.contestCriterion.findMany({ where: { contestId: judged.contest.id } });
    const scores = Object.fromEntries(criteria.map((criterion) => [criterion.id, criterion.name === "craft" ? 2 : 4]));
    expect(await castContestBallot(db, { guildId, contestId: judged.contest.id, entryId: entry.entryId, voterUserId: "judge", roleIds: staffRoles, scores, now })).toMatchObject({ result: "recorded" });
    await closeContest(db, { ...staff, contestId: judged.contest.id });
    expect(await db.contestResult.findFirst({ where: { contestId: judged.contest.id } })).toMatchObject({ score: 14, tied: false });
  });

  it("deduplicates bonus entries, keeps the first draw, and does not invent a key", async () => {
    const capped = await createGiveaway(db, {
      ...staff,
      title: "Bonus",
      rules: "One free entry.",
      bonusRules: "One bonus from each verified activity, capped at one.",
      closesAt: later,
      maxBonus: 1,
    });
    if (capped.result !== "open") {
      throw new Error(capped.result);
    }
    expect(await enterGiveaway(db, { guildId, giveawayId: capped.giveaway.id, userId: "guest-a", roleIds: [], accountAgeDays: 40, now })).toMatchObject({ result: "entered" });
    expect(await enterGiveaway(db, { guildId, giveawayId: capped.giveaway.id, userId: "guest-a", roleIds: [], accountAgeDays: 40, now })).toMatchObject({ result: "already_entered" });
    const [firstBonus, secondBonus] = await Promise.all([
      addGiveawayBonus(db, { guildId, giveawayId: capped.giveaway.id, userId: "guest-a", activityKey: "raid-2", roleIds: [], accountAgeDays: 40, now }),
      addGiveawayBonus(db, { guildId, giveawayId: capped.giveaway.id, userId: "guest-a", activityKey: "raid-3", roleIds: [], accountAgeDays: 40, now }),
    ]);
    expect([firstBonus.result, secondBonus.result].sort()).toEqual(["capped", "recorded"]);
    const bonuses = await db.giveawayEntry.findMany({ where: { giveawayId: capped.giveaway.id, kind: "bonus" } });
    expect(bonuses).toHaveLength(1);
    expect(await addGiveawayBonus(db, { guildId, giveawayId: capped.giveaway.id, userId: "guest-a", activityKey: bonuses[0]?.activityKey ?? "", roleIds: [], accountAgeDays: 40, now })).toMatchObject({ result: "already_recorded" });
    expect(await addGiveawayBonus(db, { guildId, giveawayId: capped.giveaway.id, userId: "guest-b", activityKey: bonuses[0]?.activityKey ?? "", roleIds: [], accountAgeDays: 40, now })).toMatchObject({ result: "already_recorded" });

    const token = await savePrizeStock(db, { ...staff, name: "Token", kind: "item", onHand: 1 });
    if (token.result !== "stocked") {
      throw new Error(token.result);
    }
    const draw = await createGiveaway(db, {
      ...staff,
      title: "Draw",
      rules: "One free entry.",
      bonusRules: "No bonus entries.",
      closesAt: later,
      maxBonus: 0,
      stockId: token.stock.id,
      prizeQuantity: 1,
      sponsor: "Night market",
    });
    if (draw.result !== "open") {
      throw new Error(draw.result);
    }
    await enterGiveaway(db, { guildId, giveawayId: draw.giveaway.id, userId: "guest-a", roleIds: [], accountAgeDays: 40, now });
    await enterGiveaway(db, { guildId, giveawayId: draw.giveaway.id, userId: "guest-b", roleIds: [], accountAgeDays: 40, now });
    expect(await closeGiveaway(db, { ...staff, giveawayId: draw.giveaway.id })).toMatchObject({ result: "closed" });
    const snapshot = await db.giveaway.findUnique({ where: { id: draw.giveaway.id } });
    expect(await closeGiveaway(db, { ...staff, giveawayId: draw.giveaway.id })).toMatchObject({ result: "already_closed" });
    expect(JSON.stringify((await db.giveaway.findUnique({ where: { id: draw.giveaway.id } }))?.snapshot)).toBe(JSON.stringify(snapshot?.snapshot));
    const drawn = await drawGiveaway(db, { ...staff, giveawayId: draw.giveaway.id, randomIndex: () => 0 });
    if (drawn.result !== "drawn" || !drawn.draws[0]) {
      throw new Error("draw");
    }
    expect(drawn.delivery).toBe("setup_required");
    expect(await rerollGiveaway(db, { ...staff, giveawayId: draw.giveaway.id, reason: "No failure yet" })).toMatchObject({ result: "not_eligible" });
    expect(await disqualifyGiveaway(db, { ...staff, drawId: drawn.draws[0].id, reason: "Winner missed the claim" })).toMatchObject({ result: "disqualified" });
    const rerolled = await rerollGiveaway(db, { ...staff, giveawayId: draw.giveaway.id, reason: "Replace the disqualified winner", randomIndex: () => 0 });
    if (rerolled.result !== "rerolled") {
      throw new Error(rerolled.result);
    }
    expect(rerolled.initialPreserved).toBe(true);
    expect(rerolled.draw.userId).not.toBe(drawn.draws[0].userId);
    const initial = await db.giveawayDraw.findFirst({ where: { giveawayId: draw.giveaway.id, sequence: 1 } });
    expect(initial).toMatchObject({ status: "disqualified", userId: drawn.draws[0].userId });
    expect(await claimGiveaway(db, { guildId, drawId: rerolled.draw.id, userId: rerolled.draw.userId, now })).toMatchObject({ result: "claimed", fulfilment: "fulfilled" });
    expect(await claimGiveaway(db, { guildId, drawId: rerolled.draw.id, userId: rerolled.draw.userId, now })).toMatchObject({ result: "already_claimed" });
    expect(await db.prizeStock.findUnique({ where: { id: token.stock.id } })).toMatchObject({ onHand: 0 });

    const key = await savePrizeStock(db, { ...staff, name: "Steam key", kind: "external_key", onHand: 0 });
    if (key.result !== "stocked") {
      throw new Error(key.result);
    }
    expect(key.stock.shopStatus).toBe("shop_pending");
    const locked = await createGiveaway(db, {
      ...staff,
      title: "Key",
      rules: "One free entry.",
      bonusRules: "No bonus entries.",
      closesAt: later,
      maxBonus: 0,
      stockId: key.stock.id,
    });
    if (locked.result !== "open") {
      throw new Error(locked.result);
    }
    await enterGiveaway(db, { guildId, giveawayId: locked.giveaway.id, userId: "guest-c", roleIds: [], accountAgeDays: 40, now });
    await closeGiveaway(db, { ...staff, giveawayId: locked.giveaway.id });
    const keyDraw = await drawGiveaway(db, { ...staff, giveawayId: locked.giveaway.id, randomIndex: () => 0 });
    if (keyDraw.result !== "drawn" || !keyDraw.draws[0]) {
      throw new Error("key draw");
    }
    const claimed = await claimGiveaway(db, { guildId, drawId: keyDraw.draws[0].id, userId: "guest-c", now });
    expect(claimed).toMatchObject({ result: "claimed", fulfilment: "shop_pending", detail: SHOP_KEY_DETAIL });
    const fulfilment = await db.prizeFulfilment.findFirst({ where: { guildId, source: "giveaway.prize", sourceId: locked.giveaway.id } });
    expect(fulfilment).toMatchObject({ status: "shop_pending", detail: SHOP_KEY_DETAIL });
    expect(JSON.stringify(fulfilment)).not.toMatch(/[A-Z0-9]{5}-[A-Z0-9]{5}/);
    expect(await db.prizeStock.findUnique({ where: { id: key.stock.id } })).toMatchObject({ onHand: 0, shopStatus: "shop_pending" });

    const cancelled = await createGiveaway(db, { ...staff, title: "Stop", rules: "One free entry.", bonusRules: "None.", closesAt: later, maxBonus: 0 });
    if (cancelled.result !== "open") {
      throw new Error(cancelled.result);
    }
    expect(await cancelGiveaway(db, { ...staff, giveawayId: cancelled.giveaway.id })).toMatchObject({ result: "cancelled" });
    expect(await drawGiveaway(db, { ...staff, giveawayId: cancelled.giveaway.id })).toMatchObject({ result: "cancelled" });
    expect(await db.outboxMessage.count({ where: { guildId } })).toBe(0);
    expect(await db.job.count({ where: { guildId, jobType: "giveaway.close" } })).toBeGreaterThan(0);
    expect(await db.job.count({ where: { guildId, jobType: "contest.close" } })).toBeGreaterThan(0);
  });
});
