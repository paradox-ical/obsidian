/** Interactive missions, crew missions, and recovery. Queues, trades, and crafting stay out. */

import { simulateRegularPlay } from "./characters.js";
import { strikeDamage } from "./combat.js";
import { routineMonthlyMarks } from "./economy.js";
import { scaleEnemy, type EnemySeed } from "./world.js";
import type { RollPacket } from "./combat.js";

export const RECOVERY_MINUTES = 30;
export const RECOVERY_MINIMUM_MINUTES = 10;
export const MEDKIT_SHORTEN_MINUTES = 15;
export const CREW_SIZE_MIN = 2;
export const CREW_SIZE_MAX = 5;
export const LIVE_TURN_MINUTES = 2;
export const ASYNC_TURN_MINUTES = 30;
export const ABANDON_MINUTES = 360;
export const MISS_LIMIT = 2;
export const REVIVE_LIMIT = 1;
export const SOLO_XP = 60;
export const SOLO_MARKS = 12;
export const CREW_XP = 40;
export const CREW_MARKS = 10;

export const CREW_ENTRY_RULES = "Two to five members. Each member must meet the region level. Two missed turns exclude that member from completion loot and Marks. One revive per member. Failure drops unbanked loot and starts recovery. Owned gear and the wallet stay. No energy, hunger, thirst, or durability.";

export type MissionWait = "choice" | "check" | "combat" | "done";
export type MissionStatus = "active" | "won" | "retreated" | "failed";
export type CrewMode = "live" | "async";

export interface MissionOption {
  id: string;
  label: string;
  next: string;
}

export type MissionNode =
  | { id: string; kind: "choice"; text: string; options: readonly MissionOption[] }
  | { id: string; kind: "check"; text: string; stat: "agility" | "focus"; target: number; success: string; failure: string }
  | { id: string; kind: "combat"; text: string; enemySlug: string; win: string; loss: string }
  | { id: string; kind: "discovery"; text: string; lootSlug?: string; next: string }
  | { id: string; kind: "loot"; text: string; lootSlug: string; next: string }
  | { id: string; kind: "retreat"; text: string }
  | { id: string; kind: "fail"; text: string }
  | { id: string; kind: "end"; text: string };

export interface MissionSeed {
  slug: string;
  name: string;
  regionSlug: string;
  summary: string;
  nodes: readonly MissionNode[];
}

const yard: MissionNode[] = [
  {
    id: "gate",
    kind: "choice",
    text: "The yard is open. The painted mark is flavour and does not change the level gate.",
    options: [
      { id: "alley", label: "Take the alley", next: "listen" },
      { id: "roof", label: "Climb toward the loft", next: "loft" },
      { id: "leave", label: "Retreat", next: "retreat" },
    ],
  },
  { id: "listen", kind: "check", text: "Listen for the runner. A D20 plus the agility bonus is checked against 12.", stat: "agility", target: 12, success: "cache", failure: "runner" },
  { id: "cache", kind: "loot", text: "A bandage is here. It stays unbanked until the job ends.", lootSlug: "bandage", next: "press" },
  {
    id: "press",
    kind: "choice",
    text: "The cache is banked only if you finish.",
    options: [
      { id: "captain", label: "Press the captain", next: "captain" },
      { id: "leave", label: "Retreat", next: "retreat" },
    ],
  },
  { id: "runner", kind: "combat", text: "The runner catches you. The shared combat rules resolve the fight.", enemySlug: "alley-runner", win: "cache", loss: "fail" },
  { id: "loft", kind: "discovery", text: "The signal loft was hidden. The clue names the captain and does not raise the level gate.", lootSlug: "maul", next: "captain" },
  { id: "captain", kind: "combat", text: "The yard captain fights with the execute rule.", enemySlug: "yard-captain", win: "end", loss: "fail" },
  { id: "retreat", kind: "retreat", text: "You leave. Unbanked loot is dropped. Recovery does not start." },
  { id: "fail", kind: "fail", text: "You are down. Unbanked loot is dropped. Owned gear stays. Recovery starts." },
  { id: "end", kind: "end", text: "The yard is clear. Eligible loot banks now." },
];

