import { describe, expect, it } from "vitest";

import {
  HOUSE_FEE_BPS,
  PREDICTION_RULES,
  bonusDecision,
  drawWinners,
  entryEligibility,
  mediaAllowed,
  splitPool,
  tiedLeaders,
  weightedScore,
} from "./activities.js";

describe("activity settlement", () => {
  it("splits a pool in whole marks and gives the remainder to the earliest tied user", () => {
    expect(HOUSE_FEE_BPS).toBe(0);
    expect(PREDICTION_RULES.tie).toMatch(/refunds every stake/);
    expect(PREDICTION_RULES.noWinner).toMatch(/refunds every stake/);
    expect(PREDICTION_RULES.cancel).toMatch(/refunds every stake/);
    const even = splitPool(10n, [
      { userId: "c", stake: 1n },
      { userId: "a", stake: 1n },
      { userId: "b", stake: 1n },
    ]);
    expect(even).toEqual([
      { userId: "a", payout: 4n },
      { userId: "b", payout: 3n },
      { userId: "c", payout: 3n },
    ]);
    expect(even?.reduce((sum, row) => sum + row.payout, 0n)).toBe(10n);
    expect(splitPool(5n, [
      { userId: "a", stake: 1n },
      { userId: "b", stake: 2n },
    ])).toEqual([
      { userId: "a", payout: 2n },
      { userId: "b", payout: 3n },
    ]);
  });

  it("weights contest scores, caps bonus tickets, and keeps disqualified users out of a redraw", () => {
    expect(entryEligibility({
      requiredRoleId: "verified",
      roleIds: [],
      minAccountDays: 7,
      accountAgeDays: 1,
      attendanceRequired: true,
      attended: false,
    })).toBe("role");
    expect(mediaAllowed("video", ["text"])).toBe(false);
    expect(mediaAllowed("text", ["text"])).toBe(true);
    expect(weightedScore([{ id: "craft", weight: 1 }, { id: "lore", weight: 3 }], { craft: 2, lore: 4 })).toBe(14);
    expect(weightedScore([{ id: "craft", weight: 1 }], {})).toBeNull();
    expect(tiedLeaders([{ entryId: "one", score: 4 }, { entryId: "two", score: 4 }])).toHaveLength(2);
    expect(bonusDecision(1, 1)).toBe("capped");
    expect(drawWinners([{ userId: "a" }, { userId: "a" }, { userId: "b" }], 2, new Set(["a"]), () => 0)).toEqual(["b"]);
  });
});