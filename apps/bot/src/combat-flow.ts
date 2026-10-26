import {
  acceptChallenge,
  actInBattle,
  cancelChallenge,
  equipGear,
  joinQueue,
  leaveQueue,
  offerChallenge,
  readBattle,
  readGear,
  startQuickDuel,
  startTacticalDuel,
  unequipGear,
  type PrismaClient,
} from "@collective/db";

import { buttonRow, type OutcomeRow } from "./present.js";
import { runCrateCommand } from "./shop-flow.js";
import { runWorkshopCommand } from "./workshop-flow.js";

interface CombatReply {
  content: string;
  components?: OutcomeRow[];
}

export function combatPress(customId: string): { subcommand: string; options: Record<string, string> } {
  const parts = customId.split(":");
  if (parts[1] === "quick" || parts[1] === "tactical") {
    return { subcommand: "action", options: { mode: parts[1], opponent: parts[2] || "training-dummy" } };
  }
  if (parts[1] === "queue" && parts[2] === "leave") {
    return { subcommand: "queue", options: { action: "leave" } };
  }
  if (parts[1] === "queue") {
    return { subcommand: "queue", options: { action: parts[2] || "join", mode: parts[3] || "casual" } };
  }
  if (parts[1] === "move") {
    return { subcommand: "action", options: { battle: parts[2] || "", move: parts[3] || "strike", mode: "tactical" } };
  }
  if (parts[1] === "challenge" && parts[2] === "accept") {
    return { subcommand: "challenge", options: { action: "accept", match: parts[3] || "" } };
  }
  return { subcommand: "action", options: {} };
}

function floorMenu(): CombatReply {
  return {
    content: [
      "**The floor**",
      "Practice spends nothing. The queue and a challenge use an equal stake, and zero is allowed.",
      "Ranked rewards apply only when both fighters are eligible. Otherwise the match is casual.",
      "A challenge needs another member. `/combat challenge`, then pick them.",
      "",
      "Press one.",
    ].join("\n"),
    components: [
      buttonRow([
        { id: "combat:quick:training-dummy", label: "Quick dummy" },
        { id: "combat:tactical:training-dummy", label: "Tactical dummy" },
        { id: "combat:queue:join:casual", label: "Casual queue" },
        { id: "combat:queue:join:ranked", label: "Ranked queue" },
        { id: "combat:queue:leave", label: "Leave queue" },
      ]),
    ],
  };
}

function moveRow(battleId: string): OutcomeRow[] {
  return [buttonRow([
    { id: `combat:move:${battleId}:strike`, label: "Strike" },
    { id: `combat:move:${battleId}:defend`, label: "Defend" },
    { id: `combat:move:${battleId}:ability`, label: "Ability" },
    { id: `combat:move:${battleId}:item`, label: "Item" },
  ])];
}

