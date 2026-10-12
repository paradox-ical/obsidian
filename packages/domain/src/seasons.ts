import { DEFAULT_TIMEZONE } from "./foundation.js";

export const SEASON_MONTHS = 3;
export const VOICE_EMPTY_MS = 6 * 60 * 60 * 1000;
export const TEXT_IDLE_MS = 24 * 60 * 60 * 1000;
export const ROOM_HAS_MAX_LIFETIME = false;
export const SUGGESTIONS_EXCLUDED = true;

export const LEADERBOARD_CATEGORIES = [
  "community_xp",
  "marks",
  "ingots",
  "seasonal_seals",
  "lifetime_seals",
  "pvp",
  "contracts",
  "recruitment",
  "estimated_wealth",
] as const;

export type LeaderboardCategory = (typeof LEADERBOARD_CATEGORIES)[number];
export type RoomKind = "voice" | "text";
export type RoomPrivacy = "public" | "private";

const AVAILABLE_BOARDS = new Set<LeaderboardCategory>(["community_xp", "seasonal_seals", "lifetime_seals", "recruitment", "marks", "ingots", "estimated_wealth", "pvp"]);
const RESERVED_WALLETS = ["treasury", "bot", "system"];

export interface SeasonSettingsInput {
  label: string;
  startMonth: number;
  timezone: string;
  awardMarks: number;
  memberRoomCap: number;
  serverRoomCap: number;
  roomCooldownMinutes: number;
  systemUserIds: string[];
  voiceCategoryId: string | null;
  textCategoryId: string | null;
}

export interface Standing {
  userId: string;
  score: number;
}

export function exampleSeasonSettings(): SeasonSettingsInput {
  return {
    label: "example",
    startMonth: 1,
    timezone: DEFAULT_TIMEZONE,
    awardMarks: 100,
    memberRoomCap: 1,
    serverRoomCap: 5,
    roomCooldownMinutes: 10,
    systemUserIds: [...RESERVED_WALLETS],
    voiceCategoryId: null,
    textCategoryId: null,
  };
}

export function prepareSeasonSettings(input: SeasonSettingsInput): SeasonSettingsInput {
  const requested = input.timezone.trim() || DEFAULT_TIMEZONE;
  let timezone = requested;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: requested }).format(new Date());
  } catch {
    timezone = DEFAULT_TIMEZONE;
  }
  return {
    label: input.label.trim() || "example",
    startMonth: Math.min(12, Math.max(1, Math.trunc(input.startMonth) || 1)),
    timezone,
    awardMarks: Math.max(0, Math.trunc(input.awardMarks)),
    memberRoomCap: Math.max(1, Math.trunc(input.memberRoomCap) || 1),
    serverRoomCap: Math.max(1, Math.trunc(input.serverRoomCap) || 5),
    roomCooldownMinutes: Math.max(0, Math.trunc(input.roomCooldownMinutes)),
    systemUserIds: [...new Set([...input.systemUserIds, ...RESERVED_WALLETS])],
    voiceCategoryId: input.voiceCategoryId,
    textCategoryId: input.textCategoryId,
  };
}

export function previewSeasonSettings(input: SeasonSettingsInput) {
  return {
    persisted: false as const,
    settings: prepareSeasonSettings(input),
    preservation: preservationManifest(),
    suggestions: "excluded" as const,
    roomMaxLifetime: ROOM_HAS_MAX_LIFETIME,
    voiceEmptyMs: VOICE_EMPTY_MS,
    textIdleMs: TEXT_IDLE_MS,
  };
}

export function preservationManifest() {
  return {
    communityXp: "retained" as const,
    communityRank: "retained" as const,
    lifetimeSeals: "retained" as const,
    seasonalSeals: "reset" as const,
    ranked: { status: "reset" as const, retained: true },
    wallet: { status: "retained" as const, retained: true },
    character: { status: "retained" as const, retained: true },
    gear: { status: "retained" as const, retained: true },
    inventory: { status: "module_not_built" as const, retained: true },
    regionUnlocks: { status: "retained" as const, retained: true },
    missionState: { status: "retained" as const, retained: true },
  };
}

export function isLeaderboardCategory(value: string): value is LeaderboardCategory {
  return (LEADERBOARD_CATEGORIES as readonly string[]).includes(value);
}

