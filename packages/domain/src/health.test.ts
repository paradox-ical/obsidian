import { describe, expect, it } from "vitest";

import { createAdminHealthReport, createServiceHealthReport } from "./health.js";

describe("health reports", () => {
  it("marks a database-only bot as degraded setup-required and hides secrets", () => {
    const report = createServiceHealthReport({
      service: "bot",
      database: "ok",
      foundationRevision: "0b",
      discord: "setup_required",
      jobs: "not_applicable",
    });
    expect(report.status).toBe("degraded");
    expect(report.jobs).toBe("not_applicable");
    expect(report.dashboardAuth).toBe("not_applicable");
    expect(Object.keys(report)).not.toContain("token");
    expect(Object.keys(report)).not.toContain("databaseUrl");
  });

  it("reports a database-backed worker loop as ok", () => {
    const report = createServiceHealthReport({
      service: "worker",
      database: "ok",
      foundationRevision: "0b",
      discord: "not_applicable",
      jobs: "ok",
    });
    expect(report.status).toBe("ok");
    expect(report.jobs).toBe("ok");
  });

  it("returns unavailable when the database check failed", () => {
    const report = createServiceHealthReport({
      service: "bot",
      database: "unavailable",
      foundationRevision: null,
      discord: "setup_required",
      jobs: "not_applicable",
    });
    expect(report.status).toBe("unavailable");
  });

  it("denies unauthenticated dashboard access and reports OAuth setup separately", () => {
    expect(createAdminHealthReport({ oauthConfigured: false })).toMatchObject({
      service: "admin",
      access: "denied",
      dashboardAuth: "setup_required",
      jobs: "not_applicable",
    });
    expect(createAdminHealthReport({ oauthConfigured: true })).toMatchObject({
      access: "denied",
      dashboardAuth: "oauth_ready",
    });
  });
});
