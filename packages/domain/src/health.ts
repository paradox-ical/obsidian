export type ServiceName = "bot" | "worker" | "admin";

export type DiscordHealth =
  | "setup_required"
  | "connecting"
  | "ready"
  | "login_failed"
  | "not_applicable";

export type JobHealth = "ok" | "unavailable" | "not_applicable";

export type DashboardAuthHealth = "setup_required" | "oauth_ready" | "not_applicable";

export interface HealthReport {
  service: ServiceName;
  status: "ok" | "degraded" | "unavailable";
  database: "ok" | "unavailable" | "not_applicable";
  foundationRevision: string | null;
  discord: DiscordHealth;
  jobs: JobHealth;
  dashboardAuth: DashboardAuthHealth;
  access?: "denied";
}

export function createServiceHealthReport(input: {
  service: "bot" | "worker";
  database: "ok" | "unavailable";
  foundationRevision: string | null;
  discord: DiscordHealth;
  jobs: JobHealth;
}): HealthReport {
  const degraded =
    input.database !== "ok" ||
    input.jobs === "unavailable" ||
    input.discord === "setup_required" ||
    input.discord === "connecting" ||
    input.discord === "login_failed";

  return {
    service: input.service,
    status: input.database === "unavailable" ? "unavailable" : degraded ? "degraded" : "ok",
    database: input.database,
    foundationRevision: input.foundationRevision,
    discord: input.discord,
    jobs: input.jobs,
    dashboardAuth: "not_applicable",
  };
}

export function createAdminHealthReport(input: { oauthConfigured: boolean }): HealthReport {
  return {
    service: "admin",
    status: "degraded",
    database: "not_applicable",
    foundationRevision: null,
    discord: "not_applicable",
    jobs: "not_applicable",
    dashboardAuth: input.oauthConfigured ? "oauth_ready" : "setup_required",
    access: "denied",
  };
}
