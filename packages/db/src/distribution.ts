import { randomUUID } from "node:crypto";

import {
  feedPostText,
  mentionProblems,
  nextOccurrence,
  parseFeedPayload,
  planDueRuns,
  publicationPreview,
  safeReplyPattern,
  selectReply,
  splitFeedItems,
  stickyStep,
  publicHttpUrl,
  timezoneIsValid,
  validatePublicationDraft,
  type AnnouncementCadence,
  type AnnouncementSlot,
  type PublicationDraftDocument,
  type ReplyRuleView,
} from "@collective/domain";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

import { actorCan, enqueueJob, ensureGuild, moduleIsAvailable, writeAudit, type Writer } from "./platform.js";
import { setupRequiredProbe, type ChannelProbe } from "./publications.js";

type Tx = Prisma.TransactionClient;
type Root = PrismaClient;

const CADENCES = new Set<AnnouncementCadence>(["once", "daily", "weekly", "monthly"]);

export type FeedFetcher = (url: string) => Promise<{ available: true; payload: unknown } | { available: false }>;

export const unavailableFeed: FeedFetcher = async () => ({ available: false });

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function isUnique(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function documentOf(value: unknown): PublicationDraftDocument | null {
  const validated = validatePublicationDraft(value);
  return validated.ok ? validated.document : null;
}

async function gate(db: Writer, input: { guildId: string; actorRoleIds: readonly string[] }) {
  if (!(await moduleIsAvailable(db, input.guildId, "publications"))) {
    return "maintenance" as const;
  }
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "publications" })) !== "allowed") {
    return "denied" as const;
  }
  return "ok" as const;
}

function slotOf(series: {
  cadence: string;
  timezone: string;
  hour: number;
  minute: number;
  weekday: number | null;
  dayOfMonth: number | null;
  endsAt: Date | null;
}): AnnouncementSlot | null {
  if (!CADENCES.has(series.cadence as AnnouncementCadence)) {
    return null;
  }
  return {
    cadence: series.cadence as AnnouncementCadence,
    timezone: series.timezone,
    hour: series.hour,
    minute: series.minute,
    weekday: series.weekday,
    dayOfMonth: series.dayOfMonth,
    endsAt: series.endsAt,
  };
}

function scheduleProblems(input: {
  cadence: string;
  timezone: string;
  hour: number;
  minute: number;
  weekday: number | null;
  dayOfMonth: number | null;
}): string | null {
  if (!CADENCES.has(input.cadence as AnnouncementCadence)) {
    return "Choose a one-off, daily, weekly, or monthly cadence.";
  }
  if (!timezoneIsValid(input.timezone)) {
    return "Choose a valid timezone.";
  }
  if (!Number.isInteger(input.hour) || input.hour < 0 || input.hour > 23 || !Number.isInteger(input.minute) || input.minute < 0 || input.minute > 59) {
    return "Choose an hour and minute.";
  }
  if (input.cadence === "weekly" && (input.weekday === null || input.weekday < 1 || input.weekday > 7)) {
    return "Choose a weekday.";
  }
  if (input.cadence === "monthly" && (input.dayOfMonth === null || input.dayOfMonth < 1 || input.dayOfMonth > 31)) {
    return "Choose a day of the month.";
  }
  return null;
}

async function alert(db: Writer, input: { guildId: string; kind: string; targetId: string; reason: string }) {
  await db.distributionAlert.create({
    data: {
      id: randomUUID(),
      guildId: input.guildId,
      kind: input.kind,
      targetId: input.targetId,
      reason: input.reason,
      delivery: "setup_required",
    },
  });
}

