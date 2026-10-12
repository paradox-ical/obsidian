/** Character progression. Community chat does not grant these points. */

export const CHARACTER_LEVEL_CAP = 50;
export const POINTS_PER_LEVEL = 3;
export const RESPEC_MARKS = 5_000;
export const CLASS_CHANGE_MARKS = 15_000;
export const RESPEC_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
export const CLASS_CHANGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
export const INTRO_LEVEL_LIMIT = 10;
export const STAT_KNEE = 20;
export const HIT_TARGET = 10;
export const DEFAULT_XP_FACTOR = 100;
export const DEFAULT_SESSION_XP = 1_200;
export const DEFAULT_SESSIONS_PER_WEEK = 4;
export const REGULAR_PLAY_WEEKS = 26;

export const STATS = ["strength", "agility", "endurance", "focus"] as const;
export type StatName = (typeof STATS)[number];

export const STAT_CAPS = { strength: 8, agility: 6, endurance: 6, focus: 4 } as const;
export const GAMEPLAY_LOCKS = ["combat", "queue", "mission", "expedition"] as const;
export type GameplayLock = (typeof GAMEPLAY_LOCKS)[number];

export interface AbilitySeed {
  slug: string;
  name: string;
  kind: "passive" | "active";
  unlockLevel: number;
  cooldownTurns: number;
  target: string;
  formula: string;
}

export interface ClassSeed {
  slug: string;
  name: string;
  summary: string;
  base: Record<StatName, number>;
  abilities: readonly AbilitySeed[];
}

const passive = (slug: string, name: string, formula: string): AbilitySeed => ({ slug, name, kind: "passive", unlockLevel: 1, cooldownTurns: 0, target: "self", formula });
const active = (slug: string, name: string, unlockLevel: number, cooldownTurns: number, target: string, formula: string): AbilitySeed => ({ slug, name, kind: "active", unlockLevel, cooldownTurns, target, formula });

