import { randomInt, randomUUID } from "node:crypto";

import {
  DIFFICULTY_TIERS,
  ENEMY_SEEDS,
  LOOT_TABLES,
  REGION_SEEDS,
  MISSION_SEEDS,
  RECOVERY_MINIMUM_MINUTES,
  RECOVERY_MINUTES,
  MEDKIT_SHORTEN_MINUTES,
  REMAINING_WORLD_WORK,
  cooldownDecision,
  enemyForDifficulty,
  expeditionHealth,
  isDifficulty,
  lootEligibility,
  pickLoot,
  regionAccess,
  reservedModifiers,
  resolveEncounter,
  scaleEnemy,
  slotDecision,
  xpGrant,
  type Difficulty,
  type EnemyAbility,
  type EnemySeed,
  type LootEntry,
  blankFighter,
  gearBonus,
  statEffect,
  type AffixRoll,
  type AffixRule,
  type Fighter,
  type RollPacket,
  cycleId,
} from "@collective/domain";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

import { ensureGearCatalog } from "./combat.js";
import { grantCharacterXp } from "./characters.js";
import { issueMarks } from "./ledger.js";
import { noteContractSignal } from "./contracts.js";
import { actorCan, enqueueJob, ensureGuild, moduleIsAvailable, writeAudit, type Writer } from "./platform.js";

type Tx = Prisma.TransactionClient;
type Root = PrismaClient;

interface StoredLoot {
  templateSlug: string;
  eligible: boolean;
  reason: string;
  affixes: AffixRoll[];
}

interface StoredRules {
  regionLevel: number;
  tier: { minutes: number; cooldownMinutes: number; xp: number; marks: number; scale: number };
  enemy: EnemySeed;
  lootTableVersion: number;
  loot: StoredLoot;
  packets: RollPacket[];
}

interface StoredReport {
  winner: string;
  log: string[];
  xpRequested: number;
  marksRequested: number;
}

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

function asEntries(value: unknown): LootEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") {
      return [];
    }
    const entry = row as LootEntry;
    if (typeof entry.templateSlug !== "string" || typeof entry.weight !== "number") {
      return [];
    }
    const source = entry.source === "boss" || entry.source === "contract" ? entry.source : "expedition";
    return [{ templateSlug: entry.templateSlug, weight: entry.weight, source }];
  });
}

function asStored(value: unknown): StoredRules | null {
  if (!value || typeof value !== "object" || !("enemy" in value) || !("loot" in value) || !("tier" in value)) {
    return null;
  }
  return value as StoredRules;
}

function asReport(value: unknown): StoredReport | null {
  if (!value || typeof value !== "object" || !("winner" in value) || !("log" in value)) {
    return null;
  }
  return value as StoredReport;
}

function rollAffixes(rules: AffixRule[], max: number): AffixRoll[] {
  return rules.slice(0, Math.max(0, max)).map((rule) => ({ slug: rule.slug, stat: rule.stat, amount: randomInt(rule.min, rule.max + 1) }));
}

function packetFor(diceCount: number, diceSides: number): RollPacket {
  const count = Math.max(1, diceCount);
  const sides = Math.max(2, diceSides);
  return { attack: randomInt(1, 21), damage: Array.from({ length: count }, () => randomInt(1, sides + 1)) };
}

async function openRpg(db: Writer, guildId: string) {
  await ensureGuild(db, { guildId });
  return moduleIsAvailable(db, guildId, "rpg");
}

