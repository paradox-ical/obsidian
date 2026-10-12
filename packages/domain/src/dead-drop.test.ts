import { describe, expect, it } from "vitest";

import {
  DEAD_DROP_ASSETS,
  DEAD_DROP_PICK_CAP,
  assignDeadDropCells,
  boardCommitment,
  deadDropClockDecision,
  deadDropCoordinates,
  deadDropSplit,
  deadDropWindowOpen,
  nextDeadDropWindow,
  parseCoordinate,
  perthDeadDropWindow,
  presentDeadDropCell,
  renderDeadDropGrid,
} from "./dead-drop.js";

describe("dead drop board", () => {
  it("renders one shared template and keeps the hour unset", () => {
    expect(deadDropCoordinates()).toHaveLength(36);
    expect(new Set(deadDropCoordinates()).size).toBe(36);
    expect(parseCoordinate("b3")).toBe("B3");
    expect(parseCoordinate("A7")).toBeNull();
    expect(deadDropClockDecision(null, null)).toBe("unset");
    expect(DEAD_DROP_PICK_CAP).toBe(3);
    expect(deadDropSplit(10_000n, 5000)).toEqual({ shareMinor: 5_000n, treasuryMinor: 5_000n });

    const now = new Date("2026-10-12T02:00:00.000Z");
    const window = perthDeadDropWindow(now, 10, 0);
    expect(window.opensAt.toISOString()).toBe("2026-10-12T02:00:00.000Z");
    expect(window.closesAt.toISOString()).toBe("2026-10-12T03:00:00.000Z");
    expect(deadDropWindowOpen(now, window.opensAt, window.closesAt)).toBe(true);
    const following = nextDeadDropWindow(window.opensAt);
    expect(following.opensAt.toISOString()).toBe("2026-10-13T02:00:00.000Z");
    expect(following.opensAt.getTime() - window.opensAt.getTime()).toBe(24 * 60 * 60 * 1000);

    const cells = assignDeadDropCells({ random: (max) => max - 1, smallCount: 4, smallPayload: "2000", specialKind: "collapse", specialPayload: "charge" });
    expect(cells).toHaveLength(36);
    expect(cells.filter((cell) => cell.kind === "jackpot")).toHaveLength(1);
    expect(cells.filter((cell) => cell.kind === "small")).toHaveLength(4);
    expect(cells.filter((cell) => cell.kind === "collapse")).toHaveLength(1);
    const other = assignDeadDropCells({ random: () => 0, smallCount: 4, smallPayload: "2000", specialKind: "collapse", specialPayload: "charge" });
    expect(boardCommitment(cells)).not.toBe(boardCommitment(other));

    const hidden = cells.map((cell) => presentDeadDropCell({ ...cell, status: "covered", userId: "" }));
    expect(new Set(hidden.map((cell) => cell.asset))).toEqual(new Set([DEAD_DROP_ASSETS.back]));
    expect(hidden.some((cell) => "kind" in cell)).toBe(false);
    const revealed = presentDeadDropCell({ coordinate: "A1", status: "revealed", kind: "jackpot", userId: "alpha" });
    expect(revealed.asset).toBe(DEAD_DROP_ASSETS.jackpot);
    const grid = renderDeadDropGrid(hidden);
    expect(grid).toContain("A1 dead-drop-card-back");
    expect(grid).toContain("F6 dead-drop-card-back");
    expect(new Set(hidden.map((cell) => cell.asset)).size).toBe(1);
  });
});
