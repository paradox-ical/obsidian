import { describe, expect, it } from "vitest";

import {
  LOTTERY_CAP,
  LOTTERY_MIN_ENTRANTS,
  LOTTERY_RULES,
  LOTTERY_STALL_DAYS,
  LOTTERY_TICKET_MARKS,
  entrantsMet,
  lotteryBonusMinor,
  lotteryCapDecision,
  lotteryClockDecision,
  lotteryOdds,
  lotteryPriceDecision,
  lotteryStallDecision,
  nextPerthClock,
} from "./lottery.js";

describe("lottery rules", () => {
  it("reserves half, requires three members, and does not invent a draw time", () => {
    expect(LOTTERY_TICKET_MARKS).toBe(100);
    expect(LOTTERY_CAP).toBe(5);
    expect(LOTTERY_MIN_ENTRANTS).toBe(3);
    expect(LOTTERY_STALL_DAYS).toBe(7);
    expect(lotteryBonusMinor(10_000n)).toBe(5_000n);
    expect(lotteryPriceDecision(100)).toBe("allowed");
    expect(lotteryPriceDecision(0)).toBe("invalid");
    expect(lotteryCapDecision(5)).toBe("allowed");
    expect(lotteryStallDecision(7)).toBe("allowed");
    expect(lotteryStallDecision(0)).toBe("invalid");
    expect(lotteryClockDecision(null, null)).toBe("unset");
    expect(lotteryClockDecision(0, 0)).toBe("allowed");
    expect(lotteryClockDecision(15, null)).toBe("invalid");
    expect(lotteryClockDecision(24, 0)).toBe("invalid");
    expect(entrantsMet(2)).toBe(false);
    expect(entrantsMet(3)).toBe(true);
    expect(lotteryOdds(1, 4)).toBe(2500);
    expect(nextPerthClock(new Date("2026-10-12T02:00:00.000Z"), 15, 0).toISOString()).toBe("2026-10-12T07:00:00.000Z");
    expect(nextPerthClock(new Date("2026-10-12T02:00:00.000Z"), 9, 0).toISOString()).toBe("2026-10-13T01:00:00.000Z");
    expect(LOTTERY_RULES).toContain("50 percent");
    expect(LOTTERY_RULES).toContain("three distinct members");
    expect(LOTTERY_RULES).toContain("not selected");
    expect(LOTTERY_RULES).toContain("does not add that bonus again");
  });
});