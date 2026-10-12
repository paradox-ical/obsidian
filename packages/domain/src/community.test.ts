import { describe, expect, it } from "vitest";

import {
  CAPTCHA_ALPHABET,
  MEMBER_FLAG_COMPLETED_ONBOARDING,
  assessCaptchaSubmit,
  beginOwnershipProof,
  captchaAnswerHash,
  captchaAnswerRow,
  decodeCaptchaPng,
  nativeEligibility,
  normalisePanelSelection,
  panelPresentation,
  providerStatuses,
  renderCaptchaPng,
  roleStillHeld,
  selfSelectDecision,
  stackExpiry,
  validateAccessPlan,
  type CommunitySettingsInput,
  type RoleDescriptor,
} from "./community.js";

const now = new Date("2026-10-07T00:00:00.000Z");
const verified: RoleDescriptor = { id: "verified", name: "Verified", position: 1, permissions: "0", managed: false };

const settings: CommunitySettingsInput = {
  verifiedRoleId: "verified",
  assistanceChannelId: "help",
  screeningEnabled: true,
  onboardingEnabled: true,
  pauseEntitlementsWhileAbsent: false,
  channels: [
    { channelId: "rules", label: "rules", audiences: ["pending", "onboarding"] },
    { channelId: "hall", label: "hall", audiences: ["verified"] },
  ],
  progressionRoleIds: [],
  onboardingRoleIds: ["region"],
};

describe("community verification rules", () => {
  it("keeps native rules and onboarding ahead of the CAPTCHA", () => {
    expect(nativeEligibility({ pending: true, flags: MEMBER_FLAG_COMPLETED_ONBOARDING }, settings)).toEqual({
      eligible: false,
      reason: "native_pending",
    });
    expect(nativeEligibility({ pending: false, flags: 0 }, settings)).toEqual({
      eligible: false,
      reason: "onboarding_incomplete",
    });
    expect(nativeEligibility({ pending: null, flags: null }, settings)).toEqual({
      eligible: false,
      reason: "missing_eligibility",
    });
    expect(nativeEligibility({ pending: false, flags: MEMBER_FLAG_COMPLETED_ONBOARDING }, settings)).toEqual({
      eligible: true,
    });
  });

  it("rejects a channel map that hides every onboarding channel", () => {
    expect(
      validateAccessPlan(
        { ...settings, channels: [{ channelId: "hall", label: "hall", audiences: ["verified"] }] },
        [verified],
      ).join(" "),
    ).toMatch(/onboarding/i);
    expect(validateAccessPlan(settings, [verified])).toEqual([]);
  });

  it("expires a challenge without counting a failure and cools down after three wrong answers", () => {
    const base = {
      now,
      expiresAt: new Date(now.getTime() + 60_000),
      invalidated: false,
      expectedHash: captchaAnswerHash("challenge", "ABCDEF"),
      challengeId: "challenge",
      failureCount: 0,
      cooldownUntil: null,
    };
    expect(assessCaptchaSubmit({ ...base, expiresAt: now, answer: "ABCDEF" }).result).toBe("expired");
    const third = assessCaptchaSubmit({ ...base, failureCount: 2, answer: "ZZZZZZ" });
    expect(third).toMatchObject({ result: "incorrect", failureCount: 3 });
    expect(third.result === "incorrect" ? third.cooldownUntil : null).not.toBeNull();
  });

  it("draws a CAPTCHA whose plaintext is not stored beside the image bytes", () => {
    const image = renderCaptchaPng("ABC234");
    expect(Buffer.from(image).includes(Buffer.from("ABC234"))).toBe(false);
    expect(decodeCaptchaPng(image)).toBe("ABC234");
    expect(CAPTCHA_ALPHABET).not.toMatch(/[0OI1L]/);
  });

  it("stacks temporary time and keeps a permanent role after the temporary grant ends", () => {
    const expires = stackExpiry(new Date(now.getTime() + 3 * 86_400_000), now, 7 * 86_400_000);
    expect(expires.getTime() - now.getTime()).toBe(10 * 86_400_000);
    expect(
      roleStillHeld(
        [
          { kind: "permanent", expiresAt: null, pausedRemainingMs: null, endedAt: null },
          { kind: "temporary", expiresAt: now, pausedRemainingMs: null, endedAt: now },
        ],
        now,
      ),
    ).toBe(true);
  });

  it("builds button, select, and reaction controls without offering a protected role", () => {
    const buttons = panelPresentation({
      panelId: "panel-1",
      name: "Region",
      mode: "button",
      selection: "multiple",
      options: [{ roleId: "region", label: "Region", emoji: null }],
    });
    expect(buttons.ok && buttons.components[0]?.components[0]).toMatchObject({ custom_id: "community:role:region" });
    const menu = panelPresentation({
      panelId: "panel-2",
      name: "Platform",
      mode: "select",
      selection: "single",
      options: [
        { roleId: "pc", label: "PC", emoji: null },
        { roleId: "console", label: "Console", emoji: null },
      ],
    });
    expect(menu.ok && menu.components[0]?.components[0]).toMatchObject({ custom_id: "community:select:panel-2", max_values: 1 });
    expect(panelPresentation({
      panelId: "panel-3",
      name: "Interest",
      mode: "reaction",
      selection: "multiple",
      options: [{ roleId: "lore", label: "Lore", emoji: null }],
    })).toMatchObject({ ok: false, reason: "missing_emoji" });
    expect(normalisePanelSelection({
      selection: "single",
      options: [
        { roleId: "pc", exclusiveGroup: null, prerequisiteRoleIds: [] },
        { roleId: "console", exclusiveGroup: null, prerequisiteRoleIds: [] },
      ],
      heldRoleIds: [],
      roleIds: ["pc", "console"],
    })).toEqual({ ok: false, reason: "single" });
    expect(captchaAnswerRow().components[0]).toMatchObject({ custom_id: "community:captcha-modal" });
  });

  it("refuses privileged self-select roles and reports missing provider credentials", () => {
    expect(
      selfSelectDecision({
        role: { id: "admin", name: "Admin", position: 1, permissions: "8", managed: false },
        verifiedRoleId: "verified",
        staffRoleIds: [],
        progressionRoleIds: [],
        botHighestPosition: 5,
      }),
    ).toEqual({ ok: false, reason: "privileged" });
    const steam = providerStatuses({}).find((provider) => provider.provider === "steam");
    expect(steam?.status).toBe("setup_required");
    expect(steam?.missing).toEqual(["STEAM_WEB_API_KEY"]);
    expect(beginOwnershipProof({ provider: "minecraft", ownershipProof: "unavailable", status: "setup_required", missing: [] })).toEqual({
      status: "setup_required",
      reason: "ownership_proof_unavailable",
    });
  });
});