export async function runCombatCommand(
  db: PrismaClient,
  input: { subcommand?: string; options: Record<string, string | boolean | number>; guildId: string; userId: string; now: Date },
): Promise<CombatReply> {
  if (input.subcommand === "queue" || input.subcommand === "challenge") {
    return runPvp(db, input);
  }
  if (input.subcommand === "records") {
    const battleId = text(input.options, "battle");
    if (!battleId) {
      return { content: "Name the battle. The record stays hidden until you do." };
    }
    const record = await readBattle(db, { guildId: input.guildId, userId: input.userId, battleId, audience: "member" });
    if (record.result !== "ready") {
      return { content: "That battle record was not found." };
    }
    const recent = record.log.slice(-2).filter(Boolean).join("\n");
    return { content: `**${record.status}**\nWinner: ${record.winner || "none"}${recent ? `\n${recent}` : ""}\n\nUnrevealed rolls stay hidden.` };
  }
  const mode = text(input.options, "mode");
  const battleId = text(input.options, "battle");
  if (!mode && !battleId) {
    return floorMenu();
  }
  if (battleId) {
    const acted = await actInBattle(db, { guildId: input.guildId, userId: input.userId, battleId, move: text(input.options, "move") || "strike", idempotencyKey: `discord:${input.userId}:${battleId}:${input.now.toISOString()}`, now: input.now });
    if (acted.result !== "ready") {
      return { content: acted.result === "cooling" ? "That ability is still cooling." : "That action was not accepted.", components: moveRow(battleId) };
    }
    return { content: `${acted.log.at(-1) ?? "The action was recorded."}\n\nUnrevealed rolls stay hidden.`, components: moveRow(battleId) };
  }
  const opponent = text(input.options, "opponent") || "training-dummy";
  if (mode === "tactical") {
    const started = await startTacticalDuel(db, { guildId: input.guildId, userId: input.userId, opponentSlug: opponent, idempotencyKey: `tactical:${input.userId}:${input.now.toISOString()}`, now: input.now });
    if (started.result !== "ready") {
      return { content: "That practice fight did not start. A class, a loadout, or another fight may already have you." };
    }
    return {
      content: `The tactical fight is open against **${opponent.replaceAll("-", " ")}**.\n\nPress a move. A missed turn defends.`,
      components: moveRow(started.battleId),
    };
  }
  const started = await startQuickDuel(db, { guildId: input.guildId, userId: input.userId, opponentSlug: opponent, idempotencyKey: `quick:${input.userId}:${input.now.toISOString()}`, now: input.now });
  if (started.result !== "ready") {
    return { content: "That practice fight did not start. A class, a loadout, or another fight may already have you." };
  }
  return {
    content: `**${started.status === "resolved" ? "The fight is over" : "The fight is still open"}**\nWinner: ${started.winner || "none"}\n${started.log.at(-1) ?? ""}\n\nUnrevealed rolls stay hidden.`,
    components: [buttonRow([{ id: "combat:menu", label: "The floor" }, { id: "go:character:stats", label: "The points" }])],
  };
}

export async function runInventoryCommand(
  db: PrismaClient,
  input: { subcommand?: string; options: Record<string, string | boolean | number>; guildId: string; userId: string; now: Date },
) {
  if (input.subcommand === "crates") {
    return runCrateCommand(db, input);
  }
  if (input.subcommand !== "gear") {
    return runWorkshopCommand(db, input);
  }
  const action = text(input.options, "action") || "list";
  const itemId = text(input.options, "item");
  if (action === "equip" && itemId) {
    const equipped = await equipGear(db, { guildId: input.guildId, userId: input.userId, itemId });
    if (equipped.result === "equipped") {
      return { content: "Equipped. Gear bonuses stay separate from allocated stats." };
    }
    if (equipped.result === "class") {
      return { content: "That weapon is restricted to another class." };
    }
    if (equipped.result === "level") {
      return { content: "Your level does not meet that item." };
    }
    if (equipped.result === "locked") {
      return { content: "That item is locked for a battle." };
    }
    return { content: "That item cannot be equipped." };
  }
  if (action === "unequip" && itemId) {
    const removed = await unequipGear(db, { guildId: input.guildId, userId: input.userId, itemId });
    return { content: removed.result === "unequipped" ? "Unequipped. The item is still owned." : "That item cannot be unequipped while it is locked." };
  }
  const items = await readGear(db, input.guildId, input.userId);
  if (items.length === 0) {
    return { content: "No gear instances yet." };
  }
  return { content: items.map((item) => `**${item.name}** · ${item.equipped ? "equipped" : "carried"}${item.lock ? " · locked" : ""}`).join("\n") };
}

