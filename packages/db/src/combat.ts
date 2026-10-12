import { randomInt, randomUUID } from "node:crypto";

import {
  DISCONNECT_GRACE_MINUTES,
  PAIR_LIMIT,
  RANKED_ABILITY_LEVEL,
  RANKED_GEAR_BUDGET,
  RANKED_REWARD_MARKS,
  RANKED_STAT_BUDGET,
  GEAR_HEALTH_CAP,
  GEAR_SEEDS,
  OPPONENT_SEEDS,
  TACTICAL_TURN_MS,
  affixDecision,
  blankFighter,
  diminishingBonus,
  equipDecision,
  freshBattle,
  gearBonus,
  presentBattle,
  rankedAllocation,
  resolveAction,
  resolveQuick,
  statEffect,
  gearTransferDecision,
  type AffixRoll,
  type AffixRule,
  type BattleState,
  type Fighter,
  type MainAction,
  type RollPacket,
} from "@collective/domain";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

import { enqueueJob, actorCan, ensureGuild, moduleIsAvailable, writeAudit, type Writer } from "./platform.js";

type Tx = Prisma.TransactionClient;
type Root = PrismaClient;

function isUnique(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function asRules(value: unknown): AffixRule[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") {
      return [];
    }
    const rule = row as AffixRule;
    if (typeof rule.slug !== "string" || typeof rule.min !== "number" || typeof rule.max !== "number") {
      return [];
    }
    if (rule.stat !== "accuracy" && rule.stat !== "defence" && rule.stat !== "health" && rule.stat !== "damage") {
      return [];
    }
    return [rule];
  });
}

function asAffixes(value: unknown): AffixRoll[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") {
      return [];
    }
    const affix = row as AffixRoll;
    if (typeof affix.slug !== "string" || typeof affix.amount !== "number") {
      return [];
    }
    if (affix.stat !== "accuracy" && affix.stat !== "defence" && affix.stat !== "health" && affix.stat !== "damage") {
      return [];
    }
    return [{ slug: affix.slug, stat: affix.stat, amount: affix.amount }];
  });
}

function asState(value: unknown): BattleState {
  if (!value || typeof value !== "object" || !("fighters" in value)) {
    throw new Error("Battle state is unreadable.");
  }
  return value as BattleState;
}

function isAction(value: string): value is MainAction {
  return value === "strike" || value === "defend" || value === "ability" || value === "item";
}

async function openRpg(db: Writer, guildId: string) {
  await ensureGuild(db, { guildId });
  return moduleIsAvailable(db, guildId, "rpg");
}

