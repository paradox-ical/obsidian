import { describe, expect, it } from "vitest";

import { DEFAULT_TIMEZONE } from "./foundation.js";
import { EnvValidationError, parseEnv, publicEnvSummary } from "./env.js";

const databaseUrl = "postgresql://collective:collective@localhost:5432/collective";

describe("parseEnv", () => {
  it("requires a database URL and applies documented defaults", () => {
    expect(() => parseEnv({})).toThrow(EnvValidationError);
    const env = parseEnv({ DATABASE_URL: databaseUrl });
    expect(env.defaultTimezone).toBe(DEFAULT_TIMEZONE);
    expect(env.nodeEnv).toBe("development");
    expect(env.discord.configured).toBe(false);
    expect(env.botHealthPort).toBe(8081);
    expect(env.workerHealthPort).toBe(8082);
  });

  it("treats blank Discord values as omitted", () => {
    const env = parseEnv({
      DATABASE_URL: databaseUrl,
      DISCORD_TOKEN: "   ",
      DISCORD_APPLICATION_ID: "",
      DISCORD_CLIENT_SECRET: " ",
    });
    expect(env.discord.configured).toBe(false);
    expect(env.discord.token).toBeUndefined();
    expect(env.discord.clientSecret).toBeUndefined();
  });

  it("rejects a token without an application id and does not echo secrets", () => {
    const token = "super-secret-token-value";
    expect(() =>
      parseEnv({
        DATABASE_URL: databaseUrl,
        DISCORD_TOKEN: token,
      }),
    ).toThrow(/DISCORD_TOKEN, DISCORD_APPLICATION_ID/);

    try {
      parseEnv({
        DATABASE_URL: databaseUrl,
        DISCORD_TOKEN: token,
        DISCORD_APPLICATION_ID: "not-a-snowflake",
      });
      throw new Error("expected validation failure");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as Error).message).not.toContain(token);
      expect((error as Error).message).not.toContain("not-a-snowflake");
      expect((error as Error).message).not.toContain(databaseUrl);
    }
  });

  it("accepts a matched Discord application pair", () => {
    const env = parseEnv({
      DATABASE_URL: databaseUrl,
      DISCORD_TOKEN: "token-value",
      DISCORD_APPLICATION_ID: "123456789012345678",
      DISCORD_TEST_GUILD_ID: "223456789012345678",
      DISCORD_CLIENT_SECRET: "client-secret-value",
    });
    expect(env.discord.configured).toBe(true);
    const summary = JSON.stringify(publicEnvSummary(env));
    expect(summary).not.toContain("token-value");
    expect(summary).not.toContain("client-secret-value");
    expect(summary).not.toContain(databaseUrl);
    expect(summary).toContain("123456789012345678");
    expect(summary).toContain('"clientSecretConfigured":true');
  });

  it("rejects an unknown timezone without accepting a silent fallback", () => {
    expect(() =>
      parseEnv({
        DATABASE_URL: databaseUrl,
        DEFAULT_TIMEZONE: "Mars/Olympus",
      }),
    ).toThrow(/DEFAULT_TIMEZONE/);
  });
});
