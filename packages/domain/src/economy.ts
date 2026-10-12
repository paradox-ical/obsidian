import { simulateBlackjackEconomy } from "./blackjack.js";
import { DEFAULT_TIMEZONE } from "./foundation.js";

/** One Mark is 100 minor units so later blackjack payouts can stay exact. */
export const MARK_MINOR_UNITS = 100n;

export const ROUTINE_DAILY_MARKS = 80;
export const ROUTINE_MONTH_DAYS = 30;
export const ROUTINE_WEEKLY_MARKS = 250;
export const ROUTINE_MONTHLY_MILESTONE = 500;
export const ROUTINE_STAFF_ACTIVITIES = 2;
export const ROUTINE_STAFF_ACTIVITY_MARKS = 2_000;
export const MARKS_TARGET = 10_000;
export const DEFAULT_GUILD_ROUTINE_MARKS = 500_000;

export interface EconomySettingsInput {
  label: string;
  transferMaxMarks: number;
  transferCooldownSeconds: number;
  transferDailyMarks: number;
  guildRoutineMarks: number;
}

export function exampleEconomySettings(): EconomySettingsInput {
  return {
    label: "example",
    transferMaxMarks: 1_000,
    transferCooldownSeconds: 60,
    transferDailyMarks: 5_000,
    guildRoutineMarks: DEFAULT_GUILD_ROUTINE_MARKS,
  };
}

export function prepareEconomySettings(input: EconomySettingsInput): EconomySettingsInput {
  return {
    label: input.label.trim() || "example",
    transferMaxMarks: Math.max(1, Math.trunc(input.transferMaxMarks) || 1_000),
    transferCooldownSeconds: Math.max(0, Math.trunc(input.transferCooldownSeconds)),
    transferDailyMarks: Math.max(1, Math.trunc(input.transferDailyMarks) || 5_000),
    guildRoutineMarks: Math.max(1, Math.trunc(input.guildRoutineMarks) || DEFAULT_GUILD_ROUTINE_MARKS),
  };
}

export function previewEconomySettings(input: EconomySettingsInput) {
  return {
    persisted: false as const,
    settings: prepareEconomySettings(input),
    simulation: simulateMonthlyEarnings(),
    marksSupply: "uncapped" as const,
    ingots: { status: "exchange" as const, total: "5000", protectedReserve: "2500", active: "2500" },
  };
}

export function marksToMinor(marks: number): bigint | null {
  if (!Number.isSafeInteger(marks) || marks < 0) {
    return null;
  }
  return BigInt(marks) * MARK_MINOR_UNITS;
}

export function formatMinor(minor: bigint): string {
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const whole = absolute / MARK_MINOR_UNITS;
  const fraction = (absolute % MARK_MINOR_UNITS).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${fraction}`;
}

export function presentPublicWallet(input: {
  availableMinor: bigint;
  escrowMinor: bigint;
  ingotsAvailable?: bigint;
  ingotsEscrow?: bigint;
  estimatedMarksMinor?: bigint;
}) {
  const estimated = input.estimatedMarksMinor ?? input.availableMinor + input.escrowMinor;
  return {
    privacy: "public" as const,
    marks: {
      status: "available" as const,
      available: formatMinor(input.availableMinor),
      escrow: formatMinor(input.escrowMinor),
    },
    ingots: {
      status: "available" as const,
      available: (input.ingotsAvailable ?? 0n).toString(),
      escrow: (input.ingotsEscrow ?? 0n).toString(),
    },
    estimatedWealth: {
      label: "estimated" as const,
      priceSensitive: true as const,
      marks: formatMinor(estimated),
    },
  };
}

export function emptyPublicWallet() {
  return presentPublicWallet({ availableMinor: 0n, escrowMinor: 0n });
}

export function routineMonthlyMarks() {
  const daily = ROUTINE_DAILY_MARKS * ROUTINE_MONTH_DAYS;
  const weekly = Math.round((ROUTINE_WEEKLY_MARKS * (365.25 / 7)) / 12);
  const staff = ROUTINE_STAFF_ACTIVITIES * ROUTINE_STAFF_ACTIVITY_MARKS;
  const lines = [
    { id: "daily_shared", marks: daily, assumption: "80 Marks a day for 30 days, shared by Contracts and RPG. The daily cap is not added again per contract." },
    { id: "weekly_completion", marks: weekly, assumption: "250 Marks times 365.25/7 weeks in a year, divided by 12 months, rounded to the nearest Mark." },
    { id: "monthly_milestone", marks: ROUTINE_MONTHLY_MILESTONE, assumption: "One monthly milestone of 500 Marks." },
    { id: "staff_activities", marks: staff, assumption: "Two staff activities at 2,000 Marks each, inside the same routine total." },
  ];
  const routineMarks = lines.reduce((sum, line) => sum + line.marks, 0);
  return { lines, routineMarks, targetMarks: MARKS_TARGET, monthsToReachTarget: Math.ceil(MARKS_TARGET / routineMarks) };
}

export function simulateMonthlyEarnings(input?: { exceptionalMarks?: number }) {
  const routine = routineMonthlyMarks();
  const exceptionalMarks = Math.max(0, Math.trunc(input?.exceptionalMarks ?? 0));
  return {
    ...routine,
    exceptionalMarks,
    totalMarks: routine.routineMarks + exceptionalMarks,
    blackjack: simulateBlackjackEconomy(routine.routineMarks),
    assumptions: [
      "The reference participant completes every seeded routine line and no extra ordinary bonus.",
      "Birthdays, invites, achievements, and staff awards share this one monthly total. They do not each receive a 10,000 Mark allowance.",
      "A funded exceptional prize, such as a lottery win, is outside the routine pace and can take one member above 10,000.",
      "Marks supply is uncapped. The 7,987 figure is an earning pace, not a supply cap.",
    ],
  };
}

export function perthPeriod(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: DEFAULT_TIMEZONE, year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  return `${year}-${month}`;
}

export function marksTransferDecision(input: {
  fromUserId: string;
  toUserId: string;
  amountMinor: bigint;
  availableMinor: bigint;
  recentTransfer: boolean;
  sentTodayMinor: bigint;
  maxMinor: bigint;
  dailyMinor: bigint;
}): "self" | "invalid" | "insufficient" | "cooldown" | "capped" | "allowed" {
  if (input.fromUserId === input.toUserId) {
    return "self";
  }
  if (input.amountMinor <= 0n) {
    return "invalid";
  }
  if (input.amountMinor > input.availableMinor) {
    return "insufficient";
  }
  if (input.recentTransfer) {
    return "cooldown";
  }
  if (input.amountMinor > input.maxMinor || input.sentTodayMinor + input.amountMinor > input.dailyMinor) {
    return "capped";
  }
  return "allowed";
}

export function marksHoldDecision(availableMinor: bigint, amountMinor: bigint): "invalid" | "insufficient" | "allowed" {
  if (amountMinor <= 0n) {
    return "invalid";
  }
  if (amountMinor > availableMinor) {
    return "insufficient";
  }
  return "allowed";
}
