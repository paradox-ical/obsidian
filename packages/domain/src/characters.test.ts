import { describe, expect, it } from "vitest";

import {
  CHARACTER_LEVEL_CAP,
  CLASS_SEEDS,
  STAT_CAPS,
  applyCharacterXp,
  attackPreview,
  diminishingBonus,
  earnedPoints,
  gearAfterClassChange,
  introResetDecision,
  paidResetDecision,
  pointLedger,
  simulateRegularPlay,
  statEffect,
} from "./characters.js";

describe("character progression", () => {
  it("caps at level 50 and grants three points per level gained", () => {
    expect(earnedPoints(1)).toBe(0);
    expect(earnedPoints(50)).toBe(147);
    const climbed = applyCharacterXp({ level: 1, xp: 0, gain: 200_000 });
    expect(climbed.level).toBe(CHARACTER_LEVEL_CAP);
    expect(climbed.pointsGained).toBe(147);
    expect(pointLedger({ level: 50, strength: 40, agility: 40, endurance: 40, focus: 27, unspent: 0 })).toBe("conserved");
    expect(pointLedger({ level: 2, strength: 0, agility: 0, endurance: 0, focus: 0, unspent: 4 })).toBe("broken");
  });

  it("keeps stacked accuracy and defence from deciding every attack", () => {
    expect(diminishingBonus(0, STAT_CAPS.agility)).toBe(0);
    expect(statEffect("agility", 4, 80).bonus).toBeLessThanOrEqual(STAT_CAPS.agility);
    expect(statEffect("endurance", 3, 80).bonus).toBeLessThanOrEqual(STAT_CAPS.endurance);
    const accuracy = STAT_CAPS.agility;
    const defence = STAT_CAPS.endurance;
    expect(attackPreview({ roll: 1, accuracy, defence })).toBe("miss");
    expect(attackPreview({ roll: 2, accuracy, defence })).toBe("miss");
    expect(attackPreview({ roll: 20, accuracy, defence })).toBe("critical");
    expect(attackPreview({ roll: 12, accuracy, defence: 0 })).toBe("hit");
  });

  it("seeds six solo classes and reaches level 50 in the six-month assumption", () => {
    expect(CLASS_SEEDS.map((row) => row.slug)).toEqual(["hitman", "bruiser", "saboteur", "fixer", "duelist", "gunslinger"]);
    for (const seed of CLASS_SEEDS) {
      const starters = seed.abilities.filter((ability) => ability.kind === "active" && ability.unlockLevel === 1);
      expect(starters.length).toBeGreaterThanOrEqual(2);
      expect(seed.abilities.some((ability) => ability.kind === "passive")).toBe(true);
      expect(Object.values(seed.base).reduce((sum, value) => sum + value, 0)).toBe(8);
    }
    const regular = simulateRegularPlay();
    expect(regular.level).toBe(50);
    expect(regular.requiredXp).toBe(122_500);
    expect(simulateRegularPlay({ weeks: 4 }).level).toBeLessThan(50);
    expect(introResetDecision({ level: 9, used: false, ranked: false, locked: false })).toBe("allowed");
    expect(introResetDecision({ level: 10, used: false, ranked: false, locked: false })).toBe("level");
    expect(introResetDecision({ level: 4, used: true, ranked: false, locked: false })).toBe("used");
    expect(paidResetDecision({ locked: false, availableAt: null, now: new Date(), balanceMarks: 4_999, cost: 5_000 })).toBe("unaffordable");
    expect(gearAfterClassChange([{ id: "a", classSlug: "hitman", equipped: true }, { id: "b", classSlug: "", equipped: true }], "bruiser")).toEqual([
      { id: "a", classSlug: "hitman", equipped: false },
      { id: "b", classSlug: "", equipped: true },
    ]);
  });
});
