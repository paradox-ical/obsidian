import { describe, expect, it } from "vitest";

import { blankFighter } from "./combat.js";
import {
  DIFFICULTY_TIERS,
  ENEMY_SEEDS,
  REGION_SEEDS,
  catalogCounts,
  cooldownDecision,
  enemyForDifficulty,
  lootEligibility,
  pickLoot,
  regionAccess,
  reservedModifiers,
  resolveEncounter,
  slotDecision,
  xpGrant,
  type LootEntry,
} from "./world.js";

describe("regions and expeditions", () => {
  it("keeps the launch catalogue inside the seeded targets", () => {
    const counts = catalogCounts();
    expect(REGION_SEEDS.map((region) => region.level)).toEqual([1, 15, 35]);
    expect(counts.regions).toBe(3);
    expect(counts.enemies).toBe(15);
    expect(counts.bosses).toBe(3);
    expect(counts.gear).toBeGreaterThanOrEqual(40);
    expect(counts.gear).toBeLessThanOrEqual(60);
    expect(counts.lootTables).toBe(9);
    expect(ENEMY_SEEDS.every((enemy) => enemy.summary.length > 20 && enemy.health > 0 && enemy.diceSides >= 4)).toBe(true);
    expect(regionAccess(14, 15)).toBe("level");
    expect(regionAccess(15, 15)).toBe("allowed");
    expect(slotDecision(0)).toBe("allowed");
    expect(slotDecision(1)).toBe("busy");
  });

  it("caps expedition experience and refuses unavailable gear", () => {
    expect(xpGrant(160, 300)).toBe(100);
    expect(xpGrant(40, 400)).toBe(0);
    expect(cooldownDecision(new Date("2026-10-11T06:00:00.000Z"), new Date("2026-10-11T06:10:00.000Z"))).toBe("cooling");
    expect(lootEligibility({ status: "retired", itemClass: "", classSlug: "hitman", level: 10, itemLevel: 1 })).toBe("unavailable");
    expect(lootEligibility({ status: "active", itemClass: "bruiser", classSlug: "hitman", level: 20, itemLevel: 10 })).toBe("unavailable");
    expect(lootEligibility({ status: "active", itemClass: "", classSlug: "hitman", level: 1, itemLevel: 1 })).toBe("available");
    const entries: LootEntry[] = [
      { templateSlug: "field-knife", weight: 1, source: "expedition" },
      { templateSlug: "maul", weight: 1, source: "expedition" },
    ];
    expect(pickLoot(entries, 2)?.templateSlug).toBe("maul");
    expect(reservedModifiers(["smoke", "antitoxin", "bandage"])).toEqual({ accuracy: 1, defence: 1, itemLimit: 1 });
    expect(DIFFICULTY_TIERS.severe.xp).toBeGreaterThan(DIFFICULTY_TIERS.routine.xp);
    expect(enemyForDifficulty(ENEMY_SEEDS, "backstreets", "routine")?.slug).toBe("alley-runner");
    expect(enemyForDifficulty(ENEMY_SEEDS, "backstreets", "severe")?.boss).toBe(true);
  });

  it("applies stun and execute from the stored rolls", () => {
    const member = blankFighter("member", "Hitman");
    member.reactionReady = false;
    const stun = ENEMY_SEEDS.find((enemy) => enemy.slug === "street-bruiser");
    const execute = ENEMY_SEEDS.find((enemy) => enemy.slug === "yard-captain");
    expect(stun).toBeDefined();
    expect(execute).toBeDefined();
    if (!stun || !execute) {
      return;
    }
    const stunned = resolveEncounter(member, { ...stun, health: 40 }, [{ attack: 1, damage: [1] }, { attack: 18, damage: [4] }, { attack: 15, damage: [4] }]);
    expect(stunned.log.some((line) => line.includes("stuns"))).toBe(true);
    expect(stunned.log.some((line) => line.includes("stunned"))).toBe(true);
    const executed = resolveEncounter(member, { ...execute, health: 40 }, [{ attack: 1, damage: [1] }, { attack: 20, damage: [6] }]);
    expect(executed.log.some((line) => line.includes("executes for 4."))).toBe(true);
  });
});
