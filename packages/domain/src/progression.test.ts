import { describe, expect, it } from "vitest";

import {
  activityXpStatus,
  birthdayEditDecision,
  birthdayIsToday,
  chatXpDecision,
  exampleProgressionSettings,
  inviteConfidence,
  peerCommendationDecision,
  prepareProgressionSettings,
  publicDossier,
  readPublicWallet,
  recruitmentDecision,
  voiceXpDecision,
} from "./progression.js";

const now = new Date("2026-10-10T02:00:00.000Z");
const settings = exampleProgressionSettings();

describe("community progression", () => {
  it("rejects farming and publishes a zero Marks wallet", () => {
    const common = {
      channelId: "general",
      excludedChannelIds: ["spam"],
      now,
      lastMessageAt: null,
      cooldownSeconds: settings.messageCooldownSeconds,
      lastHash: null,
      lastHashAt: null,
      repeatWindowSeconds: settings.repeatWindowSeconds,
      minimumLength: settings.minimumMessageLength,
      dailyXp: 0,
      dailyCap: settings.dailyMessageXp,
      messageXp: settings.messageXp,
    };
    expect(chatXpDecision({ ...common, content: null, channelId: "spam" })).toBe("excluded");
    expect(chatXpDecision({ ...common, content: null })).toBe("content_unavailable");
    expect(chatXpDecision({ ...common, content: "hello again" })).toBe("award");
    expect(chatXpDecision({ ...common, content: "hello again", lastMessageAt: now })).toBe("cooldown");
    expect(voiceXpDecision({
      afk: true,
      muted: false,
      deafened: false,
      eligibleHumans: 4,
      minHumans: 2,
      minutes: 30,
      dailyXp: 0,
      dailyCap: 600,
      xpPerMinute: 10,
    })).toEqual({ result: "afk", xp: 0 });
    expect(activityXpStatus()).toBe("module_not_built");
    expect(readPublicWallet()).toMatchObject({ privacy: "public", marks: { status: "available", available: "0.00" }, ingots: { status: "available", available: "0" } });
    expect(prepareProgressionSettings(settings).rankBands).toHaveLength(10);
  });

  it("represents unknown invites and blocks duplicate or early recruitment rewards", () => {
    expect(inviteConfidence({ vanity: false, inviterUserIds: [] }).confidence).toBe("unknown");
    expect(inviteConfidence({ vanity: true, inviterUserIds: ["host"] }).confidence).toBe("vanity");
    expect(inviteConfidence({ vanity: false, inviterUserIds: ["a", "b"] }).confidence).toBe("ambiguous");
    expect(recruitmentDecision({
      confidence: "unknown",
      rejoin: false,
      verifiedAt: now,
      now,
      qualifiedDays: 7,
      alreadyRewarded: false,
      inviterAwardsToday: 0,
      dailyCap: 5,
    })).toBe("unknown");
    expect(recruitmentDecision({
      confidence: "known",
      rejoin: true,
      verifiedAt: now,
      now,
      qualifiedDays: 7,
      alreadyRewarded: false,
      inviterAwardsToday: 0,
      dailyCap: 5,
    })).toBe("rejoin");
    expect(peerCommendationDecision({ fromUserId: "a", toUserId: "a", recentFromSender: 0, pairCount: 0, pairLimit: 1 })).toBe("self");
  });

  it("hides private dossier fields and observes leap-day birthdays without a second edit", () => {
    const view = publicDossier({
      userId: "member",
      xp: 10,
      level: 0,
      rankName: "Recruit",
      bio: "secret bio",
      bioPublic: false,
      birthday: { month: 2, day: 29 },
      birthdayPublic: false,
      title: null,
      frame: null,
      background: null,
      accounts: [],
      achievements: [{ id: "quiet-find", name: "Quiet find", hidden: true, earned: false }],
      commendations: [],
      wallet: readPublicWallet({ availableMinor: 5000n, escrowMinor: 0n, ingotsAvailable: 50n, ingotsEscrow: 0n }),
    });
    expect(view.bio).toBeNull();
    expect(view.birthday).toBeNull();
    expect(view.wallet.marks).toMatchObject({ status: "available", available: "50.00" });
    expect(view.wallet.ingots).toEqual({ status: "available", available: "50", escrow: "0" });
    expect(view.wallet.estimatedWealth.priceSensitive).toBe(true);
    expect(view.inventory.status).toBe("omitted");
    expect(view.achievements).toHaveLength(0);
    expect(birthdayEditDecision({ previousEditAt: now, now, cooldownDays: 30 })).toBe("cooldown");
    expect(birthdayIsToday({
      month: 2,
      day: 29,
      timeZone: "Australia/Perth",
      now: new Date("2026-02-27T16:00:00.000Z"),
      leapDayPolicy: "observe_previous",
    })).toBe(true);
  });
});