const dock: MissionNode[] = [
  {
    id: "gate",
    kind: "choice",
    text: "The dock watch is open to level 15. The tide mark is flavour.",
    options: [
      { id: "hold", label: "Hold the pier", next: "end" },
      { id: "leave", label: "Retreat", next: "retreat" },
    ],
  },
  { id: "retreat", kind: "retreat", text: "You leave the dock. Nothing was banked." },
  { id: "end", kind: "end", text: "The pier is held." },
];

export const MISSION_SEEDS: readonly MissionSeed[] = [
  { slug: "yard-run", name: "Yard Run", regionSlug: "backstreets", summary: "Choices, a D20 check, a hidden loft, a retreat, and the yard captain.", nodes: yard },
  { slug: "dock-signal", name: "Dock Signal", regionSlug: "black-docks", summary: "A level 15 dock job. The signal is flavour, not a second gate.", nodes: dock },
];

export function missionBySlug(slug: string): MissionSeed | null {
  return MISSION_SEEDS.find((mission) => mission.slug === slug) ?? null;
}

export function missionNode(mission: MissionSeed, nodeId: string): MissionNode | null {
  return mission.nodes.find((node) => node.id === nodeId) ?? null;
}

export function crewSizeDecision(count: number): "allowed" | "short" | "full" {
  if (count < CREW_SIZE_MIN) {
    return "short";
  }
  if (count > CREW_SIZE_MAX) {
    return "full";
  }
  return "allowed";
}

export function turnMinutes(mode: CrewMode): number {
  return mode === "live" ? LIVE_TURN_MINUTES : ASYNC_TURN_MINUTES;
}

export function participation(misses: number): "eligible" | "excluded" {
  return misses >= MISS_LIMIT ? "excluded" : "eligible";
}

export function scaleForParty(enemy: EnemySeed, partySize: number, difficultyScale: number): EnemySeed {
  return scaleEnemy(enemy, difficultyScale + Math.max(0, partySize - 1));
}

export function judgeCheck(roll: number, bonus: number, target: number): "success" | "failure" {
  if (roll === 1) {
    return "failure";
  }
  return roll + Math.max(0, bonus) >= target ? "success" : "failure";
}

export function recoveryDeadline(now: Date): Date {
  return new Date(now.getTime() + RECOVERY_MINUTES * 60 * 1000);
}

export function applyMedkit(now: Date, until: Date, used: boolean): { result: "shortened" | "used" | "idle" | "minimum"; until: Date } {
  if (until.getTime() <= now.getTime()) {
    return { result: "idle", until };
  }
  if (used) {
    return { result: "used", until };
  }
  const minimum = now.getTime() + RECOVERY_MINIMUM_MINUTES * 60 * 1000;
  if (until.getTime() <= minimum) {
    return { result: "minimum", until };
  }
  const shortened = until.getTime() - MEDKIT_SHORTEN_MINUTES * 60 * 1000;
  return { result: "shortened", until: new Date(Math.min(until.getTime(), Math.max(minimum, shortened))) };
}

export interface MissionPosition {
  nodeId: string;
  status: MissionStatus;
  waiting: MissionWait;
  unbanked: string[];
  log: string[];
}

export function openPosition(): MissionPosition {
  return { nodeId: "gate", status: "active", waiting: "choice", unbanked: [], log: [] };
}

export function chooseNext(mission: MissionSeed, nodeId: string, choiceId: string): string | null {
  const node = missionNode(mission, nodeId);
  if (!node || node.kind !== "choice") {
    return null;
  }
  return node.options.find((option) => option.id === choiceId)?.next ?? null;
}

export function checkNext(mission: MissionSeed, nodeId: string, roll: number, bonus: number): { next: string; result: "success" | "failure" } | null {
  const node = missionNode(mission, nodeId);
  if (!node || node.kind !== "check") {
    return null;
  }
  const result = judgeCheck(roll, bonus, node.target);
  return { next: result === "success" ? node.success : node.failure, result };
}