export async function ensureGearCatalog(db: Writer, guildId: string) {
  await ensureGuild(db, { guildId });
  const existing = await db.gearTemplate.findMany({ where: { guildId }, select: { slug: true } });
  const have = new Set(existing.map((row) => row.slug));
  if (GEAR_SEEDS.some((seed) => !have.has(seed.slug))) {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`gear-catalog:${guildId}`}, 0))`;
      const current = new Set((await tx.gearTemplate.findMany({ where: { guildId }, select: { slug: true } })).map((row) => row.slug));
      for (const seed of GEAR_SEEDS) {
        if (current.has(seed.slug)) {
          continue;
        }
        await tx.gearTemplate.create({
          data: {
            id: randomUUID(),
            guildId,
            slug: seed.slug,
            name: seed.name,
            slot: seed.slot,
            summary: seed.summary,
            classSlug: seed.classSlug,
            level: seed.level,
            binding: seed.binding,
            diceCount: seed.diceCount,
            diceSides: seed.diceSides,
            critMultiplier: seed.critMultiplier,
            abilitySlug: seed.abilitySlug,
            affixMax: seed.affixMax,
            affixRules: json(seed.affixRules),
            version: 1,
            status: "active",
          },
        });
      }
    });
  }
  if ((await db.testOpponent.count({ where: { guildId } })) === 0) {
    for (const seed of OPPONENT_SEEDS) {
      await db.testOpponent.create({
        data: { id: randomUUID(), guildId, slug: seed.slug, name: seed.name, tactic: seed.tactic, accuracy: seed.accuracy, defence: seed.defence, health: seed.health, diceCount: seed.diceCount, diceSides: seed.diceSides, version: 1 },
      });
    }
  }
}

function rolledAffixes(rules: AffixRule[], max: number): AffixRoll[] {
  return rules.slice(0, max).map((rule) => ({ slug: rule.slug, stat: rule.stat, amount: randomInt(rule.min, rule.max + 1) }));
}

export async function mintGear(db: Root, input: { guildId: string; userId: string; templateSlug: string; affixes?: AffixRoll[]; provenance?: string; idempotencyKey: string }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  await ensureGearCatalog(db, input.guildId);
  const existing = await db.gearInstance.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    return { result: "already_recorded" as const, itemId: existing.id };
  }
  const template = await db.gearTemplate.findUnique({ where: { guildId_slug: { guildId: input.guildId, slug: input.templateSlug } } });
  if (!template || template.status !== "active") {
    return { result: "missing" as const };
  }
  const rules = asRules(template.affixRules);
  const affixes = input.affixes ?? rolledAffixes(rules, template.affixMax);
  if (affixDecision(rules, affixes, template.affixMax) !== "allowed") {
    return { result: "out_of_range" as const };
  }
  try {
    const item = await db.gearInstance.create({
      data: {
        id: randomUUID(),
        guildId: input.guildId,
        userId: input.userId,
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
        affixes: json(affixes),
        provenance: input.provenance ?? "mint",
        equipped: false,
        lock: "",
        destroyed: false,
        templateVersion: template.version,
        idempotencyKey: input.idempotencyKey,
      },
    });
    return { result: "minted" as const, itemId: item.id, affixes };
  } catch (error) {
    if (!isUnique(error)) {
      throw error;
    }
    const again = await db.gearInstance.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    return { result: "already_recorded" as const, itemId: again?.id ?? "" };
  }
}

export async function equipGear(db: Root, input: { guildId: string; userId: string; itemId: string }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  return db.$transaction(async (tx) => {
    const character = await tx.playerCharacter.findUnique({ where: { guildId_userId: { guildId: input.guildId, userId: input.userId } } });
    const item = await tx.gearInstance.findUnique({ where: { id: input.itemId } });
    if (!character || !item || item.guildId !== input.guildId || item.userId !== input.userId) {
      return { result: "missing" as const };
    }
    if (character.gameplayLock || item.lock) {
      return { result: "locked" as const };
    }
    if (item.slot === "consumable") {
      return { result: "carried" as const };
    }
    const decision = equipDecision({ classSlug: character.classSlug, itemClass: item.classSlug, level: character.level, itemLevel: item.level, locked: false, destroyed: item.destroyed });
    if (decision !== "allowed") {
      return { result: decision };
    }
    await tx.gearInstance.updateMany({ where: { guildId: input.guildId, userId: input.userId, slot: item.slot, equipped: true, lock: "" }, data: { equipped: false } });
    const equipped = await tx.gearInstance.updateMany({ where: { id: item.id, userId: input.userId, lock: "", equipped: false, destroyed: false }, data: { equipped: true } });
    if (equipped.count !== 1) {
      return { result: "locked" as const };
    }
    return { result: "equipped" as const, itemId: item.id };
  });
}

export async function unequipGear(db: Root, input: { guildId: string; userId: string; itemId: string }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  const character = await db.playerCharacter.findUnique({ where: { guildId_userId: { guildId: input.guildId, userId: input.userId } } });
  const item = await db.gearInstance.findUnique({ where: { id: input.itemId } });
  if (!character || !item || item.guildId !== input.guildId || item.userId !== input.userId) {
    return { result: "missing" as const };
  }
  if (character.gameplayLock || item.lock) {
    return { result: "locked" as const };
  }
  const removed = await db.gearInstance.updateMany({ where: { id: item.id, userId: input.userId, lock: "" }, data: { equipped: false } });
  if (removed.count !== 1) {
    return { result: "locked" as const };
  }
  return { result: "unequipped" as const };
}

export async function inspectGearTransfer(db: Writer, input: { guildId: string; userId: string; itemId: string }) {
  const character = await db.playerCharacter.findUnique({ where: { guildId_userId: { guildId: input.guildId, userId: input.userId } } });
  const item = await db.gearInstance.findUnique({ where: { id: input.itemId } });
  if (!item || item.guildId !== input.guildId || item.userId !== input.userId) {
    return { result: "missing" as const };
  }
  return { result: gearTransferDecision({ binding: item.binding, locked: item.lock !== "", equipped: item.equipped, inventoryLocked: Boolean(character?.gameplayLock) }) };
}

async function memberFighter(tx: Tx, guildId: string, userId: string): Promise<Fighter | null> {
  const character = await tx.playerCharacter.findUnique({ where: { guildId_userId: { guildId, userId } } });
  if (!character) {
    return null;
  }
  const definition = await tx.classDefinition.findUnique({ where: { id: character.classId } });
  const agility = statEffect("agility", definition?.baseAgility ?? 0, character.agility);
  const endurance = statEffect("endurance", definition?.baseEndurance ?? 0, character.endurance);
  const strength = statEffect("strength", definition?.baseStrength ?? 0, character.strength);
  const items = await tx.gearInstance.findMany({ where: { guildId, userId, destroyed: false } });
  const equipped = items.filter((item) => item.equipped && item.lock !== "expedition" && item.lock !== "mission");
  const affixes = equipped.flatMap((item) => asAffixes(item.affixes));
  const weapon = equipped.find((item) => item.slot === "weapon");
  const healthGear = Math.min(GEAR_HEALTH_CAP, gearBonus(affixes, "health"));
  const maxHealth = 20 + diminishingBonus((definition?.baseEndurance ?? 0) + character.endurance, 40) + healthGear;
  const fighter = blankFighter("member", character.classSlug);
  fighter.health = maxHealth;
  fighter.maxHealth = maxHealth;
  fighter.accuracyStat = agility.bonus;
  fighter.defenceStat = endurance.bonus;
  fighter.damageStat = strength.bonus;
  fighter.accuracyGear = gearBonus(affixes, "accuracy");
  fighter.defenceGear = gearBonus(affixes, "defence");
  fighter.damageGear = gearBonus(affixes, "damage");
  fighter.healthGear = healthGear;
  fighter.diceCount = weapon?.diceCount || 1;
  fighter.diceSides = weapon?.diceSides || 6;
  fighter.critMultiplier = weapon?.critMultiplier || 2;
  fighter.itemLimit = items.some((item) => item.slot === "consumable" && item.lock !== "expedition") ? 1 : 0;
  return fighter;
}

export async function loadPvpFighter(tx: Prisma.TransactionClient, guildId: string, userId: string, side: "member" | "opponent", mode: "casual" | "ranked"): Promise<Fighter | null> {
  const character = await tx.playerCharacter.findUnique({ where: { guildId_userId: { guildId, userId } } });
  if (!character) {
    return null;
  }
  const definition = await tx.classDefinition.findUnique({ where: { id: character.classId } });
  const allocated = mode === "ranked"
    ? rankedAllocation({ strength: character.strength, agility: character.agility, endurance: character.endurance, focus: character.focus })
    : { strength: character.strength, agility: character.agility, endurance: character.endurance, focus: character.focus };
  const agility = statEffect("agility", definition?.baseAgility ?? 0, allocated.agility);
  const endurance = statEffect("endurance", definition?.baseEndurance ?? 0, allocated.endurance);
  const strength = statEffect("strength", definition?.baseStrength ?? 0, allocated.strength);
  const items = await tx.gearInstance.findMany({ where: { guildId, userId, destroyed: false } });
  let equipped = items.filter((item) => item.equipped && item.lock !== "expedition" && item.lock !== "mission");
  if (mode === "ranked") {
    const power = (affixes: unknown) => asAffixes(affixes).reduce((sum, affix) => sum + Math.abs(affix.amount), 0);
    while (equipped.reduce((sum, item) => sum + power(item.affixes), 0) > RANKED_GEAR_BUDGET) {
      let dropAt = -1;
      let highest = 0;
      equipped.forEach((item, index) => {
        const value = power(item.affixes);
        if (value >= highest) {
          highest = value;
          dropAt = index;
        }
      });
      if (dropAt < 0 || highest <= 0) {
        break;
      }
      equipped = equipped.filter((_, index) => index !== dropAt);
    }
  }
  const affixes = equipped.flatMap((item) => asAffixes(item.affixes));
  const weapon = equipped.find((item) => item.slot === "weapon");
  const healthGear = Math.min(GEAR_HEALTH_CAP, gearBonus(affixes, "health"));
  const maxHealth = 20 + diminishingBonus((definition?.baseEndurance ?? 0) + allocated.endurance, 40) + healthGear;
  const fighter = blankFighter(side, character.classSlug);
  fighter.health = maxHealth;
  fighter.maxHealth = maxHealth;
  fighter.accuracyStat = agility.bonus;
  fighter.defenceStat = endurance.bonus;
  fighter.damageStat = strength.bonus;
  fighter.accuracyGear = gearBonus(affixes, "accuracy");
  fighter.defenceGear = gearBonus(affixes, "defence");
  fighter.damageGear = gearBonus(affixes, "damage");
  fighter.healthGear = healthGear;
  fighter.diceCount = weapon?.diceCount || 1;
  fighter.diceSides = weapon?.diceSides || 6;
  fighter.critMultiplier = weapon?.critMultiplier || 2;
  fighter.itemLimit = equipped.some((item) => item.slot === "consumable") ? 1 : 0;
  fighter.reactionReady = false;
  return fighter;
}

function opponentFighter(row: { name: string; accuracy: number; defence: number; health: number; diceCount: number; diceSides: number }): Fighter {
  const fighter = blankFighter("opponent", row.name);
  fighter.health = row.health;
  fighter.maxHealth = row.health;
  fighter.accuracyStat = row.accuracy;
  fighter.defenceStat = row.defence;
  fighter.diceCount = row.diceCount;
  fighter.diceSides = row.diceSides;
  fighter.reactionReady = false;
  return fighter;
}

async function nextSequence(tx: Tx, battleId: string) {
  const latest = await tx.battleRoll.findFirst({ where: { battleId }, orderBy: { sequence: "desc" } });
  return (latest?.sequence ?? 0) + 1;
}

async function storePacket(tx: Tx, input: { battleId: string; guildId: string; packet: RollPacket; revealed: boolean; purpose: string }) {
  let sequence = await nextSequence(tx, input.battleId);
  await tx.battleRoll.create({ data: { id: randomUUID(), battleId: input.battleId, guildId: input.guildId, sequence, purpose: input.purpose, faces: 20, result: input.packet.attack, revealed: input.revealed } });
  sequence += 1;
  for (const face of input.packet.damage) {
    await tx.battleRoll.create({ data: { id: randomUUID(), battleId: input.battleId, guildId: input.guildId, sequence, purpose: "damage", faces: 6, result: face, revealed: input.revealed } });
    sequence += 1;
  }
}

function makePacket(diceCount: number, diceSides: number): RollPacket {
  const sides = Math.max(2, diceSides);
  return { attack: randomInt(1, 21), damage: Array.from({ length: Math.max(1, diceCount) }, () => randomInt(1, sides + 1)) };
}

async function missionBusy(tx: Tx, guildId: string, userId: string) {
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

async function commitLocks(tx: Tx, guildId: string, userId: string, lock: boolean) {
  await tx.playerCharacter.update({ where: { guildId_userId: { guildId, userId } }, data: { gameplayLock: lock ? "combat" : "" } });
  await tx.gearInstance.updateMany({ where: { guildId, userId, ...(lock ? { equipped: true, lock: "" } : { lock: "combat" }) }, data: { lock: lock ? "combat" : "" } });
}

async function presentStored(db: Writer, battleId: string, audience: "member" | "staff") {
  const battle = await db.battle.findUnique({ where: { id: battleId } });
  if (!battle) {
    return { result: "missing" as const };
  }
  const rolls = await db.battleRoll.findMany({ where: { battleId }, orderBy: { sequence: "asc" } });
  return { result: "ready" as const, battleId, kind: battle.kind, deadline: battle.deadline?.toISOString() ?? null, ...presentBattle(asState(battle.state), rolls, audience) };
}

export async function readBattle(db: Writer, input: { guildId: string; userId: string; battleId: string; audience?: "member" | "staff" }) {
  const battle = await db.battle.findUnique({ where: { id: input.battleId } });
  if (!battle || battle.guildId !== input.guildId || (input.audience !== "staff" && battle.userId !== input.userId)) {
    return { result: "missing" as const };
  }
  return presentStored(db, battle.id, input.audience ?? "member");
}

export async function startQuickDuel(db: Root, input: { guildId: string; userId: string; opponentSlug: string; tactic?: MainAction; idempotencyKey: string; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  await ensureGearCatalog(db, input.guildId);
  const existing = await db.battle.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    return presentStored(db, existing.id, "member");
  }
  const opponent = await db.testOpponent.findUnique({ where: { guildId_slug: { guildId: input.guildId, slug: input.opponentSlug } } });
  if (!opponent) {
    return { result: "missing" as const };
  }
  const battleId = randomUUID();
  let failure: "missing" | "locked" | null = null;
  try {
    await db.$transaction(async (tx) => {
      const member = await memberFighter(tx, input.guildId, input.userId);
      const character = await tx.playerCharacter.findUnique({ where: { guildId_userId: { guildId: input.guildId, userId: input.userId } } });
      if (!member || !character) {
        failure = "missing";
        return;
      }
      if (character.gameplayLock || await missionBusy(tx, input.guildId, input.userId)) {
        failure = "locked";
        return;
      }
      await commitLocks(tx, input.guildId, input.userId, true);
      const packets = Array.from({ length: 16 }, () => makePacket(member.diceCount, member.diceSides));
      let sequence = 1;
      for (const packet of packets) {
        await tx.battleRoll.create({ data: { id: randomUUID(), battleId, guildId: input.guildId, sequence, purpose: "attack", faces: 20, result: packet.attack, revealed: false } });
        sequence += 1;
        for (const face of packet.damage) {
          await tx.battleRoll.create({ data: { id: randomUUID(), battleId, guildId: input.guildId, sequence, purpose: "damage", faces: member.diceSides, result: face, revealed: false } });
          sequence += 1;
        }
      }
      const tactic = input.tactic && isAction(input.tactic) ? input.tactic : "strike";
      const opponentTactic = isAction(opponent.tactic) ? opponent.tactic : "strike";
      const resolved = resolveQuick(freshBattle(member, opponentFighter(opponent)), packets, [tactic, opponentTactic]);
      await tx.battle.create({
        data: { id: battleId, guildId: input.guildId, userId: input.userId, kind: "quick", status: resolved.state.status, opponentSlug: opponent.slug, state: json(resolved.state), winner: resolved.state.winner, idempotencyKey: input.idempotencyKey, createdAt: input.now },
      });
      const revealUntil = resolved.used * (1 + Math.max(1, member.diceCount));
      await tx.battleRoll.updateMany({ where: { battleId, sequence: { lte: revealUntil } }, data: { revealed: true } });
      await commitLocks(tx, input.guildId, input.userId, false);
    });
    if (failure) {
      return { result: failure };
    }
    return presentStored(db, battleId, "member");
  } catch (error) {
    if (!isUnique(error)) {
      throw error;
    }
    const again = await db.battle.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    return again ? presentStored(db, again.id, "member") : { result: "missing" as const };
  }
}

async function hiddenOrNew(tx: Tx, battleId: string, guildId: string, fighter: Fighter): Promise<RollPacket> {
  const hidden = await tx.battleRoll.findFirst({ where: { battleId, purpose: "opponent-attack", revealed: false } });
  const packet = makePacket(fighter.diceCount, fighter.diceSides);
  if (hidden) {
    await tx.battleRoll.update({ where: { id: hidden.id }, data: { revealed: true } });
    packet.attack = hidden.result;
  }
  await storePacket(tx, { battleId, guildId, packet, revealed: true, purpose: hidden ? "opponent-follow" : "attack" });
  return packet;
}

async function advanceOpponent(tx: Tx, battleId: string, guildId: string, state: BattleState, tactic: MainAction) {
  if (state.status !== "active" || state.side !== 1) {
    return state;
  }
  const needsRoll = tactic === "strike" || tactic === "ability";
  const packet = needsRoll ? await hiddenOrNew(tx, battleId, guildId, state.fighters[1]) : null;
  const outcome = resolveAction(state, needsRoll && !packet ? "defend" : tactic, packet);
  return outcome.result === "cooling" || outcome.result === "spent" ? resolveAction(state, "defend", null).state : outcome.state;
}

export async function startTacticalDuel(db: Root, input: { guildId: string; userId: string; opponentSlug: string; idempotencyKey: string; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  await ensureGearCatalog(db, input.guildId);
  const existing = await db.battle.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    return presentStored(db, existing.id, "member");
  }
  const opponent = await db.testOpponent.findUnique({ where: { guildId_slug: { guildId: input.guildId, slug: input.opponentSlug } } });
  if (!opponent) {
    return { result: "missing" as const };
  }
  const battleId = randomUUID();
  const deadline = new Date(input.now.getTime() + TACTICAL_TURN_MS);
  let failure: "missing" | "locked" | null = null;
  try {
    await db.$transaction(async (tx) => {
      const member = await memberFighter(tx, input.guildId, input.userId);
      const character = await tx.playerCharacter.findUnique({ where: { guildId_userId: { guildId: input.guildId, userId: input.userId } } });
      if (!member || !character) {
        failure = "missing";
        return;
      }
      if (character.gameplayLock || await missionBusy(tx, input.guildId, input.userId)) {
        failure = "locked";
        return;
      }
      const state = freshBattle(member, opponentFighter(opponent));
      await tx.battle.create({
        data: { id: battleId, guildId: input.guildId, userId: input.userId, kind: "tactical", status: "active", opponentSlug: opponent.slug, deadline, state: json(state), winner: "", idempotencyKey: input.idempotencyKey, createdAt: input.now },
      });
      await tx.battleRoll.create({ data: { id: randomUUID(), battleId, guildId: input.guildId, sequence: 1, purpose: "opponent-attack", faces: 20, result: randomInt(1, 21), revealed: false } });
      await commitLocks(tx, input.guildId, input.userId, true);
    });
  } catch (error) {
    if (!isUnique(error)) {
      throw error;
    }
    const again = await db.battle.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    return again ? presentStored(db, again.id, "member") : { result: "missing" as const };
  }
  if (failure) {
    return { result: failure };
  }
  await enqueueJob(db, { guildId: input.guildId, jobType: "combat.timeout", payload: { battleId }, idempotencyKey: `combat-timeout:${battleId}:1`, runAt: deadline });
  return presentStored(db, battleId, "member");
}

async function applyMemberAction(tx: Tx, battle: { id: string; guildId: string; userId: string; opponentSlug: string; state: unknown }, move: MainAction, now: Date) {
  const state = asState(battle.state);
  if (state.status === "resolved" || state.side !== 0) {
    return state;
  }
  const needsRoll = move === "strike" || move === "ability";
  const packet = needsRoll ? makePacket(state.fighters[0].diceCount, state.fighters[0].diceSides) : null;
  if (packet) {
    await storePacket(tx, { battleId: battle.id, guildId: battle.guildId, packet, revealed: true, purpose: "attack" });
  }
  const outcome = resolveAction(state, move, packet);
  if (outcome.result === "cooling" || outcome.result === "spent") {
    return state;
  }
  const opponent = await tx.testOpponent.findUnique({ where: { guildId_slug: { guildId: battle.guildId, slug: battle.opponentSlug } } });
  const tactic = opponent && isAction(opponent.tactic) ? opponent.tactic : "strike";
  const advanced = await advanceOpponent(tx, battle.id, battle.guildId, outcome.state, tactic);
  const deadline = advanced.status === "active" ? new Date(now.getTime() + TACTICAL_TURN_MS) : null;
  await tx.battle.update({ where: { id: battle.id }, data: { state: json(advanced), status: advanced.status, winner: advanced.winner, deadline } });
  if (advanced.status === "resolved") {
    await commitLocks(tx, battle.guildId, battle.userId, false);
  } else if (deadline) {
    await enqueueJob(tx, { guildId: battle.guildId, jobType: "combat.timeout", payload: { battleId: battle.id }, idempotencyKey: `combat-timeout:${battle.id}:${advanced.round}`, runAt: deadline });
  }
  return advanced;
}

export async function actInBattle(db: Root, input: { guildId: string; userId: string; battleId: string; move: string; idempotencyKey: string; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if (!isAction(input.move)) {
    return { result: "invalid" as const };
  }
  const move = input.move;
  const existingAction = await db.battleAction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existingAction) {
    return presentStored(db, existingAction.battleId, "member");
  }
  try {
    const outcome = await db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "battle" WHERE "id" = ${input.battleId} FOR UPDATE`;
      const battle = rows[0] ? await tx.battle.findUnique({ where: { id: rows[0].id } }) : null;
      if (!battle || battle.guildId !== input.guildId || battle.userId !== input.userId) {
        return "missing" as const;
      }
      if (battle.status !== "active") {
        return "resolved" as const;
      }
      if (battle.deadline && battle.deadline.getTime() <= input.now.getTime()) {
        await applyMemberAction(tx, battle, "defend", input.now);
      } else {
        const before = asState(battle.state);
        const after = await applyMemberAction(tx, battle, move, input.now);
        if (after === before) {
          return input.move === "ability" ? "cooling" as const : "spent" as const;
        }
      }
      await tx.battleAction.create({ data: { id: randomUUID(), battleId: battle.id, guildId: input.guildId, round: asState(battle.state).round, actor: "member", move: input.move, idempotencyKey: input.idempotencyKey } });
      return "ready" as const;
    });
    if (outcome !== "ready" && outcome !== "resolved") {
      return { result: outcome };
    }
    return presentStored(db, input.battleId, "member");
  } catch (error) {
    if (!isUnique(error)) {
      throw error;
    }
    return presentStored(db, input.battleId, "member");
  }
}

