import { GEAR_HEALTH_CAP, GEAR_SEEDS, addEffect, blankFighter, freshBattle, resolveAction, type Fighter, type RollPacket } from "./combat.js";
import { diminishingBonus } from "./characters.js";

export const EXPEDITION_DAILY_XP = 400;
export const EXPEDITION_SLOT_LIMIT = 1;

export const DIFFICULTIES = ["routine", "standard", "severe"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const ENEMY_ABILITIES = ["strike", "bleed", "defend", "stun", "execute"] as const;
export type EnemyAbility = (typeof ENEMY_ABILITIES)[number];

export const REMAINING_WORLD_WORK = [
  "Queues, trades, and crafting are not part of missions.",
] as const;

export interface RegionSeed {
  slug: string;
  name: string;
  level: number;
  summary: string;
}

export interface EnemySeed {
  slug: string;
  name: string;
  regionSlug: string;
  level: number;
  boss: boolean;
  ability: EnemyAbility;
  accuracy: number;
  defence: number;
  health: number;
  diceCount: number;
  diceSides: number;
  rewardSource: "expedition" | "boss";
  summary: string;
}

export interface LootEntry {
  templateSlug: string;
  weight: number;
  source: "expedition" | "boss" | "contract";
}

export interface LootTableSeed {
  slug: string;
  name: string;
  regionSlug: string;
  difficulty: Difficulty;
  entries: readonly LootEntry[];
}

export const REGION_SEEDS: readonly RegionSeed[] = [
  { slug: "backstreets", name: "Backstreets", level: 1, summary: "Seeded level 1. Access is the level gate only." },
  { slug: "black-docks", name: "Black Docks", level: 15, summary: "Seeded level 15. A story clue does not lock the gate." },
  { slug: "inner-sanctum", name: "Inner Sanctum", level: 35, summary: "Seeded level 35. Higher difficulties keep the lower regions useful." },
];

function foe(
  slug: string,
  name: string,
  regionSlug: string,
  level: number,
  boss: boolean,
  ability: EnemyAbility,
  accuracy: number,
  defence: number,
  health: number,
  diceSides: number,
  summary: string,
): EnemySeed {
  return {
    slug,
    name,
    regionSlug,
    level,
    boss,
    ability,
    accuracy,
    defence,
    health,
    diceCount: diceSides > 8 ? 2 : 1,
    diceSides: diceSides > 8 ? 6 : diceSides,
    rewardSource: boss ? "boss" : "expedition",
    summary,
  };
}

export const ENEMY_SEEDS: readonly EnemySeed[] = [
  foe("alley-runner", "Alley Runner", "backstreets", 1, false, "bleed", 1, 0, 12, 6, "A hit applies bleed 1 for two turns through the ability action."),
  foe("lookout", "Lookout", "backstreets", 2, false, "defend", 0, 2, 14, 4, "Defends. The defence bonus is 2 and does not stack."),
  foe("pickpocket", "Pickpocket", "backstreets", 3, false, "strike", 2, 0, 10, 4, "Strikes with accuracy 2. Damage is 1d4."),
  foe("street-bruiser", "Street Bruiser", "backstreets", 6, false, "stun", 0, 1, 18, 6, "A hit stuns the next main action. The stun does not chain."),
  foe("lamp-sniper", "Lamp Sniper", "backstreets", 8, false, "strike", 3, 0, 12, 8, "Strikes with accuracy 3. Damage is 1d8."),
  foe("yard-captain", "Yard Captain", "backstreets", 10, true, "execute", 2, 2, 28, 8, "Boss. A critical hit adds 4 damage after the dice are doubled."),
  foe("tide-cutter", "Tide Cutter", "black-docks", 15, false, "bleed", 2, 1, 22, 6, "A hit applies bleed 1. Damage is 1d6."),
  foe("crate-breaker", "Crate Breaker", "black-docks", 18, false, "stun", 1, 2, 26, 8, "A hit stuns the next main action. Damage is 1d8."),
  foe("signal-thief", "Signal Thief", "black-docks", 16, false, "strike", 3, 0, 18, 6, "Strikes with accuracy 3. Damage is 1d6."),
  foe("hull-guard", "Hull Guard", "black-docks", 20, false, "defend", 1, 3, 30, 6, "Defends. Defence 3 is still inside the combat cap."),
  foe("net-caster", "Net Caster", "black-docks", 22, false, "strike", 2, 1, 20, 6, "Strikes with accuracy 2 and defence 1."),
  foe("harbour-warden", "Harbour Warden", "black-docks", 28, true, "execute", 3, 2, 40, 8, "Boss. A critical hit adds 4 damage after the dice are doubled."),
  foe("choir-sentinel", "Choir Sentinel", "inner-sanctum", 35, false, "defend", 2, 4, 36, 8, "Defends. Defence 4 cannot exceed the combat cap of 8."),
  foe("vault-duelist", "Vault Duelist", "inner-sanctum", 36, false, "strike", 4, 2, 32, 8, "Strikes with accuracy 4. Damage is 1d8."),
  foe("relic-saboteur", "Relic Saboteur", "inner-sanctum", 38, false, "bleed", 3, 1, 30, 6, "A hit applies bleed 1. Damage is 1d6."),
  foe("sanctum-fixer", "Sanctum Fixer", "inner-sanctum", 40, false, "defend", 2, 2, 34, 6, "Defends, then the next strike uses defence 2."),
  foe("glass-gunner", "Glass Gunner", "inner-sanctum", 42, false, "stun", 4, 1, 28, 6, "A hit stuns the next main action. Damage is 1d6."),
  foe("sanctum-prior", "Sanctum Prior", "inner-sanctum", 45, true, "execute", 4, 3, 48, 12, "Boss. Two dice. A critical hit adds 4 damage after the dice are doubled."),
];

function table(regionSlug: string, difficulty: Difficulty, entries: readonly LootEntry[]): LootTableSeed {
  return {
    slug: `${regionSlug}-${difficulty}`,
    name: `${regionSlug} ${difficulty}`,
    regionSlug,
    difficulty,
    entries,
  };
}

const expeditionDrop = (templateSlug: string, weight = 1): LootEntry => ({ templateSlug, weight, source: "expedition" });
const bossDrop = (templateSlug: string): LootEntry => ({ templateSlug, weight: 1, source: "boss" });

export const LOOT_TABLES: readonly LootTableSeed[] = [
  table("backstreets", "routine", [expeditionDrop("field-knife"), expeditionDrop("maul"), expeditionDrop("bandage")]),
  table("backstreets", "standard", [expeditionDrop("alley-shiv"), expeditionDrop("street-jacket"), expeditionDrop("lucky-charm")]),
  table("backstreets", "severe", [bossDrop("service-baton"), expeditionDrop("hitman-arm-20")]),
  table("black-docks", "routine", [expeditionDrop("dock-hook"), expeditionDrop("dock-vest"), expeditionDrop("smoke-vial")]),
  table("black-docks", "standard", [expeditionDrop("antitoxin"), expeditionDrop("bruiser-coat-15"), expeditionDrop("dock-lens")]),
  table("black-docks", "severe", [bossDrop("bruiser-arm-20"), expeditionDrop("reinforced-coat")]),
  table("inner-sanctum", "routine", [expeditionDrop("sanctum-cane"), bossDrop("prior-signet")]),
  table("inner-sanctum", "standard", [expeditionDrop("sanctum-mail"), expeditionDrop("sanctum-seal"), expeditionDrop("duelist-arm-35")]),
  table("inner-sanctum", "severe", [bossDrop("prior-signet"), expeditionDrop("gunslinger-arm-35"), expeditionDrop("focus-band")]),
];

export interface Tier {
  minutes: number;
  cooldownMinutes: number;
  xp: number;
  marks: number;
  scale: number;
}

export const DIFFICULTY_TIERS: Record<Difficulty, Tier> = {
  routine: { minutes: 10, cooldownMinutes: 15, xp: 40, marks: 8, scale: 0 },
  standard: { minutes: 30, cooldownMinutes: 45, xp: 80, marks: 15, scale: 1 },
  severe: { minutes: 60, cooldownMinutes: 120, xp: 160, marks: 25, scale: 2 },
};

export function isDifficulty(value: string): value is Difficulty {
  return (DIFFICULTIES as readonly string[]).includes(value);
}

export function regionAccess(level: number, required: number): "allowed" | "level" {
  return level >= required ? "allowed" : "level";
}

export function slotDecision(activeCount: number): "allowed" | "busy" {
  return activeCount >= EXPEDITION_SLOT_LIMIT ? "busy" : "allowed";
}

export function cooldownDecision(now: Date, cooldownUntil: Date | null): "allowed" | "cooling" {
  if (cooldownUntil && cooldownUntil.getTime() > now.getTime()) {
    return "cooling";
  }
  return "allowed";
}

export function xpGrant(requested: number, spentToday: number): number {
  const room = Math.max(0, EXPEDITION_DAILY_XP - Math.max(0, Math.trunc(spentToday)));
  return Math.max(0, Math.min(Math.max(0, Math.trunc(requested)), room));
}

export function reservedModifiers(abilitySlugs: readonly string[]): { accuracy: number; defence: number; itemLimit: number } {
  let accuracy = 0;
  let defence = 0;
  let itemLimit = 0;
  for (const slug of abilitySlugs) {
    if (slug === "smoke") {
      accuracy += 1;
    }
    if (slug === "antitoxin") {
      defence += 1;
    }
    if (slug === "bandage" || slug === "patch") {
      itemLimit += 1;
    }
  }
  return { accuracy, defence, itemLimit };
}

export function expeditionHealth(endurance: number, healthGear: number): number {
  return 20 + diminishingBonus(endurance, 40) + Math.min(GEAR_HEALTH_CAP, Math.max(0, healthGear));
}

export function enemyForDifficulty(enemies: readonly EnemySeed[], regionSlug: string, difficulty: Difficulty): EnemySeed | null {
  const rows = enemies.filter((enemy) => enemy.regionSlug === regionSlug);
  const bosses = rows.filter((enemy) => enemy.boss).sort((left, right) => left.level - right.level);
  const regular = rows.filter((enemy) => !enemy.boss).sort((left, right) => left.level - right.level);
  if (difficulty === "severe") {
    return bosses[0] ?? regular[regular.length - 1] ?? null;
  }
  if (difficulty === "standard") {
    return regular[Math.min(2, Math.max(0, regular.length - 1))] ?? bosses[0] ?? null;
  }
  return regular[0] ?? null;
}

export function scaleEnemy(enemy: EnemySeed, scale: number): EnemySeed {
  return {
    ...enemy,
    defence: enemy.defence + scale,
    health: enemy.health + scale * 4,
  };
}

export function pickLoot(entries: readonly LootEntry[], roll: number): LootEntry | null {
  const usable = entries.filter((entry) => entry.weight > 0);
  const total = usable.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0 || !Number.isInteger(roll) || roll < 1 || roll > total) {
    return null;
  }
  let cursor = 0;
  for (const entry of usable) {
    cursor += entry.weight;
    if (roll <= cursor) {
      return entry;
    }
  }
  return null;
}