export async function ensureWorldCatalog(db: Writer, guildId: string) {
  await ensureGearCatalog(db, guildId);
  const regions = new Set((await db.worldRegion.findMany({ where: { guildId }, select: { slug: true } })).map((row) => row.slug));
  for (const seed of REGION_SEEDS) {
    if (regions.has(seed.slug)) {
      continue;
    }
    try {
      await db.worldRegion.create({ data: { id: randomUUID(), guildId, slug: seed.slug, name: seed.name, summary: seed.summary, level: seed.level, version: 1, status: "active" } });
    } catch (error) {
      if (!isUnique(error)) {
        throw error;
      }
    }
  }
  const enemies = new Set((await db.worldEnemy.findMany({ where: { guildId }, select: { slug: true } })).map((row) => row.slug));
  for (const seed of ENEMY_SEEDS) {
    if (enemies.has(seed.slug)) {
      continue;
    }
    try {
      await db.worldEnemy.create({
        data: {
          id: randomUUID(),
          guildId,
          slug: seed.slug,
          name: seed.name,
          regionSlug: seed.regionSlug,
          level: seed.level,
          boss: seed.boss,
          ability: seed.ability,
          accuracy: seed.accuracy,
          defence: seed.defence,
          health: seed.health,
          diceCount: seed.diceCount,
          diceSides: seed.diceSides,
          rewardSource: seed.rewardSource,
          summary: seed.summary,
          version: 1,
          status: "active",
        },
      });
    } catch (error) {
      if (!isUnique(error)) {
        throw error;
      }
    }
  }
  const tables = new Set((await db.lootTable.findMany({ where: { guildId }, select: { slug: true } })).map((row) => row.slug));
  for (const seed of LOOT_TABLES) {
    if (tables.has(seed.slug)) {
      continue;
    }
    try {
      await db.lootTable.create({
        data: { id: randomUUID(), guildId, slug: seed.slug, name: seed.name, regionSlug: seed.regionSlug, difficulty: seed.difficulty, entries: json(seed.entries), version: 1, status: "active" },
      });
    } catch (error) {
      if (!isUnique(error)) {
        throw error;
      }
    }
  }
}

function presentExpedition(row: { id: string; status: string; regionSlug: string; difficulty: string; deadline: Date; notice: string; report: unknown; grantedXp: number; grantedMarks: number; marksResult: string; rewardsPosted: boolean }) {
  const report = asReport(row.report);
  return {
    result: "ready" as const,
    expeditionId: row.id,
    status: row.status,
    regionSlug: row.regionSlug,
    difficulty: row.difficulty,
    deadline: row.deadline.toISOString(),
    notice: row.notice,
    winner: report?.winner ?? "",
    log: report?.log ?? [],
    grantedXp: row.grantedXp,
    grantedMarks: row.grantedMarks,
    marksResult: row.marksResult,
    rewardsPosted: row.rewardsPosted,
  };
}

export async function previewExpedition(db: Writer, input: { guildId: string; userId: string; regionSlug: string; difficulty: string; now: Date }): Promise<
  | { result: "maintenance" }
  | { result: "invalid" }
  | { result: "missing" }
  | { result: "ready"; access: "allowed" | "level"; slot: "allowed" | "busy"; cooldown: "allowed" | "cooling"; tier: { minutes: number; cooldownMinutes: number; xp: number; marks: number; scale: number }; enemy: string; lootVersion: number; remaining: readonly string[] }
> {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if (!isDifficulty(input.difficulty)) {
    return { result: "invalid" as const };
  }
  await ensureWorldCatalog(db, input.guildId);
  const character = await db.playerCharacter.findUnique({ where: { guildId_userId: { guildId: input.guildId, userId: input.userId } } });
  const region = await db.worldRegion.findUnique({ where: { guildId_slug: { guildId: input.guildId, slug: input.regionSlug } } });
  if (!character || !region || region.status !== "active") {
    return { result: "missing" as const };
  }
  const active = await db.expedition.count({ where: { guildId: input.guildId, userId: input.userId, status: "active" } });
  const cooling = await db.expedition.findFirst({ where: { guildId: input.guildId, userId: input.userId, regionSlug: region.slug, difficulty: input.difficulty, status: "resolved", cooldownUntil: { gt: input.now } }, orderBy: { cooldownUntil: "desc" } });
  const enemies = await db.worldEnemy.findMany({ where: { guildId: input.guildId, regionSlug: region.slug, status: "active" } });
  const enemy = enemyForDifficulty(enemies.map(toEnemy), region.slug, input.difficulty);
  const table = await db.lootTable.findUnique({ where: { guildId_slug: { guildId: input.guildId, slug: `${region.slug}-${input.difficulty}` } } });
  const tier = DIFFICULTY_TIERS[input.difficulty];
  return {
    result: "ready" as const,
    access: regionAccess(character.level, region.level),
    slot: slotDecision(active),
    cooldown: cooldownDecision(input.now, cooling?.cooldownUntil ?? null),
    tier,
    enemy: enemy?.name ?? "",
    lootVersion: table?.version ?? 0,
    remaining: REMAINING_WORLD_WORK,
  };
}

