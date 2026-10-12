import { randomInt, randomUUID } from "node:crypto";

import {
  DISCONNECT_GRACE_MINUTES,
  PVP_RULES,
  RANKED_REWARD_MARKS,
  RANKED_REWARD_XP,
  STARTING_RATING,
  TACTICAL_TURN_MS,
  cycleId,
  disconnectDue,
  forfeitAfterMisses,
  freshBattle,
  isPvpMode,
  pairDecision,
  pairKey,
  queueTolerance,
  rankStandings,
  ratingDelta,
  resolveAction,
  resolveQuick,
  stakeDecision,
  suspiciousPattern,
  type BattleState,
  type RollPacket,
} from "@collective/domain";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

import { grantCharacterXp, noteRankedDebut } from "./characters.js";
import { loadPvpFighter } from "./combat.js";
import { noteContractSignal } from "./contracts.js";
import { holdMarksPair, issueMarks, settleWager } from "./ledger.js";
import { enqueueJob, ensureGuild, moduleIsAvailable, type Writer } from "./platform.js";
import { ensureSeason } from "./seasons.js";

type Tx = Prisma.TransactionClient;
type Root = PrismaClient;

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isUnique(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

async function openRpg(db: Writer, guildId: string) {
  await ensureGuild(db, { guildId });
  return moduleIsAvailable(db, guildId, "rpg");
}

function asState(value: unknown): BattleState {
  if (!value || typeof value !== "object" || !("fighters" in value)) {
    throw new Error("Battle state is unreadable.");
  }
  return value as BattleState;
}

async function blocked(tx: Tx, guildId: string, userId: string) {
  const character = await tx.playerCharacter.findUnique({ where: { guildId_userId: { guildId, userId } } });
  if (!character) {
    return "missing" as const;
  }
  if (character.gameplayLock) {
    return "locked" as const;
  }
  const solo = await tx.missionRun.findFirst({ where: { guildId, userId, status: "active" }, select: { id: true } });
  if (solo) {
    return "locked" as const;
  }
  const seats = await tx.crewMissionMember.findMany({ where: { guildId, userId }, select: { missionId: true } });
  if (seats.length > 0) {
    const live = await tx.crewMission.findFirst({ where: { id: { in: seats.map((seat) => seat.missionId) }, status: { in: ["forming", "active"] } }, select: { id: true } });
    if (live) {
      return "locked" as const;
    }
  }
  const expedition = await tx.expedition.findFirst({ where: { guildId, userId, status: "active" }, select: { id: true } });
  return expedition ? "locked" as const : "ready" as const;
}

async function setLock(tx: Tx, guildId: string, userId: string, lock: "" | "queue" | "combat") {
  const character = await tx.playerCharacter.findUnique({ where: { guildId_userId: { guildId, userId } } });
  if (!character) {
    return;
  }
  if (lock === "" && character.gameplayLock !== "queue" && character.gameplayLock !== "combat") {
    return;
  }
  await tx.playerCharacter.update({ where: { id: character.id }, data: { gameplayLock: lock } });
  if (lock === "combat") {
    await tx.gearInstance.updateMany({ where: { guildId, userId, equipped: true, lock: "" }, data: { lock: "combat" } });
  }
  if (lock === "") {
    await tx.gearInstance.updateMany({ where: { guildId, userId, lock: "combat" }, data: { lock: "" } });
  }
}

function present(match: { id: string; mode: string; requestedMode: string; demoted: boolean; status: string; stake: number; rankedEligible: boolean; rules: string; winnerUserId: string; outcome: string; leftUserId: string; rightUserId: string }) {
  return {
    result: "ready" as const,
    matchId: match.id,
    mode: match.mode,
    requestedMode: match.requestedMode,
    demoted: match.demoted,
    status: match.status,
    stake: match.stake,
    rankedEligible: match.rankedEligible,
    rules: match.rules,
    winnerUserId: match.winnerUserId,
    outcome: match.outcome,
    leftUserId: match.leftUserId,
    rightUserId: match.rightUserId,
  };
}

async function liveMatch(db: Writer, guildId: string, userId: string) {
  return db.pvpMatch.findFirst({
    where: { guildId, status: { in: ["proposed", "starting", "escrowing", "active"] }, OR: [{ leftUserId: userId }, { rightUserId: userId }] },
    orderBy: { createdAt: "desc" },
  });
}

async function ensureRating(tx: Tx, guildId: string, userId: string, seasonId: string) {
  const current = await tx.pvpRating.findUnique({ where: { guildId_userId_seasonId: { guildId, userId, seasonId } } });
  if (current) {
    return current;
  }
  const previous = await tx.pvpRating.findFirst({ where: { guildId, userId }, orderBy: { updatedAt: "desc" } });
  return tx.pvpRating.create({
    data: {
      id: randomUUID(),
      guildId,
      userId,
      seasonId,
      rating: STARTING_RATING,
      lifetimeWins: previous?.lifetimeWins ?? 0,
      lifetimeLosses: previous?.lifetimeLosses ?? 0,
      lifetimeDraws: previous?.lifetimeDraws ?? 0,
    },
  });
}

function packetsOrGenerated(packets: readonly RollPacket[] | undefined): RollPacket[] {
  return packets ? [...packets] : Array.from({ length: 8 }, () => ({ attack: randomInt(1, 21), damage: [randomInt(1, 7)] }));
}

function judged(state: BattleState, leftUserId: string, rightUserId: string) {
  const leftHealth = state.fighters[0]?.health ?? 0;
  const rightHealth = state.fighters[1]?.health ?? 0;
  if (leftHealth === rightHealth) {
    return { outcome: "draw" as const, winnerUserId: "" };
  }
  return leftHealth > rightHealth ? { outcome: "win" as const, winnerUserId: leftUserId } : { outcome: "win" as const, winnerUserId: rightUserId };
}

async function finishMatch(db: Root, matchId: string, input: { outcome: "win" | "draw" | "cancel" | "forfeit"; winnerUserId: string; now: Date }) {
  const prepared = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "pvp_match" WHERE "id" = ${matchId} FOR UPDATE`;
    const match = rows[0] ? await tx.pvpMatch.findUnique({ where: { id: rows[0].id } }) : null;
    if (!match) {
      return null;
    }
    if (match.ratingPosted && match.wagerPosted && match.rewardsPosted) {
      return { posted: true as const, match };
    }
    if (match.rankedEligible && !match.ratingPosted && input.outcome !== "cancel") {
      const left = await ensureRating(tx, match.guildId, match.leftUserId, match.seasonId);
      const right = await ensureRating(tx, match.guildId, match.rightUserId, match.seasonId);
      const leftScore = input.outcome === "draw" ? 0.5 : input.winnerUserId === match.leftUserId ? 1 : 0;
      const rightScore = input.outcome === "draw" ? 0.5 : input.winnerUserId === match.rightUserId ? 1 : 0;
      await tx.pvpRating.update({
        where: { id: left.id },
        data: {
          rating: left.rating + ratingDelta(left.rating, right.rating, leftScore as 0 | 0.5 | 1),
          wins: left.wins + (leftScore === 1 ? 1 : 0),
          losses: left.losses + (leftScore === 0 ? 1 : 0),
          draws: left.draws + (leftScore === 0.5 ? 1 : 0),
          lifetimeWins: left.lifetimeWins + (leftScore === 1 ? 1 : 0),
          lifetimeLosses: left.lifetimeLosses + (leftScore === 0 ? 1 : 0),
          lifetimeDraws: left.lifetimeDraws + (leftScore === 0.5 ? 1 : 0),
        },
      });
      await tx.pvpRating.update({
        where: { id: right.id },
        data: {
          rating: right.rating + ratingDelta(right.rating, left.rating, rightScore as 0 | 0.5 | 1),
          wins: right.wins + (rightScore === 1 ? 1 : 0),
          losses: right.losses + (rightScore === 0 ? 1 : 0),
          draws: right.draws + (rightScore === 0.5 ? 1 : 0),
          lifetimeWins: right.lifetimeWins + (rightScore === 1 ? 1 : 0),
          lifetimeLosses: right.lifetimeLosses + (rightScore === 0 ? 1 : 0),
          lifetimeDraws: right.lifetimeDraws + (rightScore === 0.5 ? 1 : 0),
        },
      });
    }
    const status = input.outcome === "cancel" ? "cancelled" : input.outcome === "forfeit" ? "forfeited" : "settled";
    const saved = await tx.pvpMatch.update({
      where: { id: match.id },
      data: { status, outcome: input.outcome, winnerUserId: input.winnerUserId, ratingPosted: true, settledAt: input.now },
    });
    await setLock(tx, match.guildId, match.leftUserId, "");
    await setLock(tx, match.guildId, match.rightUserId, "");
    return { posted: false as const, match: saved };
  });
  if (!prepared) {
    return { result: "missing" as const };
  }
  if (prepared.posted) {
    return { ...present(prepared.match), result: "posted" as const };
  }
  const match = prepared.match;
  if (!match.wagerPosted && match.stake > 0) {
    await settleWager(db, {
      guildId: match.guildId,
      leftUserId: match.leftUserId,
      rightUserId: match.rightUserId,
      winnerUserId: input.winnerUserId,
      amountMarks: match.stake,
      idempotencyKey: `pvp-wager:${match.id}`,
      outcome: input.outcome === "win" || input.outcome === "forfeit" ? "pot" : "refund",
      now: input.now,
    });
  }
  if (!match.rewardsPosted && input.outcome === "win" && match.rankedEligible && input.winnerUserId) {
    await grantCharacterXp(db, { guildId: match.guildId, userId: input.winnerUserId, amount: RANKED_REWARD_XP, source: "pvp", idempotencyKey: `pvp-xp:${match.id}:${input.winnerUserId}`, now: input.now });
    await issueMarks(db, {
      guildId: match.guildId,
      userId: input.winnerUserId,
      amountMarks: RANKED_REWARD_MARKS,
      source: "pvp",
      sourceId: match.id,
      pace: "routine",
      idempotencyKey: `pvp-reward:${match.id}:${input.winnerUserId}`,
      reason: "Ranked match reward",
      actorUserId: "system",
      now: input.now,
    });
    await noteContractSignal(db, { guildId: match.guildId, userId: input.winnerUserId, kind: "rpg_pvp", amount: 1, now: input.now });
  }
  await db.pvpMatch.update({ where: { id: match.id }, data: { wagerPosted: true, rewardsPosted: true } });
  if (match.stake > 0) {
    const recent = await db.pvpMatch.findMany({
      where: { guildId: match.guildId, pairKey: match.pairKey, stake: { gt: 0 }, status: { in: ["settled", "forfeited"] } },
      orderBy: { settledAt: "desc" },
      take: 3,
    });
    const ordered = recent.slice().reverse();
    if (suspiciousPattern(ordered.map((row) => row.winnerUserId), ordered.map((row) => row.stake))) {
      await db.pvpReview.create({
        data: { id: randomUUID(), guildId: match.guildId, matchId: match.id, pairKey: match.pairKey, reason: "Three wagered matches alternated winners.", status: "open" },
      }).catch((error: unknown) => {
        if (!isUnique(error)) {
          throw error;
        }
      });
    }
  }
  const current = await db.pvpMatch.findUnique({ where: { id: match.id } });
  return current ? present(current) : { result: "missing" as const };
}

async function beginFight(db: Root, matchId: string, packets: readonly RollPacket[] | undefined, now: Date) {
  const reserved = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "pvp_match" WHERE "id" = ${matchId} FOR UPDATE`;
    const match = rows[0] ? await tx.pvpMatch.findUnique({ where: { id: rows[0].id } }) : null;
    if (!match) {
      return { result: "missing" as const };
    }
    const ready = match.status === "starting" || (match.status === "proposed" && match.acceptedLeft && match.acceptedRight);
    if (!ready) {
      return { result: "waiting" as const, match };
    }
    await tx.pvpMatch.update({ where: { id: match.id }, data: { status: "escrowing" } });
    return { result: "reserved" as const, match };
  });
  if (reserved.result === "missing") {
    return { result: "missing" as const };
  }
  if (reserved.result === "waiting") {
    return present(reserved.match);
  }
  const existing = reserved.match;
  if (existing.stake > 0) {
    const held = await holdMarksPair(db, {
      guildId: existing.guildId,
      leftUserId: existing.leftUserId,
      rightUserId: existing.rightUserId,
      amountMarks: existing.stake,
      idempotencyKey: `pvp-hold:${existing.id}`,
      reason: "PvP wager escrow",
      now,
    });
    if (held.result === "insufficient") {
      await finishMatch(db, existing.id, { outcome: "cancel", winnerUserId: "", now });
      return { result: "insufficient" as const, matchId: existing.id };
    }
  }
  const claimed = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "pvp_match" WHERE "id" = ${matchId} FOR UPDATE`;
    const match = rows[0] ? await tx.pvpMatch.findUnique({ where: { id: rows[0].id } }) : null;
    if (!match || match.status !== "escrowing") {
      return null;
    }
    const left = await loadPvpFighter(tx, match.guildId, match.leftUserId, "member", match.mode === "ranked" ? "ranked" : "casual");
    const right = await loadPvpFighter(tx, match.guildId, match.rightUserId, "opponent", match.mode === "ranked" ? "ranked" : "casual");
    if (!left || !right) {
      return { missing: true as const };
    }
    await setLock(tx, match.guildId, match.leftUserId, "combat");
    await setLock(tx, match.guildId, match.rightUserId, "combat");
    if (match.style === "tactical") {
      const battleId = randomUUID();
      const deadline = new Date(now.getTime() + TACTICAL_TURN_MS);
      await tx.battle.create({
        data: {
          id: battleId,
          guildId: match.guildId,
          userId: match.leftUserId,
          kind: "pvp-tactical",
          status: "active",
          opponentSlug: `pvp:${match.rightUserId}`,
          deadline,
          state: json(freshBattle(left, right)),
          winner: "",
          idempotencyKey: `pvp-battle:${match.id}`,
          createdAt: now,
        },
      });
      await tx.pvpMatch.update({ where: { id: match.id }, data: { status: "active", battleId, turnUserId: match.leftUserId, turnDeadline: deadline } });
      await enqueueJob(tx, { guildId: match.guildId, jobType: "pvp.turn", payload: { matchId: match.id }, idempotencyKey: `pvp-turn:${match.id}:${deadline.toISOString()}`, runAt: deadline });
      return { tactical: true as const };
    }
    const resolved = resolveQuick(freshBattle(left, right), packetsOrGenerated(packets), ["strike", "strike"]);
    const battleId = randomUUID();
    await tx.battle.create({
      data: {
        id: battleId,
        guildId: match.guildId,
        userId: match.leftUserId,
        kind: "pvp-quick",
        status: "resolved",
        opponentSlug: `pvp:${match.rightUserId}`,
        state: json(resolved.state),
        winner: resolved.state.winner,
        idempotencyKey: `pvp-battle:${match.id}`,
        createdAt: now,
      },
    });
    await tx.pvpMatch.update({ where: { id: match.id }, data: { status: "active", battleId } });
    return { tactical: false as const, judged: judged(resolved.state, match.leftUserId, match.rightUserId) };
  });
  if (!claimed) {
    const current = await db.pvpMatch.findUnique({ where: { id: matchId } });
    return current ? present(current) : { result: "missing" as const };
  }
  if ("missing" in claimed) {
    return finishMatch(db, matchId, { outcome: "cancel", winnerUserId: "", now });
  }
  if (existing.rankedEligible) {
    await noteRankedDebut(db, { guildId: existing.guildId, userId: existing.leftUserId, now });
    await noteRankedDebut(db, { guildId: existing.guildId, userId: existing.rightUserId, now });
  }
  if (claimed.tactical) {
    const current = await db.pvpMatch.findUnique({ where: { id: matchId } });
    return current ? present(current) : { result: "missing" as const };
  }
  return finishMatch(db, matchId, { outcome: claimed.judged.outcome, winnerUserId: claimed.judged.winnerUserId, now });
}

async function createPairedMatch(tx: Tx, guildId: string, leftUserId: string, rightUserId: string, requestedMode: "casual" | "ranked", stake: number, seasonId: string, now: Date, acceptChallenger: string | null) {
  const key = pairKey(leftUserId, rightUserId);
  const dayKey = cycleId(now, "daily");
  const prior = requestedMode === "ranked"
    ? await tx.pvpMatch.count({ where: { guildId, pairKey: key, dayKey, rankedEligible: true, status: { in: ["settled", "forfeited"] } } })
    : 0;
  const demoted = requestedMode === "ranked" && pairDecision(prior) === "casual";
  const mode = demoted ? "casual" : requestedMode;
  const matchId = randomUUID();
  await tx.pvpMatch.create({
    data: {
      id: matchId,
      guildId,
      seasonId,
      mode,
      requestedMode,
      demoted,
      stake,
      style: "quick",
      status: acceptChallenger !== null || demoted ? "proposed" : "starting",
      leftUserId,
      rightUserId,
      pairKey: key,
      acceptedLeft: acceptChallenger === null ? !demoted : acceptChallenger === leftUserId,
      acceptedRight: acceptChallenger === null ? !demoted : acceptChallenger === rightUserId,
      rankedEligible: mode === "ranked",
      dayKey,
      rules: demoted ? `${PVP_RULES} This pair already has two ranked matches today. Accepting starts a casual match. Rating and ranked rewards do not change.` : PVP_RULES,
      idempotencyKey: `pvp-match:${matchId}`,
    },
  });
  return matchId;
}

export async function joinQueue(db: Root, input: { guildId: string; userId: string; mode: string; stake: number; packets?: readonly RollPacket[]; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if (!isPvpMode(input.mode) || stakeDecision(input.stake) !== "allowed") {
    return { result: "invalid" as const };
  }
  const open = await liveMatch(db, input.guildId, input.userId);
  if (open) {
    return present(open);
  }
  const { state } = await ensureSeason(db, input.guildId, input.now);
  const joined = await db.$transaction(async (tx) => {
    const gate = await blocked(tx, input.guildId, input.userId);
    if (gate !== "ready") {
      return { result: gate };
    }
    const rating = await ensureRating(tx, input.guildId, input.userId, state.seasonId);
    await setLock(tx, input.guildId, input.userId, "queue");
    const entry = await tx.pvpQueueEntry.create({
      data: { id: randomUUID(), guildId: input.guildId, userId: input.userId, mode: input.mode, stake: input.stake, rating: rating.rating, status: "waiting", joinedAt: input.now },
    });
    return { result: "waiting" as const, entryId: entry.id };
  });
  if (joined.result !== "waiting") {
    return joined;
  }
  const matched = await matchQueues(db, input.guildId, input.now, input.packets);
  const mine = matched.find((match) => match.leftUserId === input.userId || match.rightUserId === input.userId);
  return mine ? present(mine) : { result: "waiting" as const, entryId: joined.entryId };
}

export async function leaveQueue(db: Root, input: { guildId: string; userId: string; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  await db.$transaction(async (tx) => {
    await tx.pvpQueueEntry.updateMany({ where: { guildId: input.guildId, userId: input.userId, status: "waiting" }, data: { status: "left" } });
    await setLock(tx, input.guildId, input.userId, "");
  });
  return { result: "left" as const };
}

export async function matchQueues(db: Root, guildId: string, now: Date, packets?: readonly RollPacket[]) {
  const { state } = await ensureSeason(db, guildId, now);
  const created = await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "pvp_queue_entry" WHERE "guildId" = ${guildId} AND "status" = 'waiting' ORDER BY "joinedAt" FOR UPDATE`;
    const entries = await tx.pvpQueueEntry.findMany({ where: { id: { in: locked.map((row) => row.id) } }, orderBy: { joinedAt: "asc" } });
    const used = new Set<string>();
    const ids: string[] = [];
    for (const entry of entries) {
      if (used.has(entry.id) || !isPvpMode(entry.mode)) {
        continue;
      }
      const waitMinutes = (now.getTime() - entry.joinedAt.getTime()) / 60_000;
      const tolerance = queueTolerance(waitMinutes);
      const partner = entries.find((other) => other.id !== entry.id && !used.has(other.id) && other.mode === entry.mode && other.stake === entry.stake && Math.abs(other.rating - entry.rating) <= tolerance);
      if (!partner || !isPvpMode(partner.mode)) {
        continue;
      }
      const [leftUserId, rightUserId] = [entry.userId, partner.userId].sort() as [string, string];
      const matchId = await createPairedMatch(tx, guildId, leftUserId, rightUserId, entry.mode, entry.stake, state.seasonId, now, null);
      used.add(entry.id);
      used.add(partner.id);
      await tx.pvpQueueEntry.updateMany({ where: { id: { in: [entry.id, partner.id] } }, data: { status: "matched" } });
      ids.push(matchId);
    }
    return ids;
  });
  const matches = [];
  for (const matchId of created) {
    const row = await db.pvpMatch.findUnique({ where: { id: matchId } });
    if (!row) {
      continue;
    }
    if (row.status === "starting") {
      const started = await beginFight(db, row.id, packets, now);
      if ("matchId" in started) {
        const saved = await db.pvpMatch.findUnique({ where: { id: row.id } });
        if (saved) {
          matches.push(saved);
        }
      }
      continue;
    }
    matches.push(row);
  }
  return matches;
}

