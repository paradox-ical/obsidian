import { randomUUID } from "node:crypto";

import {
  confirmQuote,
  quoteMarket,
  readMarketChart,
  readMarketDiagnostics,
  refreshMarketPanel,
  type PrismaClient,
} from "@collective/db";
import type { DiscordComponentRow } from "@collective/domain";

export interface MarketCommand {
  name: string;
  subcommand?: string;
  interactionId?: string;
  options: Record<string, string | boolean | number>;
  guildId: string;
  userId: string;
  roleIds: string[];
  now: Date;
}

function whole(command: MarketCommand, name: string): number | null {
  const value = command.options[name];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

export async function runMarketCommand(db: PrismaClient, command: MarketCommand): Promise<{ content: string; components?: DiscordComponentRow[] }> {
  if (command.name.startsWith("market:confirm:")) {
    const confirmed = await confirmQuote(db, {
      guildId: command.guildId,
      userId: command.userId,
      quoteId: command.name.slice("market:confirm:".length),
      now: command.now,
    });
    if (confirmed.result === "committed") {
      return { content: `${confirmed.side} committed for ${confirmed.total} Marks. Inventory is now ${confirmed.inventory}.` };
    }
    if (confirmed.result === "stale" || confirmed.result === "expired") {
      return { content: `That quote is ${confirmed.result}. Request a new quote. The previous price was not replaced.` };
    }
    return { content: `The exchange did not settle: ${confirmed.result}.` };
  }
  if (command.subcommand === "chart") {
    const chart = await readMarketChart(db, command.guildId);
    if (chart.points.length === 0) {
      return { content: "No Ingot trades yet. The next unit still uses the scarcity curve." };
    }
    return { content: chart.points.map((point) => `${point.at} ${point.side} ${point.quantity} for ${point.total}`).join("\n") };
  }
  if (command.subcommand === "pool") {
    const pool = await readMarketDiagnostics(db, command.guildId);
    return {
      content: [
        `**Inventory** ${pool.inventory} of the active 2,500`,
        `**Protected reserve** ${pool.protected}`,
        `**Next buy** ${pool.nextBuy ?? "unavailable"}`,
        "",
        "-# There is no price ceiling.",
      ].join("\n"),
    };
  }
  const side = command.subcommand === "buy" || command.subcommand === "sell" ? command.subcommand : command.options["side"];
  if (command.subcommand === "quote" || command.subcommand === "buy" || command.subcommand === "sell") {
    const amount = whole(command, "amount");
    if ((side !== "buy" && side !== "sell") || amount === null) {
      return { content: "Pick buy or sell, and a whole number of Ingots." };
    }
    const quoted = await quoteMarket(db, {
      guildId: command.guildId,
      userId: command.userId,
      side,
      quantity: amount,
      idempotencyKey: `quote:${command.interactionId ?? randomUUID()}`,
      now: command.now,
    });
    if (quoted.result !== "quoted" && quoted.result !== "already_recorded") {
      return { content: quoted.result === "depleted" ? "The exchange inventory is empty. Buys are unavailable." : `No quote: ${quoted.result}.` };
    }
    return {
      content: [
        `**${quoted.side === "buy" ? "Buy" : "Sell"}** ${quoted.quantity} Ingots`,
        `**${quoted.total}** Marks`,
        `Inventory would become ${quoted.inventoryAfter}`,
        `Spread ${quoted.spread}`,
        `The price holds until ${quoted.expiresAt}`,
        "",
        "-# There is no price ceiling. Nothing has moved yet.",
      ].join("\n"),
      components: [{
        type: 1,
        components: [{ type: 2, style: 1, custom_id: `market:confirm:${quoted.quoteId}`, label: "Confirm" }],
      }],
    };
  }
  await refreshMarketPanel(db, command.guildId, command.now);
  return { content: "Use chart, pool, quote, buy, or sell." };
}
