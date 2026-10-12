import { describe, expect, it } from "vitest";

import {
  PAIR_LIMIT,
  PVP_RULES,
  RANKED_GEAR_BUDGET,
  RANKED_STAT_BUDGET,
  STARTING_RATING,
  disconnectDue,
  forfeitAfterMisses,
  pairDecision,
  queueTolerance,
  rankedAllocation,
  ratingDelta,
  stakeDecision,
  stakesMatch,
  suspiciousPattern,
} from "./pvp.js";

describe("ranked queues, challenges, and wagers", () => {
  it("publishes the ranked budget and keeps a repeated pair casual", () => {
    expect(PVP_RULES).toContain("12-point");
    expect(PVP_RULES).toContain("casual before");
    expect(RANKED_STAT_BUDGET).toBe(12);
    expect(RANKED_GEAR_BUDGET).toBe(8);
    expect(pairDecision(PAIR_LIMIT - 1)).toBe("ranked");
    expect(pairDecision(PAIR_LIMIT)).toBe("casual");
    expect(rankedAllocation({ strength: 40, agility: 40, endurance: 40, focus: 27 })).toEqual({ strength: 4, agility: 3, endurance: 3, focus: 2 });
    expect(rankedAllocation({ strength: 1, agility: 0, endurance: 0, focus: 0 })).toEqual({ strength: 1, agility: 0, endurance: 0, focus: 0 });
    expect(stakeDecision(0)).toBe("allowed");
    expect(stakeDecision(1001)).toBe("invalid");
    expect(stakesMatch(10, 10)).toBe(true);
    expect(stakesMatch(10, 0)).toBe(false);
  });

  it("moves equal ratings by 16 and flags an alternating wager", () => {
    expect(ratingDelta(STARTING_RATING, STARTING_RATING, 1)).toBe(16);
    expect(ratingDelta(STARTING_RATING, STARTING_RATING, 0)).toBe(-16);
    expect(ratingDelta(STARTING_RATING, STARTING_RATING, 0.5)).toBe(0);
    expect(queueTolerance(0)).toBe(100);
    expect(queueTolerance(8)).toBe(400);
    const now = new Date("2026-10-12T02:00:00.000Z");
    expect(disconnectDue(new Date(now.getTime() - 60 * 1000), now)).toBe(false);
    expect(disconnectDue(new Date(now.getTime() - 2 * 60 * 1000), now)).toBe(true);
    expect(forfeitAfterMisses(1)).toBe(false);
    expect(forfeitAfterMisses(2)).toBe(true);
    expect(suspiciousPattern(["alpha", "beta", "alpha"], [10, 10, 10])).toBe(true);
    expect(suspiciousPattern(["alpha", "alpha", "alpha"], [10, 10, 10])).toBe(false);
    expect(suspiciousPattern(["alpha", "beta"], [10, 10])).toBe(false);
  });
});
