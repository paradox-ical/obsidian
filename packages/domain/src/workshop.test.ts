import { describe, expect, it } from "vitest";

import { affixWindow, priceDecision, rerollMarks, salvageQuote, tradeDue, upgradeQuote, WORKSHOP_RULES } from "./workshop.js";

describe("trades, listings, and gear progression", () => {
  it("publishes guaranteed costs and keeps a reroll inside the shown range", () => {
    expect(WORKSHOP_RULES).toContain("both members confirm");
    expect(WORKSHOP_RULES).toContain("never destroy");
    expect(priceDecision(0)).toBe("allowed");
    expect(priceDecision(-1)).toBe("invalid");
    expect(upgradeQuote(0)).toEqual({ result: "ready", nextTier: 1, marks: 25, material: "scrap", amount: 1 });
    expect(upgradeQuote(3)).toEqual({ result: "capped" });
    expect(salvageQuote(2)).toEqual({ material: "scrap", amount: 3 });
    expect(rerollMarks(0)).toBe(10);
    expect(rerollMarks(2)).toBe(30);
    expect(affixWindow({ slug: "honed", stat: "damage", min: 1, max: 2 })).toEqual({ result: "ready", slug: "honed", stat: "damage", min: 1, max: 2 });
    const now = new Date("2026-10-12T02:00:00.000Z");
    expect(tradeDue(new Date(now.getTime() + 1000), now)).toBe(false);
    expect(tradeDue(now, now)).toBe(true);
  });
});
