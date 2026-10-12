import { DEFAULT_TIMEZONE } from "./foundation.js";

export const ANNOUNCEMENT_GRACE_MS = 15 * 60 * 1000;
export const ROLE_MENTION_LIMIT = 5;
export const USER_MENTION_LIMIT = 5;
export const REPLY_PATTERN_LIMIT = 64;
export const REPLY_TEXT_LIMIT = 500;

export type AnnouncementCadence = "once" | "daily" | "weekly" | "monthly";

export interface AnnouncementSlot {
  cadence: AnnouncementCadence;
  timezone: string;
  hour: number;
  minute: number;
  weekday: number | null;
  dayOfMonth: number | null;
  endsAt: Date | null;
}

export interface DuePlan {
  post: { runAt: Date; key: string } | null;
  skipped: Array<{ runAt: Date; key: string }>;
  following: Date | null;
}

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function timezoneIsValid(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function mentionProblems(document: { mentionRoles: readonly string[]; mentionUsers: readonly string[]; content: string; allowEveryone: boolean }): string[] {
  const errors: string[] = [];
  if (document.mentionRoles.length > ROLE_MENTION_LIMIT) {
    errors.push("Role mentions exceed 5.");
  }
  if (document.mentionUsers.length > USER_MENTION_LIMIT) {
    errors.push("User mentions exceed 5.");
  }
  if (!document.allowEveryone && /@everyone|@here/.test(document.content)) {
    errors.push("everyone and here mentions require the authorised mention flag.");
  }
  return errors;
}

export function nextOccurrence(slot: AnnouncementSlot, after: Date): Date | null {
  if (slot.cadence === "once" || !timezoneIsValid(slot.timezone)) {
    return null;
  }
  const start = zonedParts(after, slot.timezone);
  if (slot.cadence === "daily") {
    return firstAfter(after, slot, start, 1);
  }
  if (slot.cadence === "weekly") {
    return firstAfter(after, slot, start, 8);
  }
  return firstMonthly(after, slot, start);
}

export function occurrenceKey(seriesId: string, runAt: Date, timezone: string): string {
  const local = zonedParts(runAt, timezone);
  const month = String(local.month).padStart(2, "0");
  const day = String(local.day).padStart(2, "0");
  return `${seriesId}:${local.year}-${month}-${day}`;
}

/** Missed occurrences are skipped. At most the newest one still inside the grace window is posted. */
export function planDueRuns(slot: AnnouncementSlot, nextRunAt: Date, now: Date, seriesId: string): DuePlan {
  if (nextRunAt.getTime() > now.getTime()) {
    return { post: null, skipped: [], following: nextRunAt };
  }
  const due: Date[] = [];
  let cursor: Date | null = nextRunAt;
  while (cursor && cursor.getTime() <= now.getTime() && due.length < 400) {
    if (slot.endsAt && cursor.getTime() > slot.endsAt.getTime()) {
      break;
    }
    due.push(cursor);
    cursor = slot.cadence === "once" ? null : nextOccurrence(slot, cursor);
  }
  const skipped: DuePlan["skipped"] = [];
  let post: DuePlan["post"] = null;
  for (const runAt of due) {
    const key = occurrenceKey(seriesId, runAt, slot.timezone || DEFAULT_TIMEZONE);
    const fresh = now.getTime() - runAt.getTime() <= ANNOUNCEMENT_GRACE_MS;
    if (fresh && !post) {
      post = { runAt, key };
    } else if (fresh && post) {
      skipped.push(post);
      post = { runAt, key };
    } else {
      skipped.push({ runAt, key });
    }
  }
  const last = due[due.length - 1] ?? nextRunAt;
  const following = slot.cadence === "once" ? null : nextOccurrence(slot, last);
  const ended = Boolean(slot.endsAt && following && following.getTime() > slot.endsAt.getTime());
  return { post, skipped, following: ended ? null : following };
}

export function stickyStep(input: {
  paused: boolean;
  expired: boolean;
  humanCount: number;
  threshold: number;
  lastPostedAt: Date | null;
  now: Date;
  cooldownMs: number;
  authorIsBot: boolean;
  messageId: string | null;
  ownMessageId: string | null;
}): "ignore_bot" | "ignore_own" | "paused" | "expired" | "cooldown" | "count" | "repost" {
  if (input.authorIsBot) {
    return "ignore_bot";
  }
  if (input.messageId && input.ownMessageId && input.messageId === input.ownMessageId) {
    return "ignore_own";
  }
  if (input.paused) {
    return "paused";
  }
  if (input.expired) {
    return "expired";
  }
  const nextCount = input.humanCount + 1;
  const cooled = !input.lastPostedAt || input.now.getTime() - input.lastPostedAt.getTime() >= input.cooldownMs;
  if (nextCount >= input.threshold && !cooled) {
    return "cooldown";
  }
  if (nextCount >= input.threshold && cooled) {
    return "repost";
  }
  return "count";
}

export interface ReplyRuleView {
  id: string;
  kind: "exact" | "keyword" | "pattern" | "trigger";
  pattern: string;
  priority: number;
  channelIds: readonly string[];
  excludedChannelIds: readonly string[];
  roleIds: readonly string[];
  excludedRoleIds: readonly string[];
  variants: readonly string[];
  visibility: "channel" | "dm" | "ephemeral";
  secret: boolean;
  status: "active" | "paused";
}

export function safeReplyPattern(pattern: string): boolean {
  if (pattern.length === 0 || pattern.length > REPLY_PATTERN_LIMIT) {
    return false;
  }
  if (/\(\?|\\[1-9]|\+\+|\*\*|\{[^}]*\}/.test(pattern)) {
    return false;
  }
  if (/\([^)]*[+*][^)]*\)[+*?]/.test(pattern)) {
    return false;
  }
  try {
    const compiled = new RegExp(pattern, "i");
    compiled.test("a");
    return true;
  } catch {
    return false;
  }
}