async function runPvp(
  db: PrismaClient,
  input: { subcommand?: string; options: Record<string, string | boolean | number>; guildId: string; userId: string; now: Date },
): Promise<CombatReply> {
  const action = text(input.options, "action");
  const stake = typeof input.options["stake"] === "number" ? input.options["stake"] : 0;
  const matchId = text(input.options, "match");
  if (input.subcommand === "queue" && !action) {
    return {
      content: "The queue takes an equal stake. Zero is allowed. Pick casual or ranked, or leave. Nothing was joined.",
      components: floorMenu().components,
    };
  }
  if (input.subcommand === "queue" && action === "leave") {
    await leaveQueue(db, { guildId: input.guildId, userId: input.userId, now: input.now });
    return { content: "You left the queue. No stake was taken.", components: floorMenu().components };
  }
  if (input.subcommand === "queue" && action === "accept") {
    if (!matchId) {
      return { content: "Accepting needs the match. Nothing was accepted." };
    }
    const accepted = await acceptChallenge(db, { guildId: input.guildId, userId: input.userId, matchId, now: input.now });
    return pvpReply(accepted);
  }
  if (input.subcommand === "queue") {
    const joined = await joinQueue(db, { guildId: input.guildId, userId: input.userId, mode: text(input.options, "mode") || "casual", stake, now: input.now });
    return pvpReply(joined);
  }
  if (!action) {
    return { content: "Pick a member, then offer. An empty challenge is not sent. Accept and cancel need the match." };
  }
  if (action === "cancel") {
    if (!matchId) {
      return { content: "Cancelling needs the match. Nothing was cancelled." };
    }
    const cancelled = await cancelChallenge(db, { guildId: input.guildId, userId: input.userId, matchId, now: input.now });
    return { content: cancelled.result === "cancelled" ? "The challenge is cancelled. No pot was paid." : "That challenge is already closed." };
  }
  if (action === "accept") {
    if (!matchId) {
      return { content: "Accepting needs the match. Nothing was accepted." };
    }
    const accepted = await acceptChallenge(db, { guildId: input.guildId, userId: input.userId, matchId, now: input.now });
    return pvpReply(accepted);
  }
  const member = text(input.options, "member");
  if (!member) {
    return { content: "A challenge needs another member. Nothing was offered." };
  }
  const offered = await offerChallenge(db, {
    guildId: input.guildId,
    userId: input.userId,
    opponentUserId: member,
    mode: text(input.options, "mode") || "casual",
    stake,
    style: text(input.options, "style") || "quick",
    now: input.now,
  });
  return pvpReply(offered);
}

function pvpReply(result: { result: string; matchId?: string; mode?: string; demoted?: boolean; status?: string; rules?: string; rankedEligible?: boolean; outcome?: string; winnerUserId?: string }): CombatReply {
  const matchId = result.matchId ?? "";
  if (result.result === "waiting") {
    return { content: "You are in the queue. The stake is equal, and zero is allowed.\n\n-# Nothing was posted in a channel.", components: [buttonRow([{ id: "combat:queue:leave", label: "Leave the queue" }])] };
  }
  if (result.result === "insufficient") {
    return { content: "The equal stake could not be held. Nothing was taken from the other wallet." };
  }
  if (result.result === "locked") {
    return { content: "A mission, expedition, or battle already has this loadout." };
  }
  if (result.demoted && result.status === "proposed") {
    return {
      content: `This match is casual until you accept. ${result.rules ?? ""}Rating and ranked rewards do not change.\n\n-# Nothing was posted in a channel.`,
      ...(matchId ? { components: [buttonRow([{ id: `combat:challenge:accept:${matchId}`, label: "Accept" }])] } : {}),
    };
  }
  if (result.status === "proposed") {
    return {
      content: `**${result.mode || "The challenge"}** is waiting. The stake stays as offered.\n\n-# Nothing was posted in a channel.`,
      ...(matchId ? { components: [buttonRow([{ id: `combat:challenge:accept:${matchId}`, label: "Accept" }])] } : {}),
    };
  }
  if (result.outcome) {
    return { content: `**${result.outcome}**\nWinner: ${result.winnerUserId || "none"}\nRanked rewards ${result.rankedEligible ? "can apply" : "do not apply"}.\n\n-# Nothing was posted in a channel.` };
  }
  if (result.result === "missing") {
    return { content: "That match was not found." };
  }
  return { content: `Match ${matchId || "unknown"} is ${result.status ?? result.result} in ${result.mode ?? "the listed mode"}.\n\n-# Nothing was posted in a channel.` };
}

function text(options: Record<string, string | boolean | number>, key: string): string {
  const value = options[key];
  return typeof value === "string" ? value : "";
}