export const CLASS_SEEDS: readonly ClassSeed[] = [
  {
    slug: "hitman",
    name: "Hitman",
    summary: "Precision, a mark, and an execute. Solo damage does not depend on another class.",
    base: { strength: 1, agility: 3, endurance: 1, focus: 3 },
    abilities: [
      passive("focused-mark", "Focused Mark", "A marked target takes min(4, 1 + Focus bonus) extra damage on the next hit."),
      active("mark", "Mark", 1, 2, "one enemy", "The target is marked for 2 turns. A second mark replaces the first."),
      active("precision-shot", "Precision Shot", 1, 1, "one enemy", "Deal 1d8 plus the Agility bonus. Natural 1 misses and natural 20 doubles the dice only."),
      active("execute", "Execute", 10, 3, "one marked enemy", "If the target is marked, add min(6, 2 + Focus bonus) damage, then clear the mark."),
      active("vanish", "Vanish", 20, 4, "self", "Defence +2 for 1 turn. The bonus cannot exceed the defence cap."),
      active("steady-aim", "Steady Aim", 30, 3, "self", "The next attack gains accuracy +2, still inside the accuracy cap."),
      active("headshot", "Headshot", 50, 5, "one enemy", "Deal 2d8. A critical hit doubles the dice, not the passive."),
    ],
  },
  {
    slug: "bruiser",
    name: "Bruiser",
    summary: "Health, close combat, and defence breaking. Solo fights start with a guard and a slam.",
    base: { strength: 3, agility: 1, endurance: 3, focus: 1 },
    abilities: [
      passive("thick-hide", "Thick Hide", "Max health gains the Endurance bonus. Close attacks add min(4, Strength bonus)."),
      active("slam", "Slam", 1, 1, "one enemy", "Deal 1d6 plus the Strength bonus."),
      active("brace", "Brace", 1, 2, "self", "Defence +2 for 1 turn. Healing received this turn is capped at 8."),
      active("guard-break", "Guard Break", 10, 3, "one enemy", "The target's defence bonus is reduced by 2 for 1 turn and cannot fall below zero."),
      active("crush", "Crush", 20, 3, "one enemy", "Deal 1d8 plus Strength. If Brace is active, add 2."),
      active("second-wind", "Second Wind", 30, 4, "self", "Restore min(8, 4 + Endurance bonus) health. It cannot raise health above the cap."),
      active("wreck", "Wreck", 50, 5, "one enemy", "Deal 2d6. A critical hit doubles the dice only."),
    ],
  },
  {
    slug: "saboteur",
    name: "Saboteur",
    summary: "Traps, explosives, and disruption. The mine and the blast are enough for a solo fight.",
    base: { strength: 2, agility: 2, endurance: 1, focus: 3 },
    abilities: [
      passive("armed", "Armed", "At the end of the turn one planted mine becomes armed. Only one mine is live."),
      active("mine", "Mine", 1, 2, "one ground space", "Plant a mine. It deals 1d6 plus Focus bonus when armed and triggered."),
      active("flash", "Flash", 1, 2, "one enemy", "The target's next attack accuracy is reduced by 2 and cannot go below zero."),
      active("detonate", "Detonate", 10, 3, "the live mine", "The armed mine deals 2d6. A second detonate does nothing until a new mine is planted."),
      active("smoke", "Smoke", 20, 4, "self", "Defence +2 for 1 turn."),
      active("disrupt", "Disrupt", 30, 3, "one enemy", "The target's next ability cooldown increases by 1 turn."),
      active("overload", "Overload", 50, 5, "one enemy", "Deal 2d6 plus Focus bonus. Reactions from this hit are capped at one."),
    ],
  },
  {
    slug: "fixer",
    name: "Fixer",
    summary: "Stimulants, healing, and buffs. The stim also deals damage, so a Fixer can finish a fight alone.",
    base: { strength: 1, agility: 1, endurance: 3, focus: 3 },
    abilities: [
      passive("compound", "Compound", "A stim grants min(3, 1 + Focus bonus) damage on the next attack and does not stack."),
      active("stim", "Stim", 1, 1, "self", "The next attack deals 1d6 plus the Compound bonus."),
      active("patch", "Patch", 1, 2, "self", "Restore min(8, 4 + Endurance bonus) health, capped at max health."),
      active("overdrive", "Overdrive", 10, 3, "self", "Accuracy +2 on the next attack, inside the accuracy cap."),
      active("cleanse", "Cleanse", 20, 3, "self", "Remove one bleed or stun. It does not remove a defence bonus."),
      active("adrenaline", "Adrenaline", 30, 4, "self", "The next ability cooldown is reduced by 1 and cannot fall below 1."),
      active("field-dose", "Field Dose", 50, 5, "self", "Restore min(12, 6 + Endurance bonus) and grant Compound once."),
    ],
  },
  {
    slug: "duelist",
    name: "Duelist",
    summary: "Parry, counter, and risk. The opener and the riposte do not need a partner.",
    base: { strength: 3, agility: 3, endurance: 1, focus: 1 },
    abilities: [
      passive("riposte-ready", "Riposte Ready", "After a successful parry, the next counter adds min(4, 1 + Agility bonus) damage."),
      active("lunge", "Lunge", 1, 1, "one enemy", "Deal 1d8 plus the Agility bonus."),
      active("parry", "Parry", 1, 2, "self", "The next incoming hit is defended at +2. A miss readies Riposte Ready."),
      active("riposte", "Riposte", 10, 2, "the attacker", "If Riposte Ready is set, deal 1d8 plus its bonus, then clear it."),
      active("feint", "Feint", 20, 3, "one enemy", "The target's defence bonus is reduced by 2 for the next attack against them."),
      active("challenge", "Challenge", 30, 4, "one enemy", "That enemy's next attack must target you. Defence +1 for 1 turn."),
      active("all-in", "All In", 50, 5, "one enemy", "Deal 2d8. Your defence bonus is 0 until your next turn. A critical hit doubles the dice only."),
    ],
  },
  {
    slug: "gunslinger",
    name: "Gunslinger",
    summary: "Chained shots, ammunition, and bursts. Reload and fan-fire stand alone.",
    base: { strength: 1, agility: 4, endurance: 1, focus: 2 },
    abilities: [
      passive("chain-fire", "Chain Fire", "Each consecutive hit adds min(3, chain count) damage. A miss or reload resets the chain."),
      active("hipfire", "Hipfire", 1, 1, "one enemy", "Deal 1d6 plus the Agility bonus and advance the chain on a hit."),
      active("reload", "Reload", 1, 0, "self", "Set ammunition to 6 and reset the chain. This is the item action, not a second main attack."),
      active("fan", "Fan", 10, 3, "one enemy", "Spend up to 3 ammunition. Each shot is 1d4. The chain adds once per hit."),
      active("burst", "Burst", 20, 3, "one enemy", "Spend 2 ammunition and deal 2d4 plus the chain bonus."),
      active("trick-shot", "Trick Shot", 30, 4, "one enemy", "Accuracy +2. On a hit, the chain does not reset if the next attack misses."),
      active("empty-mag", "Empty Mag", 50, 5, "one enemy", "Spend all ammunition, at least 1. Deal 1d6 per shot, maximum 6. A critical hit doubles the dice only."),
    ],
  },
];

