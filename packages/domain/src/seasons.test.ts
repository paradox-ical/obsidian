import { describe, expect, it } from "vitest";

import {
  VOICE_EMPTY_MS,
  applyRoomMessage,
  applyVoicePresence,
  cleanupDecision,
  exampleSeasonSettings,
  holdDecision,
  leaderboardView,
  pollCreateDecision,
  prepareSeasonSettings,
  preservationManifest,
  presentPollResults,
  rankStandings,
  roomCreateDecision,
  seasonWindow,
  transferOwner,
  voteDecision,
} from "./seasons.js";

describe("seasons, polls, and rooms", () => {
  it("uses three calendar months and keeps the next boundary exclusive", () => {
    const now = new Date("2026-10-10T02:00:00.000Z");
    const window = seasonWindow(now, 1, "Australia/Perth");
    expect(window.id).toBe("2026-10");
    expect(window.startsAt.toISOString()).toBe("2026-09-30T16:00:00.000Z");
    expect(window.endsAt.toISOString()).toBe("2026-12-31T16:00:00.000Z");
    expect(seasonWindow(window.endsAt, 1, "Australia/Perth").id).toBe("2027-01");
    expect(seasonWindow(now, 2, "Australia/Perth").id).toBe("2026-08");
  });

  it("pages public standings and leaves currency boards pending", () => {
    const page = rankStandings(
      [
        { userId: "treasury", score: 99 },
        { userId: "alpha", score: 40 },
        { userId: "beta", score: 20 },
      ],
      exampleSeasonSettings().systemUserIds,
      1,
      1,
      "beta",
    );
    expect(page.rows).toEqual([{ userId: "alpha", score: 40, position: 1 }]);
    expect(page.ownPosition).toBe(2);
    expect(leaderboardView("marks").availability).toBe("available");
    expect(leaderboardView("ingots").availability).toBe("available");
    expect(leaderboardView("estimated_wealth")).toMatchObject({ label: "estimated", priceSensitive: true, availability: "available" });
    expect(preservationManifest().wallet).toEqual({ status: "retained", retained: true });
    expect(prepareSeasonSettings({ ...exampleSeasonSettings(), startMonth: 0 }).startMonth).toBe(1);
  });

  it("denies member polls, excludes suggestions, and hides anonymous voters", () => {
    expect(pollCreateDecision({ allowed: false, kind: "poll", moduleAvailable: true })).toBe("denied");
    expect(pollCreateDecision({ allowed: true, kind: "suggestion", moduleAvailable: true })).toBe("excluded");
    const opensAt = new Date("2026-10-01T00:00:00.000Z");
    const closesAt = new Date("2026-10-20T00:00:00.000Z");
    expect(voteDecision({ status: "open", opensAt, closesAt, now: new Date("2026-10-10T00:00:00.000Z"), eligibleRoleIds: ["voters"], voterRoleIds: [] })).toBe("ineligible");
    const shown = presentPollResults({
      anonymous: true,
      audience: "member",
      choices: [{ id: "yes", label: "Yes" }],
      votes: [{ choiceId: "yes", userId: "member" }],
    });
    expect(shown.counts[0]?.voterIds).toEqual([]);
    expect(shown.retention).toContain("remain stored");
  });

  it("cancels voice deletion on join, ignores bot text, and has no maximum lifetime", () => {
    const emptySince = new Date("2026-10-10T00:00:00.000Z");
    const due = new Date(emptySince.getTime() + VOICE_EMPTY_MS + 1000);
    const joined = applyVoicePresence({ occupants: [], emptySince, userId: "member", action: "join", now: due });
    expect(joined.emptySince).toBeNull();
    expect(cleanupDecision({ kind: "voice", occupants: joined.occupants.length, emptySince: joined.emptySince, lastHumanAt: due, now: due, missionHold: false, status: "open" })).toBe("occupied");
    expect(applyRoomMessage(emptySince, "bot", due)).toEqual(emptySince);
    expect(applyRoomMessage(emptySince, "system", due)).toEqual(emptySince);
    expect(cleanupDecision({ kind: "text", occupants: 0, emptySince: null, lastHumanAt: new Date(due.getTime() - 60 * 60 * 1000), now: due, missionHold: false, status: "open" })).toBe("waiting");
    expect(transferOwner({ ownerUserId: "owner", leavingUserId: "owner", occupants: ["guest"] })).toEqual({ ownerUserId: "guest", needsStaff: false });
    expect(holdDecision("event")).toBe("not_exempt");
    expect(holdDecision("mission")).toBe("mission");
    expect(roomCreateDecision({ memberOpen: 0, serverOpen: 0, memberCap: 1, serverCap: 5, lastCreatedAt: due, now: new Date(due.getTime() + 1000), cooldownMinutes: 10 })).toBe("cooldown");
  });
});
