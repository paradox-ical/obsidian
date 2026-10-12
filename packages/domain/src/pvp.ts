import type { StatName } from "./characters.js";

export const STARTING_RATING = 1000;
export const RATING_K = 32;
export const RATING_SCALE = 400;
export const PAIR_LIMIT = 2;
export const QUEUE_TOLERANCE = 100;
export const QUEUE_TOLERANCE_STEP = 50;
export const QUEUE_TOLERANCE_CAP = 400;
export const RANKED_STAT_BUDGET = 12;
export const RANKED_GEAR_BUDGET = 8;
export const RANKED_ABILITY_LEVEL = 10;
export const DISCONNECT_GRACE_MINUTES = 2;
export const FORFEIT_MISSES = 2;
export const RANKED_REWARD_MARKS = 8;
export const RANKED_REWARD_XP = 20;
export const WAGER_MAX = 1000;

export const PVP_RULES = [
  "Casual uses the character's level, stats, and gear. Ranked keeps the class bases and gives every player the same 12-point allocation budget.",
  "Ranked gear is kept until its affix power fits inside 8. Abilities above level 10 are closed. Health resets every match.",
  "The first two ranked matches against the same opponent on a Perth day change rating and can pay a budgeted reward. A later request is casual before it can be accepted.",
  "Stakes are equal Marks, including zero. The queue only pairs the same stake. Both stakes are escrowed together. The winner takes the pot. A draw or a system cancellation refunds both. A forfeit loses the stake.",
  "Wagers do not mint Marks. Ingots are not staked. A disconnect has a 2-minute grace, then forfeits. Two missed turns forfeit after an automatic defend.",
  "Three wagered matches in a row with alternating winners are sent for review. The review does not reverse the pot or the rating.",
].join(" ");

const STATS = ["strength", "agility", "endurance", "focus"] as const;

export function isPvpMode(value: string): value is "casual" | "ranked" {
  return value === "casual" || value === "ranked";
}

export function stakeDecision(stake: number): "allowed" | "invalid" {
  if (!Number.isInteger(stake) || stake < 0 || stake > WAGER_MAX) {
    return "invalid";
  }
  return "allowed";
}

export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / RATING_SCALE));
}

export function ratingDelta(rating: number, opponent: number, score: 0 | 0.5 | 1): number {
  return Math.round(RATING_K * (score - expectedScore(rating, opponent)));
}

export function pairDecision(priorRankedToday: number): "ranked" | "casual" {
  return priorRankedToday >= PAIR_LIMIT ? "casual" : "ranked";
}

export function queueTolerance(waitMinutes: number): number {
  const steps = Math.max(0, Math.floor(waitMinutes));
  return Math.min(QUEUE_TOLERANCE_CAP, QUEUE_TOLERANCE + steps * QUEUE_TOLERANCE_STEP);
}

export function stakesMatch(left: number, right: number): boolean {
  return left === right;
}

export function rankedAllocation(stats: Record<StatName, number>, budget = RANKED_STAT_BUDGET): Record<StatName, number> {
  const totals = STATS.map((stat) => Math.max(0, Math.trunc(stats[stat])));
  const sum = totals.reduce((total, value) => total + value, 0);
  if (sum <= budget) {
    return { strength: totals[0] ?? 0, agility: totals[1] ?? 0, endurance: totals[2] ?? 0, focus: totals[3] ?? 0 };
  }
  const raw = totals.map((value) => (value * budget) / sum);
  const floors = raw.map((value) => Math.floor(value));
  let left = budget - floors.reduce((total, value) => total + value, 0);
  const order = raw.map((value, index) => ({ index, fraction: value - (floors[index] ?? 0) })).sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (const entry of order) {
    if (left <= 0) {
      break;
    }
    floors[entry.index] = (floors[entry.index] ?? 0) + 1;
    left -= 1;
  }
  return { strength: floors[0] ?? 0, agility: floors[1] ?? 0, endurance: floors[2] ?? 0, focus: floors[3] ?? 0 };
}

export function disconnectDue(disconnectedAt: Date | null, now: Date, graceMinutes = DISCONNECT_GRACE_MINUTES): boolean {
  return disconnectedAt !== null && disconnectedAt.getTime() + graceMinutes * 60 * 1000 <= now.getTime();
}

export function forfeitAfterMisses(misses: number): boolean {
  return misses >= FORFEIT_MISSES;
}

export function suspiciousPattern(winners: readonly string[], stakes: readonly number[]): boolean {
  const wagered = winners.filter((winner, index) => winner !== "" && (stakes[index] ?? 0) > 0);
  const recent = wagered.slice(-3);
  return recent.length === 3 && recent[0] !== recent[1] && recent[1] !== recent[2] && recent[0] === recent[2];
}

export function pairKey(leftUserId: string, rightUserId: string): string {
  return [leftUserId, rightUserId].sort().join(":");
}