export function isStatName(value: string): value is StatName {
  return (STATS as readonly string[]).includes(value);
}

export function isGameplayLock(value: string): value is GameplayLock {
  return (GAMEPLAY_LOCKS as readonly string[]).includes(value);
}

export function earnedPoints(level: number): number {
  const gained = Math.min(Math.max(level, 1), CHARACTER_LEVEL_CAP) - 1;
  return gained * POINTS_PER_LEVEL;
}

export function pointLedger(input: { level: number; strength: number; agility: number; endurance: number; focus: number; unspent: number }): "conserved" | "broken" {
  const spent = input.strength + input.agility + input.endurance + input.focus;
  if (spent < 0 || input.unspent < 0) {
    return "broken";
  }
  return spent + input.unspent === earnedPoints(input.level) ? "conserved" : "broken";
}

export function xpForLevel(level: number, factor = DEFAULT_XP_FACTOR): number {
  if (level < 1 || level >= CHARACTER_LEVEL_CAP) {
    return 0;
  }
  return factor * level;
}

export function xpToReachCap(factor = DEFAULT_XP_FACTOR): number {
  let total = 0;
  for (let level = 1; level < CHARACTER_LEVEL_CAP; level += 1) {
    total += xpForLevel(level, factor);
  }
  return total;
}

export function applyCharacterXp(input: { level: number; xp: number; gain: number; factor?: number }): { level: number; xp: number; pointsGained: number } {
  const factor = input.factor ?? DEFAULT_XP_FACTOR;
  let level = Math.min(Math.max(input.level, 1), CHARACTER_LEVEL_CAP);
  let xp = Math.max(0, input.xp) + Math.max(0, Math.trunc(input.gain));
  let pointsGained = 0;
  while (level < CHARACTER_LEVEL_CAP) {
    const need = xpForLevel(level, factor);
    if (xp < need) {
      break;
    }
    xp -= need;
    level += 1;
    pointsGained += POINTS_PER_LEVEL;
  }
  return { level, xp, pointsGained };
}

export function diminishingBonus(total: number, cap: number): number {
  if (total <= 0 || cap <= 0) {
    return 0;
  }
  return Math.min(cap, Math.floor((cap * total) / (total + STAT_KNEE)));
}

