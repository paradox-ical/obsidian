import { describe, expect, it } from "vitest";

import { checkInOpen, seatFor, sessionSeat } from "./gatherings.js";

describe("event seats and session joins", () => {
  it("keeps the last seat and leaves everyone else on the waitlist", () => {
    expect(seatFor({ response: "yes", going: 0, capacity: 1, waitlist: true })).toBe("going");
    expect(seatFor({ response: "yes", going: 1, capacity: 1, waitlist: true })).toBe("waitlisted");
    expect(seatFor({ response: "yes", going: 1, capacity: 1, waitlist: false })).toBe("full");
    expect(seatFor({ response: "maybe", going: 0, capacity: 1, waitlist: true })).toBe("none");
  });

  it("opens check-in only around the occurrence and holds approval joins", () => {
    const starts = new Date("2026-10-11T01:00:00.000Z");
    const ends = new Date("2026-10-11T02:00:00.000Z");
    expect(checkInOpen(new Date("2026-10-11T00:50:00.000Z"), starts, ends)).toBe(true);
    expect(checkInOpen(new Date("2026-10-11T00:40:00.000Z"), starts, ends)).toBe(false);
    expect(sessionSeat({ active: 1, size: 1, joinMode: "open" })).toBe("waitlisted");
    expect(sessionSeat({ active: 0, size: 1, joinMode: "approval" })).toBe("pending");
  });
});