export async function expireBattleTurns(db: Root, now: Date) {
  const due = await db.battle.findMany({ where: { kind: "tactical", status: "active", deadline: { lte: now } } });
  let expired = 0;
  for (const battle of due) {
    const changed = await db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "battle" WHERE "id" = ${battle.id} FOR UPDATE`;
      const current = rows[0] ? await tx.battle.findUnique({ where: { id: rows[0].id } }) : null;
      if (!current || current.status !== "active" || !current.deadline || current.deadline.getTime() > now.getTime()) {
        return false;
      }
      await applyMemberAction(tx, current, "defend", now);
      return true;
    });
    if (changed) {
      expired += 1;
    }
  }
  return { expired };
}

export async function readGear(db: Writer, guildId: string, userId: string) {
  await ensureGearCatalog(db, guildId);
  const items = await db.gearInstance.findMany({ where: { guildId, userId }, orderBy: { createdAt: "asc" } });
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    slot: item.slot,
    classSlug: item.classSlug,
    level: item.level,
    binding: item.binding,
    equipped: item.equipped,
    lock: item.lock,
    destroyed: item.destroyed,
    upgradeTier: item.upgradeTier,
    rerollCount: item.rerollCount,
    affixes: asAffixes(item.affixes),
    templateVersion: item.templateVersion,
  }));
}

export async function readCombatStaff(db: Writer, guildId: string) {
  await ensureGearCatalog(db, guildId);
  const templates = await db.gearTemplate.findMany({ where: { guildId }, orderBy: { slug: "asc" } });
  const opponents = await db.testOpponent.findMany({ where: { guildId }, orderBy: { slug: "asc" } });
  return {
    rules: presentBattle(freshBattle(blankFighter("member", "Member"), blankFighter("opponent", "Opponent")), [], "staff").rules,
    templates: templates.map((template) => ({ id: template.id, slug: template.slug, name: template.name, summary: template.summary, slot: template.slot, classSlug: template.classSlug, level: template.level, binding: template.binding, version: template.version, affixMax: template.affixMax, affixRules: asRules(template.affixRules) })),
    opponents: opponents.map((opponent) => ({ id: opponent.id, slug: opponent.slug, name: opponent.name, tactic: opponent.tactic, health: opponent.health, version: opponent.version })),
    ranked: { statBudget: RANKED_STAT_BUDGET, gearBudget: RANKED_GEAR_BUDGET, abilityLevel: RANKED_ABILITY_LEVEL, pairLimit: PAIR_LIMIT, graceMinutes: DISCONNECT_GRACE_MINUTES, rewardMarks: RANKED_REWARD_MARKS },
    reviews: await db.pvpReview.count({ where: { guildId, status: "open" } }),
  };
}

export async function saveGearTemplate(db: Root, input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; templateId: string; summary: string; level: number; classSlug: string; affixMax: number }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "content_management" })) !== "allowed") {
    return { result: "denied" as const };
  }
  if (!input.summary.trim() || !Number.isInteger(input.level) || input.level < 1 || !Number.isInteger(input.affixMax) || input.affixMax < 0 || input.affixMax > 2) {
    return { result: "invalid" as const };
  }
  const current = await db.gearTemplate.findUnique({ where: { id: input.templateId } });
  if (!current || current.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  const saved = await db.gearTemplate.update({
    where: { id: current.id },
    data: { summary: input.summary.trim(), level: input.level, classSlug: input.classSlug.trim(), affixMax: input.affixMax, version: current.version + 1 },
  });
  await writeAudit(db, { guildId: input.guildId, actorUserId: input.actorUserId, action: "combat.template", targetType: "gear_template", targetId: current.id, reason: "Edit gear template" });
  return { result: "saved" as const, version: saved.version };
}

export async function saveTestOpponent(db: Root, input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; opponentId: string; health: number }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "content_management" })) !== "allowed") {
    return { result: "denied" as const };
  }
  if (!Number.isInteger(input.health) || input.health < 1 || input.health > 200) {
    return { result: "invalid" as const };
  }
  const current = await db.testOpponent.findUnique({ where: { id: input.opponentId } });
  if (!current || current.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  const saved = await db.testOpponent.update({ where: { id: current.id }, data: { health: input.health, version: current.version + 1 } });
  await writeAudit(db, { guildId: input.guildId, actorUserId: input.actorUserId, action: "combat.opponent", targetType: "test_opponent", targetId: current.id, reason: "Edit test opponent" });
  return { result: "saved" as const, version: saved.version };
}