export function leaderboardView(category: LeaderboardCategory) {
  if (category === "estimated_wealth") {
    return { availability: "available" as const, label: "estimated" as const, priceSensitive: true };
  }
  if (!AVAILABLE_BOARDS.has(category)) {
    return { availability: "module_not_built" as const, label: null, priceSensitive: false };
  }
  return { availability: "available" as const, label: null, priceSensitive: false };
}

export function rankStandings(
  rows: readonly Standing[],
  systemUserIds: readonly string[],
  page: number,
  pageSize: number,
  viewerId: string,
) {
  const hidden = new Set(systemUserIds);
  const ranked = rows
    .filter((row) => !hidden.has(row.userId))
    .sort((left, right) => right.score - left.score || left.userId.localeCompare(right.userId))
    .map((row, index) => ({ userId: row.userId, score: row.score, position: index + 1 }));
  const size = Math.max(1, Math.trunc(pageSize) || 10);
  const safePage = Math.max(1, Math.trunc(page) || 1);
  const own = ranked.find((row) => row.userId === viewerId);
  const start = (safePage - 1) * size;
  return {
    page: safePage,
    pageSize: size,
    total: ranked.length,
    rows: ranked.slice(start, start + size),
    ownPosition: own?.position ?? null,
    ownScore: own?.score ?? null,
  };
}

export function seasonWindow(now: Date, startMonth: number, timeZone: string): { id: string; startsAt: Date; endsAt: Date } {
  const start = Math.min(12, Math.max(1, Math.trunc(startMonth) || 1));
  const zoned = zonedCalendar(now, timeZone);
  const offset = (zoned.month - start + 12) % SEASON_MONTHS;
  let month = zoned.month - offset;
  let year = zoned.year;
  if (month <= 0) {
    month += 12;
    year -= 1;
  }
  let endMonth = month + SEASON_MONTHS;
  let endYear = year;
  if (endMonth > 12) {
    endMonth -= 12;
    endYear += 1;
  }
  return {
    id: `${year}-${String(month).padStart(2, "0")}`,
    startsAt: zonedMidnight(year, month, 1, timeZone),
    endsAt: zonedMidnight(endYear, endMonth, 1, timeZone),
  };
}

export function pollCreateDecision(input: { allowed: boolean; kind: string; moduleAvailable: boolean }): "excluded" | "maintenance" | "denied" | "allowed" {
  if (SUGGESTIONS_EXCLUDED && input.kind === "suggestion") {
    return "excluded";
  }
  if (!input.moduleAvailable) {
    return "maintenance";
  }
  if (!input.allowed) {
    return "denied";
  }
  return "allowed";
}

export function voteDecision(input: {
  status: string;
  opensAt: Date;
  closesAt: Date;
  now: Date;
  eligibleRoleIds: readonly string[];
  voterRoleIds: readonly string[];
}): "not_open" | "closed" | "ineligible" | "allowed" {
  if (input.status === "cancelled" || input.status === "closed" || input.now.getTime() >= input.closesAt.getTime()) {
    return "closed";
  }
  if (input.now.getTime() < input.opensAt.getTime()) {
    return "not_open";
  }
  if (input.eligibleRoleIds.length > 0 && !input.eligibleRoleIds.some((roleId) => input.voterRoleIds.includes(roleId))) {
    return "ineligible";
  }
  return "allowed";
}

export function presentPollResults(input: {
  anonymous: boolean;
  audience: "member" | "staff";
  choices: ReadonlyArray<{ id: string; label: string }>;
  votes: ReadonlyArray<{ choiceId: string; userId: string }>;
}) {
  const revealVoters = !input.anonymous || input.audience === "staff";
  return {
    anonymous: input.anonymous,
    counts: input.choices.map((choice) => {
      const voters = input.votes.filter((vote) => vote.choiceId === choice.id);
      return {
        choiceId: choice.id,
        label: choice.label,
        count: voters.length,
        voterIds: revealVoters ? voters.map((vote) => vote.userId) : [],
      };
    }),
    retention: "Votes remain stored after the poll closes. Anonymous polls omit voter ids from member-facing results.",
  };
}