export function combatNext(mission: MissionSeed, nodeId: string, winner: string): string | null {
  const node = missionNode(mission, nodeId);
  if (!node || node.kind !== "combat") {
    return null;
  }
  return winner === "member" ? node.win : node.loss;
}

export function settleNode(mission: MissionSeed, nodeId: string, unbanked: readonly string[], log: readonly string[]): MissionPosition {
  const seen = new Set<string>();
  let current = nodeId;
  const bag = [...unbanked];
  const lines = [...log];
  while (!seen.has(current)) {
    seen.add(current);
    const node = missionNode(mission, current);
    if (!node) {
      return { nodeId: current, status: "failed", waiting: "done", unbanked: bag, log: [...lines, "The mission node is missing."] };
    }
    lines.push(node.text);
    if (node.kind === "choice") {
      return { nodeId: current, status: "active", waiting: "choice", unbanked: bag, log: lines };
    }
    if (node.kind === "check") {
      return { nodeId: current, status: "active", waiting: "check", unbanked: bag, log: lines };
    }
    if (node.kind === "combat") {
      return { nodeId: current, status: "active", waiting: "combat", unbanked: bag, log: lines };
    }
    if (node.kind === "loot") {
      bag.push(node.lootSlug);
      current = node.next;
      continue;
    }
    if (node.kind === "discovery") {
      if (node.lootSlug) {
        bag.push(node.lootSlug);
      }
      current = node.next;
      continue;
    }
    if (node.kind === "retreat") {
      return { nodeId: current, status: "retreated", waiting: "done", unbanked: bag, log: lines };
    }
    if (node.kind === "fail") {
      return { nodeId: current, status: "failed", waiting: "done", unbanked: bag, log: lines };
    }
    return { nodeId: current, status: "won", waiting: "done", unbanked: bag, log: lines };
  }
  return { nodeId: current, status: "failed", waiting: "done", unbanked: bag, log: [...lines, "The mission looped."] };
}

export function crewStrike(enemyHealth: number, defence: number, packet: RollPacket, accuracy: number): { health: number; damage: number; outcome: string } {
  const hit = strikeDamage({ roll: packet.attack, accuracy, defence, dice: packet.damage, critMultiplier: 2, flat: 0, reaction: false });
  return { health: Math.max(0, enemyHealth - hit.damage), damage: hit.damage, outcome: hit.outcome };
}

export function simulateMissionRewards() {
  const sessionsPerWeek = 4;
  const weeks = 26;
  const sessionXp = SOLO_XP + CREW_XP;
  const sessions = sessionsPerWeek * weeks;
  const missionPlay = simulateRegularPlay({ sessionXp, sessionsPerWeek, weeks });
  const combined = simulateRegularPlay({ sessionXp: 1_200 + sessionXp, sessionsPerWeek, weeks });
  const marksPerWeek = (SOLO_MARKS + CREW_MARKS) * sessionsPerWeek;
  const missionMarksMonth = Math.round((marksPerWeek * (365.25 / 7)) / 12);
  const routineMarks = routineMonthlyMarks().routineMarks;
  return {
    sessions,
    sessionXp,
    missionLevel: missionPlay.level,
    missionXp: missionPlay.xp,
    combinedLevel: combined.level,
    combinedXp: combined.xp,
    requiredXp: missionPlay.requiredXp,
    missionMarksMonth,
    routineMarks,
    fullMonthRoom: Math.max(0, routineMarks - routineMarks),
    assumptions: [
      "A mission week is four sessions. Each session is one won solo mission and one eligible crew mission.",
      "Solo completion is 60 character XP and 12 Marks. An eligible crew completion is 40 XP and 10 Marks.",
      "Those Marks use the shared routine budget. They are not added on top of a month that already reached 7,987.",
      "Mission XP alone stays below the 122,500 needed for level 50. The existing 1,200 XP contract session plus these rewards still reaches level 50 inside 26 weeks.",
      "There is no energy, hunger, thirst, or durability cost in the session.",
    ],
  };
}