export async function offerChallenge(db: Root, input: { guildId: string; userId: string; opponentUserId: string; mode: string; stake: number; style?: string; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if (!isPvpMode(input.mode) || stakeDecision(input.stake) !== "allowed" || input.userId === input.opponentUserId) {
    return { result: "invalid" as const };
  }
  const mode = input.mode;
  const open = await liveMatch(db, input.guildId, input.userId);
  if (open) {
    return present(open);
  }
  const { state } = await ensureSeason(db, input.guildId, input.now);
  const [leftUserId, rightUserId] = [input.userId, input.opponentUserId].sort() as [string, string];
  const created = await db.$transaction(async (tx) => {
    const gate = await blocked(tx, input.guildId, input.userId);
    const other = await blocked(tx, input.guildId, input.opponentUserId);
    if (gate !== "ready" || other !== "ready") {
      return { result: gate === "missing" || other === "missing" ? "missing" as const : "locked" as const };
    }
    const matchId = await createPairedMatch(tx, input.guildId, leftUserId, rightUserId, mode, input.stake, state.seasonId, input.now, input.userId);
    if (input.style === "tactical") {
      await tx.pvpMatch.update({ where: { id: matchId }, data: { style: "tactical" } });
    }
    await setLock(tx, input.guildId, input.userId, "queue");
    await setLock(tx, input.guildId, input.opponentUserId, "queue");
    return { result: "ready" as const, matchId };
  });
  if (created.result !== "ready") {
    return created;
  }
  const match = await db.pvpMatch.findUnique({ where: { id: created.matchId } });
  return match ? present(match) : { result: "missing" as const };
}

export async function acceptChallenge(db: Root, input: { guildId: string; userId: string; matchId: string; packets?: readonly RollPacket[]; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  const updated = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "pvp_match" WHERE "id" = ${input.matchId} FOR UPDATE`;
    const match = rows[0] ? await tx.pvpMatch.findUnique({ where: { id: rows[0].id } }) : null;
    if (!match || match.guildId !== input.guildId) {
      return { result: "missing" as const };
    }
    if (match.status !== "proposed") {
      return { result: "closed" as const, match };
    }
    if (match.leftUserId !== input.userId && match.rightUserId !== input.userId) {
      return { result: "missing" as const };
    }
    const acceptedLeft = match.acceptedLeft || match.leftUserId === input.userId;
    const acceptedRight = match.acceptedRight || match.rightUserId === input.userId;
    const saved = await tx.pvpMatch.update({ where: { id: match.id }, data: { acceptedLeft, acceptedRight } });
    return { result: "ready" as const, match: saved };
  });
  if (updated.result === "missing") {
    return { result: "missing" as const };
  }
  if (updated.result === "closed") {
    return { ...present(updated.match), result: "closed" as const };
  }
  if (updated.match.acceptedLeft && updated.match.acceptedRight) {
    return beginFight(db, updated.match.id, input.packets, input.now);
  }
  return present(updated.match);
}

export async function cancelChallenge(db: Root, input: { guildId: string; userId: string; matchId: string; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  const closed = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "pvp_match" WHERE "id" = ${input.matchId} FOR UPDATE`;
    const match = rows[0] ? await tx.pvpMatch.findUnique({ where: { id: rows[0].id } }) : null;
    if (!match || match.guildId !== input.guildId || (match.leftUserId !== input.userId && match.rightUserId !== input.userId)) {
      return { result: "missing" as const };
    }
    if (match.status !== "proposed" && match.status !== "starting") {
      return { result: "closed" as const };
    }
    await tx.pvpMatch.update({ where: { id: match.id }, data: { status: "cancelled", outcome: "cancel", settledAt: input.now, ratingPosted: true, wagerPosted: true, rewardsPosted: true } });
    await setLock(tx, match.guildId, match.leftUserId, "");
    await setLock(tx, match.guildId, match.rightUserId, "");
    return { result: "cancelled" as const };
  });
  return closed;
}

