import { describe, expect, it } from "vitest";

import { simulateMonthlyEarnings } from "./economy.js";
import {
  betAllowed,
  blackjackRulesText,
  defaultBlackjackRules,
  drawDealer,
  exactProfit,
  handPayout,
  handTotal,
  orderedShoe,
  presentDealer,
  shuffleShoe,
  simulateBlackjackEconomy,
  worstCaseProfitMinor,
} from "./blackjack.js";

describe("blackjack rules", () => {
  it("pays a natural exactly, stands on soft 17, and keeps the routine month", () => {
    const rules = defaultBlackjackRules();
    expect(orderedShoe(6)).toHaveLength(312);
    expect(new Set(orderedShoe(1)).size).toBe(52);
    const shuffled = shuffleShoe(orderedShoe(1), (max) => max - 1);
    expect(new Set(shuffled).size).toBe(52);
    expect(handTotal(["AS", "6C"])).toEqual({ total: 17, soft: true });
    expect(handTotal(["10S", "7D"])).toEqual({ total: 17, soft: false });
    expect(exactProfit(100n, 3, 2)).toBe(150n);
    expect(exactProfit(1n, 3, 2)).toBeNull();
    expect(worstCaseProfitMinor(100n, rules)).toBe(400n);
    expect(betAllowed(1, rules)).toBe("allowed");
    expect(betAllowed(11, rules)).toBe("bounds");

    const softStand = drawDealer({ cards: ["AH", "6C"], shoe: ["KH"], cursor: 0, hitSoft17: false });
    expect(softStand).toEqual({ cards: ["AH", "6C"], cursor: 0 });
    const softHit = drawDealer({ cards: ["AH", "6C"], shoe: ["KH"], cursor: 0, hitSoft17: true });
    expect(softHit).toEqual({ cards: ["AH", "6C", "KH"], cursor: 1 });

    const natural = handPayout({ cards: ["AS", "KS"], stakeMinor: 100n, fromSplit: false, dealerCards: ["10H", "7D"], rules });
    expect(natural).toEqual({ result: "win", profitMinor: 150n });
    const splitNatural = handPayout({ cards: ["AS", "KS"], stakeMinor: 100n, fromSplit: true, dealerCards: ["KH", "QC"], rules });
    expect(splitNatural).toEqual({ result: "win", profitMinor: 100n });
    const push = handPayout({ cards: ["10S", "QS"], stakeMinor: 100n, fromSplit: false, dealerCards: ["10H", "QC"], rules });
    expect(push).toEqual({ result: "push", profitMinor: 0n });
    const again = handPayout({ cards: ["AS", "KS"], stakeMinor: 100n, fromSplit: false, dealerCards: ["10H", "7D"], rules });
    expect(again).toEqual(natural);
    expect(presentDealer(["10H", "7D"], false)).toEqual([{ card: "10H" }, { hidden: true }]);
    expect(blackjackRulesText(rules).some((line) => line.includes("no hidden forced-loss"))).toBe(true);

    const month = simulateMonthlyEarnings();
    expect(month.routineMarks).toBe(7987);
    expect(month.blackjack.worstPlayerLossMarks).toBe(40);
    expect(month.blackjack.smallRelativeToSlowEconomy).toBe(true);
    expect(month.blackjack.exampleNaturalProfit).toBe("1.50");
    expect(simulateBlackjackEconomy().monthlyRoutineMarks).toBe(7987);
  });
});
