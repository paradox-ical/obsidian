import { describe, expect, it } from "vitest";

import { ENEMY_SEEDS } from "./world.js";
import {
  ABANDON_MINUTES,
  CREW_ENTRY_RULES,
  applyMedkit,
  checkNext,
  chooseNext,
  crewSizeDecision,
  crewStrike,
  judgeCheck,
  missionBySlug,
  openPosition,
  participation,
  recoveryDeadline,
  scaleForParty,
  settleNode,
  simulateMissionRewards,
  turnMinutes,
} from "./missions.js";

describe("missions and recovery", () => {
  it("branches through a check, a hidden room, and a retreat", () => {
    const mission = missionBySlug("yard-run");
    expect(mission?.regionSlug).toBe("backstreets");
    expect(missionBySlug("dock-signal")?.regionSlug).toBe("black-docks");
    if (!mission) {
      return;
    }
    expect(chooseNext(mission, "gate", "alley")).toBe("listen");
    expect(checkNext(mission, "listen", 1, 5)?.result).toBe("failure");
    expect(judgeCheck(20, 0, 12)).toBe("success");
    const loft = settleNode(mission, "loft", [], []);
    expect(loft.waiting).toBe("combat");
    expect(loft.unbanked).toEqual(["maul"]);
    expect(loft.log.some((line) => line.includes("does not raise the level gate"))).toBe(true);
    const left = settleNode(mission, "retreat", ["bandage"], []);
    expect(left.status).toBe("retreated");
    expect(left.unbanked).toEqual(["bandage"]);
    expect(CREW_ENTRY_RULES.includes("No energy")).toBe(true);
  });

  it("scales a crew, shortens recovery once, and keeps mission rewards inside the published caps", () => {
    const runner = ENEMY_SEEDS.find((enemy) => enemy.slug === "alley-runner");
    expect(runner).toBeDefined();
    if (!runner) {
      return;
    }
    const scaled = scaleForParty(runner, 2, 0);
    expect(scaled.health).toBe(runner.health + 4);
    expect(crewSizeDecision(1)).toBe("short");
    expect(crewSizeDecision(5)).toBe("allowed");
    expect(crewSizeDecision(6)).toBe("full");
    expect(turnMinutes("live")).toBe(2);
    expect(turnMinutes("async")).toBe(30);
    expect(ABANDON_MINUTES).toBe(360);
    expect(participation(1)).toBe("eligible");
    expect(participation(2)).toBe("excluded");
    const now = new Date("2026-10-12T00:00:00.000Z");
    const until = recoveryDeadline(now);
    const first = applyMedkit(now, until, false);
    expect(first.result).toBe("shortened");
    expect(first.until.getTime()).toBe(now.getTime() + 15 * 60 * 1000);
    expect(applyMedkit(now, first.until, true).result).toBe("used");
    const low = applyMedkit(now, new Date(now.getTime() + 10 * 60 * 1000), false);
    expect(low.result).toBe("minimum");
    const strike = crewStrike(12, 0, { attack: 18, damage: [6] }, 0);
    expect(strike.health).toBe(6);
    const rewards = simulateMissionRewards();
    expect(rewards.missionLevel).toBeLessThan(50);
    expect(rewards.combinedLevel).toBe(50);
    expect(rewards.missionMarksMonth).toBeLessThan(rewards.routineMarks);
    expect(rewards.fullMonthRoom).toBe(0);
    expect(rewards.requiredXp).toBe(122_500);
    expect(openPosition().waiting).toBe("choice");
  });
});