function toEnemy(row: { slug: string; name: string; regionSlug: string; level: number; boss: boolean; ability: string; accuracy: number; defence: number; health: number; diceCount: number; diceSides: number; rewardSource: string; summary: string }): EnemySeed {
  const ability: EnemyAbility = row.ability === "bleed" || row.ability === "defend" || row.ability === "stun" || row.ability === "execute" ? row.ability : "strike";
  return {
    slug: row.slug,
    name: row.name,
    regionSlug: row.regionSlug,
    level: row.level,
    boss: row.boss,
    ability,
    accuracy: row.accuracy,
    defence: row.defence,
    health: row.health,
    diceCount: row.diceCount,
    diceSides: row.diceSides,
    rewardSource: row.rewardSource === "boss" ? "boss" : "expedition",
    summary: row.summary,
  };
}

export async function startExpedition(db: Root, input: { guildId: string; userId: string; regionSlug: string; difficulty: string; itemIds?: string[]; notify?: boolean; idempotencyKey: string; now: Date; packets?: RollPacket[]; lootRoll?: number }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if (!isDifficulty(input.difficulty)) {
    return { result: "invalid" as const };
  }
  const difficulty: Difficulty = input.difficulty;
  await ensureWorldCatalog(db, input.guildId);
  const existing = await db.expedition.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    return presentExpedition(existing);
  }
  const region = await db.worldRegion.findUnique({ where: { guildId_slug: { guildId: input.guildId, slug: input.regionSlug } } });
  const table = await db.lootTable.findUnique({ where: { guildId_slug: { guildId: input.guildId, slug: `${input.regionSlug}-${difficulty}` } } });
  if (!region || region.status !== "active" || !table || table.status !== "active") {
    return { result: "missing" as const };
  }
  const enemies = (await db.worldEnemy.findMany({ where: { guildId: input.guildId, regionSlug: region.slug, status: "active" } })).map(toEnemy);
  const picked = enemyForDifficulty(enemies, region.slug, difficulty);
  if (!picked) {
    return { result: "missing" as const };
  }
  const tier = DIFFICULTY_TIERS[difficulty];
  const enemy = scaleEnemy(picked, tier.scale);
  const expeditionId = randomUUID();
  const deadline = new Date(input.now.getTime() + tier.minutes * 60 * 1000);
  try {
    const outcome = await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "player_character" WHERE "guildId" = ${input.guildId} AND "userId" = ${input.userId} FOR UPDATE`;
      const character = locked[0] ? await tx.playerCharacter.findUnique({ where: { id: locked[0].id } }) : null;
      if (!character) {
        return "missing" as const;
      }
      if (regionAccess(character.level, region.level) === "level") {
        return "level" as const;
      }
      const recovery = await tx.recovery.findUnique({ where: { guildId_userId: { guildId: input.guildId, userId: input.userId } } });
      if (recovery && recovery.until.getTime() > input.now.getTime()) {
        return "recovery" as const;
      }
      const playing = await tx.missionRun.findFirst({ where: { guildId: input.guildId, userId: input.userId, status: "active" }, select: { id: true } });
      if (playing) {
        return "locked" as const;
      }
      if (character.gameplayLock === "combat" || character.gameplayLock === "mission" || character.gameplayLock === "queue") {
        return "locked" as const;
      }
      const active = await tx.expedition.count({ where: { guildId: input.guildId, userId: input.userId, status: "active" } });
      if (slotDecision(active) === "busy") {
        return "busy" as const;
      }
      const cooling = await tx.expedition.findFirst({ where: { guildId: input.guildId, userId: input.userId, regionSlug: region.slug, difficulty, status: "resolved", cooldownUntil: { gt: input.now } } });
      if (cooldownDecision(input.now, cooling?.cooldownUntil ?? null) === "cooling") {
        return "cooling" as const;
      }
      const itemIds = [...new Set(input.itemIds ?? [])].slice(0, 4);
      const items = [];
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
        items.push(item);
      }
      const definition = await tx.classDefinition.findUnique({ where: { id: character.classId } });
      const fighter = fighterFrom(character, definition, items);
      const entries = asEntries(table.entries);
      const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
      const lootRoll = input.lootRoll ?? (total > 0 ? randomInt(1, total + 1) : 1);
      const drop = pickLoot(entries, lootRoll);
      const template = drop ? await tx.gearTemplate.findUnique({ where: { guildId_slug: { guildId: input.guildId, slug: drop.templateSlug } } }) : null;
      const eligible = template ? lootEligibility({ status: template.status, itemClass: template.classSlug, classSlug: character.classSlug, level: character.level, itemLevel: template.level }) : "unavailable";
      const loot: StoredLoot = {
        templateSlug: drop?.templateSlug ?? "",
        eligible: eligible === "available",
        reason: eligible === "available" ? "available" : template ? eligible : "missing",
        affixes: template && eligible === "available" ? rollAffixes(asRules(template.affixRules), template.affixMax) : [],
      };
      const packets = input.packets ?? Array.from({ length: 8 }, (_, index) => packetFor(index % 2 === 0 ? fighter.diceCount : enemy.diceCount, index % 2 === 0 ? fighter.diceSides : enemy.diceSides));
      const encounter = resolveEncounter(fighter, enemy, packets);
      const rules: StoredRules = { regionLevel: region.level, tier, enemy, lootTableVersion: table.version, loot, packets };
      const report: StoredReport = { winner: encounter.winner, log: encounter.log, xpRequested: tier.xp, marksRequested: tier.marks };
      await tx.expedition.create({
        data: {
          id: expeditionId,
          guildId: input.guildId,
          userId: input.userId,
          regionSlug: region.slug,
          difficulty,
          status: "active",
          deadline,
          cooldownUntil: deadline,
          notify: input.notify === true,
          notice: "",
          reservedItemIds: json(itemIds),
          rules: json(rules),
          report: json(report),
          idempotencyKey: input.idempotencyKey,
          createdAt: input.now,
        },
      });
      if (itemIds.length > 0) {
        await tx.gearInstance.updateMany({ where: { id: { in: itemIds }, lock: "" }, data: { lock: "expedition" } });
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
    const again = await db.expedition.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    return again ? presentExpedition(again) : { result: "missing" as const };
  }
  await enqueueJob(db, { guildId: input.guildId, jobType: "expedition.complete", payload: { expeditionId }, idempotencyKey: `expedition-complete:${expeditionId}`, runAt: deadline });
  const created = await db.expedition.findUnique({ where: { id: expeditionId } });
  return created ? presentExpedition(created) : { result: "missing" as const };
}

function fighterFrom(character: { classSlug: string; agility: number; endurance: number; strength: number }, definition: { baseAgility: number; baseEndurance: number; baseStrength: number } | null, items: Array<{ slot: string; affixes: unknown; diceCount: number; diceSides: number; critMultiplier: number; abilitySlug: string }>): Fighter {
  const agility = statEffect("agility", definition?.baseAgility ?? 0, character.agility);
  const endurance = statEffect("endurance", definition?.baseEndurance ?? 0, character.endurance);
  const strength = statEffect("strength", definition?.baseStrength ?? 0, character.strength);
  const affixes = items.flatMap((item) => asAffixRolls(item.affixes));
  const weapon = items.find((item) => item.slot === "weapon");
  const mods = reservedModifiers(items.map((item) => item.abilitySlug));
  const healthGear = Math.min(10, gearBonus(affixes, "health"));
  const maxHealth = expeditionHealth((definition?.baseEndurance ?? 0) + character.endurance, healthGear);
  const fighter = blankFighter("member", character.classSlug);
  fighter.health = maxHealth;
  fighter.maxHealth = maxHealth;
  fighter.accuracyStat = agility.bonus;
  fighter.defenceStat = endurance.bonus;
  fighter.damageStat = strength.bonus;
  fighter.accuracyGear = gearBonus(affixes, "accuracy") + mods.accuracy;
  fighter.defenceGear = gearBonus(affixes, "defence") + mods.defence;
  fighter.damageGear = gearBonus(affixes, "damage");
  fighter.healthGear = healthGear;
  fighter.diceCount = weapon?.diceCount || 1;
  fighter.diceSides = weapon?.diceSides || 6;
  fighter.critMultiplier = weapon?.critMultiplier || 2;
  fighter.itemLimit = mods.itemLimit;
  fighter.reactionReady = false;
  return fighter;
}

function asAffixRolls(value: unknown): AffixRoll[] {
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
    return [affix];
  });
}

export async function completeDueExpeditions(db: Root, now: Date) {
  const due = await db.expedition.findMany({
    where: { OR: [{ status: "active", deadline: { lte: now } }, { status: "resolved", rewardsPosted: false }] },
    orderBy: { deadline: "asc" },
  });
  let completed = 0;
  for (const row of due) {
    const outcome = await finishExpedition(db, row.id, now);
    if (outcome === "completed") {
      completed += 1;
    }
  }
  return { completed };
}

async function finishExpedition(db: Root, expeditionId: string, now: Date): Promise<"completed" | "posted" | "missing"> {
  const prepared = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "expedition" WHERE "id" = ${expeditionId} FOR UPDATE`;
    const current = rows[0] ? await tx.expedition.findUnique({ where: { id: rows[0].id } }) : null;
    if (!current) {
      return null;
    }
    if (current.rewardsPosted) {
      return { posted: true as const };
    }
    if (current.status === "active" && current.deadline.getTime() > now.getTime()) {
      return { posted: true as const };
    }
    const rules = asStored(current.rules);
    const report = asReport(current.report);
    if (!rules || !report) {
      return null;
    }
    const dayKey = current.dayKey || cycleId(now, "daily");
    const prior = await tx.expedition.findMany({ where: { guildId: current.guildId, userId: current.userId, dayKey, status: "resolved", id: { not: current.id } }, select: { grantedXp: true } });
    const spent = prior.reduce((sum, row) => sum + row.grantedXp, 0);
    const requested = report.winner === "member" ? rules.tier.xp : 0;
    const grantedXp = current.status === "resolved" ? current.grantedXp : xpGrant(requested, spent);
    const marksRequested = report.winner === "member" ? rules.tier.marks : 0;
    if (current.status === "active") {
      const reserved = Array.isArray(current.reservedItemIds) ? current.reservedItemIds.filter((item): item is string => typeof item === "string") : [];
      await tx.gearInstance.updateMany({ where: { id: { in: reserved }, lock: "expedition" }, data: { lock: "" } });
      await tx.expedition.update({
        where: { id: current.id },
        data: {
          status: "resolved",
          dayKey,
          grantedXp,
          cooldownUntil: new Date(now.getTime() + rules.tier.cooldownMinutes * 60 * 1000),
          notice: current.notify ? "setup_required" : "skipped",
          completedAt: now,
        },
      });
      if (report.winner === "member" && rules.loot.eligible && rules.loot.templateSlug) {
        await mintDrop(tx, current.guildId, current.userId, current.id, rules.loot);
      }
    }
    return { posted: false as const, guildId: current.guildId, userId: current.userId, grantedXp, marksRequested, winner: report.winner };
  });
  if (!prepared) {
    return "missing";
  }
  if (prepared.posted) {
    return "posted";
  }
  if (prepared.grantedXp > 0) {
    await grantCharacterXp(db, { guildId: prepared.guildId, userId: prepared.userId, amount: prepared.grantedXp, source: "expedition", idempotencyKey: `expedition-xp:${expeditionId}`, now });
  }
  let marksResult = "skipped";
  let grantedMarks = 0;
  if (prepared.marksRequested > 0) {
    const paid = await issueMarks(db, {
      guildId: prepared.guildId,
      userId: prepared.userId,
      amountMarks: prepared.marksRequested,
      source: "expedition",
      sourceId: expeditionId,
      pace: "routine",
      idempotencyKey: `expedition-marks:${expeditionId}`,
      reason: "Expedition completion",
      actorUserId: "system",
      now,
    });
    marksResult = paid.result;
    grantedMarks = paid.result === "posted" || paid.result === "already_recorded" ? prepared.marksRequested : 0;
  }
  await noteContractSignal(db, { guildId: prepared.guildId, userId: prepared.userId, kind: "rpg_exploration", amount: 1, now });
  if (prepared.winner === "member") {
    await noteContractSignal(db, { guildId: prepared.guildId, userId: prepared.userId, kind: "rpg_pve", amount: 1, now });
  }
  await db.expedition.update({ where: { id: expeditionId }, data: { rewardsPosted: true, marksResult, grantedMarks } });
  return "completed";
}

