/** Community progression. Marks are read from the ledger. Ingots stay pending. */

import { emptyPublicWallet, presentPublicWallet } from "./economy.js";
import { sha256 } from "./secrets.js";

export const INVITE_CONFIDENCE = ["known", "vanity", "unknown", "ambiguous"] as const;
export type InviteConfidence = (typeof INVITE_CONFIDENCE)[number];

export interface RankBand {
  id: string;
  name: string;
  level: number;
  roleId: string | null;
}

export interface AchievementDefinition {
  id: string;
  name: string;
  kind: string;
  hidden: boolean;
  marks: number;
}

export interface ProgressionSettingsInput {
  label: string;
  xpPerLevel: number;
  messageXp: number;
  messageCooldownSeconds: number;
  minimumMessageLength: number;
  dailyMessageXp: number;
  repeatWindowSeconds: number;
  excludedChannelIds: string[];
  voiceXpPerMinute: number;
  voiceMinHumans: number;
  dailyVoiceXp: number;
  rankBands: RankBand[];
  birthdayRoleId: string | null;
  birthdayGiftMarks: number;
  birthdayEditCooldownDays: number;
  leapDayPolicy: "observe_previous" | "skip";
  birthdayGreeting: string;
  birthdayChannelId: string | null;
  qualifiedDays: number;
  inviteRewardMarks: number;
  inviteDailyCap: number;
  peerCooldownHours: number;
  peerPairLimit: number;
  peerPairWindowDays: number;
  achievements: AchievementDefinition[];
}

export function exampleProgressionSettings(): ProgressionSettingsInput {
  const bands: Array<[string, string, number]> = [
    ["recruit", "Recruit", 0],
    ["associate", "Associate", 5],
    ["member", "Member", 10],
    ["regular", "Regular", 20],
    ["established", "Established", 30],
    ["veteran", "Veteran", 40],
    ["senior", "Senior", 55],
    ["distinguished", "Distinguished", 70],
    ["luminary", "Luminary", 85],
    ["collective", "Collective", 100],
  ];
  return {
    label: "example",
    xpPerLevel: 100,
    messageXp: 15,
    messageCooldownSeconds: 60,
    minimumMessageLength: 8,
    dailyMessageXp: 500,
    repeatWindowSeconds: 300,
    excludedChannelIds: [],
    voiceXpPerMinute: 10,
    voiceMinHumans: 2,
    dailyVoiceXp: 600,
    rankBands: bands.map(([id, name, level]) => ({ id, name, level, roleId: null })),
    birthdayRoleId: null,
    birthdayGiftMarks: 50,
    birthdayEditCooldownDays: 30,
    leapDayPolicy: "observe_previous",
    birthdayGreeting: "Happy birthday.",
    birthdayChannelId: null,
    qualifiedDays: 7,
    inviteRewardMarks: 100,
    inviteDailyCap: 5,
    peerCooldownHours: 24,
    peerPairLimit: 1,
    peerPairWindowDays: 30,
    achievements: [
      { id: "first-chat", name: "First word", kind: "participation", hidden: false, marks: 0 },
      { id: "recruiter", name: "Recruiter", kind: "recruitment", hidden: false, marks: 25 },
      { id: "quiet-find", name: "Quiet find", kind: "discovery", hidden: true, marks: 0 },
    ],
  };
}

export function prepareProgressionSettings(input: ProgressionSettingsInput): ProgressionSettingsInput {
  return {
    ...input,
    label: input.label.trim() || "example",
    xpPerLevel: Math.max(1, input.xpPerLevel),
    qualifiedDays: input.qualifiedDays >= 1 ? input.qualifiedDays : 7,
    leapDayPolicy: input.leapDayPolicy === "skip" ? "skip" : "observe_previous",
    rankBands: [...input.rankBands].sort((left, right) => left.level - right.level),
    achievements: input.achievements.map((achievement) => ({ ...achievement, marks: Math.max(0, achievement.marks) })),
  };
}

export function previewProgressionSettings(input: ProgressionSettingsInput) {
  return {
    persisted: false as const,
    settings: prepareProgressionSettings(input),
    wallet: emptyPublicWallet(),
    pendingIntegrations: [
      { id: "character_dossier", module: "rpg", status: "available" as const },
      { id: "activity_xp", module: "events_contracts", status: "module_not_built" as const },
    ],
  };
}

