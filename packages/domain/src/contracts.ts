/** Contracts. Exploration, defeat, crafting, and ranked PvP objectives are live. */

import { ROUTINE_DAILY_MARKS, ROUTINE_MONTHLY_MILESTONE, ROUTINE_WEEKLY_MARKS } from "./economy.js";
import { DEFAULT_TIMEZONE } from "./foundation.js";
import { contentHash } from "./progression.js";
import { sha256 } from "./secrets.js";

export const CONTRACT_BOARDS = ["daily", "weekly", "monthly"] as const;
export type ContractBoard = (typeof CONTRACT_BOARDS)[number];

export const OBJECTIVE_KINDS = [
  "chat_messages",
  "voice_minutes",
  "event_attendance",
  "crew_session",
  "riddle",
  "manual",
  "rpg_exploration",
  "rpg_pve",
  "rpg_crafting",
  "rpg_pvp",
] as const;
export type ObjectiveKind = (typeof OBJECTIVE_KINDS)[number];

const UNBUILT_KINDS = new Set<string>([]);

export const CONTRACT_CAPS = {
  daily: ROUTINE_DAILY_MARKS,
  weekly: ROUTINE_WEEKLY_MARKS,
  monthly: ROUTINE_MONTHLY_MILESTONE,
} as const;

export interface ObjectiveSeed {
  slug: string;
  kind: ObjectiveKind;
  title: string;
  prompt: string;
  band: "easy" | "medium" | "hard";
  target: number;
  rewardMarks: number;
  answer: string;
  dailyPool: boolean;
  weeklyPool: boolean;
  monthlyPool: boolean;
}

export const CONTRACT_SEEDS: readonly ObjectiveSeed[] = [
  { slug: "chat-five", kind: "chat_messages", title: "Join the conversation", prompt: "Send five useful messages in an eligible channel.", band: "easy", target: 5, rewardMarks: 15, answer: "", dailyPool: true, weeklyPool: false, monthlyPool: false },
  { slug: "voice-twenty", kind: "voice_minutes", title: "Stay in voice", prompt: "Spend twenty minutes in voice with other members.", band: "easy", target: 20, rewardMarks: 20, answer: "", dailyPool: true, weeklyPool: false, monthlyPool: false },
  { slug: "attend-event", kind: "event_attendance", title: "Attend an official event", prompt: "Check in and have attendance verified at one official event.", band: "medium", target: 1, rewardMarks: 25, answer: "", dailyPool: true, weeklyPool: false, monthlyPool: false },
  { slug: "crew-session", kind: "crew_session", title: "Finish a crew session", prompt: "Be marked present for one crew or LFG session.", band: "medium", target: 1, rewardMarks: 25, answer: "", dailyPool: true, weeklyPool: false, monthlyPool: false },
  { slug: "daily-riddle", kind: "riddle", title: "Answer the daily riddle", prompt: "What has hands but cannot clap?", band: "medium", target: 1, rewardMarks: 20, answer: "a clock", dailyPool: true, weeklyPool: false, monthlyPool: false },
  { slug: "voice-hour", kind: "voice_minutes", title: "Hold a voice hour", prompt: "Spend sixty minutes in voice with other members.", band: "hard", target: 60, rewardMarks: 40, answer: "", dailyPool: true, weeklyPool: false, monthlyPool: false },
  { slug: "weekly-chat", kind: "chat_messages", title: "Weekly conversation", prompt: "Send twenty-five useful messages this week.", band: "easy", target: 25, rewardMarks: 100, answer: "", dailyPool: false, weeklyPool: true, monthlyPool: false },
  { slug: "weekly-voice", kind: "voice_minutes", title: "Weekly voice", prompt: "Spend one hundred and twenty minutes in voice this week.", band: "medium", target: 120, rewardMarks: 100, answer: "", dailyPool: false, weeklyPool: true, monthlyPool: false },
  { slug: "weekly-events", kind: "event_attendance", title: "Weekly events", prompt: "Have attendance verified at two official events this week.", band: "medium", target: 2, rewardMarks: 50, answer: "", dailyPool: false, weeklyPool: true, monthlyPool: false },
  { slug: "monthly-crew", kind: "crew_session", title: "Monthly crew", prompt: "Finish four crew sessions this month.", band: "medium", target: 4, rewardMarks: 200, answer: "", dailyPool: false, weeklyPool: false, monthlyPool: true },
  { slug: "monthly-voice", kind: "voice_minutes", title: "Monthly voice", prompt: "Spend four hundred minutes in voice this month.", band: "hard", target: 400, rewardMarks: 200, answer: "", dailyPool: false, weeklyPool: false, monthlyPool: true },
  { slug: "monthly-events", kind: "event_attendance", title: "Monthly events", prompt: "Have attendance verified at four official events this month.", band: "medium", target: 4, rewardMarks: 100, answer: "", dailyPool: false, weeklyPool: false, monthlyPool: true },
  { slug: "rpg-exploration", kind: "rpg_exploration", title: "Complete an expedition", prompt: "Finish one expedition or mission. The report is stored with the run.", band: "hard", target: 1, rewardMarks: 0, answer: "", dailyPool: false, weeklyPool: false, monthlyPool: false },
  { slug: "rpg-pve", kind: "rpg_pve", title: "Defeat an expedition enemy", prompt: "Win one expedition, mission, or eligible crew fight.", band: "hard", target: 1, rewardMarks: 0, answer: "", dailyPool: false, weeklyPool: false, monthlyPool: false },
  { slug: "rpg-crafting", kind: "rpg_crafting", title: "Craft an item", prompt: "Craft one item from a published recipe. The result is specified before the materials are spent.", band: "hard", target: 1, rewardMarks: 0, answer: "", dailyPool: false, weeklyPool: false, monthlyPool: false },
  { slug: "rpg-pvp", kind: "rpg_pvp", title: "Win a ranked match", prompt: "Win one reward-eligible ranked match. A repeated pair that has become casual does not count.", band: "hard", target: 1, rewardMarks: 0, answer: "", dailyPool: false, weeklyPool: false, monthlyPool: false },
];