async function mintDrop(tx: Tx, guildId: string, userId: string, expeditionId: string, loot: StoredLoot) {
  const template = await tx.gearTemplate.findUnique({ where: { guildId_slug: { guildId, slug: loot.templateSlug } } });
  if (!template || template.status !== "active") {
    return;
  }
  const existing = await tx.gearInstance.findUnique({ where: { idempotencyKey: `expedition-loot:${expeditionId}` } });
  if (existing) {
    return;
  }
  await tx.gearInstance.create({
    data: {
      id: randomUUID(),
      guildId,
      userId,
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
      affixes: json(loot.affixes),
      provenance: "expedition",
      equipped: false,
      lock: "",
      destroyed: false,
      templateVersion: template.version,
      idempotencyKey: `expedition-loot:${expeditionId}`,
    },
  });
}

export async function readWorldStaff(db: Writer, guildId: string) {
  await ensureWorldCatalog(db, guildId);
  const regions = await db.worldRegion.findMany({ where: { guildId }, orderBy: { level: "asc" } });
  const enemies = await db.worldEnemy.findMany({ where: { guildId }, orderBy: { level: "asc" } });
  const tables = await db.lootTable.findMany({ where: { guildId }, orderBy: { slug: "asc" } });
  return {
    remaining: REMAINING_WORLD_WORK,
    regions: regions.map((region) => ({ id: region.id, slug: region.slug, name: region.name, summary: region.summary, level: region.level, version: region.version })),
    enemies: enemies.map((enemy) => ({ id: enemy.id, slug: enemy.slug, name: enemy.name, regionSlug: enemy.regionSlug, level: enemy.level, boss: enemy.boss, ability: enemy.ability, health: enemy.health, summary: enemy.summary, version: enemy.version, rewardSource: enemy.rewardSource })),
    loot: tables.map((table) => ({ id: table.id, slug: table.slug, name: table.name, version: table.version, entries: asEntries(table.entries) })),
    counts: { regions: regions.length, enemies: enemies.filter((enemy) => !enemy.boss).length, bosses: enemies.filter((enemy) => enemy.boss).length },
    missions: MISSION_SEEDS.map((mission) => ({ slug: mission.slug, name: mission.name, regionSlug: mission.regionSlug, summary: mission.summary })),
    recovery: { minutes: RECOVERY_MINUTES, minimumMinutes: RECOVERY_MINIMUM_MINUTES, medkitMinutes: MEDKIT_SHORTEN_MINUTES },
  };
}

