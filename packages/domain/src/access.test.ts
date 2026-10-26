import { describe, expect, it } from "vitest";

import { decideCapability, decideDashboardAccess, moduleAvailable, ownerActsAsStaff, OWNER_STAFF_ROLE, staffRoleIds } from "./access.js";

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

  it("gives the guild owner every staff action only while testing mode is on", () => {
    expect(ownerActsAsStaff({ NODE_ENV: "development" })).toBe(true);
    expect(ownerActsAsStaff({ NODE_ENV: "test" })).toBe(false);
    expect(ownerActsAsStaff({ NODE_ENV: "production" })).toBe(false);
    expect(ownerActsAsStaff({ NODE_ENV: "production", DASHBOARD_OWNER_STAFF: "true" })).toBe(true);
    expect(ownerActsAsStaff({ NODE_ENV: "development", DASHBOARD_OWNER_STAFF: "false" })).toBe(false);
    expect(staffRoleIds(["mod-role"], true, { NODE_ENV: "development" })).toContain(OWNER_STAFF_ROLE);
    expect(staffRoleIds(["mod-role"], false, { NODE_ENV: "development" })).not.toContain(OWNER_STAFF_ROLE);
    expect(staffRoleIds([], true, { NODE_ENV: "test" })).toEqual([]);
    expect(
      decideCapability({
        roleIds: staffRoleIds([], true, { NODE_ENV: "development" }),
        grants: [],
        capability: "economy_operations",
      }),
    ).toBe("denied");
  });
});