export function lootEligibility(input: { status: string; itemClass: string; classSlug: string; level: number; itemLevel: number }): "available" | "unavailable" {
  if (input.status !== "active") {
    return "unavailable";
  }
  if (input.itemClass && input.itemClass !== input.classSlug) {
    return "unavailable";
  }
  if (input.level < input.itemLevel) {
    return "unavailable";
  }
  return "available";
}

export function catalogCounts(): { regions: number; enemies: number; bosses: number; gear: number; lootTables: number } {
  return {
    regions: REGION_SEEDS.length,
    enemies: ENEMY_SEEDS.filter((enemy) => !enemy.boss).length,
    bosses: ENEMY_SEEDS.filter((enemy) => enemy.boss).length,
    gear: GEAR_SEEDS.length,
    lootTables: LOOT_TABLES.length,
  };
}

export function enemyFighter(enemy: EnemySeed): Fighter {
  const fighter = blankFighter("opponent", enemy.name);
  fighter.health = enemy.health;
  fighter.maxHealth = enemy.health;
  fighter.accuracyStat = enemy.accuracy;
  fighter.defenceStat = enemy.defence;
  fighter.diceCount = enemy.diceCount;
  fighter.diceSides = enemy.diceSides;
  fighter.reactionReady = false;
  return fighter;
}

