import { describe, expect, it } from "vitest";

import {
  CONTRACT_SEEDS,
  answerHash,
  answerMatches,
  cappedPayout,
  closedDmPlan,
  completionDelivery,
  completionReward,
  cycleDeadline,
  cycleId,
  objectiveAvailability,
  pickObjectives,
  rerollDecision,
  versionApplies,
} from "./contracts.js";

describe("contract cycles and payouts", () => {
  it("splits Perth midnights and ISO weeks from the local calendar", () => {
    expect(cycleId(new Date("2026-10-11T15:59:00.000Z"), "daily")).toBe("daily:2026-10-11");
    expect(cycleId(new Date("2026-10-11T16:00:00.000Z"), "daily")).toBe("daily:2026-10-12");
    expect(cycleId(new Date("2026-10-11T15:59:00.000Z"), "weekly")).toBe("weekly:2026-W41");
    expect(cycleId(new Date("2026-10-11T16:00:00.000Z"), "weekly")).toBe("weekly:2026-W42");
    expect(cycleId(new Date("2026-10-13T15:59:00.000Z"), "weekly")).toBe("weekly:2026-W42");
    expect(cycleId(new Date("2026-10-13T16:00:00.000Z"), "weekly")).toBe("weekly:2026-W42");
    expect(cycleId(new Date("2026-10-13T16:00:00.000Z"), "daily")).toBe("daily:2026-10-14");
    expect(cycleId(new Date("2026-10-31T15:59:00.000Z"), "monthly")).toBe("monthly:2026-10");
    expect(cycleId(new Date("2026-10-31T16:00:00.000Z"), "monthly")).toBe("monthly:2026-11");
    expect(cycleDeadline("daily:2026-10-11").toISOString()).toBe("2026-10-11T16:00:00.000Z");
    expect(cycleDeadline("weekly:2026-W41").toISOString()).toBe("2026-10-11T16:00:00.000Z");
    expect(cycleDeadline("monthly:2026-10").toISOString()).toBe("2026-10-31T16:00:00.000Z");
  });

  it("allows one unstarted daily reroll and keeps muted pings from the reward", () => {
    expect(rerollDecision({ board: "daily", progress: 0, rerollsUsed: 0 })).toBe("allowed");
    expect(rerollDecision({ board: "daily", progress: 1, rerollsUsed: 0 })).toBe("started");
    expect(rerollDecision({ board: "daily", progress: 0, rerollsUsed: 1 })).toBe("used");
    expect(rerollDecision({ board: "weekly", progress: 0, rerollsUsed: 0 })).toBe("wrong_board");
    expect(cappedPayout(50, 50, 80)).toEqual({ payable: 30, reduced: true, capped: false });
    expect(cappedPayout(50, 80, 80)).toEqual({ payable: 0, reduced: false, capped: true });
    expect(versionApplies("migrate", 0)).toBe("migrate");
    expect(versionApplies("migrate", 1)).toBe("keep");
    expect(versionApplies("preserve", 0)).toBe("keep");
    expect(objectiveAvailability("chat_messages")).toBe("ready");
    expect(objectiveAvailability("rpg_exploration")).toBe("ready");
    expect(objectiveAvailability("rpg_pve")).toBe("ready");
    expect(objectiveAvailability("rpg_crafting")).toBe("ready");
    expect(objectiveAvailability("rpg_pvp")).toBe("ready");
    expect(closedDmPlan("dm")).toBe("fail_private");
    expect(completionDelivery(false)).toBe("skip");
    expect(completionReward(false)).toBe("pay");
    expect(answerMatches(" A Clock ", answerHash("a clock"))).toBe(true);
  });

  it("seeds shared caps and keeps RPG hooks out of the daily pool", () => {
    const weekly = CONTRACT_SEEDS.filter((seed) => seed.weeklyPool);
    const monthly = CONTRACT_SEEDS.filter((seed) => seed.monthlyPool);
    const daily = CONTRACT_SEEDS.filter((seed) => seed.dailyPool);
    expect(weekly.reduce((sum, seed) => sum + seed.rewardMarks, 0)).toBe(250);
    expect(monthly.reduce((sum, seed) => sum + seed.rewardMarks, 0)).toBe(500);
    expect(daily.length).toBeGreaterThanOrEqual(4);
    expect(daily.every((seed) => objectiveAvailability(seed.kind) === "ready")).toBe(true);
    expect(CONTRACT_SEEDS.filter((seed) => seed.kind === "rpg_crafting" || seed.kind === "rpg_pvp" || seed.kind === "rpg_exploration" || seed.kind === "rpg_pve").every((seed) => !seed.dailyPool && !seed.weeklyPool && !seed.monthlyPool)).toBe(true);
    const picked = pickObjectives(daily.map((seed) => ({ id: seed.slug, band: seed.band })), 3, "member:daily:2026-10-11");
    expect(picked).toHaveLength(3);
    expect(new Set(picked.map((row) => row.band))).toEqual(new Set(["easy", "medium", "hard"]));
    expect(pickObjectives(daily.map((seed) => ({ id: seed.slug, band: seed.band })), 3, "member:daily:2026-10-11").map((row) => row.id)).toEqual(picked.map((row) => row.id));
  });
});
