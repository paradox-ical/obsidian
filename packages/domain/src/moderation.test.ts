import { describe, expect, it } from "vitest";

import {
  activeWarningPoints,
  attributeAuditActor,
  evaluateRules,
  examplePolicy,
  hierarchyDecision,
  logContent,
  preparePolicy,
  previewRules,
} from "./moderation.js";

const now = new Date("2026-10-07T02:00:00.000Z");

describe("moderation policy", () => {
  it("does not ban because a flood heuristic matches, even when a rule asks for a ban", () => {
    const example = examplePolicy();
    expect(example.rules.every((item) => !item.actions.includes("ban"))).toBe(true);
    expect(example.label).toBe("example");
    const prepared = preparePolicy({
      ...example,
      rules: example.rules.map((item) => (item.id === "example-flood" ? { ...item, actions: ["ban", "warn"] } : item)),
    });
    expect(prepared.banRemoved).toBe(true);
    const decision = evaluateRules(prepared.policy, {
      kind: "message",
      channelId: "general",
      roleIds: [],
      content: "hello",
      mentionCount: 0,
      recentCount: 5,
      repeatedCount: 1,
    });
    expect(decision.ban).toEqual({ applied: false, reason: "automatic_ban_disabled" });
    expect(decision.actions).not.toContain("ban");
    expect(decision.actions).toContain("warn");
    expect(previewRules(prepared.policy, {
      kind: "message",
      channelId: "general",
      roleIds: [],
      content: "https://discord.gg/example",
      mentionCount: 0,
      recentCount: 1,
      repeatedCount: 1,
    }).persisted).toBe(false);
  });

  it("skips excluded channels and hidden message text", () => {
    const policy = preparePolicy({
      ...examplePolicy(),
      rules: examplePolicy().rules.map((item) =>
        item.kind === "flood" ? { ...item, excludedChannelIds: ["staff"] } : item,
      ),
    }).policy;
    expect(evaluateRules(policy, {
      kind: "message",
      channelId: "staff",
      roleIds: [],
      content: "spam",
      mentionCount: 0,
      recentCount: 9,
      repeatedCount: 4,
    }).matches.map((match) => match.kind)).not.toContain("flood");
    expect(evaluateRules(policy, {
      kind: "message",
      channelId: "general",
      roleIds: [],
      content: null,
      mentionCount: 0,
      recentCount: 1,
      repeatedCount: 5,
    }).matches.map((match) => match.kind)).not.toContain("link");
  });

  it("drops expired and reversed points and leaves uncertain actors unknown", () => {
    expect(activeWarningPoints([
      { points: 2, status: "active", expiresAt: new Date(now.getTime() + 1000) },
      { points: 5, status: "active", expiresAt: now },
      { points: 4, status: "reversed", expiresAt: null },
    ], now)).toBe(2);
    expect(attributeAuditActor({
      candidates: [
        { userId: "a", action: "message_delete", targetId: "m1", at: now },
        { userId: "b", action: "message_delete", targetId: "m1", at: now },
      ],
      action: "message_delete",
      targetId: "m1",
      occurredAt: now,
      windowMs: 5_000,
    })).toEqual({ actorUserId: null, confidence: "unknown" });
    expect(attributeAuditActor({
      candidates: [{ userId: "mod", action: "message_delete", targetId: "m1", at: now }],
      action: "message_delete",
      targetId: "m1",
      occurredAt: now,
      windowMs: 5_000,
    })).toEqual({ actorUserId: "mod", confidence: "reliable" });
    expect(logContent({ content: null, channelId: "general", excludedChannelIds: [] }).contentLabel).toBe("unavailable");
    expect(logContent({ content: "secret", channelId: "staff", excludedChannelIds: ["staff"] })).toEqual({
      content: null,
      contentLabel: "excluded",
    });
  });

  it("records a hierarchy miss instead of a successful timeout", () => {
    expect(hierarchyDecision({
      action: "timeout",
      actorPosition: 2,
      targetPosition: 5,
      botPosition: 1,
      botPermissions: String(1n << 40n),
      targetIsOwner: false,
      automated: false,
    })).toEqual({ ok: false, reason: "hierarchy" });
    expect(hierarchyDecision({
      action: "delete",
      actorPosition: 8,
      targetPosition: 2,
      botPosition: 9,
      botPermissions: "0",
      targetIsOwner: false,
      automated: true,
    })).toEqual({ ok: false, reason: "permission" });
  });
});
