import { describe, expect, it } from "vitest";

import { emptyPublicWallet, formatMinor, marksHoldDecision, marksToMinor, marksTransferDecision, simulateMonthlyEarnings } from "./economy.js";

describe("marks ledger rules", () => {
  it("keeps the reference month below 10,000 and allows a funded exception", () => {
    const routine = simulateMonthlyEarnings();
    expect(routine.routineMarks).toBe(7987);
    expect(routine.monthsToReachTarget).toBe(2);
    expect(routine.lines.map((line) => line.marks)).toEqual([2400, 1087, 500, 4000]);
    const winner = simulateMonthlyEarnings({ exceptionalMarks: 5_000 });
    expect(winner.routineMarks).toBe(7987);
    expect(winner.totalMarks).toBe(12_987);
    expect(winner.assumptions.some((line) => line.includes("share this one monthly total"))).toBe(true);
  });

  it("refuses a spend that would pass the available balance", () => {
    const amount = marksToMinor(25);
    expect(amount).toBe(2500n);
    expect(marksHoldDecision(2499n, amount ?? 0n)).toBe("insufficient");
    expect(marksHoldDecision(2500n, amount ?? 0n)).toBe("allowed");
    expect(marksTransferDecision({
      fromUserId: "a",
      toUserId: "b",
      amountMinor: 100n,
      availableMinor: 50n,
      recentTransfer: false,
      sentTodayMinor: 0n,
      maxMinor: 1000n,
      dailyMinor: 5000n,
    })).toBe("insufficient");
    expect(formatMinor(-150n)).toBe("-1.50");
    expect(emptyPublicWallet().privacy).toBe("public");
    expect(emptyPublicWallet().ingots).toEqual({ status: "available", available: "0", escrow: "0" });
    expect(emptyPublicWallet().estimatedWealth).toMatchObject({ label: "estimated", priceSensitive: true, marks: "0.00" });
  });
});