export function isContractBoard(value: string): value is ContractBoard {
  return (CONTRACT_BOARDS as readonly string[]).includes(value);
}

export function isObjectiveKind(value: string): value is ObjectiveKind {
  return (OBJECTIVE_KINDS as readonly string[]).includes(value);
}

export function objectiveAvailability(kind: string): "ready" | "module_not_built" {
  if (UNBUILT_KINDS.has(kind)) {
    return "module_not_built";
  }
  return isObjectiveKind(kind) ? "ready" : "module_not_built";
}

export function answerHash(answer: string): string {
  return contentHash(answer);
}

export function answerMatches(answer: string, hash: string): boolean {
  return hash.length > 0 && answerHash(answer) === hash;
}

export function contractRewardKey(guildId: string, userId: string, definitionId: string, cycleId: string): string {
  return `contract:${guildId}:${userId}:${definitionId}:${cycleId}`;
}

export function cycleId(now: Date, board: ContractBoard, timeZone = DEFAULT_TIMEZONE): string {
  const parts = zonedParts(now, timeZone);
  if (board === "daily") {
    return `daily:${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
  }
  if (board === "monthly") {
    return `monthly:${pad(parts.year, 4)}-${pad(parts.month)}`;
  }
  const week = isoWeek(parts.year, parts.month, parts.day);
  return `weekly:${pad(week.weekYear, 4)}-W${pad(week.week)}`;
}

export function cycleDeadline(cycle: string, timeZone = DEFAULT_TIMEZONE): Date {
  const daily = /^daily:(\d{4})-(\d{2})-(\d{2})$/.exec(cycle);
  if (daily) {
    const next = addDays(Number(daily[1]), Number(daily[2]), Number(daily[3]), 1);
    return utcFromZoned(next.year, next.month, next.day, 0, 0, timeZone);
  }
  const weekly = /^weekly:(\d{4})-W(\d{2})$/.exec(cycle);
  if (weekly) {
    const next = mondayOfIsoWeek(Number(weekly[1]), Number(weekly[2]) + 1);
    return utcFromZoned(next.year, next.month, next.day, 0, 0, timeZone);
  }
  const monthly = /^monthly:(\d{4})-(\d{2})$/.exec(cycle);
  if (monthly) {
    const month = Number(monthly[2]);
    const year = Number(monthly[1]);
    const next = month === 12 ? { year: year + 1, month: 1, day: 1 } : { year, month: month + 1, day: 1 };
    return utcFromZoned(next.year, next.month, next.day, 0, 0, timeZone);
  }
  return new Date(0);
}

export function rerollDecision(input: { board: string; progress: number; rerollsUsed: number }): "allowed" | "started" | "used" | "wrong_board" {
  if (input.board !== "daily") {
    return "wrong_board";
  }
  if (input.rerollsUsed >= 1) {
    return "used";
  }
  if (input.progress !== 0) {
    return "started";
  }
  return "allowed";
}

export function cappedPayout(reward: number, spent: number, cap: number): { payable: number; reduced: boolean; capped: boolean } {
  const room = Math.max(0, Math.trunc(cap) - Math.max(0, Math.trunc(spent)));
  const payable = Math.max(0, Math.min(Math.max(0, Math.trunc(reward)), room));
  return { payable, reduced: payable > 0 && payable < reward, capped: payable === 0 && reward > 0 };
}

export function versionApplies(policy: "preserve" | "migrate", progress: number): "keep" | "migrate" {
  if (policy === "migrate" && progress === 0) {
    return "migrate";
  }
  return "keep";
}

export function evaluateObjective(input: { kind: string; progress: number; target: number; delta: number }):
  | { result: "module_not_built" }
  | { result: "progress"; progress: number; complete: boolean } {
  if (objectiveAvailability(input.kind) !== "ready") {
    return { result: "module_not_built" };
  }
  const progress = Math.min(input.target, input.progress + Math.max(0, Math.trunc(input.delta)));
  return { result: "progress", progress, complete: progress >= input.target && input.progress < input.target };
}

export function pickObjectives<T extends { id: string; band: string }>(candidates: readonly T[], count: number, salt: string, exclude: readonly string[] = []): T[] {
  const blocked = new Set(exclude);
  const pool = candidates.filter((row) => !blocked.has(row.id));
  const chosen: T[] = [];
  for (const band of ["easy", "medium", "hard"]) {
    if (chosen.length >= count) {
      break;
    }
    const next = [...pool].filter((row) => row.band === band && !chosen.includes(row)).sort((left, right) => rank(salt, left.id).localeCompare(rank(salt, right.id)))[0];
    if (next) {
      chosen.push(next);
    }
  }
  const rest = pool.filter((row) => !chosen.includes(row)).sort((left, right) => rank(salt, left.id).localeCompare(rank(salt, right.id)));
  for (const row of rest) {
    if (chosen.length >= count) {
      break;
    }
    chosen.push(row);
  }
  return chosen;
}

export function refreshDelivery(input: { enabled: boolean; delivery: "dm" | "channel" }): "dm" | "channel" | "skip" {
  if (!input.enabled) {
    return "skip";
  }
  return input.delivery === "channel" ? "channel" : "dm";
}

export function closedDmPlan(delivery: "dm" | "channel"): "fail_private" | "channel" {
  return delivery === "channel" ? "channel" : "fail_private";
}

export function completionDelivery(pings: boolean): "mention" | "skip" {
  return pings ? "mention" : "skip";
}

/** Completion pings choose the mention. They never decide whether the reward posts. */
export function completionReward(pings: boolean): "pay" {
  void pings;
  return "pay";
}

function rank(salt: string, id: string): string {
  return sha256(`${salt}:${id}`);
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

function zonedParts(now: Date, timeZone: string) {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now);
  const map = Object.fromEntries(formatted.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  let hour = Number(map["hour"]);
  if (hour === 24) {
    hour = 0;
  }
  return { year: Number(map["year"]), month: Number(map["month"]), day: Number(map["day"]), hour, minute: Number(map["minute"]) };
}

function utcFromZoned(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  let utc = Date.UTC(year, month - 1, day, hour, minute);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const parts = zonedParts(new Date(utc), timeZone);
    const delta = Date.UTC(year, month - 1, day, hour, minute) - Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    if (delta === 0) {
      break;
    }
    utc += delta;
  }
  return new Date(utc);
}

function addDays(year: number, month: number, day: number, days: number) {
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function isoWeek(year: number, month: number, day: number): { weekYear: number; week: number } {
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const weekYear = date.getUTCFullYear();
  const start = new Date(Date.UTC(weekYear, 0, 1));
  const week = Math.ceil(((date.getTime() - start.getTime()) / 86_400_000 + 1) / 7);
  return { weekYear, week };
}

function mondayOfIsoWeek(weekYear: number, week: number) {
  const jan4 = new Date(Date.UTC(weekYear, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1) + (week - 1) * 7);
  return { year: monday.getUTCFullYear(), month: monday.getUTCMonth() + 1, day: monday.getUTCDate() };
}
