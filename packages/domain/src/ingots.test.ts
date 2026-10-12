import { describe, expect, it } from "vitest";

import {
  integratedBuyMarks,
  integratedSellMarks,
  nextUnitBuyMarks,
  redemptionLiabilityMarks,
  simulateSupplyConservation,
} from "./ingots.js";

describe("ingot scarcity curve", () => {
  it("matches the seeded quotes and refuses a flat or multiplied price", () => {
    expect(nextUnitBuyMarks(2_500n)).toBe(10_000n);
    expect(nextUnitBuyMarks(2_000n)).toBe(19_532n);
    expect(nextUnitBuyMarks(1_250n)).toBe(80_000n);
    expect(nextUnitBuyMarks(500n)).toBe(1_250_000n);
    expect(nextUnitBuyMarks(250n)).toBe(10_000_000n);
    expect(nextUnitBuyMarks(1n)).toBe(156_250_000_000_000n);
    expect(nextUnitBuyMarks(0n)).toBeNull();
    const two = integratedBuyMarks(2_500n, 2n);
    expect(two).toBe(10_000n + (nextUnitBuyMarks(2_499n) ?? 0n));
    expect(two).not.toBe(20_000n);
    expect(two !== null && two > 20_000n).toBe(true);
  });

  it("pays the pre-trade unit on a sell and cannot profit on a round trip", () => {
    const paid = integratedBuyMarks(2_500n, 1n);
    const proceeds = integratedSellMarks(2_499n, 1n);
    expect(paid).toBe(10_000n);
    expect(proceeds).toBe(9_500n);
    expect(proceeds !== null && paid !== null && proceeds < paid).toBe(true);
    expect(integratedSellMarks(1_999n, 1n)).toBe(18_555n);
    expect(redemptionLiabilityMarks(2_500n)).toBe(0n);
    expect(redemptionLiabilityMarks(2_499n)).toBe(10_000n);
  });

  it("keeps every simulated shop and event movement inside 5,000", () => {
    const simulation = simulateSupplyConservation();
    expect(simulation.conserved).toBe(true);
    expect(simulation.total).toBe("5000");
    expect(simulation.steps).toHaveLength(10);
    expect(simulation.futureUse.some((line) => line.includes("does not withdraw Marks backing"))).toBe(true);
    expect(simulation.futureUse.some((line) => line.includes("empty treasury"))).toBe(true);
  });
});
