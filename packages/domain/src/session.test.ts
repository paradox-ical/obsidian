import { describe, expect, it } from "vitest";

import { evaluateSession, retryDelayMs } from "./session.js";

const session = {
  actorUserId: "user",
  revision: 2,
  expiresAt: new Date("2026-10-07T12:00:00.000Z"),
  consumedAt: null,
};

describe("interaction sessions", () => {
  it("rejects the wrong actor, expiry, a stale revision, and reuse", () => {
    const now = new Date("2026-10-07T11:00:00.000Z");
    expect(evaluateSession(session, "other", 2, now)).toBe("actor");
    expect(evaluateSession(session, "user", 3, now)).toBe("stale");
    expect(evaluateSession(session, "user", 2, new Date("2026-10-07T12:00:00.000Z"))).toBe("expired");
    expect(evaluateSession({ ...session, consumedAt: now }, "user", 2, now)).toBe("consumed");
    expect(evaluateSession(session, "user", 2, now)).toBe("ok");
  });

  it("caps retry backoff at 15 minutes", () => {
    expect(retryDelayMs(1)).toBe(1_000);
    expect(retryDelayMs(2)).toBe(2_000);
    expect(retryDelayMs(20)).toBe(15 * 60 * 1000);
  });
});