export async function createAnnouncementSeries(
  db: Root,
  input: {
    guildId: string;
    draftId: string;
    destination: string;
    cadence: AnnouncementCadence;
    timezone: string;
    hour: number;
    minute: number;
    weekday: number | null;
    dayOfMonth: number | null;
    endsAt: Date | null;
    removeAfterMinutes: number | null;
    scheduledFor: Date | null;
    actorUserId: string;
    actorRoleIds: readonly string[];
    now: Date;
    probe?: ChannelProbe;
  },
) {
  const gated = await gate(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const problem = scheduleProblems(input);
  if (problem || !input.destination.trim()) {
    return { result: "invalid" as const, errors: [problem ?? "Choose a destination."] };
  }
  if (input.removeAfterMinutes !== null && (!Number.isInteger(input.removeAfterMinutes) || input.removeAfterMinutes < 1 || input.removeAfterMinutes > 43200)) {
    return { result: "invalid" as const, errors: ["Removal duration must be a positive number of minutes."] };
  }
  const draft = await db.publicationDraft.findUnique({ where: { id: input.draftId } });
  const document = draft && draft.guildId === input.guildId ? documentOf(draft.document) : null;
  if (!draft || !document || draft.committedRevision !== draft.revision) {
    return { result: "approval_required" as const };
  }
  const mentions = mentionProblems(document);
  if (mentions.length > 0) {
    return { result: "mention_limit" as const, errors: mentions };
  }
  const slot = slotOf({ ...input, endsAt: input.endsAt });
  if (!slot) {
    return { result: "invalid" as const, errors: ["Choose a cadence."] };
  }
  const nextRunAt = input.cadence === "once" ? input.scheduledFor : nextOccurrence(slot, input.now);
  if (!nextRunAt || nextRunAt.getTime() <= input.now.getTime()) {
    return { result: "invalid" as const, errors: ["Choose a future occurrence."] };
  }
  const probe = input.probe ?? setupRequiredProbe;
  const access = await probe({ guildId: input.guildId, channelId: input.destination, purpose: "destination" });
  if (access === "denied") {
    await alert(db, { guildId: input.guildId, kind: "announcement.permission", targetId: input.draftId, reason: "Destination permission was denied." });
    return { result: "permission" as const };
  }
  await ensureGuild(db, { guildId: input.guildId });
  const series = await db.announcementSeries.create({
    data: {
      id: randomUUID(),
      guildId: input.guildId,
      draftId: draft.id,
      approvedRevision: draft.revision,
      destination: input.destination,
      cadence: input.cadence,
      timezone: input.timezone,
      hour: input.hour,
      minute: input.minute,
      weekday: input.weekday,
      dayOfMonth: input.dayOfMonth,
      endsAt: input.endsAt,
      removeAfterMinutes: input.removeAfterMinutes,
      status: "active",
      nextRunAt,
      updatedAt: input.now,
    },
  });
  await enqueueJob(db, {
    guildId: input.guildId,
    jobType: "announcement.run",
    payload: { seriesId: series.id },
    idempotencyKey: `announcement:${series.id}:${nextRunAt.toISOString()}`,
    runAt: nextRunAt,
  });
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "announcement.create",
    targetType: "announcement_series",
    targetId: series.id,
    reason: input.cadence,
  });
  return { result: "scheduled" as const, series };
}

export async function pauseAnnouncement(db: Root, input: { guildId: string; seriesId: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date }) {
  return setSeriesStatus(db, input, "paused", ["active"]);
}

export async function cancelAnnouncement(db: Root, input: { guildId: string; seriesId: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date }) {
  return setSeriesStatus(db, input, "cancelled", ["active", "paused"]);
}

async function setSeriesStatus(
  db: Root,
  input: { guildId: string; seriesId: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date },
  status: "paused" | "cancelled",
  from: string[],
) {
  const gated = await gate(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const series = await db.announcementSeries.findUnique({ where: { id: input.seriesId } });
  if (!series || series.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  if (!from.includes(series.status)) {
    return { result: "stale" as const, series };
  }
  const updated = await db.announcementSeries.update({ where: { id: series.id }, data: { status, updatedAt: input.now } });
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: `announcement.${status}`,
    targetType: "announcement_series",
    targetId: series.id,
    reason: status,
  });
  return { result: status, series: updated };
}

