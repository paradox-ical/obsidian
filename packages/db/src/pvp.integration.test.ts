import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { ratingDelta } from "@collective/domain";

import { changeClass, chooseClass, introReset } from "./characters.js";
import { createPrismaClient } from "./client.js";
import { equipGear, mintGear } from "./combat.js";
import { assignContract, saveContractObjective } from "./contracts.js";
import { fundExceptional, issueMarks } from "./ledger.js";
import { grantCapability } from "./platform.js";
import {
  acceptChallenge,
  cancelChallenge,
  joinQueue,
  leaveQueue,
  noteDisconnect,
  offerChallenge,
  sweepPvp,
} from "./pvp.js";
import { readSeasonArchive, rollSeason } from "./seasons.js";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.");
}

const db = createPrismaClient(databaseUrl);
const guildId = `guild-${randomUUID()}`;
const now = new Date("2026-10-12T02:00:00.000Z");
const staff = ["staff"];
const win = [{ attack: 18, damage: [30] }, { attack: 1, damage: [1] }];
const lose = [{ attack: 1, damage: [1] }, { attack: 18, damage: [30] }];

async function marks(userId: string) {
  const wallet = await db.wallet.findUnique({ where: { guildId_userId_currency: { guildId, userId, currency: "marks" } } });
  return { available: Number(wallet?.availableMinor ?? 0n) / 100, escrow: Number(wallet?.escrowMinor ?? 0n) / 100 };
}

afterAll(async () => {
  await db.pvpReview.deleteMany({ where: { guildId } });
  await db.pvpMatch.deleteMany({ where: { guildId } });
  await db.pvpQueueEntry.deleteMany({ where: { guildId } });
  await db.pvpRating.deleteMany({ where: { guildId } });
  await db.battleAction.deleteMany({ where: { guildId } });
  await db.battleRoll.deleteMany({ where: { guildId } });
  await db.battle.deleteMany({ where: { guildId } });
  await db.gearInstance.deleteMany({ where: { guildId } });
  await db.gearTemplate.deleteMany({ where: { guildId } });
  await db.testOpponent.deleteMany({ where: { guildId } });
  await db.job.deleteMany({ where: { guildId } });
  await db.contractAssignment.deleteMany({ where: { guildId } });
  await db.contractRevision.deleteMany({ where: { guildId } });
  await db.contractDefinition.deleteMany({ where: { guildId } });
  await db.contractSettings.deleteMany({ where: { guildId } });
  await db.characterXpEvent.deleteMany({ where: { guildId } });
  await db.playerCharacter.deleteMany({ where: { guildId } });
  await db.classAbility.deleteMany({ where: { guildId } });
  await db.classDefinition.deleteMany({ where: { guildId } });
  await db.characterCurve.deleteMany({ where: { guildId } });
  await db.seasonArchive.deleteMany({ where: { guildId } });
  await db.seasonState.deleteMany({ where: { guildId } });
  await db.seasonSettings.deleteMany({ where: { guildId } });
  await db.ledgerEntry.deleteMany({ where: { guildId } });
  await db.wallet.deleteMany({ where: { guildId } });
  await db.issuanceBudget.deleteMany({ where: { guildId } });
  await db.economySettings.deleteMany({ where: { guildId } });
  await db.auditRecord.deleteMany({ where: { guildId } });
  await db.capabilityGrant.deleteMany({ where: { guildId } });
  await db.featureFlag.deleteMany({ where: { guildId } });
  await db.outboxMessage.deleteMany({ where: { guildId } });
  await db.guild.deleteMany({ where: { guildId } });
  await db.$disconnect();
});