export function readPublicWallet(input?: {
  availableMinor: bigint;
  escrowMinor: bigint;
  ingotsAvailable?: bigint;
  ingotsEscrow?: bigint;
  estimatedMarksMinor?: bigint;
}) {
  return presentPublicWallet(input ?? { availableMinor: 0n, escrowMinor: 0n });
}

export function levelForXp(xp: number, xpPerLevel: number): number {
  return Math.min(100, Math.max(0, Math.floor(xp / Math.max(1, xpPerLevel))));
}

export function bandForLevel(level: number, bands: readonly RankBand[]): RankBand | null {
  const sorted = [...bands].sort((left, right) => left.level - right.level);
  let current: RankBand | null = null;
  for (const band of sorted) {
    if (band.level <= level) {
      current = band;
    }
  }
  return current;
}

export function contentHash(content: string): string {
  return sha256(content.trim().toLowerCase());
}

export function chatXpDecision(input: {
  content: string | null;
  channelId: string;
  excludedChannelIds: readonly string[];
  now: Date;
  lastMessageAt: Date | null;
  cooldownSeconds: number;
  lastHash: string | null;
  lastHashAt: Date | null;
  repeatWindowSeconds: number;
  minimumLength: number;
  dailyXp: number;
  dailyCap: number;
  messageXp: number;
}): "excluded" | "content_unavailable" | "too_short" | "repeat" | "cooldown" | "capped" | "award" {
  if (input.excludedChannelIds.includes(input.channelId)) {
    return "excluded";
  }
  const text = input.content?.trim() ?? "";
  if (!text) {
    return "content_unavailable";
  }
  if (text.length < input.minimumLength) {
    return "too_short";
  }
  if (input.lastHash && input.lastHashAt && contentHash(text) === input.lastHash) {
    const repeatUntil = input.lastHashAt.getTime() + input.repeatWindowSeconds * 1000;
    if (input.now.getTime() < repeatUntil) {
      return "repeat";
    }
  }
  if (input.lastMessageAt && input.now.getTime() - input.lastMessageAt.getTime() < input.cooldownSeconds * 1000) {
    return "cooldown";
  }
  if (input.dailyXp >= input.dailyCap || input.messageXp <= 0) {
    return "capped";
  }
  return "award";
}

export function voiceXpDecision(input: {
  afk: boolean;
  muted: boolean;
  deafened: boolean;
  eligibleHumans: number;
  minHumans: number;
  minutes: number;
  dailyXp: number;
  dailyCap: number;
  xpPerMinute: number;
}): { result: "afk" | "muted" | "deafened" | "alone" | "short" | "capped" | "award"; xp: number } {
  if (input.afk) {
    return { result: "afk", xp: 0 };
  }
  if (input.muted) {
    return { result: "muted", xp: 0 };
  }
  if (input.deafened) {
    return { result: "deafened", xp: 0 };
  }
  if (input.eligibleHumans < input.minHumans) {
    return { result: "alone", xp: 0 };
  }
  if (input.minutes < 1) {
    return { result: "short", xp: 0 };
  }
  const room = Math.max(0, input.dailyCap - input.dailyXp);
  const xp = Math.min(room, input.minutes * input.xpPerMinute);
  if (xp <= 0) {
    return { result: "capped", xp: 0 };
  }
  return { result: "award", xp };
}

export function activityXpStatus(): "module_not_built" {
  return "module_not_built";
}

export function inviteConfidence(input: { vanity: boolean; inviterUserIds: readonly string[] }): {
  confidence: InviteConfidence;
  inviterUserId: string | null;
} {
  if (input.vanity) {
    return { confidence: "vanity", inviterUserId: null };
  }
  if (input.inviterUserIds.length > 1) {
    return { confidence: "ambiguous", inviterUserId: null };
  }
  const inviter = input.inviterUserIds[0];
  if (!inviter) {
    return { confidence: "unknown", inviterUserId: null };
  }
  return { confidence: "known", inviterUserId: inviter };
}