function tacticFor(ability: EnemyAbility): "strike" | "defend" | "ability" {
  if (ability === "bleed") {
    return "ability";
  }
  if (ability === "defend") {
    return "defend";
  }
  return "strike";
}

export function resolveEncounter(member: Fighter, enemy: EnemySeed, packets: readonly RollPacket[]): { winner: string; log: string[] } {
  let state = freshBattle(member, enemyFighter(enemy));
  const tactic = tacticFor(enemy.ability);
  let used = 0;
  for (let step = 0; step < 16 && state.status === "active"; step += 1) {
    const acting = state.side;
    const action = acting === 0 ? "strike" : tactic;
    const needsRoll = action === "strike" || action === "ability";
    const packet = needsRoll ? packets[used] ?? null : null;
    const before = state.log.length;
    const outcome = resolveAction(state, needsRoll && !packet ? "defend" : action, packet);
    if ((outcome.result === "cooling" || outcome.result === "spent") && outcome.state === state) {
      state = resolveAction(state, "defend", null).state;
      continue;
    }
    state = outcome.state;
    if (needsRoll && packet) {
      used += 1;
    }
    if (acting !== 1 || state.status === "resolved") {
      continue;
    }
    const added = state.log.slice(before);
    const attack = added.find((line) => line.includes("rolls"));
    if (!attack || attack.includes("miss")) {
      continue;
    }
    if (enemy.ability === "stun") {
      const memberNow = state.fighters[0];
      const enemyNow = state.fighters[1];
      state = { ...state, fighters: [{ ...memberNow, effects: addEffect(memberNow.effects, { kind: "stun", magnitude: 1, remaining: 1 }) }, enemyNow], log: [...state.log, `${enemy.name} stuns the next main action.`] };
    }
    if (enemy.ability === "execute" && attack.includes("critical")) {
      const memberNow = state.fighters[0];
      const enemyNow = state.fighters[1];
      const health = Math.max(0, memberNow.health - 4);
      const log = [...state.log, `${enemy.name} executes for 4.`];
      state = health <= 0
        ? { ...state, fighters: [{ ...memberNow, health }, enemyNow], status: "resolved", winner: enemyNow.id, log: [...log, `${memberNow.name} is incapacitated.`] }
        : { ...state, fighters: [{ ...memberNow, health }, enemyNow], log };
    }
  }
  if (state.status === "active") {
    const memberHealth = state.fighters[0]?.health ?? 0;
    const enemyHealth = state.fighters[1]?.health ?? 0;
    state = { ...state, status: "resolved", winner: memberHealth >= enemyHealth ? "member" : "opponent" };
  }
  return { winner: state.winner, log: state.log };
}
