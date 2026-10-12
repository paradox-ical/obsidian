import { describe, expect, it } from "vitest";

import { decideCapability, decideDashboardAccess, moduleAvailable } from "./access.js";

describe("capability and dashboard access", () => {
  it("does not treat a moderator capability as dashboard access", () => {
    expect(
      decideDashboardAccess({
        userId: "member",
        roleIds: ["mod-role"],
        ownerUserId: "owner",
        userGrantIds: [],
        roleGrantIds: [],
      }),
    ).toBe("denied");
    expect(
      decideCapability({
        roleIds: ["mod-role"],
        grants: [{ roleId: "mod-role", capability: "moderation" }],
        capability: "statistics",
      }),
    ).toBe("denied");
  });

  it("lets the guild owner into the dashboard and keeps protected modules available", () => {
    expect(
      decideDashboardAccess({
        userId: "owner",
        roleIds: [],
        ownerUserId: "owner",
        userGrantIds: [],
        roleGrantIds: [],
      }),
    ).toBe("allowed");
    expect(moduleAvailable("verification", true)).toBe(true);
    expect(moduleAvailable("economy", true)).toBe(false);
  });
});