export function recruitmentDecision(input: {
  confidence: InviteConfidence;
  rejoin: boolean;
  verifiedAt: Date | null;
  now: Date;
  qualifiedDays: number;
  alreadyRewarded: boolean;
  inviterAwardsToday: number;
  dailyCap: number;
}): "reward" | "waiting" | "unknown" | "vanity" | "ambiguous" | "rejoin" | "already_rewarded" | "unverified" | "capped" {
  if (input.alreadyRewarded) {
    return "already_rewarded";
  }
  if (input.rejoin) {
    return "rejoin";
  }
  if (input.confidence === "unknown" || input.confidence === "vanity" || input.confidence === "ambiguous") {
    return input.confidence;
  }
  if (!input.verifiedAt) {
    return "unverified";
  }
  const due = input.verifiedAt.getTime() + input.qualifiedDays * 24 * 60 * 60 * 1000;
  if (input.now.getTime() < due) {
    return "waiting";
  }
  if (input.inviterAwardsToday >= input.dailyCap) {
    return "capped";
  }
  return "reward";
}

export function rewardLedgerStatus(kind: "marks" | "badge" | "title"): "posted" | "not_applicable" {
  return kind === "marks" ? "posted" : "not_applicable";
}

export function birthdayEditDecision(input: { previousEditAt: Date | null; now: Date; cooldownDays: number }): "create" | "edit" | "cooldown" {
  if (!input.previousEditAt) {
    return "create";
  }
  const until = input.previousEditAt.getTime() + input.cooldownDays * 24 * 60 * 60 * 1000;
  return input.now.getTime() < until ? "cooldown" : "edit";
}

export function validBirthdayDate(month: number, day: number): boolean {
  const lengths = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const limit = lengths[month] ?? 0;
  return month >= 1 && month <= 12 && day >= 1 && day <= limit;
}

export function birthdayIsToday(input: {
  month: number;
  day: number;
  timeZone: string;
  now: Date;
  leapDayPolicy: "observe_previous" | "skip";
}): boolean {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: input.timeZone, month: "numeric", day: "numeric", year: "numeric" }).formatToParts(input.now);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  if (input.month === 2 && input.day === 29) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    if (!leap) {
      return input.leapDayPolicy === "observe_previous" && month === 2 && day === 28;
    }
  }
  return month === input.month && day === input.day;
}

export function zonedYear(now: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric" }).format(now));
}

export function peerCommendationDecision(input: {
  fromUserId: string;
  toUserId: string;
  recentFromSender: number;
  pairCount: number;
  pairLimit: number;
}): "self" | "cooldown" | "pair_limit" | "allowed" {
  if (input.fromUserId === input.toUserId) {
    return "self";
  }
  if (input.recentFromSender > 0) {
    return "cooldown";
  }
  if (input.pairCount >= input.pairLimit) {
    return "pair_limit";
  }
  return "allowed";
}

export function publicDossier(input: {
  userId: string;
  xp: number;
  level: number;
  rankName: string | null;
  bio: string | null;
  bioPublic: boolean;
  birthday: { month: number; day: number } | null;
  birthdayPublic: boolean;
  title: string | null;
  frame: string | null;
  background: string | null;
  accounts: Array<{ provider: string; handle: string }>;
  achievements: Array<{ id: string; name: string; hidden: boolean; earned: boolean }>;
  commendations: Array<{ category: string; reason: string }>;
  wallet: ReturnType<typeof readPublicWallet>;
  character?: { status: "ready"; className: string; level: number } | { status: "uncreated" };
}) {
  return {
    userId: input.userId,
    xp: input.xp,
    level: input.level,
    rankName: input.rankName,
    bio: input.bioPublic ? input.bio : null,
    birthday: input.birthdayPublic && input.birthday ? { month: input.birthday.month, day: input.birthday.day } : null,
    title: input.title,
    frame: input.frame,
    background: input.background,
    accounts: input.accounts,
    achievements: input.achievements.filter((achievement) => achievement.earned),
    commendations: input.commendations,
    wallet: input.wallet,
    character: input.character ?? { status: "uncreated" as const },
    inventory: { status: "omitted" as const },
  };
}
