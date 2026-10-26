import { z } from "zod";

import { ownerActsAsStaff } from "./access.js";
import { providerStatuses, type ProviderCredentialStatus } from "./community.js";
import { DEFAULT_TIMEZONE } from "./foundation.js";

const snowflake = z.string().regex(/^[0-9]{17,20}$/);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).optional(),
  DATABASE_URL: z.string().min(1),
  DEFAULT_TIMEZONE: z.string().min(1).optional(),
  BOT_HEALTH_HOST: z.string().min(1).optional(),
  BOT_HEALTH_PORT: z.string().regex(/^[0-9]+$/).optional(),
  WORKER_HEALTH_PORT: z.string().regex(/^[0-9]+$/).optional(),
  ADMIN_PORT: z.string().regex(/^[0-9]+$/).optional(),
  ADMIN_ORIGIN: z.string().min(1).optional(),
  DISCORD_TOKEN: z.string().min(1).optional(),
  DISCORD_APPLICATION_ID: snowflake.optional(),
  DISCORD_TEST_GUILD_ID: snowflake.optional(),
  DISCORD_PRODUCTION_GUILD_ID: snowflake.optional(),
  DISCORD_CLIENT_SECRET: z.string().min(1).optional(),
});

export class EnvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvValidationError";
  }
}

export interface AppEnv {
  nodeEnv: "development" | "test" | "production";
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  databaseUrl: string;
  defaultTimezone: string;
  botHealthHost: string;
  botHealthPort: number;
  workerHealthPort: number;
  adminPort: number;
  adminOrigin: string;
  ownerStaff: boolean;
  discord: {
    configured: boolean;
    token?: string;
    applicationId?: string;
    testGuildId?: string;
    productionGuildId?: string;
    clientSecret?: string;
  };
  providers: ProviderCredentialStatus[];
}

const KNOWN_KEYS = [
  "NODE_ENV",
  "LOG_LEVEL",
  "DATABASE_URL",
  "DEFAULT_TIMEZONE",
  "BOT_HEALTH_HOST",
  "BOT_HEALTH_PORT",
  "WORKER_HEALTH_PORT",
  "ADMIN_PORT",
  "ADMIN_ORIGIN",
  "DISCORD_TOKEN",
  "DISCORD_APPLICATION_ID",
  "DISCORD_TEST_GUILD_ID",
  "DISCORD_PRODUCTION_GUILD_ID",
  "DISCORD_CLIENT_SECRET",
] as const;

function collectInput(source: Record<string, string | undefined>): Record<string, string> {
  const input: Record<string, string> = {};
  for (const key of KNOWN_KEYS) {
    const value = source[key];
    if (value === undefined || value.trim() === "") {
      continue;
    }
    input[key] = value.trim();
  }
  return input;
}

function readPort(value: string | undefined, fallback: number, name: string): number {
  const raw = value ?? String(fallback);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new EnvValidationError(`Environment validation failed: ${name}`);
  }
  return port;
}

function readOrigin(value: string | undefined): string {
  const raw = value ?? "http://localhost:5173";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new EnvValidationError("Environment validation failed: ADMIN_ORIGIN");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new EnvValidationError("Environment validation failed: ADMIN_ORIGIN");
  }
  return url.origin;
}

function readTimezone(value: string | undefined): string {
  const timeZone = value ?? DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone }).format(new Date());
  } catch {
    throw new EnvValidationError("Environment validation failed: DEFAULT_TIMEZONE");
  }
  return timeZone;
}

export function parseEnv(source: Record<string, string | undefined>): AppEnv {
  const parsed = envSchema.safeParse(collectInput(source));
  if (!parsed.success) {
    const paths = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "environment"))];
    throw new EnvValidationError(`Environment validation failed: ${paths.join(", ")}`);
  }

  const token = parsed.data.DISCORD_TOKEN;
  const applicationId = parsed.data.DISCORD_APPLICATION_ID;
  if (Boolean(token) !== Boolean(applicationId)) {
    throw new EnvValidationError(
      "Environment validation failed: DISCORD_TOKEN, DISCORD_APPLICATION_ID",
    );
  }

  return {
    nodeEnv: parsed.data.NODE_ENV ?? "development",
    logLevel: parsed.data.LOG_LEVEL ?? "info",
    databaseUrl: parsed.data.DATABASE_URL,
    defaultTimezone: readTimezone(parsed.data.DEFAULT_TIMEZONE),
    botHealthHost: parsed.data.BOT_HEALTH_HOST ?? "0.0.0.0",
    botHealthPort: readPort(parsed.data.BOT_HEALTH_PORT, 8081, "BOT_HEALTH_PORT"),
    workerHealthPort: readPort(parsed.data.WORKER_HEALTH_PORT, 8082, "WORKER_HEALTH_PORT"),
    adminPort: readPort(parsed.data.ADMIN_PORT, 5173, "ADMIN_PORT"),
    adminOrigin: readOrigin(parsed.data.ADMIN_ORIGIN),
    ownerStaff: ownerActsAsStaff({ ...source, NODE_ENV: parsed.data.NODE_ENV ?? source["NODE_ENV"] ?? "development" }),
    discord: {
      configured: Boolean(token && applicationId),
      ...(token ? { token } : {}),
      ...(applicationId ? { applicationId } : {}),
      ...(parsed.data.DISCORD_TEST_GUILD_ID ? { testGuildId: parsed.data.DISCORD_TEST_GUILD_ID } : {}),
      ...(parsed.data.DISCORD_PRODUCTION_GUILD_ID
        ? { productionGuildId: parsed.data.DISCORD_PRODUCTION_GUILD_ID }
        : {}),
      ...(parsed.data.DISCORD_CLIENT_SECRET ? { clientSecret: parsed.data.DISCORD_CLIENT_SECRET } : {}),
    },
    providers: providerStatuses(source),
  };
}

export function loadEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  return parseEnv(source);
}

/** Safe to log. Omits database URLs, tokens, and client secrets. */
export function publicEnvSummary(env: AppEnv): {
  nodeEnv: AppEnv["nodeEnv"];
  logLevel: AppEnv["logLevel"];
  defaultTimezone: string;
  discordConfigured: boolean;
  applicationId: string | null;
  testGuildConfigured: boolean;
  productionGuildConfigured: boolean;
  clientSecretConfigured: boolean;
  oauthConfigured: boolean;
  providersReady: number;
  providersSetupRequired: number;
  ownerStaff: boolean;
} {
  return {
    nodeEnv: env.nodeEnv,
    logLevel: env.logLevel,
    defaultTimezone: env.defaultTimezone,
    discordConfigured: env.discord.configured,
    applicationId: env.discord.applicationId ?? null,
    testGuildConfigured: Boolean(env.discord.testGuildId),
    productionGuildConfigured: Boolean(env.discord.productionGuildId),
    clientSecretConfigured: Boolean(env.discord.clientSecret),
    oauthConfigured: Boolean(env.discord.token && env.discord.applicationId && env.discord.clientSecret),
    providersReady: env.providers.filter((provider) => provider.status === "ready").length,
    providersSetupRequired: env.providers.filter((provider) => provider.status === "setup_required").length,
    ownerStaff: env.ownerStaff,
  };
}
