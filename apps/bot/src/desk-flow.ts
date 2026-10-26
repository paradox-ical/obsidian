import { COMMAND_PARENTS } from "@collective/domain";
import { MODULE_COPY } from "./experience-catalog.js";
import { homeRows, searchActions } from "./experience.js";
import {
  actorCan,
  listReplyRules,
  readCharacter,
  readDeadDropStaff,
  readLotteryStaff,
  readMemberWallet,
  readOperations,
  testReplyRule,
  type PrismaClient,
} from "@collective/db";

import { spokenAmount } from "./present.js";

const UNMAPPED = [
  "bot-terminal",
  "contracts",
  "events",
  "market",
  "game-updates",
  "lottery and Dead Drop",
  "activity threads",
  "publication review",
  "moderation log",
  "server log",
  "economy audit",
  "support tickets",
  "temporary rooms",
];

export async function runHelpCommand(
  db: PrismaClient,
  input: { subcommand?: string; options: Record<string, string | boolean | number>; guildId: string; userId: string; now: Date },
) {
  if (input.subcommand === "actions") {
    const sheet = await readCharacter(db, input.guildId, input.userId, input.now);
    const wallet = await readMemberWallet(db, input.guildId, input.userId);
    const marks = wallet.marks.status === "available" ? spokenAmount(wallet.marks.available) : "closed";
    const life = sheet.status === "uncreated"
      ? "Choose your character class with `/character open`. Community rank and character progression are separate."
      : `You are a **${sheet.className}**, level ${sheet.level}. Stat points are \`/character stats\`. A practice fight is \`/combat action\`.`;
    return { content: `**${marks}** Marks on hand.\n\n${life}\n\nAfter that: \`/market pool\`, \`/shop supply\`, \`/explore expedition\`.` };
  }
  const query = typeof input.options["query"] === "string" ? input.options["query"].trim().toLowerCase() : "";
  const found = searchActions(query);
  return {
    content: query
      ? found.length ? found.map((entry) => `**/${entry.value}**\n${COMMAND_PARENTS.find((p) => p.name === entry.value.split(" ")[0])?.options.find((o) => o.name === entry.value.split(" ")[1])?.description ?? ""}`).join("\n\n") : "No matching actions. Try a feature name such as trade, ticket, class or birthday."
      : `**The Collective**\n${MODULE_COPY["help"]!.description}\n\nEvery section has a guided menu. Existing slash shortcuts remain available.`,
    components: homeRows(),
  };
}

export async function runSetupCommand(
  db: PrismaClient,
  input: { subcommand?: string; options: Record<string, string | boolean | number>; guildId: string; userId: string; roleIds: string[]; now: Date },
) {
  const lottery = await readLotteryStaff(db, input.guildId);
  const drop = await readDeadDropStaff(db, input.guildId);
  const lotteryLine = lottery.result === "ready" ? lottery.clockLabel : "The lottery desk is paused.";
  const dropLine = drop.result === "ready" ? drop.clockLabel : "The Dead Drop desk is paused.";
  const checklist = [
    "**Still to choose**",
    `Lottery: ${lotteryLine}`,
    `Dead Drop: ${dropLine}`,
    "Channel posts, prize keys, and provider proofs stay closed until those credentials exist.",
    "Review configuration before enabling delivery.",
  ].join("\n");
  if (input.subcommand === "mappings") {
    return { content: `${checklist}\n\n**Channels**\nDestinations to review in the admin configuration:\n${UNMAPPED.map((name) => `- ${name}`).join("\n")}\n\nNo channel was created.` };
  }
  if (input.subcommand === "diagnostics") {
    const staff = (await actorCan(db, { guildId: input.guildId, roleIds: input.roleIds, capability: "statistics" })) === "allowed";
    if (!staff) {
      return { content: `${checklist}\n\nDiagnostics are for the server owner, or a role with statistics.` };
    }
    const desk = await readOperations(db, input.guildId, input.now);
    return {
      content: [
        checklist,
        "",
        "**Desk**",
        `Dead jobs: ${desk.health.deadJobs}`,
        `Delivery failures: ${desk.health.discordDeliveryFailures}`,
        `Negative wallets: ${desk.health.negativeWallets}`,
        `Stalled matches: ${desk.health.stalledMatches}`,
        `Overdue rooms: ${desk.health.overdueRooms}`,
        `Market backing: ${desk.health.backing}`,
        desk.health.marketPaused ? "The exchange is paused." : "The exchange is not paused.",
      ].join("\n"),
    };
  }
  return { content: `${checklist}\n\nUse **Diagnostics** for the desk, and **Channels** for what is still unmapped. Start exploring at \`/rank profile\`.` };
}

export async function runReplyCommand(
  db: PrismaClient,
  input: { subcommand?: string; options: Record<string, string | boolean | number>; guildId: string; userId: string; roleIds: string[] },
) {
  if (input.subcommand === "test") {
    const text = typeof input.options["text"] === "string" ? input.options["text"] : "";
    if (!text.trim()) {
      return { content: "Give the test a phrase. Nothing is sent to the channel." };
    }
    const tested = await testReplyRule(db, {
      guildId: input.guildId,
      text,
      source: "interaction",
      channelId: "dashboard",
      roleIds: input.roleIds,
      authorIsBot: false,
      pick: 0,
      actorRoleIds: input.roleIds,
    });
    if (tested.result !== "tested") {
      return { content: tested.result === "denied" ? "Reply rules are for staff with publications." : "The reply desk is not open." };
    }
    const selected = tested.selected;
    if (selected.result === "matched") {
      return {
        content: selected.secret
          ? "A rule would answer, and the words stay private.\n\n-# Nothing was sent."
          : `A rule would answer:\n${selected.variant}\n\n-# Nothing was sent.`,
      };
    }
    if (selected.result === "excluded") {
      return { content: "A rule saw the phrase, then this channel or role was excluded.\n\n-# Nothing was sent." };
    }
    if (selected.result === "refused") {
      return { content: "That rule only answers inside an interaction.\n\n-# Nothing was sent." };
    }
    return { content: "No rule matches that phrase.\n\n-# Nothing was sent." };
  }
  const listed = await listReplyRules(db, { guildId: input.guildId, actorRoleIds: input.roleIds });
  if (listed.result !== "ready") {
    return { content: listed.result === "denied" ? "Reply rules are for staff with publications." : "The reply desk is not open." };
  }
  if (listed.rules.length === 0) {
    return { content: "No reply rules are stored. The admin desk is where a rule is written." };
  }
  return { content: listed.rules.map((rule) => `**${rule.name}** · ${rule.status}\n${rule.pattern}`).join("\n\n") };
}