export function selectReply(
  rules: readonly ReplyRuleView[],
  input: { text: string; source: "message" | "interaction"; channelId: string; roleIds: readonly string[]; authorIsBot: boolean; pick: number },
): { result: "none"; excludedRuleIds: string[] } | { result: "excluded"; ruleId: string; excludedRuleIds: string[] } | { result: "refused"; reason: "ordinary_message"; excludedRuleIds: string[] } | {
  result: "matched";
  ruleId: string;
  variant: string;
  visibility: ReplyRuleView["visibility"];
  secret: boolean;
  excludedRuleIds: string[];
} {
  if (input.authorIsBot) {
    return { result: "none", excludedRuleIds: [] };
  }
  const ordered = [...rules].filter((rule) => rule.status === "active").sort((left, right) => right.priority - left.priority);
  const excludedRuleIds: string[] = [];
  for (const rule of ordered) {
    if (rule.excludedChannelIds.includes(input.channelId) || rule.excludedRoleIds.some((roleId) => input.roleIds.includes(roleId))) {
      excludedRuleIds.push(rule.id);
      continue;
    }
    if (rule.channelIds.length > 0 && !rule.channelIds.includes(input.channelId)) {
      continue;
    }
    if (rule.roleIds.length > 0 && !rule.roleIds.some((roleId) => input.roleIds.includes(roleId))) {
      continue;
    }
    if (!ruleMatches(rule, input.text)) {
      continue;
    }
    if (input.source === "message" && rule.visibility === "ephemeral") {
      return { result: "refused", reason: "ordinary_message", excludedRuleIds };
    }
    const variant = rule.variants[Math.abs(input.pick) % rule.variants.length] ?? rule.variants[0] ?? "";
    return { result: "matched", ruleId: rule.id, variant, visibility: rule.visibility, secret: rule.secret, excludedRuleIds };
  }
  const lastExcluded = excludedRuleIds[excludedRuleIds.length - 1];
  return lastExcluded ? { result: "excluded", ruleId: lastExcluded, excludedRuleIds } : { result: "none", excludedRuleIds };
}

export interface FeedItem {
  externalId: string;
  canonical: string;
  title: string;
  url: string;
  summary: string;
  summaryLabel: "source" | "generated";
  category: "patches" | "announcements" | "maintenance" | "releases";
}

