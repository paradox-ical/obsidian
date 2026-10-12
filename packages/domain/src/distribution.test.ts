import { describe, expect, it } from "vitest";

import {
  ANNOUNCEMENT_GRACE_MS,
  feedPostText,
  mentionProblems,
  nextOccurrence,
  occurrenceKey,
  parseFeedPayload,
  planDueRuns,
  safeReplyPattern,
  selectReply,
  splitFeedItems,
  stickyStep,
  type AnnouncementSlot,
  type FeedItem,
  type ReplyRuleView,
} from "./distribution.js";

const daily: AnnouncementSlot = {
  cadence: "daily",
  timezone: "Australia/Perth",
  hour: 9,
  minute: 0,
  weekday: null,
  dayOfMonth: null,
  endsAt: null,
};

describe("announcement schedule", () => {
  it("places the next Perth morning and skips a backlog instead of replaying it", () => {
    const after = new Date("2026-10-11T00:00:00.000Z");
    const next = nextOccurrence(daily, after);
    expect(next?.toISOString()).toBe("2026-10-11T01:00:00.000Z");
    const later = nextOccurrence(daily, next ?? after);
    expect(later?.toISOString()).toBe("2026-10-12T01:00:00.000Z");
    expect(occurrenceKey("series", next ?? after, "Australia/Perth")).toBe("series:2026-10-11");

    const missed = planDueRuns(daily, new Date("2026-10-08T01:00:00.000Z"), new Date("2026-10-11T01:30:00.000Z"), "series");
    expect(missed.post).toBeNull();
    expect(missed.skipped.length).toBeGreaterThanOrEqual(3);
    expect(missed.following?.toISOString()).toBe("2026-10-12T01:00:00.000Z");

    const fresh = planDueRuns(daily, new Date("2026-10-11T01:00:00.000Z"), new Date("2026-10-11T01:10:00.000Z"), "series");
    expect(fresh.post?.key).toBe("series:2026-10-11");
    expect(fresh.following?.toISOString()).toBe("2026-10-12T01:00:00.000Z");
    expect(ANNOUNCEMENT_GRACE_MS).toBe(15 * 60 * 1000);
  });

  it("caps explicit mentions", () => {
    expect(mentionProblems({ mentionRoles: ["1", "2", "3", "4", "5", "6"], mentionUsers: [], content: "Hello", allowEveryone: false })).toEqual(["Role mentions exceed 5."]);
    expect(mentionProblems({ mentionRoles: [], mentionUsers: [], content: "Hello @everyone", allowEveryone: false })).toEqual(["everyone and here mentions require the authorised mention flag."]);
  });
});

describe("stickies and replies", () => {
  it("ignores the bot and its own sticky, then reposts after the human threshold", () => {
    const base = { paused: false, expired: false, humanCount: 1, threshold: 2, lastPostedAt: null, now: new Date("2026-10-11T00:00:00.000Z"), cooldownMs: 60_000, messageId: "human", ownMessageId: "sticky-1" };
    expect(stickyStep({ ...base, authorIsBot: true })).toBe("ignore_bot");
    expect(stickyStep({ ...base, authorIsBot: false, messageId: "sticky-1" })).toBe("ignore_own");
    expect(stickyStep({ ...base, authorIsBot: false })).toBe("repost");
  });

  it("refuses an ephemeral reply to an ordinary message and rejects unsafe patterns", () => {
    const rule: ReplyRuleView = {
      id: "clue",
      kind: "trigger",
      pattern: "!server",
      priority: 2,
      channelIds: [],
      excludedChannelIds: ["quiet"],
      roleIds: [],
      excludedRoleIds: [],
      variants: ["one", "two"],
      visibility: "ephemeral",
      secret: true,
      status: "active",
    };
    expect(selectReply([rule], { text: "!server", source: "message", channelId: "general", roleIds: [], authorIsBot: false, pick: 1 }).result).toBe("refused");
    expect(selectReply([rule], { text: "!server", source: "interaction", channelId: "general", roleIds: [], authorIsBot: false, pick: 1 })).toMatchObject({ result: "matched", variant: "two", visibility: "ephemeral" });
    expect(selectReply([rule], { text: "!server", source: "interaction", channelId: "quiet", roleIds: [], authorIsBot: false, pick: 0 })).toMatchObject({ result: "excluded" });
    expect(selectReply([rule], { text: "!server", source: "message", channelId: "general", roleIds: [], authorIsBot: true, pick: 0 }).result).toBe("none");
    expect(safeReplyPattern("(a+)+")).toBe(false);
    expect(safeReplyPattern("server")).toBe(true);
  });
});

describe("game feeds", () => {
  it("keeps source links, labels generated summaries, and separates replays", () => {
    const parsed = parseFeedPayload({
      items: [{ id: "patch-1", title: "Patch 1", url: "https://example.com/patch", summary: "Fixes the gate.", generated: true, category: "patches" }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const item = parsed.items[0] as FeedItem;
    expect(feedPostText(item)).toEqual({ content: "Generated summary.\nFixes the gate.\nhttps://example.com/patch", labelled: true });
    expect(parseFeedPayload({ items: [{ id: "x", title: "Made up", url: "https://example.com/x", category: "rumours" }] }).ok).toBe(false);
    const split = splitFeedItems(new Set(["patch-1"]), parsed.items);
    expect(split.fresh).toHaveLength(0);
    expect(split.replayed).toHaveLength(1);
  });
});