export async function resumeAnnouncement(db: Root, input: { guildId: string; seriesId: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date }) {
  const gated = await gate(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const series = await db.announcementSeries.findUnique({ where: { id: input.seriesId } });
  if (!series || series.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  if (series.status !== "paused") {
    return { result: "stale" as const };
  }
  const slot = slotOf(series);
  if (!slot) {
    return { result: "invalid" as const };
  }
  if (series.cadence === "once" && series.nextRunAt.getTime() <= input.now.getTime()) {
    const ended = await db.announcementSeries.update({ where: { id: series.id }, data: { status: "ended", updatedAt: input.now } });
    await alert(db, { guildId: input.guildId, kind: "announcement.missed", targetId: series.id, reason: "A paused one-off was not replayed." });
    return { result: "ended" as const, series: ended };
  }
  const nextRunAt = series.cadence === "once" ? series.nextRunAt : nextOccurrence(slot, input.now);
  if (!nextRunAt) {
    const ended = await db.announcementSeries.update({ where: { id: series.id }, data: { status: "ended", updatedAt: input.now } });
    return { result: "ended" as const, series: ended };
  }
  const updated = await db.announcementSeries.update({ where: { id: series.id }, data: { status: "active", nextRunAt, updatedAt: input.now } });
  await enqueueJob(db, {
    guildId: input.guildId,
    jobType: "announcement.run",
    payload: { seriesId: series.id },
    idempotencyKey: `announcement:${series.id}:${nextRunAt.toISOString()}`,
    runAt: nextRunAt,
  });
  return { result: "active" as const, series: updated };
}

export async function rescheduleAnnouncement(
  db: Root,
  input: {
    guildId: string;
    seriesId: string;
    timezone: string;
    hour: number;
    minute: number;
    weekday: number | null;
    dayOfMonth: number | null;
    endsAt: Date | null;
    scheduledFor: Date | null;
    actorUserId: string;
    actorRoleIds: readonly string[];
    now: Date;
  },
) {
  const gated = await gate(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const series = await db.announcementSeries.findUnique({ where: { id: input.seriesId } });
  if (!series || series.guildId !== input.guildId || (series.status !== "active" && series.status !== "paused")) {
    return { result: series ? "stale" as const : "missing" as const };
  }
  const problem = scheduleProblems({ ...input, cadence: series.cadence });
  if (problem) {
    return { result: "invalid" as const, errors: [problem] };
  }
  const slot = slotOf({ ...series, ...input });
  if (!slot) {
    return { result: "invalid" as const, errors: ["Choose a cadence."] };
  }
  const nextRunAt = series.cadence === "once" ? input.scheduledFor : nextOccurrence(slot, input.now);
  if (!nextRunAt || nextRunAt.getTime() <= input.now.getTime()) {
    return { result: "invalid" as const, errors: ["Choose a future occurrence."] };
  }
  const updated = await db.announcementSeries.update({
    where: { id: series.id },
    data: {
      timezone: input.timezone,
      hour: input.hour,
      minute: input.minute,
      weekday: input.weekday,
      dayOfMonth: input.dayOfMonth,
      endsAt: input.endsAt,
      nextRunAt,
      updatedAt: input.now,
    },
  });
  if (updated.status === "active") {
    await enqueueJob(db, {
      guildId: input.guildId,
      jobType: "announcement.run",
      payload: { seriesId: series.id },
      idempotencyKey: `announcement:${series.id}:${nextRunAt.toISOString()}`,
      runAt: nextRunAt,
    });
  }
  return { result: "scheduled" as const, series: updated };
}

export async function runAnnouncementSeries(db: Root, input: { seriesId: string; now: Date; probe?: ChannelProbe }) {
  const located = await db.announcementSeries.findUnique({ where: { id: input.seriesId } });
  if (!located) {
    return { result: "missing" as const };
  }
  const probe = input.probe ?? setupRequiredProbe;
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "announcement_series" WHERE "id" = ${located.id} FOR UPDATE`;
      const series = await tx.announcementSeries.findUnique({ where: { id: located.id } });
      if (!series) {
        return { result: "missing" as const };
      }
      if (series.status !== "active") {
        return { result: series.status as "paused" | "cancelled" | "ended" | "stale" | "failed" };
      }
      if (series.nextRunAt.getTime() > input.now.getTime()) {
        return { result: "waiting" as const };
      }
      const draft = await tx.publicationDraft.findUnique({ where: { id: series.draftId } });
      const document = draft ? documentOf(draft.document) : null;
      if (!draft || !document || draft.revision !== series.approvedRevision || draft.committedRevision !== series.approvedRevision) {
        await tx.announcementSeries.update({ where: { id: series.id }, data: { status: "stale", updatedAt: input.now } });
        await alert(tx, { guildId: series.guildId, kind: "announcement.stale", targetId: series.id, reason: "Editing the draft invalidated this approval." });
        return { result: "stale" as const };
      }
      const mentions = mentionProblems(document);
      if (mentions.length > 0) {
        await tx.announcementSeries.update({ where: { id: series.id }, data: { status: "failed", updatedAt: input.now } });
        await alert(tx, { guildId: series.guildId, kind: "announcement.mentions", targetId: series.id, reason: mentions.join(" ") });
        return { result: "mention_limit" as const };
      }
      const slot = slotOf(series);
      if (!slot) {
        return { result: "invalid" as const };
      }
      const plan = planDueRuns(slot, series.nextRunAt, input.now, series.id);
      for (const skipped of plan.skipped) {
        await remember(tx, series, skipped.key, "skipped", {}, null, "missed");
      }
      let deliveryId: string | null = null;
      let duplicate = false;
      if (plan.post) {
        const existing = await tx.announcementDelivery.findUnique({ where: { seriesId_occurrenceKey: { seriesId: series.id, occurrenceKey: plan.post.key } } });
        if (existing) {
          deliveryId = existing.id;
          duplicate = true;
        } else {
          const access = await probe({ guildId: series.guildId, channelId: series.destination, purpose: "destination" });
          if (access === "denied") {
            deliveryId = await remember(tx, series, plan.post.key, "failed", {}, null, "permission");
            await alert(tx, { guildId: series.guildId, kind: "announcement.permission", targetId: series.id, reason: "Destination permission was denied." });
          } else {
            const expiresAt = series.removeAfterMinutes ? new Date(plan.post.runAt.getTime() + series.removeAfterMinutes * 60_000) : null;
            deliveryId = await remember(tx, series, plan.post.key, "posted", publicationPreview(document), expiresAt, "");
            if (expiresAt) {
              await enqueueJob(tx, {
                guildId: series.guildId,
                jobType: "announcement.expire",
                payload: { seriesId: series.id },
                idempotencyKey: `announcement:${series.id}:${plan.post.key}:expire`,
                runAt: expiresAt,
              });
            }
          }
        }
      }
      const status = plan.following ? "active" : "ended";
      await tx.announcementSeries.update({
        where: { id: series.id },
        data: { status, nextRunAt: plan.following ?? series.nextRunAt, updatedAt: input.now },
      });
      if (plan.following) {
        await enqueueJob(tx, {
          guildId: series.guildId,
          jobType: "announcement.run",
          payload: { seriesId: series.id },
          idempotencyKey: `announcement:${series.id}:${plan.following.toISOString()}`,
          runAt: plan.following,
        });
      }
      if (duplicate) {
        return { result: "already_recorded" as const, deliveryId, skipped: plan.skipped.length };
      }
      return {
        result: plan.post ? "posted" as const : "skipped" as const,
        deliveryId,
        skipped: plan.skipped.length,
      };
    });
  } catch (error) {
    if (!isUnique(error)) {
      throw error;
    }
    return { result: "already_recorded" as const };
  }
}

async function remember(
  tx: Tx,
  series: { id: string; guildId: string },
  occurrenceKey: string,
  status: "posted" | "skipped" | "failed" | "removed",
  snapshot: unknown,
  expiresAt: Date | null,
  reason: string,
) {
  const existing = await tx.announcementDelivery.findUnique({ where: { seriesId_occurrenceKey: { seriesId: series.id, occurrenceKey } } });
  if (existing) {
    return existing.id;
  }
  const created = await tx.announcementDelivery.create({
    data: {
      id: randomUUID(),
      guildId: series.guildId,
      seriesId: series.id,
      occurrenceKey,
      status,
      snapshot: asJson(snapshot),
      delivery: "setup_required",
      discordMessageId: null,
      expiresAt,
      reason,
    },
  });
  return created.id;
}

export async function sweepAnnouncements(db: Root, now: Date, probe?: ChannelProbe) {
  const due = await db.announcementSeries.findMany({
    where: { status: "active", nextRunAt: { lte: now } },
    orderBy: { nextRunAt: "asc" },
    take: 20,
  });
  const results = [];
  for (const series of due) {
    results.push(await runAnnouncementSeries(db, { seriesId: series.id, now, probe }));
  }
  return results;
}

export async function sweepAnnouncementExpiry(db: Root, now: Date) {
  const due = await db.announcementDelivery.findMany({
    where: { status: "posted", expiresAt: { lte: now } },
    take: 50,
  });
  for (const row of due) {
    await db.announcementDelivery.update({
      where: { id: row.id },
      data: { status: "removed", delivery: "setup_required", reason: "expired" },
    });
    await alert(db, { guildId: row.guildId, kind: "announcement.expired", targetId: row.id, reason: "The announcement copy was due for removal." });
  }
  return due.length;
}

export async function pinPublication(
  db: Root,
  input: { guildId: string; messageId: string; expiresAt: Date | null; actorUserId: string; actorRoleIds: readonly string[]; now: Date; probe?: ChannelProbe },
) {
  const gated = await gate(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const message = await db.publicationMessage.findUnique({ where: { id: input.messageId } });
  const delivery = message ? null : await db.announcementDelivery.findUnique({ where: { id: input.messageId } });
  const channelId = message?.destinationChannelId ?? null;
  const series = delivery ? await db.announcementSeries.findUnique({ where: { id: delivery.seriesId } }) : null;
  const resolvedChannel = channelId ?? series?.destination ?? null;
  const guildId = message?.guildId ?? delivery?.guildId;
  if (!resolvedChannel || guildId !== input.guildId || (message && message.status !== "recorded") || (delivery && delivery.status !== "posted")) {
    return { result: "missing" as const };
  }
  const probe = input.probe ?? setupRequiredProbe;
  const access = await probe({ guildId: input.guildId, channelId: resolvedChannel, purpose: "destination" });
  if (access === "denied") {
    await alert(db, { guildId: input.guildId, kind: "pin.permission", targetId: input.messageId, reason: "Pin permission was denied." });
    return { result: "permission" as const };
  }
  await db.managedPin.updateMany({ where: { guildId: input.guildId, channelId: resolvedChannel, status: "pinned" }, data: { status: "replaced" } });
  const pin = await db.managedPin.create({
    data: {
      id: randomUUID(),
      guildId: input.guildId,
      channelId: resolvedChannel,
      messageId: input.messageId,
      status: "pinned",
      delivery: "setup_required",
      discordMessageId: null,
      expiresAt: input.expiresAt,
    },
  });
  if (input.expiresAt) {
    await enqueueJob(db, {
      guildId: input.guildId,
      jobType: "pin.expire",
      payload: { pinId: pin.id },
      idempotencyKey: `pin:${pin.id}:expire`,
      runAt: input.expiresAt,
    });
  }
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "pin.create",
    targetType: "managed_pin",
    targetId: pin.id,
    reason: "Bot-managed pin recorded.",
  });
  return { result: "pinned" as const, pin };
}

export async function unpinPublication(db: Root, input: { guildId: string; pinId: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date }) {
  const gated = await gate(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const pin = await db.managedPin.findUnique({ where: { id: input.pinId } });
  if (!pin || pin.guildId !== input.guildId || pin.status !== "pinned") {
    return { result: pin ? "stale" as const : "missing" as const };
  }
  const updated = await db.managedPin.update({ where: { id: pin.id }, data: { status: "unpinned", delivery: "setup_required" } });
  return { result: "unpinned" as const, pin: updated };
}

export async function sweepPins(db: Root, now: Date) {
  const due = await db.managedPin.findMany({ where: { status: "pinned", expiresAt: { lte: now } }, take: 50 });
  for (const pin of due) {
    await db.managedPin.update({ where: { id: pin.id }, data: { status: "unpinned", delivery: "setup_required" } });
    await alert(db, { guildId: pin.guildId, kind: "pin.expired", targetId: pin.id, reason: "A bot-managed pin reached its expiry." });
  }
  return due.length;
}

export async function saveSticky(
  db: Root,
  input: {
    guildId: string;
    channelId: string;
    content: string;
    threshold: number;
    cooldownMs: number;
    expiresAt: Date | null;
    status: "active" | "paused";
    actorUserId: string;
    actorRoleIds: readonly string[];
    now: Date;
  },
) {
  const gated = await gate(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  if (!input.channelId.trim() || input.content.trim().length === 0 || input.content.length > 2000) {
    return { result: "invalid" as const };
  }
  if (!Number.isInteger(input.threshold) || input.threshold < 1 || input.threshold > 100 || !Number.isInteger(input.cooldownMs) || input.cooldownMs < 0 || input.cooldownMs > 86_400_000) {
    return { result: "invalid" as const };
  }
  await ensureGuild(db, { guildId: input.guildId });
  const existing = await db.stickyChannel.findUnique({ where: { guildId_channelId: { guildId: input.guildId, channelId: input.channelId } } });
  const sticky = existing
    ? await db.stickyChannel.update({
      where: { id: existing.id },
      data: { content: input.content, threshold: input.threshold, cooldownMs: input.cooldownMs, expiresAt: input.expiresAt, status: input.status, updatedAt: input.now },
    })
    : await db.stickyChannel.create({
      data: {
        id: randomUUID(),
        guildId: input.guildId,
        channelId: input.channelId,
        content: input.content,
        threshold: input.threshold,
        cooldownMs: input.cooldownMs,
        expiresAt: input.expiresAt,
        status: input.status,
        updatedAt: input.now,
      },
    });
  return { result: "saved" as const, sticky };
}

export async function noteStickyMessage(
  db: Root,
  input: { guildId: string; channelId: string; messageId: string | null; authorIsBot: boolean; now: Date },
) {
  const sticky = await db.stickyChannel.findUnique({ where: { guildId_channelId: { guildId: input.guildId, channelId: input.channelId } } });
  if (!sticky) {
    return { result: "missing" as const };
  }
  const decision = stickyStep({
    paused: sticky.status === "paused",
    expired: Boolean(sticky.expiresAt && sticky.expiresAt.getTime() <= input.now.getTime()),
    humanCount: sticky.humanCount,
    threshold: sticky.threshold,
    lastPostedAt: sticky.lastPostedAt,
    now: input.now,
    cooldownMs: sticky.cooldownMs,
    authorIsBot: input.authorIsBot,
    messageId: input.messageId,
    ownMessageId: sticky.currentDeliveryId,
  });
  if (decision === "ignore_bot" || decision === "ignore_own" || decision === "paused" || decision === "expired") {
    return { result: decision, humanCount: sticky.humanCount };
  }
  if (decision === "count" || decision === "cooldown") {
    const updated = await db.stickyChannel.update({ where: { id: sticky.id }, data: { humanCount: sticky.humanCount + 1, updatedAt: input.now } });
    return { result: decision, humanCount: updated.humanCount };
  }
  const deliveryId = randomUUID();
  await db.$transaction(async (tx) => {
    if (sticky.currentDeliveryId) {
      await tx.stickyDelivery.updateMany({ where: { id: sticky.currentDeliveryId, stickyId: sticky.id, status: "current" }, data: { status: "deleted" } });
    }
    await tx.stickyDelivery.create({
      data: {
        id: deliveryId,
        guildId: sticky.guildId,
        stickyId: sticky.id,
        channelId: sticky.channelId,
        content: sticky.content,
        status: "current",
        delivery: "setup_required",
        discordMessageId: null,
      },
    });
    await tx.stickyChannel.update({
      where: { id: sticky.id },
      data: { humanCount: 0, lastPostedAt: input.now, currentDeliveryId: deliveryId, updatedAt: input.now },
    });
  });
  return { result: "repost" as const, deliveryId, delivery: "setup_required" as const };
}

export async function saveReplyRule(
  db: Root,
  input: {
    guildId: string;
    ruleId?: string | null;
    name: string;
    kind: ReplyRuleView["kind"];
    pattern: string;
    priority: number;
    channelIds: string[];
    excludedChannelIds: string[];
    roleIds: string[];
    excludedRoleIds: string[];
    variants: string[];
    visibility: ReplyRuleView["visibility"];
    secret: boolean;
    cooldownMs: number;
    status: "active" | "paused";
    actorUserId: string;
    actorRoleIds: readonly string[];
    now: Date;
  },
) {
  const gated = await gate(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const variants = input.variants.map((variant) => variant.trim()).filter((variant) => variant.length > 0);
  const kinds = new Set(["exact", "keyword", "pattern", "trigger"]);
  const visibilities = new Set(["channel", "dm", "ephemeral"]);
  if (!kinds.has(input.kind) || !visibilities.has(input.visibility) || input.name.trim().length === 0 || input.pattern.trim().length === 0 || variants.length === 0 || variants.length > 8) {
    return { result: "invalid" as const };
  }
  if (variants.some((variant) => variant.length > 500) || !Number.isInteger(input.priority) || input.priority < -100 || input.priority > 100) {
    return { result: "invalid" as const };
  }
  if (!Number.isInteger(input.cooldownMs) || input.cooldownMs < 0 || input.cooldownMs > 86_400_000) {
    return { result: "invalid" as const };
  }
  if (input.kind === "pattern" && !safeReplyPattern(input.pattern)) {
    return { result: "unsafe_pattern" as const };
  }
  await ensureGuild(db, { guildId: input.guildId });
  const data = {
    name: input.name.trim(),
    kind: input.kind,
    pattern: input.pattern,
    priority: input.priority,
    channelIds: asJson(input.channelIds),
    excludedChannelIds: asJson(input.excludedChannelIds),
    roleIds: asJson(input.roleIds),
    excludedRoleIds: asJson(input.excludedRoleIds),
    variants: asJson(variants),
    visibility: input.visibility,
    secret: input.secret,
    cooldownMs: input.cooldownMs,
    status: input.status,
    updatedAt: input.now,
  };
  const existing = input.ruleId ? await db.replyRule.findUnique({ where: { id: input.ruleId } }) : null;
  if (input.ruleId && (!existing || existing.guildId !== input.guildId)) {
    return { result: "missing" as const };
  }
  const rule = existing
    ? await db.replyRule.update({ where: { id: existing.id }, data })
    : await db.replyRule.create({ data: { id: randomUUID(), guildId: input.guildId, ...data } });
  return { result: "saved" as const, rule };
}

function viewOf(rule: {
  id: string;
  kind: string;
  pattern: string;
  priority: number;
  channelIds: unknown;
  excludedChannelIds: unknown;
  roleIds: unknown;
  excludedRoleIds: unknown;
  variants: unknown;
  visibility: string;
  secret: boolean;
  status: string;
}): ReplyRuleView | null {
  if (rule.kind !== "exact" && rule.kind !== "keyword" && rule.kind !== "pattern" && rule.kind !== "trigger") {
    return null;
  }
  if (rule.visibility !== "channel" && rule.visibility !== "dm" && rule.visibility !== "ephemeral") {
    return null;
  }
  if (rule.status !== "active" && rule.status !== "paused") {
    return null;
  }
  return {
    id: rule.id,
    kind: rule.kind,
    pattern: rule.pattern,
    priority: rule.priority,
    channelIds: strings(rule.channelIds),
    excludedChannelIds: strings(rule.excludedChannelIds),
    roleIds: strings(rule.roleIds),
    excludedRoleIds: strings(rule.excludedRoleIds),
    variants: strings(rule.variants),
    visibility: rule.visibility,
    secret: rule.secret,
    status: rule.status,
  };
}

export async function listReplyRules(
  db: Root,
  input: { guildId: string; actorRoleIds: readonly string[] },
) {
  const gated = await gate(db, input);
  if (gated !== "ok") {
    return { result: gated, rules: [] as Array<{ name: string; status: string; pattern: string }> };
  }
  const rows = await db.replyRule.findMany({ where: { guildId: input.guildId }, orderBy: { priority: "desc" } });
  return {
    result: "ready" as const,
    rules: rows.map((row) => ({ name: row.name, status: row.status, pattern: row.pattern })),
  };
}

export async function testReplyRule(
  db: Root,
  input: { guildId: string; text: string; source: "message" | "interaction"; channelId: string; roleIds: string[]; authorIsBot: boolean; pick: number; actorRoleIds: readonly string[] },
) {
  const gated = await gate(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const rows = await db.replyRule.findMany({ where: { guildId: input.guildId } });
  const rules = rows.flatMap((row) => {
    const view = viewOf(row);
    return view ? [view] : [];
  });
  const selected = selectReply(rules, input);
  return { result: "tested" as const, selected, sent: false as const };
}

export async function applyReply(
  db: Root,
  input: { guildId: string; text: string; source: "message" | "interaction"; channelId: string; roleIds: string[]; authorIsBot: boolean; authorId: string; pick: number; now: Date },
) {
  const rows = await db.replyRule.findMany({ where: { guildId: input.guildId, status: "active" } });
  const rules = rows.flatMap((row) => {
    const view = viewOf(row);
    return view ? [view] : [];
  });
  const selected = selectReply(rules, input);
  if (selected.result !== "matched") {
    return { ...selected, sent: false as const };
  }
  const rule = rows.find((row) => row.id === selected.ruleId);
  if (!rule) {
    return { result: "none" as const, excludedRuleIds: selected.excludedRuleIds, sent: false as const };
  }
  const memberKey = { ruleId: rule.id, scope: "member", subjectId: input.authorId };
  const channelKey = { ruleId: rule.id, scope: "channel", subjectId: input.channelId };
  const [member, channel] = await Promise.all([
    db.replyCooldown.findUnique({ where: { ruleId_scope_subjectId: memberKey } }),
    db.replyCooldown.findUnique({ where: { ruleId_scope_subjectId: channelKey } }),
  ]);
  const cooling = (row: { lastAt: Date } | null) => Boolean(row && input.now.getTime() - row.lastAt.getTime() < rule.cooldownMs);
  if (cooling(member) || cooling(channel)) {
    return { result: "cooldown" as const, ruleId: rule.id, sent: false as const };
  }
  await db.replyLog.create({
    data: {
      id: randomUUID(),
      guildId: input.guildId,
      ruleId: rule.id,
      variant: selected.variant,
      visibility: selected.visibility,
      source: input.source,
    },
  });
  for (const key of [memberKey, channelKey]) {
    await db.replyCooldown.upsert({
      where: { ruleId_scope_subjectId: key },
      create: { id: randomUUID(), ...key, lastAt: input.now },
      update: { lastAt: input.now },
    });
  }
  return { ...selected, text: selected.variant, delivery: "setup_required" as const, sent: true as const };
}

export async function saveFeedSource(
  db: Root,
  input: {
    guildId: string;
    sourceId?: string | null;
    name: string;
    adapter: string;
    url: string;
    mode: "automatic" | "approval";
    destination: string;
    status: "active" | "paused";
    actorUserId: string;
    actorRoleIds: readonly string[];
    now: Date;
  },
) {
  const gated = await gate(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  if (input.adapter !== "json") {
    return { result: "unsupported" as const };
  }
  if (input.mode !== "automatic" && input.mode !== "approval") {
    return { result: "invalid" as const };
  }
  if (input.name.trim().length === 0 || (input.mode === "automatic" && input.destination.trim().length === 0)) {
    return { result: "invalid" as const };
  }
  if (input.url.trim().length > 0 && publicHttpUrl(input.url.trim()) !== "allowed") {
    return { result: "invalid" as const };
  }
  await ensureGuild(db, { guildId: input.guildId });
  const data = {
    name: input.name.trim(),
    adapter: input.adapter,
    url: input.url.trim(),
    mode: input.mode,
    destination: input.destination.trim(),
    status: input.status,
    updatedAt: input.now,
  };
  const existing = input.sourceId ? await db.feedSource.findUnique({ where: { id: input.sourceId } }) : null;
  if (input.sourceId && (!existing || existing.guildId !== input.guildId)) {
    return { result: "missing" as const };
  }
  const source = existing
    ? await db.feedSource.update({ where: { id: existing.id }, data })
    : await db.feedSource.create({ data: { id: randomUUID(), guildId: input.guildId, ...data } });
  return { result: "saved" as const, source };
}

export async function pollFeedSource(db: Root, input: { sourceId: string; guildId?: string; now: Date; fetcher?: FeedFetcher }) {
  const source = await db.feedSource.findUnique({ where: { id: input.sourceId } });
  if (!source || (input.guildId && source.guildId !== input.guildId)) {
    return { result: "missing" as const };
  }
  if (source.status !== "active") {
    return { result: "paused" as const, lastExternalId: source.lastExternalId };
  }
  const fetcher = input.fetcher ?? unavailableFeed;
  if (!source.url) {
    await alert(db, { guildId: source.guildId, kind: "feed.unavailable", targetId: source.id, reason: "Feed access is not configured." });
    return { result: "unavailable" as const, lastExternalId: source.lastExternalId, inserted: 0 };
  }
  const fetched = await fetcher(source.url);
  if (!fetched.available) {
    await alert(db, { guildId: source.guildId, kind: "feed.unavailable", targetId: source.id, reason: "The feed could not be read. The last item was kept." });
    return { result: "unavailable" as const, lastExternalId: source.lastExternalId, inserted: 0 };
  }
  const parsed = parseFeedPayload(fetched.payload);
  if (!parsed.ok) {
    await alert(db, { guildId: source.guildId, kind: "feed.unavailable", targetId: source.id, reason: "The feed payload was not a supported update list." });
    return { result: "unavailable" as const, lastExternalId: source.lastExternalId, inserted: 0 };
  }
  const knownRows = await db.feedItem.findMany({ where: { sourceId: source.id } });
  const known = new Set(knownRows.flatMap((row) => [row.externalId, row.canonical]));
  const split = splitFeedItems(known, parsed.items);
  let lastExternalId = source.lastExternalId;
  for (const item of split.fresh) {
    const text = feedPostText(item);
    if (source.mode === "approval") {
      const draft = await db.publicationDraft.create({
        data: {
          id: randomUUID(),
          guildId: source.guildId,
          authorUserId: "feed",
          revision: 1,
          status: "draft",
          label: item.title.slice(0, 80),
          document: asJson({
            content: text.content,
            title: item.title,
            description: item.summary,
            url: item.url,
            color: "",
            authorName: source.name,
            authorUrl: "",
            authorIconUrl: "",
            footerText: item.category,
            footerIconUrl: "",
            timestamp: "",
            imageUrl: "",
            thumbnailUrl: "",
            fields: [],
            buttons: [{ label: "Source", url: item.url }],
            mentionUsers: [],
            mentionRoles: [],
            allowEveryone: false,
            category: "announcements",
            secondApproval: false,
          }),
          updatedAt: input.now,
        },
      });
      await db.feedItem.create({
        data: {
          id: randomUUID(),
          guildId: source.guildId,
          sourceId: source.id,
          externalId: item.externalId,
          canonical: item.canonical,
          title: item.title,
          url: item.url,
          summary: text.content,
          category: item.category,
          mode: source.mode,
          status: "queued",
          draftId: draft.id,
          delivery: "none",
        },
      });
    } else {
      await db.feedItem.create({
        data: {
          id: randomUUID(),
          guildId: source.guildId,
          sourceId: source.id,
          externalId: item.externalId,
          canonical: item.canonical,
          title: item.title,
          url: item.url,
          summary: text.content,
          category: item.category,
          mode: source.mode,
          status: "posted",
          delivery: "setup_required",
        },
      });
    }
    lastExternalId = item.externalId;
  }
  if (split.fresh.length > 0) {
    await db.feedSource.update({ where: { id: source.id }, data: { lastExternalId, updatedAt: input.now } });
  }
  return {
    result: split.fresh.length > 0 ? "recorded" as const : "already_recorded" as const,
    inserted: split.fresh.length,
    replayed: split.replayed.length,
    lastExternalId,
  };
}

export async function readDistribution(db: Root, input: { guildId: string; actorRoleIds: readonly string[] }) {
  const gated = await gate(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const [series, deliveries, pins, stickies, rules, feeds, items, alerts] = await Promise.all([
    db.announcementSeries.findMany({ where: { guildId: input.guildId }, orderBy: { nextRunAt: "asc" } }),
    db.announcementDelivery.findMany({ where: { guildId: input.guildId }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.managedPin.findMany({ where: { guildId: input.guildId }, orderBy: { createdAt: "desc" } }),
    db.stickyChannel.findMany({ where: { guildId: input.guildId } }),
    db.replyRule.findMany({ where: { guildId: input.guildId }, orderBy: { priority: "desc" } }),
    db.feedSource.findMany({ where: { guildId: input.guildId } }),
    db.feedItem.findMany({ where: { guildId: input.guildId }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.distributionAlert.findMany({ where: { guildId: input.guildId }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  return { result: "ok" as const, series, deliveries, pins, stickies, rules, feeds, items, alerts };
}
