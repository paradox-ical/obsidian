import { randomUUID } from "node:crypto";

import { emptyPublicationDraft, validatePublicationDraft } from "@collective/domain";
import { afterAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "./client.js";
import {
  applyReply,
  cancelAnnouncement,
  createAnnouncementSeries,
  noteStickyMessage,
  pauseAnnouncement,
  pinPublication,
  pollFeedSource,
  resumeAnnouncement,
  runAnnouncementSeries,
  saveFeedSource,
  saveReplyRule,
  saveSticky,
  sweepAnnouncementExpiry,
  sweepPins,
  testReplyRule,
} from "./distribution.js";
import { grantCapability } from "./platform.js";
import { approvePublication, savePublicationDraft, sendPublicationPreview } from "./publications.js";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.");
}

const db = createPrismaClient(databaseUrl);
const guildId = `guild-${randomUUID()}`;
const editors = ["editor-role"];
const actor = { guildId, actorUserId: "editor", actorRoleIds: editors };

const document = {
  ...emptyPublicationDraft(),
  content: "Doors open at dusk.",
  title: "Night market",
  description: "Bring a lamp.",
  url: "https://example.com/market",
};

afterAll(async () => {
  await db.distributionAlert.deleteMany({ where: { guildId } });
  await db.replyLog.deleteMany({ where: { guildId } });
  const rules = await db.replyRule.findMany({ where: { guildId } });
  await db.replyCooldown.deleteMany({ where: { ruleId: { in: rules.map((rule) => rule.id) } } });
  await db.replyRule.deleteMany({ where: { guildId } });
  await db.feedItem.deleteMany({ where: { guildId } });
  await db.feedSource.deleteMany({ where: { guildId } });
  await db.stickyDelivery.deleteMany({ where: { guildId } });
  await db.stickyChannel.deleteMany({ where: { guildId } });
  await db.managedPin.deleteMany({ where: { guildId } });
  await db.announcementDelivery.deleteMany({ where: { guildId } });
  await db.announcementSeries.deleteMany({ where: { guildId } });
  await db.publicationHistory.deleteMany({ where: { guildId } });
  await db.publicationMessage.deleteMany({ where: { guildId } });
  await db.publicationReview.deleteMany({ where: { guildId } });
  await db.publicationDraft.deleteMany({ where: { guildId } });
  await db.job.deleteMany({ where: { guildId } });
  await db.auditRecord.deleteMany({ where: { guildId } });
  await db.capabilityGrant.deleteMany({ where: { guildId } });
  await db.guild.deleteMany({ where: { guildId } });
  await db.$disconnect();
});

async function approvedDraft(content: typeof document, now: Date) {
  const saved = await savePublicationDraft(db, { guildId, document: content, actorUserId: "editor", actorRoleIds: editors, now });
  if (saved.result !== "saved") {
    throw new Error(saved.result);
  }
  const preview = await sendPublicationPreview(db, { guildId, draftId: saved.draftId, reviewChannelId: "review", actorUserId: "editor", actorRoleIds: editors, now });
  if (preview.result !== "preview") {
    throw new Error(preview.result);
  }
  const approved = await approvePublication(db, {
    guildId,
    reviewId: preview.reviewId,
    destinationChannelId: "hall",
    mode: "now",
    scheduledFor: null,
    actorUserId: "editor",
    actorRoleIds: editors,
    now,
  });
  if (approved.result !== "recorded") {
    throw new Error(approved.result);
  }
  return { draftId: saved.draftId, messageId: approved.messageId };
}