describe("ranked queues, challenges, and wagers", () => {
  it("matches once, demotes a repeated pair, and settles a pot one time", async () => {
    await grantCapability(db, { guildId, roleId: "staff", capability: "event_management", actorUserId: "owner", reason: "test" });
    await grantCapability(db, { guildId, roleId: "staff", capability: "economy_operations", actorUserId: "owner", reason: "test" });
    expect(await fundExceptional(db, { guildId, amountMarks: 320, idempotencyKey: "pvp-pool", reason: "PvP test", actorUserId: "owner", actorRoleIds: staff, now })).toMatchObject({ result: "funded" });
    for (const userId of ["alpha", "beta", "gamma", "broke"]) {
      expect(await chooseClass(db, { guildId, userId, classSlug: "hitman", now })).toMatchObject({ result: "chosen" });
      if (userId !== "broke") {
        expect(await issueMarks(db, { guildId, userId, amountMarks: 80, source: "pvp.test", sourceId: userId, pace: "exceptional", idempotencyKey: `fund:${userId}`, reason: "PvP test", actorUserId: "owner", now })).toMatchObject({ result: "posted" });
      }
    }
    const knife = await mintGear(db, { guildId, userId: "alpha", templateSlug: "field-knife", idempotencyKey: "pvp-knife" });
    expect(knife.result).toBe("minted");
    if (knife.result === "minted") {
      expect(await equipGear(db, { guildId, userId: "alpha", itemId: knife.itemId })).toMatchObject({ result: "equipped" });
    }
    const objective = await saveContractObjective(db, { guildId, actorUserId: "owner", actorRoleIds: staff, title: "Win ranked", prompt: "Win one ranked match.", kind: "rpg_pvp", target: 1, rewardMarks: 10, now });
    if (objective.result !== "saved") {
      throw new Error(objective.result);
    }
    const assignment = await assignContract(db, { guildId, actorUserId: "owner", actorRoleIds: staff, userId: "alpha", definitionId: objective.objectiveId, board: "daily", now });
    if (assignment.result !== "assigned") {
      throw new Error(assignment.result);
    }

    await Promise.all([
      joinQueue(db, { guildId, userId: "alpha", mode: "ranked", stake: 0, packets: win, now }),
      joinQueue(db, { guildId, userId: "beta", mode: "ranked", stake: 0, packets: win, now }),
    ]);
    const firstMatches = await db.pvpMatch.findMany({ where: { guildId } });
    expect(firstMatches).toHaveLength(1);
    const first = firstMatches[0];
    expect(first).toMatchObject({ status: "settled", mode: "ranked", rankedEligible: true, winnerUserId: "alpha", outcome: "win" });
    if (!first) {
      return;
    }
    expect(await acceptChallenge(db, { guildId, userId: "beta", matchId: first.id, packets: win, now })).toMatchObject({ result: "closed" });
    expect(await db.ledgerEntry.count({ where: { idempotencyKey: `pvp-reward:${first.id}:alpha` } })).toBe(1);
    expect(await db.pvpRating.findFirst({ where: { guildId, userId: "alpha" } })).toMatchObject({ rating: 1016, wins: 1 });
    expect(await db.pvpRating.findFirst({ where: { guildId, userId: "beta" } })).toMatchObject({ rating: 984, losses: 1 });
    expect(await db.contractAssignment.findUnique({ where: { id: assignment.assignment.id } })).toMatchObject({ status: "completed", payoutMarks: 10 });
    expect(await introReset(db, { guildId, userId: "alpha", now })).toMatchObject({ result: "ranked" });

    const second = await offerChallenge(db, { guildId, userId: "alpha", opponentUserId: "beta", mode: "ranked", stake: 0, now });
    expect(second).toMatchObject({ result: "ready", mode: "ranked", demoted: false, rankedEligible: true, status: "proposed" });
    if (second.result !== "ready") {
      return;
    }
    expect(await acceptChallenge(db, { guildId, userId: "beta", matchId: second.matchId, packets: win, now })).toMatchObject({ status: "settled", rankedEligible: true, winnerUserId: "alpha" });
    expect(await db.ledgerEntry.count({ where: { idempotencyKey: `pvp-reward:${second.matchId}:alpha` } })).toBe(1);
    const ratingAfterTwo = 1016 + ratingDelta(1016, 984, 1);
    expect(await db.pvpRating.findFirst({ where: { guildId, userId: "alpha" } })).toMatchObject({ rating: ratingAfterTwo, lifetimeWins: 2 });

    const third = await offerChallenge(db, { guildId, userId: "alpha", opponentUserId: "beta", mode: "ranked", stake: 0, now });
    expect(third).toMatchObject({ result: "ready", mode: "casual", demoted: true, rankedEligible: false, status: "proposed" });
    if (third.result !== "ready") {
      return;
    }
    expect(third.rules).toContain("casual");
    expect(await acceptChallenge(db, { guildId, userId: "beta", matchId: third.matchId, packets: win, now })).toMatchObject({ status: "settled", mode: "casual", rankedEligible: false });
    expect(await db.pvpRating.findFirst({ where: { guildId, userId: "alpha" } })).toMatchObject({ rating: ratingAfterTwo, lifetimeWins: 2 });
    expect(await db.ledgerEntry.count({ where: { idempotencyKey: { startsWith: `pvp-reward:${third.matchId}` } } })).toBe(0);
    expect(await marks("alpha")).toEqual({ available: 106, escrow: 0 });

    await joinQueue(db, { guildId, userId: "alpha", mode: "ranked", stake: 0, now });
    await joinQueue(db, { guildId, userId: "beta", mode: "ranked", stake: 0, now });
    const repeatedQueue = await db.pvpMatch.findFirst({ where: { guildId, status: "proposed", demoted: true, rankedEligible: false, mode: "casual" } });
    expect(repeatedQueue).toMatchObject({ acceptedLeft: false, acceptedRight: false, requestedMode: "ranked" });
    expect(repeatedQueue?.rules).toContain("casual");
    expect(await db.pvpMatch.count({ where: { guildId, rankedEligible: true, status: "settled" } })).toBe(2);
    if (!repeatedQueue) {
      return;
    }
    expect(await cancelChallenge(db, { guildId, userId: "alpha", matchId: repeatedQueue.id, now })).toMatchObject({ result: "cancelled" });
    expect(await db.pvpRating.findFirst({ where: { guildId, userId: "alpha" } })).toMatchObject({ rating: ratingAfterTwo, lifetimeWins: 2 });

    const wager = await offerChallenge(db, { guildId, userId: "alpha", opponentUserId: "beta", mode: "casual", stake: 10, now });
    if (wager.result !== "ready") {
      throw new Error(wager.result);
    }
    expect(await acceptChallenge(db, { guildId, userId: "beta", matchId: wager.matchId, packets: win, now })).toMatchObject({ outcome: "win", winnerUserId: "alpha" });
    expect(await acceptChallenge(db, { guildId, userId: "beta", matchId: wager.matchId, packets: win, now })).toMatchObject({ result: "closed" });
    expect(await marks("alpha")).toEqual({ available: 116, escrow: 0 });
    expect(await marks("beta")).toEqual({ available: 70, escrow: 0 });
    expect(await db.ledgerEntry.count({ where: { idempotencyKey: `pvp-wager:${wager.matchId}:gate` } })).toBe(1);

    const draw = await offerChallenge(db, { guildId, userId: "alpha", opponentUserId: "beta", mode: "casual", stake: 10, now });
    if (draw.result !== "ready") {
      throw new Error(draw.result);
    }
    const misses = Array.from({ length: 16 }, () => ({ attack: 1, damage: [1] }));
    expect(await acceptChallenge(db, { guildId, userId: "beta", matchId: draw.matchId, packets: misses, now })).toMatchObject({ outcome: "draw", rankedEligible: false });
    expect(await acceptChallenge(db, { guildId, userId: "beta", matchId: draw.matchId, packets: misses, now })).toMatchObject({ result: "closed" });
    expect(await marks("alpha")).toEqual({ available: 116, escrow: 0 });
    expect(await marks("beta")).toEqual({ available: 70, escrow: 0 });

    const halted = await offerChallenge(db, { guildId, userId: "alpha", opponentUserId: "beta", mode: "casual", stake: 10, style: "tactical", now });
    if (halted.result !== "ready") {
      throw new Error(halted.result);
    }
    expect(await acceptChallenge(db, { guildId, userId: "beta", matchId: halted.matchId, now })).toMatchObject({ status: "active" });
    await noteDisconnect(db, { guildId, userId: "alpha", matchId: halted.matchId, now });
    await noteDisconnect(db, { guildId, userId: "beta", matchId: halted.matchId, now });
    await sweepPvp(db, new Date(now.getTime() + 2 * 60 * 1000));
    expect(await db.pvpMatch.findUnique({ where: { id: halted.matchId } })).toMatchObject({ status: "cancelled", outcome: "cancel" });
    expect(await marks("alpha")).toEqual({ available: 116, escrow: 0 });
    expect(await marks("beta")).toEqual({ available: 70, escrow: 0 });

    const race = await offerChallenge(db, { guildId, userId: "alpha", opponentUserId: "beta", mode: "casual", stake: 10, style: "tactical", now });
    if (race.result !== "ready") {
      throw new Error(race.result);
    }
    const [accepted, cancelled] = await Promise.all([
      acceptChallenge(db, { guildId, userId: "beta", matchId: race.matchId, now }),
      cancelChallenge(db, { guildId, userId: "alpha", matchId: race.matchId, now }),
    ]);
    expect(["cancelled", "closed", "ready"]).toContain(accepted.result);
    expect(["cancelled", "closed"]).toContain(cancelled.result);
    const raced = await db.pvpMatch.findUnique({ where: { id: race.matchId } });
    const holds = await db.ledgerEntry.count({ where: { idempotencyKey: { startsWith: `pvp-hold:${race.matchId}` } } });
    expect(holds === 0 || holds === 2).toBe(true);
    if (raced?.status === "active") {
      expect(await marks("alpha")).toMatchObject({ escrow: 10 });
      await noteDisconnect(db, { guildId, userId: "beta", matchId: race.matchId, now });
      expect((await sweepPvp(db, new Date(now.getTime() + 60 * 1000))).advanced).toBe(0);
      await sweepPvp(db, new Date(now.getTime() + 2 * 60 * 1000));
      expect(await db.pvpMatch.findUnique({ where: { id: race.matchId } })).toMatchObject({ status: "forfeited", winnerUserId: "alpha" });
      expect(await marks("alpha")).toMatchObject({ escrow: 0 });
      expect(await marks("beta")).toMatchObject({ escrow: 0 });
    } else {
      expect(raced?.status === "cancelled" || raced?.status === "settled" || raced?.status === "forfeited").toBe(true);
      expect(await marks("alpha")).toMatchObject({ escrow: 0 });
      expect(await marks("beta")).toMatchObject({ escrow: 0 });
    }

    const broke = await offerChallenge(db, { guildId, userId: "broke", opponentUserId: "gamma", mode: "casual", stake: 10, now });
    if (broke.result !== "ready") {
      throw new Error(broke.result);
    }
    expect(await acceptChallenge(db, { guildId, userId: "gamma", matchId: broke.matchId, now })).toMatchObject({ result: "insufficient" });
    expect(await marks("broke")).toEqual({ available: 0, escrow: 0 });
    expect(await marks("gamma")).toEqual({ available: 80, escrow: 0 });

    await joinQueue(db, { guildId, userId: "alpha", mode: "casual", stake: 5, now });
    await joinQueue(db, { guildId, userId: "beta", mode: "casual", stake: 0, now });
    expect(await db.pvpQueueEntry.count({ where: { guildId, status: "waiting" } })).toBe(2);
    await leaveQueue(db, { guildId, userId: "alpha", now });
    await leaveQueue(db, { guildId, userId: "beta", now });

    const tactical = await offerChallenge(db, { guildId, userId: "alpha", opponentUserId: "gamma", mode: "casual", stake: 10, style: "tactical", now });
    if (tactical.result !== "ready") {
      throw new Error(tactical.result);
    }
    expect(await acceptChallenge(db, { guildId, userId: "gamma", matchId: tactical.matchId, now })).toMatchObject({ status: "active" });
    await noteDisconnect(db, { guildId, userId: "gamma", matchId: tactical.matchId, now });
    await sweepPvp(db, new Date(now.getTime() + 60 * 1000));
    expect(await db.pvpMatch.findUnique({ where: { id: tactical.matchId } })).toMatchObject({ status: "active" });
    await sweepPvp(db, new Date(now.getTime() + 2 * 60 * 1000));
    expect(await db.pvpMatch.findUnique({ where: { id: tactical.matchId } })).toMatchObject({ status: "forfeited", winnerUserId: "alpha", rankedEligible: false });
    expect(await db.ledgerEntry.count({ where: { idempotencyKey: `pvp-reward:${tactical.matchId}:alpha` } })).toBe(0);

    const quiet = await offerChallenge(db, { guildId, userId: "alpha", opponentUserId: "gamma", mode: "casual", stake: 0, style: "tactical", now });
    if (quiet.result !== "ready") {
      throw new Error(quiet.result);
    }
    const quietStart = new Date(now.getTime() + 3 * 60 * 1000);
    expect(await acceptChallenge(db, { guildId, userId: "gamma", matchId: quiet.matchId, now: quietStart })).toMatchObject({ status: "active" });
    const firstMiss = new Date(quietStart.getTime() + 2 * 60 * 1000);
    await sweepPvp(db, firstMiss);
    expect(await db.pvpMatch.findUnique({ where: { id: quiet.matchId } })).toMatchObject({ status: "active", leftMisses: 1, rightMisses: 0 });
    await sweepPvp(db, firstMiss);
    expect(await db.pvpMatch.findUnique({ where: { id: quiet.matchId } })).toMatchObject({ status: "active", leftMisses: 1, rightMisses: 0 });
    await sweepPvp(db, new Date(quietStart.getTime() + 4 * 60 * 1000));
    expect(await db.pvpMatch.findUnique({ where: { id: quiet.matchId } })).toMatchObject({ status: "active", leftMisses: 1, rightMisses: 1 });
    await sweepPvp(db, new Date(quietStart.getTime() + 6 * 60 * 1000));
    expect(await db.pvpMatch.findUnique({ where: { id: quiet.matchId } })).toMatchObject({ status: "forfeited", winnerUserId: "gamma" });

    const later = new Date(now.getTime() + 10 * 60 * 1000);
    for (const [step, packets] of [[1, win], [2, lose], [3, win]] as const) {
      const offered = await offerChallenge(db, { guildId, userId: "beta", opponentUserId: "gamma", mode: "casual", stake: 10, now: new Date(later.getTime() + step * 1000) });
      if (offered.result !== "ready") {
        throw new Error(offered.result);
      }
      expect(await acceptChallenge(db, { guildId, userId: "gamma", matchId: offered.matchId, packets, now: new Date(later.getTime() + step * 1000) })).toMatchObject({ status: "settled" });
    }
    expect(await db.pvpReview.count({ where: { guildId, status: "open" } })).toBe(1);
    expect(await db.gearInstance.findFirst({ where: { guildId, userId: "alpha" } })).toMatchObject({ destroyed: false, lock: "" });

    const opened = await rollSeason(db, { guildId, now, actorUserId: "owner", reason: "Open the season" });
    expect(opened.result).toBe("not_due");
    if (opened.result !== "not_due") {
      return;
    }
    const rolled = await rollSeason(db, { guildId, now: opened.endsAt, actorUserId: "owner", reason: "Close the season" });
    expect(rolled.result).toBe("rolled");
    if (rolled.result !== "rolled") {
      return;
    }
    expect(rolled.preservation.ranked).toEqual({ status: "reset", retained: true });
    const archive = await readSeasonArchive(db, { guildId, seasonId: opened.seasonId, category: "pvp", viewerId: "alpha" });
    expect(archive).toMatchObject({ result: "ready", availability: "available" });
    await joinQueue(db, { guildId, userId: "alpha", mode: "casual", stake: 0, now: opened.endsAt });
    expect(await db.pvpRating.findFirst({ where: { guildId, userId: "alpha", seasonId: rolled.nextSeasonId } })).toMatchObject({ rating: 1000, lifetimeWins: 2 });
    await leaveQueue(db, { guildId, userId: "alpha", now: opened.endsAt });
    await joinQueue(db, { guildId, userId: "alpha", mode: "casual", stake: 0, now: opened.endsAt });
    expect(await changeClass(db, { guildId, userId: "alpha", classSlug: "bruiser", now: opened.endsAt })).toMatchObject({ result: "locked" });
    await leaveQueue(db, { guildId, userId: "alpha", now: opened.endsAt });
  });
});