export function statEffect(stat: StatName, base: number, allocated: number): { total: number; bonus: number; cap: number; formula: string } {
  const total = Math.max(0, base) + Math.max(0, allocated);
  const cap = STAT_CAPS[stat];
  const bonus = diminishingBonus(total, cap);
  const labels = {
    strength: "melee damage",
    agility: "accuracy",
    endurance: "defence",
    focus: "ability effect",
  };
  return {
    total,
    bonus,
    cap,
    formula: `${labels[stat]} bonus = min(${cap}, floor(${cap} × total / (total + ${STAT_KNEE}))), total = base ${base} + allocated ${allocated}.`,
  };
}

export function attackPreview(input: { roll: number; accuracy: number; defence: number }): "miss" | "hit" | "critical" {
  if (input.roll === 1) {
    return "miss";
  }
  if (input.roll === 20) {
    return "critical";
  }
  return input.roll + input.accuracy >= HIT_TARGET + input.defence ? "hit" : "miss";
}

export function cooldownReady(availableAt: Date | null, now: Date): boolean {
  return !availableAt || availableAt.getTime() <= now.getTime();
}

export function introResetDecision(input: { level: number; used: boolean; ranked: boolean; locked: boolean }): "allowed" | "level" | "used" | "ranked" | "locked" {
  if (input.locked) {
    return "locked";
  }
  if (input.used) {
    return "used";
  }
  if (input.ranked) {
    return "ranked";
  }
  if (input.level >= INTRO_LEVEL_LIMIT) {
    return "level";
  }
  return "allowed";
}

export function paidResetDecision(input: { locked: boolean; availableAt: Date | null; now: Date; balanceMarks: number; cost: number }): "allowed" | "locked" | "cooling" | "unaffordable" {
  if (input.locked) {
    return "locked";
  }
  if (!cooldownReady(input.availableAt, input.now)) {
    return "cooling";
  }
  if (input.balanceMarks < input.cost) {
    return "unaffordable";
  }
  return "allowed";
}

export function gearAfterClassChange<T extends { id: string; classSlug: string; equipped: boolean }>(items: readonly T[], nextClass: string): Array<T & { equipped: boolean }> {
  return items.map((item) => ({ ...item, equipped: item.equipped && (item.classSlug === "" || item.classSlug === nextClass) }));
}

export function starterRewardKey(guildId: string, userId: string, classSlug: string): string {
  return `character-starter:${guildId}:${userId}:${classSlug}`;
}

export function milestoneRewardKey(guildId: string, userId: string, classSlug: string, abilitySlug: string): string {
  return `character-milestone:${guildId}:${userId}:${classSlug}:${abilitySlug}`;
}

export function simulateRegularPlay(input?: { factor?: number; sessionXp?: number; sessionsPerWeek?: number; weeks?: number }) {
  const factor = input?.factor ?? DEFAULT_XP_FACTOR;
  const sessionXp = input?.sessionXp ?? DEFAULT_SESSION_XP;
  const sessionsPerWeek = input?.sessionsPerWeek ?? DEFAULT_SESSIONS_PER_WEEK;
  const weeks = input?.weeks ?? REGULAR_PLAY_WEEKS;
  let level = 1;
  let xp = 0;
  const sessions = sessionsPerWeek * weeks;
  for (let session = 0; session < sessions; session += 1) {
    const next = applyCharacterXp({ level, xp, gain: sessionXp, factor });
    level = next.level;
    xp = next.xp;
  }
  return {
    level,
    xp,
    sessions,
    sessionXp,
    sessionsPerWeek,
    weeks,
    requiredXp: xpToReachCap(factor),
    pointsAtCap: earnedPoints(CHARACTER_LEVEL_CAP),
    assumptions: [
      "A regular week is four selected-contract sessions. Community chat awards no character XP.",
      "Each session awards 1,200 character XP.",
      "The XP to leave level L is 100 times L. Reaching level 50 from level 1 costs 122,500 XP.",
      "One hundred and four sessions provide 124,800 XP, so level 50 lands inside six months.",
      "Marks stay on the separate 7,987 routine simulation and are not added to this curve.",
    ],
  };
}
