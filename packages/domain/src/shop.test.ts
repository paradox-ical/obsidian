import { describe, expect, it } from "vitest";

import { CRATE_POLICY, SHOP_RULES, STEAM_KEY_INGOTS, crateTableDecision, offerOpen, pityDue, publishedOdds, shopPriceDecision } from "./shop.js";

describe("shops and crates", () => {
  it("publishes odds, pity, and the Steam-key boundary", () => {
    expect(SHOP_RULES).toContain("cannot contain one");
    expect(SHOP_RULES).toContain("ranked power budget");
    expect(SHOP_RULES).toContain("does not roll again");
    expect(CRATE_POLICY).toBe("roll_at_acquisition");
    expect(STEAM_KEY_INGOTS).toBe(10);
    expect(shopPriceDecision(0)).toBe("invalid");
    expect(shopPriceDecision(40)).toBe("allowed");
    expect(crateTableDecision([{ kind: "steam_key", weight: 1 }])).toBe("invalid");
    expect(crateTableDecision([{ kind: "material", weight: 70 }, { kind: "cosmetic", weight: 5 }])).toBe("allowed");
    const odds = publishedOdds([{ slug: "scrap", weight: 70 }, { slug: "knife", weight: 25 }, { slug: "glass", weight: 5 }]);
    expect(odds.reduce((sum, entry) => sum + entry.basisPoints, 0)).toBe(10_000);
    expect(odds[0]).toEqual({ slug: "scrap", weight: 70, basisPoints: 7000 });
    expect(pityDue(4, 5)).toBe(true);
    expect(pityDue(3, 5)).toBe(false);
    const now = new Date("2026-10-12T02:00:00.000Z");
    expect(offerOpen(now, null, new Date("2026-10-12T01:00:00.000Z"))).toBe(false);
    expect(offerOpen(now, new Date("2026-10-13T00:00:00.000Z"), null)).toBe(false);
    expect(offerOpen(now, null, null)).toBe(true);
  });
});