export async function noteDisconnect(db: Root, input: { guildId: string; userId: string; matchId: string; now: Date }) {
  const match = await db.pvpMatch.findUnique({ where: { id: input.matchId } });
  if (!match || match.guildId !== input.guildId || match.status !== "active") {
    return { result: "missing" as const };
  }
  if (match.leftUserId !== input.userId && match.rightUserId !== input.userId) {
    return { result: "missing" as const };
  }
  const data = match.leftUserId === input.userId ? { leftDisconnectedAt: input.now } : { rightDisconnectedAt: input.now };
  await db.pvpMatch.update({ where: { id: match.id }, data });
  const due = new Date(input.now.getTime() + DISCONNECT_GRACE_MINUTES * 60 * 1000);
  await enqueueJob(db, { guildId: input.guildId, jobType: "pvp.disconnect", payload: { matchId: match.id }, idempotencyKey: `pvp-disconnect:${match.id}:${input.userId}:${due.toISOString()}`, runAt: due });
  return { result: "grace" as const, until: due.toISOString() };
}

export async function sweepPvp(db: Root, now: Date) {
  const due = await db.pvpMatch.findMany({
    where: {
      status: "active",
      OR: [{ turnDeadline: { lte: now } }, { leftDisconnectedAt: { not: null } }, { rightDisconnectedAt: { not: null } }],
    },
  });
  let advanced = 0;
  for (const row of due) {
    const acted = await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "pvp_match" WHERE "id" = ${row.id} FOR UPDATE`;
      const match = locked[0] ? await tx.pvpMatch.findUnique({ where: { id: locked[0].id } }) : null;
      if (!match || match.status !== "active") {
        return null;
      }
      const leftDue = disconnectDue(match.leftDisconnectedAt, now);
      const rightDue = disconnectDue(match.rightDisconnectedAt, now);
      if (leftDue && rightDue) {
        return { outcome: "cancel" as const, winnerUserId: "" };
      }
      if (leftDue) {
        return { outcome: "forfeit" as const, winnerUserId: match.rightUserId };
      }
      if (rightDue) {
        return { outcome: "forfeit" as const, winnerUserId: match.leftUserId };
      }
      if (!match.turnDeadline || match.turnDeadline.getTime() > now.getTime()) {
        return null;
      }
      const leftTurn = match.turnUserId === match.leftUserId;
      const misses = (leftTurn ? match.leftMisses : match.rightMisses) + 1;
      if (forfeitAfterMisses(misses)) {
        return { outcome: "forfeit" as const, winnerUserId: leftTurn ? match.rightUserId : match.leftUserId };
      }
      const battle = match.battleId ? await tx.battle.findUnique({ where: { id: match.battleId } }) : null;
      if (battle) {
        const outcome = resolveAction(asState(battle.state), "defend", null);
        await tx.battle.update({ where: { id: battle.id }, data: { state: json(outcome.state), status: outcome.state.status, winner: outcome.state.winner } });
        if (outcome.state.status === "resolved") {
          const result = judged(outcome.state, match.leftUserId, match.rightUserId);
          return { outcome: result.outcome, winnerUserId: result.winnerUserId };
        }
      }
      const deadline = new Date(now.getTime() + TACTICAL_TURN_MS);
      const nextUser = leftTurn ? match.rightUserId : match.leftUserId;
      await tx.pvpMatch.update({
        where: { id: match.id },
        data: leftTurn ? { leftMisses: misses, turnUserId: nextUser, turnDeadline: deadline } : { rightMisses: misses, turnUserId: nextUser, turnDeadline: deadline },
      });
      await enqueueJob(tx, { guildId: match.guildId, jobType: "pvp.turn", payload: { matchId: match.id }, idempotencyKey: `pvp-turn:${match.id}:${deadline.toISOString()}`, runAt: deadline });
      return { outcome: "waiting" as const, winnerUserId: "" };
    });
    if (acted && acted.outcome !== "waiting") {
      await finishMatch(db, row.id, { outcome: acted.outcome, winnerUserId: acted.winnerUserId, now });
      advanced += 1;
    } else if (acted?.outcome === "waiting") {
      advanced += 1;
    }
  }
  return { advanced };
}

export async function readPvpMatch(db: Writer, input: { guildId: string; matchId: string }) {
  const match = await db.pvpMatch.findUnique({ where: { id: input.matchId } });
  if (!match || match.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  return present(match);
}

export async function readPvpLeaderboard(db: Writer, input: { guildId: string; viewerId: string; now: Date }) {
  const { state, settings } = await ensureSeason(db, input.guildId, input.now);
  const rows = await db.pvpRating.findMany({ where: { guildId: input.guildId, seasonId: state.seasonId } });
  return { seasonId: state.seasonId, ...rankStandings(rows.map((row) => ({ userId: row.userId, score: row.rating })), settings.systemUserIds, 1, 10, input.viewerId) };
}