export async function saveWorldRegion(db: Root, input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; regionId: string; summary: string; level: number }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "content_management" })) !== "allowed") {
    return { result: "denied" as const };
  }
  if (!input.summary.trim() || !Number.isInteger(input.level) || input.level < 1 || input.level > 50) {
    return { result: "invalid" as const };
  }
  const current = await db.worldRegion.findUnique({ where: { id: input.regionId } });
  if (!current || current.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  const saved = await db.worldRegion.update({ where: { id: current.id }, data: { summary: input.summary.trim(), level: input.level, version: current.version + 1 } });
  await writeAudit(db, { guildId: input.guildId, actorUserId: input.actorUserId, action: "world.region", targetType: "world_region", targetId: current.id, reason: "Edit region" });
  return { result: "saved" as const, version: saved.version };
}

export async function saveWorldEnemy(db: Root, input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; enemyId: string; health: number; ability: string }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "content_management" })) !== "allowed") {
    return { result: "denied" as const };
  }
  if (!Number.isInteger(input.health) || input.health < 1 || input.health > 200 || !["strike", "bleed", "defend", "stun", "execute"].includes(input.ability)) {
    return { result: "invalid" as const };
  }
  const current = await db.worldEnemy.findUnique({ where: { id: input.enemyId } });
  if (!current || current.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  const saved = await db.worldEnemy.update({ where: { id: current.id }, data: { health: input.health, ability: input.ability, version: current.version + 1 } });
  await writeAudit(db, { guildId: input.guildId, actorUserId: input.actorUserId, action: "world.enemy", targetType: "world_enemy", targetId: current.id, reason: "Edit enemy" });
  return { result: "saved" as const, version: saved.version };
}

export async function saveLootWeight(db: Root, input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; tableId: string; templateSlug: string; weight: number }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "content_management" })) !== "allowed") {
    return { result: "denied" as const };
  }
  if (!input.templateSlug || !Number.isInteger(input.weight) || input.weight < 1 || input.weight > 100) {
    return { result: "invalid" as const };
  }
  const current = await db.lootTable.findUnique({ where: { id: input.tableId } });
  if (!current || current.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  const entries = asEntries(current.entries);
  if (!entries.some((entry) => entry.templateSlug === input.templateSlug)) {
    return { result: "missing" as const };
  }
  const saved = await db.lootTable.update({
    where: { id: current.id },
    data: { entries: json(entries.map((entry) => entry.templateSlug === input.templateSlug ? { ...entry, weight: input.weight } : entry)), version: current.version + 1 },
  });
  await writeAudit(db, { guildId: input.guildId, actorUserId: input.actorUserId, action: "world.loot", targetType: "loot_table", targetId: current.id, reason: "Edit loot weight" });
  return { result: "saved" as const, version: saved.version };
}
