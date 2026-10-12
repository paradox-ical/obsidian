import { describe, expect, it } from "vitest";

import {
  claimDecision,
  exampleTicketSettings,
  formGaps,
  inactivityDue,
  memberSummary,
  memberTranscript,
  openingDecision,
  prepareTicketSettings,
  previewTicketSettings,
  referenceIntegration,
  reopenDecision,
  transferDecision,
} from "./tickets.js";

const now = new Date("2026-10-10T00:00:00.000Z");

describe("support tickets", () => {
  it("keeps verification help open to unverified members and never grants general access", () => {
    const settings = prepareTicketSettings({
      ...exampleTicketSettings(),
      categories: exampleTicketSettings().categories.map((category) => ({ ...category, grantsGeneralAccess: true })),
    });
    expect(settings.categories.every((category) => category.grantsGeneralAccess === false)).toBe(true);
    const help = settings.categories.find((category) => category.purpose === "verification_help") ?? null;
    expect(help?.requiresVerified).toBe(false);
    expect(
      openingDecision({
        category: help,
        verified: false,
        openCount: 0,
        lastClosedAt: null,
        now,
        settings,
        maintenance: true,
        source: "member",
      }),
    ).toBe("allowed");
    const general = settings.categories.find((category) => category.purpose === "general") ?? null;
    expect(
      openingDecision({
        category: general,
        verified: false,
        openCount: 0,
        lastClosedAt: null,
        now,
        settings,
        maintenance: false,
        source: "member",
      }),
    ).toBe("verification_required");
    expect(previewTicketSettings(settings).persisted).toBe(false);
    expect(previewTicketSettings(settings).pendingIntegrations.every((item) => item.status === "module_not_built")).toBe(true);
  });

  it("omits staff notes from member transcripts and blocks reopen after retention", () => {
    const summary = memberSummary({
      summary: "Member can see this",
      contentLabel: "available",
      messages: [
        { id: "m1", authorUserId: "member", authorKind: "member", visibility: "member", body: "Need help", contentLabel: "available" },
        { id: "s1", authorUserId: "staff", authorKind: "staff", visibility: "staff", body: "secret-staff-note", contentLabel: "available" },
      ],
    });
    expect(memberTranscript(summary.messages).map((message) => message.body)).toEqual(["Need help"]);
    expect(JSON.stringify(summary)).not.toContain("secret-staff-note");
    expect(reopenDecision({ status: "closed", reopenUntil: new Date("2026-10-09T00:00:00.000Z"), contentLabel: "available", now })).toBe("retention_elapsed");
    expect(reopenDecision({ status: "open", reopenUntil: null, contentLabel: "available", now })).toBe("already_open");
  });

  it("enforces caps, cooldowns, ownership, and unfinished economy references", () => {
    const settings = exampleTicketSettings();
    const general = settings.categories[1] ?? null;
    expect(
      openingDecision({
        category: general,
        verified: true,
        openCount: settings.openCap,
        lastClosedAt: null,
        now,
        settings,
        maintenance: false,
        source: "member",
      }),
    ).toBe("capped");
    expect(
      openingDecision({
        category: general,
        verified: true,
        openCount: 0,
        lastClosedAt: new Date(now.getTime() - 60_000),
        now,
        settings,
        maintenance: false,
        source: "member",
      }),
    ).toBe("cooldown");
    const help = settings.categories.find((category) => category.id === "verification-help");
    if (!help) {
      throw new Error("Verification help category is missing.");
    }
    expect(formGaps(help, {})).toEqual(["need"]);
    expect(claimDecision({ assigneeUserId: null, actorUserId: "staff", staff: false })).toBe("denied");
    expect(transferDecision({ staff: true, targetStaff: false, assigneeUserId: "staff", targetUserId: "former" })).toBe("denied");
    expect(referenceIntegration("purchase")).toBe("module_not_built");
    expect(referenceIntegration("reward")).toBe("module_not_built");
    expect(referenceIntegration("moderation_case")).toBe("linked");
    expect(
      inactivityDue({
        status: "open",
        lastHumanAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        remindedAt: null,
        now,
        reminderHours: 1,
        closeHours: 3,
      }),
    ).toBe("remind");
  });
});
