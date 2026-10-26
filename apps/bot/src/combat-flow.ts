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

import { runCrateCommand } from "./shop-flow.js";
import { runWorkshopCommand } from "./workshop-flow.js";

export async function runCombatCommand(
  db: PrismaClient,
  input: { subcommand?: string; options: Record<string, string | boolean | number>; guildId: string; userId: string; now: Date },
) {
  if (input.subcommand === "queue" || input.subcommand === "challenge") {
    return runPvp(db, input);
  }
  if (input.subcommand === "records") {
    const battleId = text(input.options, "battle");
    if (!battleId) {
      return { content: "Name a battle to read its record." };
    }
    const record = await readBattle(db, { guildId: input.guildId, userId: input.userId, battleId, audience: "member" });
    if (record.result !== "ready") {
      return { content: "That battle record was not found." };
    }
    return { content: `${record.status}. Winner ${record.winner || "none"}. ${record.log.slice(-2).join(" ")}` };
  }
  const mode = text(input.options, "mode");
  const battleId = text(input.options, "battle");
  if (battleId) {
    const acted = await actInBattle(db, { guildId: input.guildId, userId: input.userId, battleId, move: text(input.options, "move") || "strike", idempotencyKey: `discord:${input.userId}:${battleId}:${input.now.toISOString()}`, now: input.now });
    if (acted.result !== "ready") {
      return { content: acted.result === "cooling" ? "That ability is still cooling." : "That action was not accepted." };
    }
    return { content: `${acted.log.at(-1) ?? "The action was recorded."} Unrevealed rolls stay hidden.` };
  }
  if (mode === "tactical") {
    const started = await startTacticalDuel(db, { guildId: input.guildId, userId: input.userId, opponentSlug: text(input.options, "opponent") || "training-dummy", idempotencyKey: `tactical:${input.userId}:${input.now.toISOString()}`, now: input.now });
    if (started.result !== "ready") {
      return { content: "That test duel did not start." };
    }
    return { content: `The tactical duel is open.\n**${started.battleId}**\nPick a strike, a defence, an ability, or an item. A missed turn defends.` };
  }
  const started = await startQuickDuel(db, { guildId: input.guildId, userId: input.userId, opponentSlug: text(input.options, "opponent") || "training-dummy", idempotencyKey: `quick:${input.userId}:${input.now.toISOString()}`, now: input.now });
  if (started.result !== "ready") {
    return { content: "That test duel did not start." };
  }
  return { content: `Quick duel ${started.status}. Winner ${started.winner || "none"}. ${started.log.at(-1) ?? ""}` };
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
  return { content: items.map((item) => `${item.name} ${item.equipped ? "equipped" : "carried"}${item.lock ? " locked" : ""}`).join(". ") };
}

async function runPvp(
  db: PrismaClient,
  input: { subcommand?: string; options: Record<string, string | boolean | number>; guildId: string; userId: string; now: Date },
) {
  const action = text(input.options, "action");
  const stake = typeof input.options["stake"] === "number" ? input.options["stake"] : 0;
  const matchId = text(input.options, "match");
  if (input.subcommand === "queue" && action === "leave") {
    await leaveQueue(db, { guildId: input.guildId, userId: input.userId, now: input.now });
    return { content: "You left the queue. No stake was taken." };
  }
  if (input.subcommand === "queue" && action === "accept" && matchId) {
    const accepted = await acceptChallenge(db, { guildId: input.guildId, userId: input.userId, matchId, now: input.now });
    return { content: pvpText(accepted) };
  }
  if (input.subcommand === "queue") {
    const joined = await joinQueue(db, { guildId: input.guildId, userId: input.userId, mode: text(input.options, "mode") || "casual", stake, now: input.now });
    return { content: pvpText(joined) };
  }
  if (action === "cancel" && matchId) {
    const cancelled = await cancelChallenge(db, { guildId: input.guildId, userId: input.userId, matchId, now: input.now });
    return { content: cancelled.result === "cancelled" ? "The challenge is cancelled. No pot was paid." : "That challenge is already closed." };
  }
  if (action === "accept" && matchId) {
    const accepted = await acceptChallenge(db, { guildId: input.guildId, userId: input.userId, matchId, now: input.now });
    return { content: pvpText(accepted) };
  }
  const offered = await offerChallenge(db, {
    guildId: input.guildId,
    userId: input.userId,
    opponentUserId: text(input.options, "member"),
    mode: text(input.options, "mode") || "casual",
    stake,
    style: text(input.options, "style") || "quick",
    now: input.now,
  });
  return { content: pvpText(offered) };
}

function pvpText(result: { result: string; mode?: string; demoted?: boolean; status?: string; rules?: string; rankedEligible?: boolean; outcome?: string; winnerUserId?: string }): string {
  if (result.result === "waiting") {
    return "You are in the queue. The same stake is required. Zero remains available. The notice is not posted.";
  }
  if (result.result === "insufficient") {
    return "The equal stake could not be escrowed. Nothing was taken from the other wallet.";
  }
  if (result.result === "locked") {
    return "A mission, expedition, or battle already has this loadout.";
  }
  if (result.demoted && result.status === "proposed") {
    return `This match is casual before you accept. ${result.rules ?? ""} Rating and ranked rewards do not change. The notice is not posted.`;
  }
  if (result.status === "proposed") {
    return `Challenge ${result.mode ?? ""} is waiting for acceptance. Stake terms are fixed. The notice is not posted.`;
  }
  if (result.outcome) {
    return `Match ${result.outcome}. Winner ${result.winnerUserId || "none"}. Ranked rewards ${result.rankedEligible ? "can apply" : "do not apply"}. The notice is not posted.`;
  }
  const shown = awaitMatch(result);
  return shown;
}

function awaitMatch(result: { result: string; matchId?: string; mode?: string; status?: string }): string {
  if (result.result === "missing") {
    return "That match was not found.";
  }
  return `Match ${result.matchId ?? ""} is ${result.status ?? result.result} in ${result.mode ?? "the listed mode"}. The notice is not posted.`;
}

function text(options: Record<string, string | boolean | number>, key: string): string {
  const value = options[key];
  return typeof value === "string" ? value : "";
}
