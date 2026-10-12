import { randomInt, randomUUID } from "node:crypto";

import {
  ABANDON_MINUTES,
  CREW_ENTRY_RULES,
  CREW_MARKS,
  CREW_XP,
  SOLO_MARKS,
  SOLO_XP,
  applyMedkit,
  checkNext,
  chooseNext,
  combatNext,
  crewSizeDecision,
  crewStrike,
  missionBySlug,
  openPosition,
  participation,
  recoveryDeadline,
  scaleForParty,
  settleNode,
  turnMinutes,
  type CrewMode,
  type EnemySeed,
  DIFFICULTY_TIERS,
  blankFighter,
  cycleId,
  enemyForDifficulty,
  expeditionHealth,
  isDifficulty,
  lootEligibility,
  pickLoot,
  regionAccess,
  statEffect,
  resolveEncounter,
  xpGrant,
  type RollPacket,
} from "@collective/domain";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

import { grantCharacterXp } from "./characters.js";
import { noteContractSignal } from "./contracts.js";
import { issueMarks } from "./ledger.js";
import { ensureGuild, enqueueJob, moduleIsAvailable, type Writer } from "./platform.js";
import { closeRoom, createRoom } from "./seasons.js";
import { readWorldStaff } from "./world.js";

type Tx = Prisma.TransactionClient;
type Root = PrismaClient;

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function isUnique(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function openRpg(db: Writer, guildId: string) {
  await ensureGuild(db, { guildId });
  return moduleIsAvailable(db, guildId, "rpg");
}

async function recoveryOpen(tx: Tx, guildId: string, userId: string, now: Date) {
  const row = await tx.recovery.findUnique({ where: { guildId_userId: { guildId, userId } } });
  return Boolean(row && row.until.getTime() > now.getTime());
}

async function spentXp(tx: Tx, guildId: string, userId: string, dayKey: string) {
  const expeditions = await tx.expedition.findMany({ where: { guildId, userId, dayKey, status: "resolved" }, select: { grantedXp: true } });
  const runs = await tx.missionRun.findMany({ where: { guildId, userId, dayKey, status: "won" }, select: { grantedXp: true } });
  const crew = await tx.crewMissionMember.findMany({ where: { guildId, userId }, select: { grantedXp: true, missionId: true } });
  let crewXp = 0;
  for (const member of crew) {
    if (member.grantedXp <= 0) {
      continue;
    }
    const mission = await tx.crewMission.findUnique({ where: { id: member.missionId }, select: { completedAt: true, status: true } });
    if (mission?.status === "won" && mission.completedAt && cycleId(mission.completedAt, "daily") === dayKey) {
      crewXp += member.grantedXp;
    }
  }
  return expeditions.reduce((sum, row) => sum + row.grantedXp, 0) + runs.reduce((sum, row) => sum + row.grantedXp, 0) + crewXp;
}

function presentRun(row: { id: string; slug: string; status: string; nodeId: string; waiting: string; unbanked: unknown; log: unknown; notice: string; grantedXp: number; grantedMarks: number; rewardsPosted: boolean }) {
  return {
    result: "ready" as const,
    missionId: row.id,
    slug: row.slug,
    status: row.status,
    nodeId: row.nodeId,
    waiting: row.waiting,
    unbanked: strings(row.unbanked),
    log: strings(row.log),
    notice: row.notice,
    grantedXp: row.grantedXp,
    grantedMarks: row.grantedMarks,
    rewardsPosted: row.rewardsPosted,
  };
}

export async function previewMission(db: Writer, input: { guildId: string; userId: string; slug: string; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  const mission = missionBySlug(input.slug);
  if (!mission) {
    return { result: "missing" as const };
  }
  const world = await readWorldStaff(db, input.guildId);
  const region = world.regions.find((item) => item.slug === mission.regionSlug);
  const character = await db.playerCharacter.findUnique({ where: { guildId_userId: { guildId: input.guildId, userId: input.userId } } });
  if (!region || !character) {
    return { result: "missing" as const };
  }
  const recovery = await db.recovery.findUnique({ where: { guildId_userId: { guildId: input.guildId, userId: input.userId } } });
  return {
    result: "ready" as const,
    slug: mission.slug,
    name: mission.name,
    summary: mission.summary,
    access: regionAccess(character.level, region.level),
    recovery: recovery && recovery.until.getTime() > input.now.getTime() ? "recovery" as const : "ready" as const,
    options: mission.nodes.find((node) => node.kind === "choice")?.kind === "choice" ? mission.nodes.filter((node) => node.kind === "choice" && node.id === "gate").flatMap((node) => node.kind === "choice" ? node.options.map((option) => option.label) : []) : [],
  };
}

export async function startMission(db: Root, input: { guildId: string; userId: string; slug: string; itemIds?: string[]; notify?: boolean; idempotencyKey: string; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  const mission = missionBySlug(input.slug);
  if (!mission) {
    return { result: "missing" as const };
  }
  const world = await readWorldStaff(db, input.guildId);
  const region = world.regions.find((item) => item.slug === mission.regionSlug);
  if (!region) {
    return { result: "missing" as const };
  }
  const existing = await db.missionRun.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    return presentRun(existing);
  }
  const opened = openPosition();
  try {
    const outcome = await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "player_character" WHERE "guildId" = ${input.guildId} AND "userId" = ${input.userId} FOR UPDATE`;
      const character = locked[0] ? await tx.playerCharacter.findUnique({ where: { id: locked[0].id } }) : null;
      if (!character) {
        return "missing" as const;
      }
      if (await recoveryOpen(tx, input.guildId, input.userId, input.now)) {
        return "recovery" as const;
      }
      if (regionAccess(character.level, region.level) === "level") {
        return "level" as const;
      }
      const expedition = await tx.expedition.findFirst({ where: { guildId: input.guildId, userId: input.userId, status: "active" }, select: { id: true } });
      const activeRun = await tx.missionRun.findFirst({ where: { guildId: input.guildId, userId: input.userId, status: "active" }, select: { id: true } });
      if (expedition || activeRun || character.gameplayLock === "combat") {
        return "locked" as const;
      }
      const itemIds = [...new Set(input.itemIds ?? [])].slice(0, 4);
      for (const itemId of itemIds) {
        const item = await tx.gearInstance.findUnique({ where: { id: itemId } });
        if (!item || item.guildId !== input.guildId || item.userId !== input.userId || item.destroyed) {
          return "missing" as const;
        }
        if (item.lock) {
          return "locked" as const;
        }
        if (item.classSlug && item.classSlug !== character.classSlug) {
          return "class" as const;
        }
        if (character.level < item.level) {
          return "level" as const;
        }
      }
      await tx.missionRun.create({
        data: {
          id: randomUUID(),
          guildId: input.guildId,
          userId: input.userId,
          slug: mission.slug,
          status: opened.status,
          nodeId: opened.nodeId,
          waiting: opened.waiting,
          unbanked: json(opened.unbanked),
          log: json([mission.summary]),
          reservedItemIds: json(itemIds),
          notice: input.notify === true ? "setup_required" : "skipped",
          idempotencyKey: input.idempotencyKey,
          createdAt: input.now,
        },
      });
      if (itemIds.length > 0) {
        await tx.gearInstance.updateMany({ where: { id: { in: itemIds }, lock: "" }, data: { lock: "mission" } });
      }
      return "ready" as const;
    });
    if (outcome !== "ready") {
      return { result: outcome };
    }
  } catch (error) {
    if (!isUnique(error)) {
      throw error;
    }
  }
  const created = await db.missionRun.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  return created ? presentRun(created) : { result: "missing" as const };
}

async function loadRun(tx: Tx, guildId: string, userId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "mission_run" WHERE "guildId" = ${guildId} AND "userId" = ${userId} AND "status" = 'active' ORDER BY "createdAt" DESC LIMIT 1 FOR UPDATE`;
  return rows[0] ? tx.missionRun.findUnique({ where: { id: rows[0].id } }) : null;
}

async function savePosition(tx: Tx, runId: string, position: { nodeId: string; status: string; waiting: string; unbanked: string[]; log: string[] }, now: Date) {
  await tx.missionRun.update({
    where: { id: runId },
    data: {
      nodeId: position.nodeId,
      status: position.status,
      waiting: position.waiting,
      unbanked: json(position.unbanked),
      log: json(position.log),
      ...(position.status === "active" ? {} : { completedAt: now }),
    },
  });
}

export async function chooseMission(db: Root, input: { guildId: string; userId: string; choiceId: string; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  const moved = await db.$transaction(async (tx) => {
    const run = await loadRun(tx, input.guildId, input.userId);
    if (!run) {
      return { result: "missing" as const };
    }
    if (run.waiting !== "choice") {
      return presentRun(run);
    }
    const mission = missionBySlug(run.slug);
    const next = mission ? chooseNext(mission, run.nodeId, input.choiceId) : null;
    if (!mission || !next) {
      return { result: "invalid" as const };
    }
    const position = settleNode(mission, next, strings(run.unbanked), strings(run.log));
    await savePosition(tx, run.id, position, input.now);
    return { result: "ready" as const, missionId: run.id, status: position.status };
  });
  if (moved.result === "ready" && moved.status !== "active") {
    return closeSolo(db, moved.missionId, input.now);
  }
  if (moved.result !== "ready") {
    return moved;
  }
  const current = await db.missionRun.findUnique({ where: { id: moved.missionId } });
  return current ? presentRun(current) : { result: "missing" as const };
}

export async function resolveMissionCheck(db: Root, input: { guildId: string; userId: string; roll: number; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  const moved = await db.$transaction(async (tx) => {
    const run = await loadRun(tx, input.guildId, input.userId);
    if (!run) {
      return { result: "missing" as const };
    }
    if (run.waiting !== "check") {
      return presentRun(run);
    }
    const mission = missionBySlug(run.slug);
    const character = await tx.playerCharacter.findUnique({ where: { guildId_userId: { guildId: input.guildId, userId: input.userId } } });
    const definition = character ? await tx.classDefinition.findUnique({ where: { id: character.classId } }) : null;
    const bonus = statEffect("agility", definition?.baseAgility ?? 0, character?.agility ?? 0).bonus;
    const judged = mission ? checkNext(mission, run.nodeId, input.roll, bonus) : null;
    if (!mission || !judged) {
      return { result: "invalid" as const };
    }
    const position = settleNode(mission, judged.next, strings(run.unbanked), [...strings(run.log), `Check ${judged.result} on ${input.roll}.`]);
    await savePosition(tx, run.id, position, input.now);
    return { result: "ready" as const, missionId: run.id, status: position.status };
  });
  if (moved.result === "ready" && moved.status !== "active") {
    return closeSolo(db, moved.missionId, input.now);
  }
  if (moved.result !== "ready") {
    return moved;
  }
  const current = await db.missionRun.findUnique({ where: { id: moved.missionId } });
  return current ? presentRun(current) : { result: "missing" as const };
}

export async function resolveMissionCombat(db: Root, input: { guildId: string; userId: string; packets?: RollPacket[]; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  const moved = await db.$transaction(async (tx) => {
    const run = await loadRun(tx, input.guildId, input.userId);
    if (!run) {
      return { result: "missing" as const };
    }
    if (run.waiting !== "combat") {
      return presentRun(run);
    }
    const mission = missionBySlug(run.slug);
    const node = mission?.nodes.find((item) => item.id === run.nodeId);
    if (!mission || !node || node.kind !== "combat") {
      return { result: "invalid" as const };
    }
    const enemyRow = await tx.worldEnemy.findUnique({ where: { guildId_slug: { guildId: input.guildId, slug: node.enemySlug } } });
    const character = await tx.playerCharacter.findUnique({ where: { guildId_userId: { guildId: input.guildId, userId: input.userId } } });
    if (!enemyRow || !character) {
      return { result: "missing" as const };
    }
    const definition = await tx.classDefinition.findUnique({ where: { id: character.classId } });
    const enemy: EnemySeed = {
      slug: enemyRow.slug,
      name: enemyRow.name,
      regionSlug: enemyRow.regionSlug,
      level: enemyRow.level,
      boss: enemyRow.boss,
      ability: enemyRow.ability === "bleed" || enemyRow.ability === "defend" || enemyRow.ability === "stun" || enemyRow.ability === "execute" ? enemyRow.ability : "strike",
      accuracy: enemyRow.accuracy,
      defence: enemyRow.defence,
      health: enemyRow.health,
      diceCount: enemyRow.diceCount,
      diceSides: enemyRow.diceSides,
      rewardSource: enemyRow.rewardSource === "boss" ? "boss" : "expedition",
      summary: enemyRow.summary,
    };
    const agility = statEffect("agility", definition?.baseAgility ?? 0, character.agility);
    const endurance = statEffect("endurance", definition?.baseEndurance ?? 0, character.endurance);
    const strength = statEffect("strength", definition?.baseStrength ?? 0, character.strength);
    const maxHealth = expeditionHealth((definition?.baseEndurance ?? 0) + character.endurance, 0);
    const fighter = blankFighter("member", character.classSlug);
    fighter.health = maxHealth;
    fighter.maxHealth = maxHealth;
    fighter.accuracyStat = agility.bonus;
    fighter.defenceStat = endurance.bonus;
    fighter.damageStat = strength.bonus;
    fighter.reactionReady = false;
    const packets = input.packets ?? Array.from({ length: 8 }, () => ({ attack: randomInt(1, 21), damage: [randomInt(1, 7)] }));
    const encounter = resolveEncounter(fighter, enemy, packets);
    const next = combatNext(mission, run.nodeId, encounter.winner);
    if (!next) {
      return { result: "invalid" as const };
    }
    const position = settleNode(mission, next, strings(run.unbanked), [...strings(run.log), ...encounter.log]);
    await savePosition(tx, run.id, position, input.now);
    return { result: "ready" as const, missionId: run.id, status: position.status };
  });
  if (moved.result === "ready" && moved.status !== "active") {
    return closeSolo(db, moved.missionId, input.now);
  }
  if (moved.result !== "ready") {
    return moved;
  }
  const current = await db.missionRun.findUnique({ where: { id: moved.missionId } });
  return current ? presentRun(current) : { result: "missing" as const };
}

async function closeSolo(db: Root, missionId: string, now: Date) {
  const prepared = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "mission_run" WHERE "id" = ${missionId} FOR UPDATE`;
    const run = rows[0] ? await tx.missionRun.findUnique({ where: { id: rows[0].id } }) : null;
    if (!run) {
      return null;
    }
    if (run.rewardsPosted || run.status === "active") {
      return { posted: true as const };
    }
    const reserved = strings(run.reservedItemIds);
    if (reserved.length > 0) {
      await tx.gearInstance.updateMany({ where: { id: { in: reserved }, lock: "mission" }, data: { lock: "" } });
    }
    const dayKey = cycleId(now, "daily");
    const won = run.status === "won";
    const grantedXp = won ? xpGrant(SOLO_XP, await spentXp(tx, run.guildId, run.userId, dayKey)) : 0;
    await tx.missionRun.update({ where: { id: run.id }, data: { grantedXp, dayKey, rewardsPosted: false } });
    if (run.status === "failed") {
      await tx.recovery.upsert({
        where: { guildId_userId: { guildId: run.guildId, userId: run.userId } },
        create: { id: randomUUID(), guildId: run.guildId, userId: run.userId, until: recoveryDeadline(now), medkitUsed: false, source: "mission" },
        update: { until: recoveryDeadline(now), medkitUsed: false, source: "mission" },
      });
    }
    const character = await tx.playerCharacter.findUnique({ where: { guildId_userId: { guildId: run.guildId, userId: run.userId } } });
    const banked: string[] = [];
    if (won && character) {
      for (const slug of strings(run.unbanked)) {
        const template = await tx.gearTemplate.findUnique({ where: { guildId_slug: { guildId: run.guildId, slug } } });
        const eligible = template ? lootEligibility({ status: template.status, itemClass: template.classSlug, classSlug: character.classSlug, level: character.level, itemLevel: template.level }) : "unavailable";
        if (template && eligible === "available") {
          const key = `mission-loot:${run.id}:${slug}`;
          const prior = await tx.gearInstance.findUnique({ where: { idempotencyKey: key } });
          if (!prior) {
            await tx.gearInstance.create({
              data: {
                id: randomUUID(),
                guildId: run.guildId,
                userId: run.userId,
                templateId: template.id,
                name: template.name,
                slot: template.slot,
                classSlug: template.classSlug,
                level: template.level,
                binding: template.binding,
                diceCount: template.diceCount,
                diceSides: template.diceSides,
                critMultiplier: template.critMultiplier,
                abilitySlug: template.abilitySlug,
                affixes: json([]),
                provenance: "mission",
                equipped: false,
                lock: "",
                destroyed: false,
                templateVersion: template.version,
                idempotencyKey: key,
              },
            });
          }
          banked.push(slug);
        }
      }
    }
    return { posted: false as const, guildId: run.guildId, userId: run.userId, grantedXp, marks: won ? SOLO_MARKS : 0, won, banked };
  });
  if (!prepared || prepared.posted) {
    const current = await db.missionRun.findUnique({ where: { id: missionId } });
    return current ? presentRun(current) : { result: "missing" as const };
  }
  if (prepared.grantedXp > 0) {
    await grantCharacterXp(db, { guildId: prepared.guildId, userId: prepared.userId, amount: prepared.grantedXp, source: "mission", idempotencyKey: `mission-xp:${missionId}`, now });
  }
  let marksResult = "skipped";
  let grantedMarks = 0;
  if (prepared.marks > 0) {
    const paid = await issueMarks(db, {
      guildId: prepared.guildId,
      userId: prepared.userId,
      amountMarks: prepared.marks,
      source: "mission",
      sourceId: missionId,
      pace: "routine",
      idempotencyKey: `mission-marks:${missionId}`,
      reason: "Mission completion",
      actorUserId: "system",
      now,
    });
    marksResult = paid.result;
    grantedMarks = paid.result === "posted" || paid.result === "already_recorded" ? prepared.marks : 0;
  }
  await noteContractSignal(db, { guildId: prepared.guildId, userId: prepared.userId, kind: "rpg_exploration", amount: 1, now });
  if (prepared.won) {
    await noteContractSignal(db, { guildId: prepared.guildId, userId: prepared.userId, kind: "rpg_pve", amount: 1, now });
  }
  await db.missionRun.update({ where: { id: missionId }, data: { rewardsPosted: true, marksResult, grantedMarks } });
  const current = await db.missionRun.findUnique({ where: { id: missionId } });
  return current ? presentRun(current) : { result: "missing" as const };
}

export async function openCrewMission(db: Root, input: { guildId: string; crewId: string; userId: string; regionSlug: string; difficulty: string; mode: CrewMode; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if (!isDifficulty(input.difficulty) || (input.mode !== "live" && input.mode !== "async")) {
    return { result: "invalid" as const };
  }
  const world = await readWorldStaff(db, input.guildId);
  const region = world.regions.find((item) => item.slug === input.regionSlug);
  const crew = await db.crew.findUnique({ where: { id: input.crewId } });
  if (!crew || crew.guildId !== input.guildId || crew.status !== "active" || !region) {
    return { result: "missing" as const };
  }
  const members = await db.crewMember.findMany({ where: { crewId: crew.id, status: "active" } });
  const size = crewSizeDecision(members.length);
  if (size !== "allowed") {
    return { result: size };
  }
  const existing = await db.crewMission.findFirst({ where: { guildId: input.guildId, crewId: crew.id, status: { in: ["forming", "active"] } } });
  if (existing) {
    return { result: "ready" as const, missionId: existing.id, status: existing.status, rules: existing.rules, roomId: existing.roomId };
  }
  const missionId = randomUUID();
  await db.crewMission.create({
    data: {
      id: missionId,
      guildId: input.guildId,
      crewId: crew.id,
      regionSlug: region.slug,
      difficulty: input.difficulty,
      mode: input.mode,
      status: "forming",
      abandonAt: new Date(input.now.getTime() + ABANDON_MINUTES * 60 * 1000),
      enemy: json({}),
      rules: CREW_ENTRY_RULES,
      notice: "setup_required",
      idempotencyKey: `crew-mission:${crew.id}:${missionId}`,
      createdAt: input.now,
    },
  });
  for (const member of members) {
    await db.crewMissionMember.create({
      data: { id: randomUUID(), guildId: input.guildId, missionId, userId: member.userId, health: 20, reservedItemIds: json([]) },
    });
  }
  await enqueueJob(db, { guildId: input.guildId, jobType: "mission.abandon", payload: { missionId }, idempotencyKey: `mission-abandon:${missionId}`, runAt: new Date(input.now.getTime() + ABANDON_MINUTES * 60 * 1000) });
  return { result: "ready" as const, missionId, status: "forming", rules: CREW_ENTRY_RULES, roomId: "" };
}

export async function readyCrewMission(db: Root, input: { guildId: string; missionId: string; userId: string; itemIds?: string[]; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  const outcome = await db.$transaction(async (tx) => {
    const mission = await tx.crewMission.findUnique({ where: { id: input.missionId } });
    if (!mission || mission.guildId !== input.guildId || mission.status !== "forming") {
      return { result: "missing" as const };
    }
    const seat = await tx.crewMissionMember.findUnique({ where: { missionId_userId: { missionId: mission.id, userId: input.userId } } });
    const character = await tx.playerCharacter.findUnique({ where: { guildId_userId: { guildId: input.guildId, userId: input.userId } } });
    const region = await tx.worldRegion.findUnique({ where: { guildId_slug: { guildId: input.guildId, slug: mission.regionSlug } } });
    if (!seat || !character || !region) {
      return { result: "missing" as const };
    }
    if (await recoveryOpen(tx, input.guildId, input.userId, input.now)) {
      return { result: "recovery" as const };
    }
    if (regionAccess(character.level, region.level) === "level") {
      return { result: "level" as const };
    }
    const itemIds = [...new Set(input.itemIds ?? [])].slice(0, 4);
    for (const itemId of itemIds) {
      const item = await tx.gearInstance.findUnique({ where: { id: itemId } });
      if (!item || item.userId !== input.userId || item.lock) {
        return { result: "locked" as const };
      }
    }
    await tx.crewMissionMember.update({ where: { id: seat.id }, data: { ready: true, reservedItemIds: json(itemIds) } });
    if (itemIds.length > 0) {
      await tx.gearInstance.updateMany({ where: { id: { in: itemIds }, lock: "" }, data: { lock: "mission" } });
    }
    const seats = await tx.crewMissionMember.findMany({ where: { missionId: mission.id } });
    if (seats.every((member) => member.ready || member.userId === input.userId)) {
      return { result: "start" as const, missionId: mission.id };
    }
    return { result: "ready" as const, missionId: mission.id, status: "forming" as const };
  });
  if (outcome.result === "start") {
    return beginCrewMission(db, outcome.missionId, input.now);
  }
  return outcome;
}

async function beginCrewMission(db: Root, missionId: string, now: Date) {
  const mission = await db.crewMission.findUnique({ where: { id: missionId } });
  if (!mission || mission.status !== "forming") {
    return mission ? { result: "ready" as const, missionId, status: mission.status, roomId: mission.roomId } : { result: "missing" as const };
  }
  const seats = await db.crewMissionMember.findMany({ where: { missionId }, orderBy: { userId: "asc" } });
  if (!seats.every((seat) => seat.ready)) {
    return { result: "ready" as const, missionId, status: "forming" as const, roomId: "" };
  }
  const world = await readWorldStaff(db, mission.guildId);
  const enemies = world.enemies.filter((enemy) => enemy.regionSlug === mission.regionSlug);
  const picked = enemyForDifficulty(enemies.map((enemy) => ({
    slug: enemy.slug,
    name: enemy.name,
    regionSlug: enemy.regionSlug,
    level: enemy.level,
    boss: enemy.boss,
    ability: enemy.ability === "bleed" || enemy.ability === "defend" || enemy.ability === "stun" || enemy.ability === "execute" ? enemy.ability : "strike",
    accuracy: 1,
    defence: 0,
    health: enemy.health,
    diceCount: 1,
    diceSides: 6,
    rewardSource: enemy.boss ? "boss" as const : "expedition" as const,
    summary: enemy.summary,
  })), mission.regionSlug, mission.difficulty === "standard" || mission.difficulty === "severe" ? mission.difficulty : "routine");
  if (!picked) {
    return { result: "missing" as const };
  }
  const full = await db.worldEnemy.findUnique({ where: { guildId_slug: { guildId: mission.guildId, slug: picked.slug } } });
  if (!full) {
    return { result: "missing" as const };
  }
  const tier = DIFFICULTY_TIERS[mission.difficulty === "standard" || mission.difficulty === "severe" ? mission.difficulty : "routine"];
  const enemy = scaleForParty({
    slug: full.slug,
    name: full.name,
    regionSlug: full.regionSlug,
    level: full.level,
    boss: full.boss,
    ability: full.ability === "bleed" || full.ability === "defend" || full.ability === "stun" || full.ability === "execute" ? full.ability : "strike",
    accuracy: full.accuracy,
    defence: full.defence,
    health: full.health,
    diceCount: full.diceCount,
    diceSides: full.diceSides,
    rewardSource: full.rewardSource === "boss" ? "boss" : "expedition",
    summary: full.summary,
  }, seats.length, tier.scale);
  const leader = seats[0];
  const room = leader ? await createRoom(db, { guildId: mission.guildId, userId: leader.userId, kind: "text", name: "Crew mission", privacy: "private", now }) : { result: "missing" as const };
  const roomId = room.result === "created" ? room.roomId : "";
  const deadline = new Date(now.getTime() + turnMinutes(mission.mode === "live" ? "live" : "async") * 60 * 1000);
  await db.crewMission.update({
    where: { id: mission.id },
    data: { status: "active", enemy: json(enemy), enemyHealth: enemy.health, turnUserId: leader?.userId ?? "", turnDeadline: deadline, roomId },
  });
  await enqueueJob(db, { guildId: mission.guildId, jobType: "mission.turn", payload: { missionId }, idempotencyKey: `mission-turn:${missionId}:${deadline.toISOString()}`, runAt: deadline });
  return { result: "ready" as const, missionId, status: "active" as const, roomId, enemy: enemy.name, rules: mission.rules };
}

export async function actCrewMission(db: Root, input: { guildId: string; missionId: string; userId: string; action: "strike" | "revive"; targetUserId?: string; packet?: RollPacket; enemyPacket?: RollPacket; lootRoll?: number; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  const outcome = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "crew_mission" WHERE "id" = ${input.missionId} FOR UPDATE`;
    const mission = rows[0] ? await tx.crewMission.findUnique({ where: { id: rows[0].id } }) : null;
    if (!mission || mission.guildId !== input.guildId || mission.status !== "active") {
      return { result: "missing" as const };
    }
    if (mission.turnUserId !== input.userId) {
      return { result: "waiting" as const };
    }
    const seats = await tx.crewMissionMember.findMany({ where: { missionId: mission.id }, orderBy: { userId: "asc" } });
    const actor = seats.find((seat) => seat.userId === input.userId);
    if (!actor || actor.downed) {
      return { result: "waiting" as const };
    }
    const enemy = mission.enemy as { defence?: number; accuracy?: number; name?: string };
    if (input.action === "revive") {
      const target = seats.find((seat) => seat.userId === input.targetUserId);
      if (!target || !target.downed) {
        return { result: "missing" as const };
      }
      if (target.revivesUsed >= 1) {
        return { result: "limit" as const };
      }
      await tx.crewMissionMember.update({ where: { id: target.id }, data: { downed: false, health: 10, revivesUsed: target.revivesUsed + 1 } });
      const next = nextSeat(seats.map((seat) => seat.userId === target.userId ? { ...seat, downed: false } : seat), actor.userId);
      if (!next) {
        return { result: "failed" as const, missionId: mission.id };
      }
      await moveTurn(tx, mission, next, input.now);
      return { result: "revived" as const, missionId: mission.id };
    }
    const packet = input.packet ?? { attack: randomInt(1, 21), damage: [randomInt(1, 7)] };
    const strike = crewStrike(mission.enemyHealth, enemy.defence ?? 0, packet, 0);
    let health = actor.health;
    let downed = false;
    if (strike.health > 0) {
      const reply = crewStrike(health, 0, input.enemyPacket ?? { attack: randomInt(1, 21), damage: [randomInt(1, 7)] }, enemy.accuracy ?? 0);
      health = reply.health;
      downed = health <= 0;
    }
    await tx.crewMissionMember.update({ where: { id: actor.id }, data: { health, downed, acted: true } });
    if (strike.health <= 0) {
      return { result: "won" as const, missionId: mission.id, lootRoll: input.lootRoll ?? 1 };
    }
    const refreshed = seats.map((seat) => seat.id === actor.id ? { ...seat, downed, health } : seat);
    const next = nextSeat(refreshed, actor.userId);
    if (!next) {
      return { result: "failed" as const, missionId: mission.id };
    }
    await tx.crewMission.update({ where: { id: mission.id }, data: { enemyHealth: strike.health } });
    await moveTurn(tx, mission, next, input.now);
    return { result: "ready" as const, missionId: mission.id };
  });
  if (outcome.result === "won") {
    return finishCrew(db, outcome.missionId, "won", outcome.lootRoll, input.now);
  }
  if (outcome.result === "failed") {
    return finishCrew(db, outcome.missionId, "failed", 1, input.now);
  }
  return outcome;
}

function nextSeat(seats: Array<{ userId: string; downed: boolean }>, current: string): string | null {
  const living = seats.filter((seat) => !seat.downed);
  if (living.length === 0) {
    return null;
  }
  const ordered = seats.map((seat) => seat.userId);
  const start = ordered.indexOf(current);
  for (let step = 1; step <= ordered.length; step += 1) {
    const userId = ordered[(start + step) % ordered.length];
    if (userId && living.some((seat) => seat.userId === userId)) {
      return userId;
    }
  }
  return null;
}

async function moveTurn(tx: Tx, mission: { id: string; guildId: string; mode: string }, userId: string, now: Date) {
  const deadline = new Date(now.getTime() + turnMinutes(mission.mode === "live" ? "live" : "async") * 60 * 1000);
  await tx.crewMission.update({ where: { id: mission.id }, data: { turnUserId: userId, turnDeadline: deadline } });
  await enqueueJob(tx, { guildId: mission.guildId, jobType: "mission.turn", payload: { missionId: mission.id }, idempotencyKey: `mission-turn:${mission.id}:${deadline.toISOString()}`, runAt: deadline });
}

export async function sweepCrewMissions(db: Root, now: Date) {
  const due = await db.crewMission.findMany({ where: { status: { in: ["forming", "active"] }, OR: [{ abandonAt: { lte: now } }, { status: "active", turnDeadline: { lte: now } }] } });
  let advanced = 0;
  for (const row of due) {
    if (row.abandonAt.getTime() <= now.getTime()) {
      const closed = await abandonCrew(db, row.id, now);
      if (closed) {
        advanced += 1;
      }
      continue;
    }
    const missed = await missTurn(db, row.id, now);
    if (missed) {
      advanced += 1;
    }
  }
  return { advanced };
}

async function missTurn(db: Root, missionId: string, now: Date) {
  const outcome = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "crew_mission" WHERE "id" = ${missionId} FOR UPDATE`;
    const mission = rows[0] ? await tx.crewMission.findUnique({ where: { id: rows[0].id } }) : null;
    if (!mission || mission.status !== "active" || !mission.turnDeadline || mission.turnDeadline.getTime() > now.getTime()) {
      return "posted" as const;
    }
    const seats = await tx.crewMissionMember.findMany({ where: { missionId }, orderBy: { userId: "asc" } });
    const actor = seats.find((seat) => seat.userId === mission.turnUserId) ?? seats[0];
    if (!actor) {
      return "failed" as const;
    }
    const misses = actor.misses + 1;
    await tx.crewMissionMember.update({ where: { id: actor.id }, data: { misses, eligible: participation(misses) === "eligible" } });
    const refreshed = seats.map((seat) => seat.id === actor.id ? { ...seat, misses, eligible: participation(misses) === "eligible" } : seat);
    if (refreshed.every((seat) => !seat.eligible)) {
      return "failed" as const;
    }
    const next = nextSeat(refreshed, actor.userId);
    if (!next) {
      return "failed" as const;
    }
    await moveTurn(tx, mission, next, now);
    return "ready" as const;
  });
  if (outcome === "failed") {
    await finishCrew(db, missionId, "failed", 1, now);
  }
  return outcome === "ready" || outcome === "failed";
}

async function abandonCrew(db: Root, missionId: string, now: Date) {
  const mission = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "crew_mission" WHERE "id" = ${missionId} FOR UPDATE`;
    const current = rows[0] ? await tx.crewMission.findUnique({ where: { id: rows[0].id } }) : null;
    if (!current || (current.status !== "forming" && current.status !== "active") || current.abandonAt.getTime() > now.getTime()) {
      return null;
    }
    await tx.crewMission.update({ where: { id: current.id }, data: { status: "abandoned", completedAt: now, granted: true } });
    const seats = await tx.crewMissionMember.findMany({ where: { missionId } });
    for (const seat of seats) {
      const reserved = strings(seat.reservedItemIds);
      if (reserved.length > 0) {
        await tx.gearInstance.updateMany({ where: { id: { in: reserved }, lock: "mission" }, data: { lock: "" } });
      }
    }
    return current;
  });
  if (!mission) {
    return false;
  }
  if (mission.roomId) {
    const room = await db.tempRoom.findUnique({ where: { id: mission.roomId } });
    if (room && room.status === "open") {
      await closeRoom(db, { guildId: mission.guildId, roomId: room.id, actorUserId: room.ownerUserId, actorRoleIds: [], now });
    }
  }
  return true;
}

async function finishCrew(db: Root, missionId: string, status: "won" | "failed", lootRoll: number, now: Date) {
  const prepared = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "crew_mission" WHERE "id" = ${missionId} FOR UPDATE`;
    const mission = rows[0] ? await tx.crewMission.findUnique({ where: { id: rows[0].id } }) : null;
    if (!mission) {
      return null;
    }
    if (mission.granted || mission.status === "won" || mission.status === "failed" || mission.status === "abandoned") {
      return { posted: true as const, missionId };
    }
    const seats = await tx.crewMissionMember.findMany({ where: { missionId } });
    const table = await tx.lootTable.findUnique({ where: { guildId_slug: { guildId: mission.guildId, slug: `${mission.regionSlug}-${mission.difficulty}` } } });
    const entries = Array.isArray(table?.entries) ? table.entries.flatMap((entry) => {
      if (!entry || typeof entry !== "object") {
        return [];
      }
      const row = entry as { templateSlug?: string; weight?: number; source?: string };
      if (typeof row.templateSlug !== "string" || typeof row.weight !== "number") {
        return [];
      }
      return [{ templateSlug: row.templateSlug, weight: row.weight, source: row.source === "boss" ? "boss" as const : "expedition" as const }];
    }) : [];
    const drop = pickLoot(entries, lootRoll);
    const payouts: Array<{ userId: string; xp: number; marks: number; slug: string; eligible: boolean }> = [];
    for (const seat of seats) {
      const reserved = strings(seat.reservedItemIds);
      if (reserved.length > 0) {
        await tx.gearInstance.updateMany({ where: { id: { in: reserved }, lock: "mission" }, data: { lock: "" } });
      }
      if (status === "failed") {
        await tx.recovery.upsert({
          where: { guildId_userId: { guildId: mission.guildId, userId: seat.userId } },
          create: { id: randomUUID(), guildId: mission.guildId, userId: seat.userId, until: recoveryDeadline(now), medkitUsed: false, source: "crew" },
          update: { until: recoveryDeadline(now), medkitUsed: false, source: "crew" },
        });
        continue;
      }
      if (!seat.eligible || seat.downed) {
        continue;
      }
      const dayKey = cycleId(now, "daily");
      const xp = xpGrant(CREW_XP, await spentXp(tx, mission.guildId, seat.userId, dayKey));
      const character = await tx.playerCharacter.findUnique({ where: { guildId_userId: { guildId: mission.guildId, userId: seat.userId } } });
      const template = drop ? await tx.gearTemplate.findUnique({ where: { guildId_slug: { guildId: mission.guildId, slug: drop.templateSlug } } }) : null;
      const eligible = template && character ? lootEligibility({ status: template.status, itemClass: template.classSlug, classSlug: character.classSlug, level: character.level, itemLevel: template.level }) === "available" : false;
      await tx.crewMissionMember.update({ where: { id: seat.id }, data: { lootSlug: drop?.templateSlug ?? "", grantedXp: xp } });
      if (eligible && template) {
        const key = `crew-loot:${mission.id}:${seat.userId}`;
        const prior = await tx.gearInstance.findUnique({ where: { idempotencyKey: key } });
        if (!prior) {
          await tx.gearInstance.create({
            data: {
              id: randomUUID(),
              guildId: mission.guildId,
              userId: seat.userId,
              templateId: template.id,
              name: template.name,
              slot: template.slot,
              classSlug: template.classSlug,
              level: template.level,
              binding: template.binding,
              diceCount: template.diceCount,
              diceSides: template.diceSides,
              critMultiplier: template.critMultiplier,
              abilitySlug: template.abilitySlug,
              affixes: json([]),
              provenance: "mission",
              equipped: false,
              lock: "",
              destroyed: false,
              templateVersion: template.version,
              idempotencyKey: key,
            },
          });
        }
      }
      payouts.push({ userId: seat.userId, xp, marks: CREW_MARKS, slug: drop?.templateSlug ?? "", eligible });
    }
    await tx.crewMission.update({ where: { id: mission.id }, data: { status, granted: true, completedAt: now } });
    return { posted: false as const, guildId: mission.guildId, status, payouts };
  });
  if (!prepared || prepared.posted) {
    return { result: "ready" as const, missionId, status: "posted" };
  }
  if (prepared.status === "won") {
    for (const payout of prepared.payouts) {
      if (payout.xp > 0) {
        await grantCharacterXp(db, { guildId: prepared.guildId, userId: payout.userId, amount: payout.xp, source: "crew-mission", idempotencyKey: `crew-xp:${missionId}:${payout.userId}`, now });
      }
      await issueMarks(db, {
        guildId: prepared.guildId,
        userId: payout.userId,
        amountMarks: payout.marks,
        source: "crew-mission",
        sourceId: missionId,
        pace: "routine",
        idempotencyKey: `crew-marks:${missionId}:${payout.userId}`,
        reason: "Crew mission completion",
        actorUserId: "system",
        now,
      });
      await noteContractSignal(db, { guildId: prepared.guildId, userId: payout.userId, kind: "crew_session", amount: 1, now });
      await noteContractSignal(db, { guildId: prepared.guildId, userId: payout.userId, kind: "rpg_pve", amount: 1, now });
      await noteContractSignal(db, { guildId: prepared.guildId, userId: payout.userId, kind: "rpg_exploration", amount: 1, now });
    }
  }
  return { result: "ready" as const, missionId, status: prepared.status };
}

export async function useRecoveryMedkit(db: Root, input: { guildId: string; userId: string; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  return db.$transaction(async (tx) => {
    const recovery = await tx.recovery.findUnique({ where: { guildId_userId: { guildId: input.guildId, userId: input.userId } } });
    if (!recovery) {
      return { result: "idle" as const };
    }
    const decision = applyMedkit(input.now, recovery.until, recovery.medkitUsed);
    if (decision.result !== "shortened") {
      return { result: decision.result, until: decision.until.toISOString() };
    }
    const medkit = await tx.gearInstance.findFirst({ where: { guildId: input.guildId, userId: input.userId, abilitySlug: "recover", destroyed: false, lock: "" } });
    if (!medkit) {
      return { result: "missing" as const };
    }
    await tx.gearInstance.update({ where: { id: medkit.id }, data: { destroyed: true } });
    await tx.recovery.update({ where: { id: recovery.id }, data: { until: decision.until, medkitUsed: true } });
    return { result: "shortened" as const, until: decision.until.toISOString() };
  });
}
