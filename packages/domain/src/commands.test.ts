import { describe, expect, it } from "vitest";

import {
  COMMAND_PARENTS,
  DISCORD_GLOBAL_CHAT_INPUT_LIMIT,
  DISCORD_OPTIONS_PER_LEVEL_LIMIT,
  PROJECT_PARENT_COMMAND_CEILING,
  assertParentCommandBudget,
  decideRegistration,
  testGuildCommandsUrl,
  validateCommandManifest,
} from "./commands.js";

const SPEC_PARENTS = [
  "help",
  "setup",
  "verify",
  "roles",
  "accounts",
  "temproles",
  "invites",
  "birthday",
  "mod",
  "report",
  "logs",
  "stats",
  "rank",
  "economy",
  "market",
  "leaderboard",
  "events",
  "schedule",
  "crew",
  "prediction",
  "contest",
  "giveaway",
  "publish",
  "reply",
  "lottery",
  "contracts",
  "combat",
  "character",
  "explore",
  "inventory",
  "profile",
  "shop",
  "blackjack",
  "deaddrop",
  "support",
  "community",
];

describe("command parent budget", () => {
  it("matches the 36-parent plan and stays inside Discord and project limits", () => {
    expect(COMMAND_PARENTS.map((parent) => parent.name)).toEqual(SPEC_PARENTS);
    expect(COMMAND_PARENTS).toHaveLength(36);
    expect(PROJECT_PARENT_COMMAND_CEILING).toBe(50);
    expect(DISCORD_GLOBAL_CHAT_INPUT_LIMIT).toBe(100);
    expect(DISCORD_OPTIONS_PER_LEVEL_LIMIT).toBe(25);
    expect(() => assertParentCommandBudget()).not.toThrow();
  });

  it("rejects duplicate names and counts above the project ceiling", () => {
    expect(() =>
      assertParentCommandBudget([{ name: "help" }, { name: "help" }]),
    ).toThrow(/unique/);

    const tooMany = Array.from({ length: PROJECT_PARENT_COMMAND_CEILING + 1 }, (_, index) => ({
      name: `parent${index}`,
    }));
    expect(() => assertParentCommandBudget(tooMany)).toThrow(/ceiling/);
  });

  it("accepts the shipped option trees and rejects an illegal option count", () => {
    expect(validateCommandManifest()).toEqual([]);
    const help = COMMAND_PARENTS[0];
    if (!help) {
      throw new Error("The help command is missing.");
    }
    const broken = [
      {
        ...help,
        options: Array.from({ length: 26 }, (_, index) => ({
          name: `panel_${index}`,
          description: "Too many panels",
          options: [],
        })),
      },
    ];
    expect(validateCommandManifest(broken).join(" ")).toMatch(/1-25/);
  });

  it("keeps registration on a dry run unless the test guild is named", () => {
    expect(decideRegistration({ apply: false, hasToken: false, hasApplicationId: false }).action).toBe("dry_run");
    expect(
      decideRegistration({
        apply: true,
        hasToken: false,
        hasApplicationId: false,
        testGuildId: "123456789012345678",
      }).action,
    ).toBe("setup_required");
    expect(
      decideRegistration({
        apply: true,
        hasToken: true,
        hasApplicationId: true,
        guildId: "999999999999999999",
        testGuildId: "123456789012345678",
        productionGuildId: "999999999999999999",
      }),
    ).toMatchObject({ action: "refused" });
    expect(testGuildCommandsUrl("123456789012345678", "223456789012345678")).toBe(
      "https://discord.com/api/v10/applications/123456789012345678/guilds/223456789012345678/commands",
    );
  });
});