export function parseFeedPayload(payload: unknown): { ok: true; items: FeedItem[] } | { ok: false } {
  if (!payload || typeof payload !== "object" || !("items" in payload) || !Array.isArray(payload.items)) {
    return { ok: false };
  }
  const items: FeedItem[] = [];
  for (const entry of payload.items) {
    if (!entry || typeof entry !== "object") {
      return { ok: false };
    }
    const row = entry as Record<string, unknown>;
    const externalId = typeof row["id"] === "string" ? row["id"].trim() : "";
    const title = typeof row["title"] === "string" ? row["title"].trim() : "";
    const url = typeof row["url"] === "string" ? row["url"].trim() : "";
    const category = row["category"];
    if (!externalId || !title || !/^https?:\/\//.test(url)) {
      return { ok: false };
    }
    if (category !== "patches" && category !== "announcements" && category !== "maintenance" && category !== "releases") {
      return { ok: false };
    }
    const summary = typeof row["summary"] === "string" ? row["summary"].trim() : "";
    items.push({
      externalId,
      canonical: url.toLowerCase(),
      title,
      url,
      summary,
      summaryLabel: row["generated"] === true ? "generated" : "source",
      category,
    });
  }
  return { ok: true, items };
}

export function splitFeedItems(known: ReadonlySet<string>, items: readonly FeedItem[]): { fresh: FeedItem[]; replayed: FeedItem[] } {
  const fresh: FeedItem[] = [];
  const replayed: FeedItem[] = [];
  for (const item of items) {
    if (known.has(item.externalId) || known.has(item.canonical)) {
      replayed.push(item);
    } else {
      fresh.push(item);
    }
  }
  return { fresh, replayed };
}

export function feedPostText(item: FeedItem): { content: string; labelled: boolean } {
  const body = item.summary || item.title;
  const labelled = item.summaryLabel === "generated" && item.summary.length > 0;
  return { content: labelled ? `Generated summary.\n${body}\n${item.url}` : `${body}\n${item.url}`, labelled };
}

function ruleMatches(rule: ReplyRuleView, text: string): boolean {
  const sample = text.slice(0, REPLY_TEXT_LIMIT);
  const pattern = rule.pattern.trim().toLowerCase();
  const haystack = sample.trim().toLowerCase();
  if (rule.kind === "exact") {
    return haystack === pattern;
  }
  if (rule.kind === "keyword") {
    return pattern.length > 0 && haystack.includes(pattern);
  }
  if (rule.kind === "trigger") {
    return pattern.length > 0 && (haystack === pattern || haystack.startsWith(`${pattern} `));
  }
  if (!safeReplyPattern(rule.pattern)) {
    return false;
  }
  return new RegExp(rule.pattern, "i").test(sample);
}

function firstAfter(after: Date, slot: AnnouncementSlot, start: ZonedParts, limit: number): Date | null {
  let cursor = { year: start.year, month: start.month, day: start.day };
  for (let step = 0; step < limit + 370; step += 1) {
    const candidate = utcFromZoned(cursor.year, cursor.month, cursor.day, slot.hour, slot.minute, slot.timezone);
    const local = zonedParts(candidate, slot.timezone);
    const weekdayOk = slot.cadence !== "weekly" || local.weekday === slot.weekday;
    if (weekdayOk && candidate.getTime() > after.getTime() && (!slot.endsAt || candidate.getTime() <= slot.endsAt.getTime())) {
      return candidate;
    }
    cursor = addDays(cursor.year, cursor.month, cursor.day, 1);
  }
  return null;
}

function firstMonthly(after: Date, slot: AnnouncementSlot, start: ZonedParts): Date | null {
  const day = slot.dayOfMonth ?? 1;
  let year = start.year;
  let month = start.month;
  for (let step = 0; step < 24; step += 1) {
    if (day <= daysInMonth(year, month)) {
      const candidate = utcFromZoned(year, month, day, slot.hour, slot.minute, slot.timezone);
      if (candidate.getTime() > after.getTime() && (!slot.endsAt || candidate.getTime() <= slot.endsAt.getTime())) {
        return candidate;
      }
    }
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return null;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const map = Object.fromEntries(formatted.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  let hour = Number(map["hour"]);
  if (hour === 24) {
    hour = 0;
  }
  return {
    year: Number(map["year"]),
    month: Number(map["month"]),
    day: Number(map["day"]),
    hour,
    minute: Number(map["minute"]),
    weekday: WEEKDAY[map["weekday"] ?? ""] ?? 0,
  };
}

function utcFromZoned(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  let utc = Date.UTC(year, month - 1, day, hour, minute);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const local = zonedParts(new Date(utc), timeZone);
    const localAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
    const desired = Date.UTC(year, month - 1, day, hour, minute);
    const delta = desired - localAsUtc;
    if (delta === 0) {
      break;
    }
    utc += delta;
  }
  return new Date(utc);
}

function addDays(year: number, month: number, day: number, days: number): { year: number; month: number; day: number } {
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