export function roomCreateDecision(input: {
  memberOpen: number;
  serverOpen: number;
  memberCap: number;
  serverCap: number;
  lastCreatedAt: Date | null;
  now: Date;
  cooldownMinutes: number;
}): "cooldown" | "member_cap" | "server_cap" | "allowed" {
  if (input.lastCreatedAt && input.now.getTime() < input.lastCreatedAt.getTime() + input.cooldownMinutes * 60 * 1000) {
    return "cooldown";
  }
  if (input.memberOpen >= input.memberCap) {
    return "member_cap";
  }
  if (input.serverOpen >= input.serverCap) {
    return "server_cap";
  }
  return "allowed";
}

export function applyRoomMessage(lastHumanAt: Date, authorKind: "human" | "bot" | "system", at: Date): Date {
  if (authorKind !== "human") {
    return lastHumanAt;
  }
  return at;
}

export function applyVoicePresence(input: {
  occupants: readonly string[];
  emptySince: Date | null;
  userId: string;
  action: "join" | "leave";
  now: Date;
}): { occupants: string[]; emptySince: Date | null } {
  const present = new Set(input.occupants);
  if (input.action === "join") {
    present.add(input.userId);
  } else {
    present.delete(input.userId);
  }
  const occupants = [...present];
  if (occupants.length > 0) {
    return { occupants, emptySince: null };
  }
  if (input.action === "leave" && input.occupants.includes(input.userId)) {
    return { occupants, emptySince: input.now };
  }
  return { occupants, emptySince: input.emptySince ?? input.now };
}

export function cleanupDecision(input: {
  kind: RoomKind;
  occupants: number;
  emptySince: Date | null;
  lastHumanAt: Date;
  now: Date;
  missionHold: boolean;
  status: string;
}): "closed" | "deferred" | "occupied" | "waiting" | "due" {
  if (input.status !== "open") {
    return "closed";
  }
  if (input.missionHold) {
    return "deferred";
  }
  if (input.kind === "voice") {
    if (input.occupants > 0) {
      return "occupied";
    }
    if (!input.emptySince || input.now.getTime() < input.emptySince.getTime() + VOICE_EMPTY_MS) {
      return "waiting";
    }
    return "due";
  }
  if (input.now.getTime() < input.lastHumanAt.getTime() + TEXT_IDLE_MS) {
    return "waiting";
  }
  return "due";
}

export function transferOwner(input: { ownerUserId: string; leavingUserId: string; occupants: readonly string[] }): { ownerUserId: string; needsStaff: boolean } {
  if (input.leavingUserId !== input.ownerUserId) {
    return { ownerUserId: input.ownerUserId, needsStaff: false };
  }
  const next = input.occupants.find((userId) => userId !== input.leavingUserId);
  if (next) {
    return { ownerUserId: next, needsStaff: false };
  }
  return { ownerUserId: input.ownerUserId, needsStaff: true };
}

export function roomAccess(input: {
  privacy: RoomPrivacy;
  locked: boolean;
  ownerUserId: string;
  invited: readonly string[];
  userId: string;
  moderation: boolean;
}): "allowed" | "denied" {
  if (input.moderation || input.userId === input.ownerUserId || input.invited.includes(input.userId)) {
    return "allowed";
  }
  if (input.locked || input.privacy === "private") {
    return "denied";
  }
  return "allowed";
}

export function holdDecision(reason: string): "mission" | "not_exempt" {
  return reason === "mission" ? "mission" : "not_exempt";
}

export function manualClosePlan(kind: RoomKind, occupants: number): { warnDisconnect: boolean } {
  return { warnDisconnect: kind === "voice" && occupants > 0 };
}

function zonedCalendar(now: Date, timeZone: string): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric" }).formatToParts(now);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
  };
}

function zonedMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const utcGuess = Date.UTC(year, month - 1, day, 0, 0, 0);
  let instant = utcGuess;
  let guard = 0;
  while (guard < 3) {
    guard += 1;
    const next = utcGuess - zoneOffsetMs(new Date(instant), timeZone);
    if (next === instant) {
      break;
    }
    instant = next;
  }
  return new Date(instant);
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "0";
  const hour = Number(read("hour")) === 24 ? 0 : Number(read("hour"));
  const asUtc = Date.UTC(Number(read("year")), Number(read("month")) - 1, Number(read("day")), hour, Number(read("minute")), Number(read("second")));
  return asUtc - instant.getTime();
}
