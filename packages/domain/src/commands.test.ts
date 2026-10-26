import { describe, expect, it } from "vitest";

import { COMMAND_CHOICES } from "./command-choices.js";
import {
  COMMAND_PARENTS,
  DISCORD_GLOBAL_CHAT_INPUT_LIMIT,
  DISCORD_OPTIONS_PER_LEVEL_LIMIT,
  PROJECT_PARENT_COMMAND_CEILING,
  assertParentCommandBudget,
  decideRegistration,
  testGuildCommandsUrl,
  toDiscordCommandBody,
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

  it("offers a picker for every closed list and keeps free text typed", () => {
    expect(validateCommandManifest()).toEqual([]);
    const option = (parentName: string, subcommandName: string, optionName: string) => {
      const body = toDiscordCommandBody(COMMAND_PARENTS.find((parent) => parent.name === parentName)!);
      const subcommand = body.options.find((entry) => entry.name === subcommandName);
      const parameters = subcommand?.options as Array<{ name: string; choices?: Array<{ name: string; value: string | number }> }>;
      return parameters.find((entry) => entry.name === optionName);
    };
    expect(option("economy", "adjust", "action")?.choices?.map((choice) => choice.value)).toEqual(["add", "remove", "set", "bulk"]);
    expect(option("character", "class", "class")?.choices?.map((choice) => choice.value)).toEqual([
      "hitman",
      "bruiser",
      "saboteur",
      "fixer",
      "duelist",
      "gunslinger",
    ]);
    expect(option("character", "loadout", "slot")?.choices?.map((choice) => choice.value)).toEqual([1, 2, 3, 4]);
    expect(option("economy", "adjust", "reason")?.choices).toBeUndefined();
    expect(option("deaddrop", "pick", "coordinate")?.choices).toBeUndefined();
    for (const key of Object.keys(COMMAND_CHOICES)) {
      const [parentName, subcommandName, optionName] = key.split(".");
      const choices = option(parentName ?? "", subcommandName ?? "", optionName ?? "")?.choices;
      expect(choices?.map((choice) => choice.value), key).toEqual(COMMAND_CHOICES[key]?.map((choice) => choice.value));
    }
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