describe("announcements, pins, stickies, replies, and feeds", () => {
  it("skips missed runs, refuses duplicate and stale posts, and keeps missing feeds quiet", async () => {
    const now = new Date("2026-10-11T00:00:00.000Z");
    expect(await createAnnouncementSeries(db, {
      ...actor,
      draftId: "missing",
      destination: "hall",
      cadence: "daily",
      timezone: "Australia/Perth",
      hour: 9,
      minute: 0,
      weekday: null,
      dayOfMonth: null,
      endsAt: null,
      removeAfterMinutes: null,
      scheduledFor: null,
      now,
    })).toMatchObject({ result: "denied" });

    await grantCapability(db, { guildId, roleId: "editor-role", capability: "publications", actorUserId: "owner", reason: "Open distribution" });
    const noisy = {
      ...document,
      mentionRoles: ["1", "2", "3", "4", "5", "6"],
    };
    const noisyApproved = await approvedDraft(noisy, now);
    expect(await createAnnouncementSeries(db, {
      ...actor,
      draftId: noisyApproved.draftId,
      destination: "hall",
      cadence: "daily",
      timezone: "Australia/Perth",
      hour: 9,
      minute: 0,
      weekday: null,
      dayOfMonth: null,
      endsAt: null,
      removeAfterMinutes: null,
      scheduledFor: null,
      now,
    })).toMatchObject({ result: "mention_limit" });

    const approved = await approvedDraft(document, now);
    const created = await createAnnouncementSeries(db, {
      ...actor,
      draftId: approved.draftId,
      destination: "hall",
      cadence: "daily",
      timezone: "Australia/Perth",
      hour: 9,
      minute: 0,
      weekday: null,
      dayOfMonth: null,
      endsAt: null,
      removeAfterMinutes: null,
      scheduledFor: null,
      now,
    });
    if (created.result !== "scheduled") {
      throw new Error(created.result);
    }
    await db.announcementSeries.update({ where: { id: created.series.id }, data: { nextRunAt: new Date("2026-10-08T01:00:00.000Z") } });
    const missed = await runAnnouncementSeries(db, { seriesId: created.series.id, now: new Date("2026-10-11T01:30:00.000Z") });
    expect(missed).toMatchObject({ result: "skipped" });
    const skippedRows = await db.announcementDelivery.findMany({ where: { seriesId: created.series.id, status: "skipped" } });
    expect(skippedRows.length).toBeGreaterThanOrEqual(3);
    expect(await db.announcementDelivery.count({ where: { seriesId: created.series.id, status: "posted" } })).toBe(0);

    await db.announcementSeries.update({ where: { id: created.series.id }, data: { status: "active", nextRunAt: new Date("2026-10-12T01:00:00.000Z") } });
    const first = await runAnnouncementSeries(db, { seriesId: created.series.id, now: new Date("2026-10-12T01:10:00.000Z") });
    if (first.result !== "posted" || !("deliveryId" in first) || !first.deliveryId) {
      throw new Error(first.result);
    }
    await db.announcementSeries.update({ where: { id: created.series.id }, data: { status: "active", nextRunAt: new Date("2026-10-12T01:00:00.000Z") } });
    expect(await runAnnouncementSeries(db, { seriesId: created.series.id, now: new Date("2026-10-12T01:10:00.000Z") })).toMatchObject({ result: "already_recorded" });
    expect(await db.announcementDelivery.count({ where: { seriesId: created.series.id, status: "posted" } })).toBe(1);

    const second = await runAnnouncementSeries(db, { seriesId: created.series.id, now: new Date("2026-10-13T01:05:00.000Z") });
    if (second.result !== "posted" || !("deliveryId" in second) || !second.deliveryId) {
      throw new Error(second.result);
    }
    expect(second.deliveryId).not.toBe(first.deliveryId);
    const posted = await db.announcementDelivery.findMany({ where: { seriesId: created.series.id, status: "posted" } });
    expect(posted).toHaveLength(2);
    expect(posted.every((row) => row.discordMessageId === null && row.delivery === "setup_required")).toBe(true);

    const paused = await pauseAnnouncement(db, { ...actor, seriesId: created.series.id, now });
    expect(paused.result).toBe("paused");
    await db.announcementSeries.update({ where: { id: created.series.id }, data: { nextRunAt: new Date("2026-10-14T01:00:00.000Z") } });
    expect(await runAnnouncementSeries(db, { seriesId: created.series.id, now: new Date("2026-10-14T01:05:00.000Z") })).toMatchObject({ result: "paused" });
    const resumed = await resumeAnnouncement(db, { ...actor, seriesId: created.series.id, now: new Date("2026-10-14T02:00:00.000Z") });
    if (resumed.result !== "active" || !("series" in resumed)) {
      throw new Error(resumed.result);
    }
    expect(resumed.series.nextRunAt.toISOString()).toBe("2026-10-15T01:00:00.000Z");
    expect(await db.announcementDelivery.count({ where: { seriesId: created.series.id, occurrenceKey: "ignored" } })).toBe(0);
    expect(await cancelAnnouncement(db, { ...actor, seriesId: created.series.id, now })).toMatchObject({ result: "cancelled" });

    const expiring = await approvedDraft({ ...document, title: "Short notice" }, now);
    const short = await createAnnouncementSeries(db, {
      ...actor,
      draftId: expiring.draftId,
      destination: "hall",
      cadence: "once",
      timezone: "Australia/Perth",
      hour: 9,
      minute: 0,
      weekday: null,
      dayOfMonth: null,
      endsAt: null,
      removeAfterMinutes: 15,
      scheduledFor: new Date("2026-10-16T01:00:00.000Z"),
      now,
    });
    if (short.result !== "scheduled") {
      throw new Error(short.result);
    }
    const once = await runAnnouncementSeries(db, { seriesId: short.series.id, now: new Date("2026-10-16T01:05:00.000Z") });
    expect(once.result).toBe("posted");
    expect(await sweepAnnouncementExpiry(db, new Date("2026-10-16T01:20:00.000Z"))).toBe(1);
    expect(await db.announcementDelivery.count({ where: { seriesId: short.series.id, status: "removed" } })).toBe(1);
    expect(await db.announcementDelivery.count({ where: { seriesId: short.series.id } })).toBe(1);

    const pin = await pinPublication(db, { ...actor, messageId: approved.messageId, expiresAt: new Date("2026-10-11T03:00:00.000Z"), now });
    if (pin.result !== "pinned") {
      throw new Error(pin.result);
    }
    const replacement = await pinPublication(db, { ...actor, messageId: approved.messageId, expiresAt: new Date("2026-10-11T04:00:00.000Z"), now });
    expect(replacement.result).toBe("pinned");
    expect(await db.managedPin.count({ where: { guildId, status: "replaced" } })).toBe(1);
    expect(await sweepPins(db, new Date("2026-10-11T04:05:00.000Z"))).toBe(1);
    expect(await db.managedPin.count({ where: { guildId, status: "pinned" } })).toBe(0);

    const sticky = await saveSticky(db, { ...actor, channelId: "hall", content: "Read the rules.", threshold: 2, cooldownMs: 0, expiresAt: null, status: "active", now });
    if (sticky.result !== "saved") {
      throw new Error(sticky.result);
    }
    expect(await noteStickyMessage(db, { guildId, channelId: "hall", messageId: "bot-1", authorIsBot: true, now })).toMatchObject({ result: "ignore_bot" });
    expect((await noteStickyMessage(db, { guildId, channelId: "hall", messageId: "human-1", authorIsBot: false, now })).result).toBe("count");
    const repost = await noteStickyMessage(db, { guildId, channelId: "hall", messageId: "human-2", authorIsBot: false, now });
    if (repost.result !== "repost") {
      throw new Error(repost.result);
    }
    expect(await noteStickyMessage(db, { guildId, channelId: "hall", messageId: repost.deliveryId, authorIsBot: false, now })).toMatchObject({ result: "ignore_own" });
    expect((await noteStickyMessage(db, { guildId, channelId: "hall", messageId: "human-3", authorIsBot: false, now })).result).toBe("count");
    const again = await noteStickyMessage(db, { guildId, channelId: "hall", messageId: "human-4", authorIsBot: false, now });
    expect(again.result).toBe("repost");
    const copies = await db.stickyDelivery.findMany({ where: { stickyId: sticky.sticky.id } });
    expect(copies.filter((copy) => copy.status === "deleted")).toHaveLength(1);
    expect(copies.filter((copy) => copy.status === "current")).toHaveLength(1);
    expect(copies.every((copy) => copy.delivery === "setup_required")).toBe(true);

    expect(await saveReplyRule(db, {
      ...actor,
      name: "Unsafe",
      kind: "pattern",
      pattern: "(a+)+",
      priority: 1,
      channelIds: [],
      excludedChannelIds: [],
      roleIds: [],
      excludedRoleIds: [],
      variants: ["no"],
      visibility: "channel",
      secret: false,
      cooldownMs: 0,
      status: "active",
      now,
    })).toMatchObject({ result: "unsafe_pattern" });
    const quiet = await saveReplyRule(db, {
      ...actor,
      name: "Quiet",
      kind: "keyword",
      pattern: "server",
      priority: 5,
      channelIds: [],
      excludedChannelIds: ["hall"],
      roleIds: [],
      excludedRoleIds: [],
      variants: ["hidden"],
      visibility: "channel",
      secret: false,
      cooldownMs: 0,
      status: "active",
      now,
    });
    const clue = await saveReplyRule(db, {
      ...actor,
      name: "Clue",
      kind: "trigger",
      pattern: "!server",
      priority: 2,
      channelIds: [],
      excludedChannelIds: [],
      roleIds: [],
      excludedRoleIds: [],
      variants: ["The gate is east.", "The gate is west."],
      visibility: "ephemeral",
      secret: true,
      cooldownMs: 60_000,
      status: "active",
      now,
    });
    if (quiet.result !== "saved" || clue.result !== "saved") {
      throw new Error("reply rules were not saved");
    }
    const dashboard = await testReplyRule(db, { guildId, text: "!server", source: "message", channelId: "hall", roleIds: [], authorIsBot: false, pick: 1, actorRoleIds: editors });
    expect(dashboard).toMatchObject({ result: "tested", sent: false });
    if (dashboard.result !== "tested") {
      throw new Error(dashboard.result);
    }
    expect(dashboard.selected).toMatchObject({ result: "refused", reason: "ordinary_message" });
    expect(dashboard.selected.excludedRuleIds).toContain(quiet.rule.id);
    expect(await applyReply(db, { guildId, text: "!server", source: "message", channelId: "hall", roleIds: [], authorIsBot: false, authorId: "member", pick: 1, now })).toMatchObject({ result: "refused" });
    expect(await db.replyLog.count({ where: { guildId } })).toBe(0);
    const spoken = await applyReply(db, { guildId, text: "!server", source: "interaction", channelId: "hall", roleIds: [], authorIsBot: false, authorId: "member", pick: 1, now });
    expect(spoken).toMatchObject({ result: "matched", text: "The gate is west.", visibility: "ephemeral", secret: true, delivery: "setup_required" });
    expect(await applyReply(db, { guildId, text: "!server", source: "interaction", channelId: "hall", roleIds: [], authorIsBot: false, authorId: "member", pick: 0, now: new Date(now.getTime() + 1000) })).toMatchObject({ result: "cooldown" });
    expect(await db.replyLog.count({ where: { guildId } })).toBe(1);

    const missingFeed = await saveFeedSource(db, { ...actor, name: "Official", adapter: "json", url: "", mode: "automatic", destination: "hall", status: "active", now });
    if (missingFeed.result !== "saved") {
      throw new Error(missingFeed.result);
    }
    expect(await pollFeedSource(db, { sourceId: missingFeed.source.id, now })).toMatchObject({ result: "unavailable", inserted: 0, lastExternalId: "" });
    expect(await db.feedItem.count({ where: { sourceId: missingFeed.source.id } })).toBe(0);

    const live = await saveFeedSource(db, { ...actor, sourceId: missingFeed.source.id, name: "Official", adapter: "json", url: "https://example.com/feed.json", mode: "automatic", destination: "hall", status: "active", now });
    if (live.result !== "saved") {
      throw new Error(live.result);
    }
    const payload = { items: [{ id: "patch-1", title: "Patch 1", url: "https://example.com/patch", summary: "Fixes the gate.", generated: true, category: "patches" }] };
    const fetched = await pollFeedSource(db, { sourceId: live.source.id, now, fetcher: async () => ({ available: true, payload }) });
    expect(fetched).toMatchObject({ result: "recorded", inserted: 1, lastExternalId: "patch-1" });
    const item = await db.feedItem.findFirst({ where: { sourceId: live.source.id } });
    expect(item?.url).toBe("https://example.com/patch");
    expect(item?.delivery).toBe("setup_required");
    expect(item?.summary.startsWith("Generated summary.")).toBe(true);
    expect(await pollFeedSource(db, { sourceId: live.source.id, now, fetcher: async () => ({ available: true, payload }) })).toMatchObject({ result: "already_recorded", inserted: 0 });
    expect(await db.feedItem.count({ where: { sourceId: live.source.id } })).toBe(1);
    expect(await pollFeedSource(db, { sourceId: live.source.id, now, fetcher: async () => ({ available: false }) })).toMatchObject({ result: "unavailable", lastExternalId: "patch-1", inserted: 0 });
    expect(await db.feedItem.count({ where: { sourceId: live.source.id } })).toBe(1);

    const queued = await saveFeedSource(db, { ...actor, name: "Queue", adapter: "json", url: "https://example.com/news.json", mode: "approval", destination: "", status: "active", now });
    if (queued.result !== "saved") {
      throw new Error(queued.result);
    }
    await pollFeedSource(db, {
      sourceId: queued.source.id,
      now,
      fetcher: async () => ({ available: true, payload: { items: [{ id: "news-1", title: "Maintenance", url: "https://example.com/news", summary: "Gate closed.", category: "maintenance" }] } }),
    });
    const queuedItem = await db.feedItem.findFirst({ where: { sourceId: queued.source.id } });
    expect(queuedItem?.status).toBe("queued");
    expect(await db.publicationMessage.count({ where: { draftId: queuedItem?.draftId ?? "none" } })).toBe(0);
    const stored = queuedItem?.draftId ? await db.publicationDraft.findUnique({ where: { id: queuedItem.draftId } }) : null;
    expect(validatePublicationDraft(stored?.document).ok).toBe(true);

    const editable = await approvedDraft({ ...document, title: "Changing" }, now);
    const series = await createAnnouncementSeries(db, {
      ...actor,
      draftId: editable.draftId,
      destination: "hall",
      cadence: "daily",
      timezone: "Australia/Perth",
      hour: 9,
      minute: 0,
      weekday: null,
      dayOfMonth: null,
      endsAt: null,
      removeAfterMinutes: null,
      scheduledFor: null,
      now,
    });
    if (series.result !== "scheduled") {
      throw new Error(series.result);
    }
    const edited = await savePublicationDraft(db, { guildId, draftId: editable.draftId, document: { ...document, title: "Changed" }, actorUserId: "editor", actorRoleIds: editors, now });
    expect(edited.result).toBe("saved");
    expect(await runAnnouncementSeries(db, { seriesId: series.series.id, now: new Date("2026-10-11T01:05:00.000Z") })).toMatchObject({ result: "stale" });
    expect(await db.announcementDelivery.count({ where: { seriesId: series.series.id, status: "posted" } })).toBe(0);
    expect(await db.distributionAlert.count({ where: { guildId, kind: "announcement.stale", targetId: series.series.id } })).toBe(1);
  });
});
