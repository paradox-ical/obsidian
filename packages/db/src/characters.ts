import { randomUUID } from "node:crypto";

import {
  CHARACTER_LEVEL_CAP,
  CLASS_CHANGE_COOLDOWN_MS,
  CLASS_CHANGE_MARKS,
  CLASS_SEEDS,
  DEFAULT_SESSION_XP,
  DEFAULT_SESSIONS_PER_WEEK,
  DEFAULT_XP_FACTOR,
  RESPEC_COOLDOWN_MS,
  RESPEC_MARKS,
  applyCharacterXp,
  diminishingBonus,
  earnedPoints,
  gearAfterClassChange,
  introResetDecision,
  isGameplayLock,
  isStatName,
  milestoneRewardKey,
  pointLedger,
  simulateRegularPlay,
  starterRewardKey,
  statEffect,
  xpForLevel,
  type StatName,
} from "@collective/domain";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

import { postCharacterFee } from "./ledger.js";
import { actorCan, ensureGuild, moduleIsAvailable, writeAudit, type Writer } from "./platform.js";

type Tx = Prisma.TransactionClient;
type Root = PrismaClient;

function isUnique(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

async function lockKey(tx: Tx, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

async function openRpg(db: Writer, guildId: string) {
  await ensureGuild(db, { guildId });
  return moduleIsAvailable(db, guildId, "rpg");
}

async function expeditionOpen(tx: Tx, guildId: string, userId: string) {
  const active = await tx.expedition.findFirst({ where: { guildId, userId, status: "active" }, select: { id: true } });
  return active !== null;
}

async function missionOpen(tx: Tx, guildId: string, userId: string) {
  const solo = await tx.missionRun.findFirst({ where: { guildId, userId, status: "active" }, select: { id: true } });
  if (solo) {
    return true;
  }
  const seats = await tx.crewMissionMember.findMany({ where: { guildId, userId }, select: { missionId: true } });
  if (seats.length === 0) {
    return false;
  }
  const live = await tx.crewMission.findFirst({ where: { id: { in: seats.map((seat) => seat.missionId) }, status: { in: ["forming", "active"] } }, select: { id: true } });
  return live !== null;
}

async function curveOf(db: Writer, guildId: string) {
  const existing = await db.characterCurve.findUnique({ where: { guildId } });
  if (existing) {
    return existing;
  }
  try {
    return await db.characterCurve.create({
      data: { guildId, version: 1, xpFactor: DEFAULT_XP_FACTOR, sessionXp: DEFAULT_SESSION_XP, sessionsPerWeek: DEFAULT_SESSIONS_PER_WEEK },
    });
  } catch (error) {
    if (!isUnique(error)) {
      throw error;
    }
    const again = await db.characterCurve.findUnique({ where: { guildId } });
    if (!again) {
      throw error;
    }
    return again;
  }
}

export async function ensureClassCatalog(db: Writer, guildId: string) {
  await ensureGuild(db, { guildId });
  await curveOf(db, guildId);
  if ((await db.classDefinition.count({ where: { guildId } })) > 0) {
    return;
  }
  await db.$transaction(async (tx) => {
    await lockKey(tx, `class-catalog:${guildId}`);
    if ((await tx.classDefinition.count({ where: { guildId } })) > 0) {
      return;
    }
    for (const seed of CLASS_SEEDS) {
      const classId = randomUUID();
      await tx.classDefinition.create({
        data: {
          id: classId,
          guildId,
          slug: seed.slug,
          name: seed.name,
          summary: seed.summary,
          baseStrength: seed.base.strength,
          baseAgility: seed.base.agility,
          baseEndurance: seed.base.endurance,
          baseFocus: seed.base.focus,
          version: 1,
          status: "active",
        },
      });
      for (const ability of seed.abilities) {
        await tx.classAbility.create({
          data: {
            id: randomUUID(),
            guildId,
            classId,
            slug: ability.slug,
            name: ability.name,
            kind: ability.kind,
            unlockLevel: ability.unlockLevel,
            cooldownTurns: ability.cooldownTurns,
            targetRule: ability.target,
            formula: ability.formula,
            version: 1,
          },
        });
      }
    }
  });
}

async function lockCharacter(tx: Tx, guildId: string, userId: string) {
  await lockKey(tx, `character:${guildId}:${userId}`);
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "player_character" WHERE "guildId" = ${guildId} AND "userId" = ${userId} FOR UPDATE
  `;
  const id = rows[0]?.id;
  if (!id) {
    return null;
  }
  return tx.playerCharacter.findUnique({ where: { id } });
}

async function rememberReward(tx: Tx, input: { guildId: string; userId: string; rewardKey: string; kind: string }) {
  const existing = await tx.characterReward.findUnique({ where: { rewardKey: input.rewardKey } });
  if (existing) {
    return false;
  }
  await tx.characterReward.create({
    data: { id: randomUUID(), guildId: input.guildId, userId: input.userId, rewardKey: input.rewardKey, kind: input.kind },
  });
  return true;
}

function conserved(row: { level: number; strength: number; agility: number; endurance: number; focus: number; unspentPoints: number }) {
  if (pointLedger({ level: row.level, strength: row.strength, agility: row.agility, endurance: row.endurance, focus: row.focus, unspent: row.unspentPoints }) === "broken") {
    throw new Error("Character points are not conserved.");
  }
}

async function grantMilestones(tx: Tx, row: { guildId: string; userId: string; classId: string; classSlug: string; level: number }, previousLevel: number) {
  const abilities = await tx.classAbility.findMany({ where: { classId: row.classId, kind: "active" } });
  for (const ability of abilities) {
    if (ability.unlockLevel <= 1 || ability.unlockLevel > row.level || ability.unlockLevel <= previousLevel) {
      continue;
    }
    await rememberReward(tx, {
      guildId: row.guildId,
      userId: row.userId,
      rewardKey: milestoneRewardKey(row.guildId, row.userId, row.classSlug, ability.slug),
      kind: "milestone",
    });
  }
}

async function applyGain(tx: Tx, row: { id: string; guildId: string; userId: string; classId: string; classSlug: string; level: number; xp: number; unspentPoints: number; strength: number; agility: number; endurance: number; focus: number }, gain: number) {
  const curve = await curveOf(tx, row.guildId);
  const next = applyCharacterXp({ level: row.level, xp: row.xp, gain, factor: curve.xpFactor });
  const updated = await tx.playerCharacter.update({
    where: { id: row.id },
    data: { level: next.level, xp: next.xp, unspentPoints: row.unspentPoints + next.pointsGained },
  });
  conserved(updated);
  await grantMilestones(tx, updated, row.level);
  return updated;
}

async function unequipForClass(tx: Tx, guildId: string, userId: string, classSlug: string) {
  const items = await tx.characterHeldItem.findMany({ where: { guildId, userId } });
  const next = gearAfterClassChange(items, classSlug);
  for (const item of next) {
    const current = items.find((row) => row.id === item.id);
    if (current && current.equipped !== item.equipped) {
      await tx.characterHeldItem.update({ where: { id: item.id }, data: { equipped: item.equipped } });
    }
  }
  const gear = await tx.gearInstance.findMany({ where: { guildId, userId, equipped: true, lock: "" } });
  for (const item of gear) {
    if (item.classSlug && item.classSlug !== classSlug) {
      await tx.gearInstance.update({ where: { id: item.id }, data: { equipped: false, destroyed: false } });
    }
  }
  const slots = await tx.characterLoadoutSlot.findMany({ where: { guildId, userId } });
  for (const slot of slots) {
      if (slot.kind === "gear") {
        const item = next.find((row) => row.id === slot.itemId);
        const gearItem = item ? null : await tx.gearInstance.findUnique({ where: { id: slot.itemId } });
        if (!item?.equipped && !(gearItem && gearItem.equipped && (gearItem.classSlug === "" || gearItem.classSlug === classSlug))) {
          await tx.characterLoadoutSlot.delete({ where: { id: slot.id } });
        }
        continue;
      }
    const ability = slot.abilityId ? await tx.classAbility.findUnique({ where: { id: slot.abilityId } }) : null;
    const definition = ability ? await tx.classDefinition.findUnique({ where: { id: ability.classId } }) : null;
    if (!definition || definition.slug !== classSlug) {
      await tx.characterLoadoutSlot.delete({ where: { id: slot.id } });
    }
  }
}

async function adoptClass(tx: Tx, row: { id: string; guildId: string; userId: string; level: number }, definition: { id: string; slug: string }, now: Date, cooldowns: boolean) {
  const updated = await tx.playerCharacter.update({
    where: { id: row.id },
    data: {
      classId: definition.id,
      classSlug: definition.slug,
      strength: 0,
      agility: 0,
      endurance: 0,
      focus: 0,
      unspentPoints: earnedPoints(row.level),
      ...(cooldowns
        ? { respecAvailableAt: new Date(now.getTime() + RESPEC_COOLDOWN_MS), classChangeAvailableAt: new Date(now.getTime() + CLASS_CHANGE_COOLDOWN_MS) }
        : {}),
    },
  });
  conserved(updated);
  await unequipForClass(tx, row.guildId, row.userId, definition.slug);
  await rememberReward(tx, { guildId: row.guildId, userId: row.userId, rewardKey: starterRewardKey(row.guildId, row.userId, definition.slug), kind: "starter" });
  await grantMilestones(tx, updated, 0);
  return updated;
}

export async function chooseClass(db: Root, input: { guildId: string; userId: string; classSlug: string; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  await ensureClassCatalog(db, input.guildId);
  const definition = await db.classDefinition.findUnique({ where: { guildId_slug: { guildId: input.guildId, slug: input.classSlug } } });
  if (!definition || definition.status !== "active") {
    return { result: "missing_class" as const };
  }
  try {
    return await db.$transaction(async (tx) => {
      const existing = await lockCharacter(tx, input.guildId, input.userId);
      if (existing) {
        return { result: "already_chosen" as const, classSlug: existing.classSlug };
      }
      const created = await tx.playerCharacter.create({
        data: { id: randomUUID(), guildId: input.guildId, userId: input.userId, classId: definition.id, classSlug: definition.slug, level: 1, xp: 0, unspentPoints: 0 },
      });
      const pending = await tx.characterXpEvent.findMany({ where: { guildId: input.guildId, userId: input.userId } });
      const gain = pending.reduce((sum, event) => sum + event.amount, 0);
      const row = gain > 0 ? await applyGain(tx, created, gain) : created;
      await rememberReward(tx, { guildId: input.guildId, userId: input.userId, rewardKey: starterRewardKey(input.guildId, input.userId, definition.slug), kind: "starter" });
      return { result: "chosen" as const, level: row.level, unspentPoints: row.unspentPoints };
    });
  } catch (error) {
    if (!isUnique(error)) {
      throw error;
    }
    return { result: "already_chosen" as const, classSlug: input.classSlug };
  }
}

export async function grantCharacterXp(db: Root, input: { guildId: string; userId: string; amount: number; source: string; idempotencyKey: string; now: Date }) {
  const amount = Math.trunc(input.amount);
  if (!Number.isInteger(amount) || amount <= 0 || !input.idempotencyKey) {
    return { result: "invalid" as const };
  }
  await ensureGuild(db, { guildId: input.guildId });
  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.characterXpEvent.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      const row = await lockCharacter(tx, input.guildId, input.userId);
      if (existing) {
        return { result: "already_recorded" as const, level: row?.level ?? 1, xp: row?.xp ?? 0 };
      }
      await tx.characterXpEvent.create({
        data: { id: randomUUID(), guildId: input.guildId, userId: input.userId, amount, source: input.source, idempotencyKey: input.idempotencyKey },
      });
      if (!row) {
        return { result: "pending" as const, amount };
      }
      const updated = await applyGain(tx, row, amount);
      return { result: "granted" as const, level: updated.level, xp: updated.xp, unspentPoints: updated.unspentPoints };
    });
  } catch (error) {
    if (!isUnique(error)) {
      throw error;
    }
    return { result: "already_recorded" as const, level: 1, xp: 0 };
  }
}

export async function allocateStats(db: Root, input: { guildId: string; userId: string; stat: string; points: number; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if (!isStatName(input.stat) || !Number.isInteger(input.points) || input.points <= 0) {
    return { result: "invalid" as const };
  }
  const stat: StatName = input.stat;
  return db.$transaction(async (tx) => {
    const row = await lockCharacter(tx, input.guildId, input.userId);
    if (!row) {
      return { result: "missing" as const };
    }
    if (row.gameplayLock) {
      return { result: "locked" as const };
    }
    if (row.unspentPoints < input.points) {
      return { result: "overspent" as const, unspentPoints: row.unspentPoints };
    }
    const updated = await tx.playerCharacter.update({
      where: { id: row.id },
      data: { [stat]: row[stat] + input.points, unspentPoints: row.unspentPoints - input.points },
    });
    conserved(updated);
    return { result: "allocated" as const, unspentPoints: updated.unspentPoints };
  });
}

async function spendReset(tx: Tx, input: { guildId: string; userId: string; characterId: string; amountMarks: number; source: string; idempotencyKey: string; reason: string; now: Date }) {
  return postCharacterFee(tx, {
    guildId: input.guildId,
    userId: input.userId,
    amountMarks: input.amountMarks,
    source: input.source,
    sourceId: input.characterId,
    idempotencyKey: input.idempotencyKey,
    reason: input.reason,
    actorUserId: input.userId,
    now: input.now,
  });
}

export async function respecCharacter(db: Root, input: { guildId: string; userId: string; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  return db.$transaction(async (tx) => {
    const row = await lockCharacter(tx, input.guildId, input.userId);
    if (!row) {
      return { result: "missing" as const };
    }
    if (row.gameplayLock || await expeditionOpen(tx, input.guildId, input.userId) || await missionOpen(tx, input.guildId, input.userId)) {
      return { result: "locked" as const };
    }
    if (row.respecAvailableAt && row.respecAvailableAt.getTime() > input.now.getTime()) {
      return { result: "cooling" as const, availableAt: row.respecAvailableAt.toISOString() };
    }
    const paid = await spendReset(tx, {
      guildId: input.guildId,
      userId: input.userId,
      characterId: row.id,
      amountMarks: RESPEC_MARKS,
      source: "character.respec",
      idempotencyKey: `character-respec:${row.id}:${row.updatedAt.toISOString()}`,
      reason: "Stat respec",
      now: input.now,
    });
    if (paid.result !== "posted") {
      return { result: paid.result === "insufficient" ? "unaffordable" as const : paid.result === "already_recorded" ? "already_recorded" as const : "invalid" as const, balanceMarks: paid.balanceMarks };
    }
    const updated = await tx.playerCharacter.update({
      where: { id: row.id },
      data: {
        strength: 0,
        agility: 0,
        endurance: 0,
        focus: 0,
        unspentPoints: earnedPoints(row.level),
        respecAvailableAt: new Date(input.now.getTime() + RESPEC_COOLDOWN_MS),
      },
    });
    conserved(updated);
    return { result: "respec" as const, availableAt: updated.respecAvailableAt?.toISOString() ?? "", unspentPoints: updated.unspentPoints, balanceMarks: paid.balanceMarks };
  });
}

export async function changeClass(db: Root, input: { guildId: string; userId: string; classSlug: string; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  await ensureClassCatalog(db, input.guildId);
  const definition = await db.classDefinition.findUnique({ where: { guildId_slug: { guildId: input.guildId, slug: input.classSlug } } });
  if (!definition || definition.status !== "active") {
    return { result: "missing_class" as const };
  }
  return db.$transaction(async (tx) => {
    const row = await lockCharacter(tx, input.guildId, input.userId);
    if (!row) {
      return { result: "missing" as const };
    }
    if (row.classSlug === definition.slug) {
      return { result: "same_class" as const };
    }
    if (row.gameplayLock || await expeditionOpen(tx, input.guildId, input.userId) || await missionOpen(tx, input.guildId, input.userId)) {
      return { result: "locked" as const };
    }
    if (row.classChangeAvailableAt && row.classChangeAvailableAt.getTime() > input.now.getTime()) {
      return { result: "cooling" as const, availableAt: row.classChangeAvailableAt.toISOString() };
    }
    const level = row.level;
    const xp = row.xp;
    const paid = await spendReset(tx, {
      guildId: input.guildId,
      userId: input.userId,
      characterId: row.id,
      amountMarks: CLASS_CHANGE_MARKS,
      source: "character.class_change",
      idempotencyKey: `character-class:${row.id}:${row.updatedAt.toISOString()}:${definition.slug}`,
      reason: "Class change",
      now: input.now,
    });
    if (paid.result !== "posted") {
      return { result: paid.result === "insufficient" ? "unaffordable" as const : paid.result === "already_recorded" ? "already_recorded" as const : "invalid" as const, balanceMarks: paid.balanceMarks };
    }
    const updated = await adoptClass(tx, row, definition, input.now, true);
    if (updated.level !== level || updated.xp !== xp) {
      throw new Error("A class change changed level or experience.");
    }
    return { result: "changed" as const, classSlug: updated.classSlug, level: updated.level, unspentPoints: updated.unspentPoints, balanceMarks: paid.balanceMarks };
  });
}

export async function introReset(db: Root, input: { guildId: string; userId: string; classSlug?: string; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  await ensureClassCatalog(db, input.guildId);
  return db.$transaction(async (tx) => {
    const row = await lockCharacter(tx, input.guildId, input.userId);
    if (!row) {
      return { result: "missing" as const };
    }
    const decision = introResetDecision({ level: row.level, used: row.introResetUsed, ranked: row.rankedDebutAt !== null, locked: row.gameplayLock !== "" || await expeditionOpen(tx, input.guildId, input.userId) || await missionOpen(tx, input.guildId, input.userId) });
    if (decision !== "allowed") {
      return { result: decision };
    }
    const definition = input.classSlug ? await tx.classDefinition.findUnique({ where: { guildId_slug: { guildId: input.guildId, slug: input.classSlug } } }) : null;
    if (input.classSlug && (!definition || definition.status !== "active")) {
      return { result: "missing_class" as const };
    }
    const next = definition && definition.slug !== row.classSlug ? await adoptClass(tx, row, definition, input.now, false) : await tx.playerCharacter.update({
      where: { id: row.id },
      data: { strength: 0, agility: 0, endurance: 0, focus: 0, unspentPoints: earnedPoints(row.level) },
    });
    const updated = await tx.playerCharacter.update({ where: { id: next.id }, data: { introResetUsed: true } });
    conserved(updated);
    return { result: "reset" as const, classSlug: updated.classSlug, unspentPoints: updated.unspentPoints };
  });
}

export async function noteRankedDebut(db: Root, input: { guildId: string; userId: string; now: Date }) {
  return db.$transaction(async (tx) => {
    const row = await lockCharacter(tx, input.guildId, input.userId);
    if (!row) {
      return { result: "missing" as const };
    }
    if (!row.rankedDebutAt) {
      await tx.playerCharacter.update({ where: { id: row.id }, data: { rankedDebutAt: input.now } });
    }
    return { result: "noted" as const };
  });
}

export async function lockGameplay(db: Root, input: { guildId: string; userId: string; lock: string }) {
  if (!isGameplayLock(input.lock)) {
    return { result: "invalid" as const };
  }
  const row = await db.playerCharacter.findUnique({ where: { guildId_userId: { guildId: input.guildId, userId: input.userId } } });
  if (!row) {
    return { result: "missing" as const };
  }
  await db.playerCharacter.update({ where: { id: row.id }, data: { gameplayLock: input.lock } });
  return { result: "locked" as const };
}

export async function unlockGameplay(db: Root, input: { guildId: string; userId: string }) {
  const row = await db.playerCharacter.findUnique({ where: { guildId_userId: { guildId: input.guildId, userId: input.userId } } });
  if (!row) {
    return { result: "missing" as const };
  }
  await db.playerCharacter.update({ where: { id: row.id }, data: { gameplayLock: "" } });
  return { result: "open" as const };
}

export async function setLoadout(db: Root, input: { guildId: string; userId: string; slots: Array<{ kind: "class" | "gear"; slug?: string; itemId?: string }> }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if (input.slots.length > 4) {
    return { result: "too_many" as const };
  }
  return db.$transaction(async (tx) => {
    const row = await lockCharacter(tx, input.guildId, input.userId);
    if (!row) {
      return { result: "missing" as const };
    }
    if (row.gameplayLock) {
      return { result: "locked" as const };
    }
    const abilities = await tx.classAbility.findMany({ where: { classId: row.classId } });
    const seen = new Set<string>();
    const writes: Array<{ kind: "class" | "gear"; abilityId: string; itemId: string }> = [];
    for (const slot of input.slots) {
      if (slot.kind === "gear") {
        const held = slot.itemId ? await tx.characterHeldItem.findUnique({ where: { id: slot.itemId } }) : null;
        const gear = held || !slot.itemId ? null : await tx.gearInstance.findUnique({ where: { id: slot.itemId } });
        const item = held
          ? { id: held.id, guildId: held.guildId, userId: held.userId, destroyed: held.destroyed, equipped: held.equipped, abilitySlug: held.abilitySlug, classSlug: held.classSlug, lock: "" }
          : gear;
        if (!item || item.guildId !== input.guildId || item.userId !== input.userId || item.destroyed || !item.equipped || !item.abilitySlug || item.lock) {
          return { result: item?.lock ? "locked" as const : "wrong_class" as const };
        }
        if (item.classSlug && item.classSlug !== row.classSlug) {
          return { result: "wrong_class" as const };
        }
        if (seen.has(`gear:${item.id}`)) {
          return { result: "duplicate" as const };
        }
        seen.add(`gear:${item.id}`);
        writes.push({ kind: "gear", abilityId: "", itemId: item.id });
        continue;
      }
      const ability = abilities.find((candidate) => candidate.slug === slot.slug);
      if (!ability || ability.kind !== "active") {
        return { result: "wrong_class" as const };
      }
      if (ability.unlockLevel > row.level) {
        return { result: "locked_ability" as const };
      }
      if (seen.has(ability.id)) {
        return { result: "duplicate" as const };
      }
      seen.add(ability.id);
      writes.push({ kind: "class", abilityId: ability.id, itemId: "" });
    }
    await tx.characterLoadoutSlot.deleteMany({ where: { guildId: input.guildId, userId: input.userId } });
    for (const [index, slot] of writes.entries()) {
      await tx.characterLoadoutSlot.create({
        data: { id: randomUUID(), guildId: input.guildId, userId: input.userId, slot: index + 1, kind: slot.kind, abilityId: slot.abilityId, itemId: slot.itemId },
      });
    }
    return { result: "saved" as const, slots: writes.length };
  });
}

export async function retainHeldItem(db: Root, input: { guildId: string; userId: string; name: string; classSlug?: string; abilitySlug?: string }) {
  await ensureGuild(db, { guildId: input.guildId });
  const item = await db.characterHeldItem.create({
    data: { id: randomUUID(), guildId: input.guildId, userId: input.userId, name: input.name, classSlug: input.classSlug ?? "", abilitySlug: input.abilitySlug ?? "", equipped: true, destroyed: false },
  });
  return { result: "retained" as const, itemId: item.id };
}

export async function clearCharacterCooldown(db: Root, input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; userId: string; reason: string }) {
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "content_management" })) !== "allowed") {
    return { result: "denied" as const };
  }
  const row = await db.playerCharacter.findUnique({ where: { guildId_userId: { guildId: input.guildId, userId: input.userId } } });
  if (!row) {
    return { result: "missing" as const };
  }
  await db.playerCharacter.update({ where: { id: row.id }, data: { respecAvailableAt: null, classChangeAvailableAt: null } });
  await writeAudit(db, { guildId: input.guildId, actorUserId: input.actorUserId, action: "character.cooldown", targetType: "player_character", targetId: row.id, reason: input.reason });
  return { result: "cleared" as const };
}

export async function saveClassDefinition(db: Root, input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; classId: string; summary: string; baseStrength: number; baseAgility: number; baseEndurance: number; baseFocus: number }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "content_management" })) !== "allowed") {
    return { result: "denied" as const };
  }
  const bases = [input.baseStrength, input.baseAgility, input.baseEndurance, input.baseFocus];
  if (!input.summary.trim() || bases.some((value) => !Number.isInteger(value) || value < 0 || value > 20)) {
    return { result: "invalid" as const };
  }
  const current = await db.classDefinition.findUnique({ where: { id: input.classId } });
  if (!current || current.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  const saved = await db.classDefinition.update({
    where: { id: current.id },
    data: { summary: input.summary.trim(), baseStrength: input.baseStrength, baseAgility: input.baseAgility, baseEndurance: input.baseEndurance, baseFocus: input.baseFocus, version: current.version + 1 },
  });
  await writeAudit(db, { guildId: input.guildId, actorUserId: input.actorUserId, action: "character.class", targetType: "class_definition", targetId: current.id, reason: "Edit class" });
  return { result: "saved" as const, version: saved.version };
}

export async function saveCharacterCurve(db: Root, input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; xpFactor: number; sessionXp: number; sessionsPerWeek: number }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "content_management" })) !== "allowed") {
    return { result: "denied" as const };
  }
  if (![input.xpFactor, input.sessionXp, input.sessionsPerWeek].every((value) => Number.isInteger(value) && value >= 1)) {
    return { result: "invalid" as const };
  }
  const current = await curveOf(db, input.guildId);
  const saved = await db.characterCurve.update({
    where: { guildId: input.guildId },
    data: { xpFactor: input.xpFactor, sessionXp: input.sessionXp, sessionsPerWeek: input.sessionsPerWeek, version: current.version + 1 },
  });
  await writeAudit(db, { guildId: input.guildId, actorUserId: input.actorUserId, action: "character.curve", targetType: "character_curve", targetId: input.guildId, reason: "Edit character curve" });
  return { result: "saved" as const, version: saved.version };
}

async function presentCharacter(db: Writer, guildId: string, userId: string) {
  const curve = await curveOf(db, guildId);
  const classes = await db.classDefinition.findMany({ where: { guildId, status: "active" }, orderBy: { slug: "asc" } });
  const abilities = await db.classAbility.findMany({ where: { guildId }, orderBy: [{ unlockLevel: "asc" }, { slug: "asc" }] });
  const simulation = simulateRegularPlay({ factor: curve.xpFactor, sessionXp: curve.sessionXp, sessionsPerWeek: curve.sessionsPerWeek });
  const catalog = classes.map((definition) => ({
    id: definition.id,
    slug: definition.slug,
    name: definition.name,
    summary: definition.summary,
    version: definition.version,
    base: { strength: definition.baseStrength, agility: definition.baseAgility, endurance: definition.baseEndurance, focus: definition.baseFocus },
    abilities: abilities.filter((ability) => ability.classId === definition.id).map((ability) => ({
      slug: ability.slug,
      name: ability.name,
      kind: ability.kind,
      unlockLevel: ability.unlockLevel,
      cooldownTurns: ability.cooldownTurns,
      target: ability.targetRule,
      formula: ability.formula,
    })),
  }));
  const row = userId ? await db.playerCharacter.findUnique({ where: { guildId_userId: { guildId, userId } } }) : null;
  return { curve, simulation, catalog, row, abilities };
}

export async function readCharacter(db: Writer, guildId: string, userId: string, now: Date) {
  await ensureClassCatalog(db, guildId);
  const view = await presentCharacter(db, guildId, userId);
  if (!view.row) {
    return { status: "uncreated" as const, classes: view.catalog, simulation: view.simulation, curveVersion: view.curve.version };
  }
  const definition = view.catalog.find((item) => item.id === view.row?.classId);
  const base = definition?.base ?? { strength: 0, agility: 0, endurance: 0, focus: 0 };
  const effects = {
    strength: statEffect("strength", base.strength, view.row.strength),
    agility: statEffect("agility", base.agility, view.row.agility),
    endurance: statEffect("endurance", base.endurance, view.row.endurance),
    focus: statEffect("focus", base.focus, view.row.focus),
    health: 20 + diminishingBonus(base.endurance + view.row.endurance, 40),
  };
  const slots = await db.characterLoadoutSlot.findMany({ where: { guildId, userId }, orderBy: { slot: "asc" } });
  const items = await db.characterHeldItem.findMany({ where: { guildId, userId } });
  const need = xpForLevel(view.row.level, view.curve.xpFactor);
  return {
    status: "ready" as const,
    className: definition?.name ?? view.row.classSlug,
    classSlug: view.row.classSlug,
    level: view.row.level,
    xp: view.row.xp,
    xpToNext: view.row.level >= CHARACTER_LEVEL_CAP ? 0 : need - view.row.xp,
    earnedPoints: earnedPoints(view.row.level),
    unspentPoints: view.row.unspentPoints,
    allocated: { strength: view.row.strength, agility: view.row.agility, endurance: view.row.endurance, focus: view.row.focus },
    conservation: pointLedger({ level: view.row.level, strength: view.row.strength, agility: view.row.agility, endurance: view.row.endurance, focus: view.row.focus, unspent: view.row.unspentPoints }),
    effects,
    abilities: (definition?.abilities ?? []).map((ability) => ({ ...ability, unlocked: view.row ? ability.unlockLevel <= view.row.level : false })),
    loadout: slots.map((slot) => ({ slot: slot.slot, kind: slot.kind, abilityId: slot.abilityId, abilitySlug: view.abilities.find((ability) => ability.id === slot.abilityId)?.slug ?? "", itemId: slot.itemId })),
    held: items.map((item) => ({ id: item.id, name: item.name, classSlug: item.classSlug, abilitySlug: item.abilitySlug, equipped: item.equipped, destroyed: item.destroyed })),
    asOf: now.toISOString(),
    respecAvailableAt: view.row.respecAvailableAt?.toISOString() ?? null,
    classChangeAvailableAt: view.row.classChangeAvailableAt?.toISOString() ?? null,
    introReset: introResetDecision({ level: view.row.level, used: view.row.introResetUsed, ranked: view.row.rankedDebutAt !== null, locked: view.row.gameplayLock !== "" }),
    gameplayLock: view.row.gameplayLock,
    classes: view.catalog,
    simulation: view.simulation,
  };
}

export async function readCharacterStaff(db: Writer, guildId: string, now: Date) {
  await ensureClassCatalog(db, guildId);
  const view = await presentCharacter(db, guildId, "");
  return {
    curve: { version: view.curve.version, xpFactor: view.curve.xpFactor, sessionXp: view.curve.sessionXp, sessionsPerWeek: view.curve.sessionsPerWeek },
    classes: view.catalog,
    simulation: view.simulation,
    asOf: now.toISOString(),
    fees: { respecMarks: RESPEC_MARKS, classChangeMarks: CLASS_CHANGE_MARKS },
  };
}
