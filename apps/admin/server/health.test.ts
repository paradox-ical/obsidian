import { createAdminHealthReport } from "@collective/domain";
import { describe, expect, it } from "vitest";

describe("admin health", () => {
  it("denies access and does not describe a session", () => {
    const report = createAdminHealthReport({ oauthConfigured: false });
    expect(report.access).toBe("denied");
    expect(report.dashboardAuth).toBe("setup_required");
    expect(JSON.stringify(report)).not.toContain("session");
    expect(JSON.stringify(report)).not.toContain("token");
  });
});
