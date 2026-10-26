import {
  actBlackjack,
  joinBlackjackTable,
  openBlackjackTable,
  quoteBlackjack,
  readBlackjack,
  type PrismaClient,
} from "@collective/db";

type Options = Record<string, string | boolean | number>;
import { buttonRow } from "./present.js";

interface TableView {
  tableId?: string;
  status?: string;
  turnHandId?: string;
  turnDeadline?: string | null;
  dealer?: Array<{ card?: string; hidden?: true }>;
  seats?: Array<{ userId: string; hands: Array<{ handId: string; cards: string[]; total: number; stake: string; status: string; outcome: string }> }>;
  receipts?: Array<{ userId: string; summary: string }>;
}

export function blackjackTableReply(table: TableView, userId: string) {
  const own = table.seats?.find((s) => s.userId === userId);
  const hand = own?.hands.find((h) => h.handId === table.turnHandId && h.status === "playing");
  const lines = [
    `**Blackjack · ${table.status ?? "current table"}**`,
    `Dealer: ${table.dealer?.map((c) => c.hidden ? "[hidden]" : c.card).join(" · ") ?? "not dealt"}`,
    ...(own?.hands.map((h, i) => `**Hand ${i + 1}:** ${h.cards.join(" · ")} = **${h.total}**\nStake: ${h.stake} Marks · ${h.outcome || h.status}`) ?? []),
    ...(table.receipts?.filter((r) => r.userId === userId).map((r) => r.summary) ?? []),
    hand ? `Your turn. ${table.turnDeadline ? `Deadline: ${table.turnDeadline}.` : "Choose an action below."}` : table.status === "playing" ? "Waiting for the next turn. Use Receipt to refresh this table." : table.status === "joining" ? "The table is accepting players. Play starts when its joining window closes." : "Review your receipt or open another table.",
  ];
  const controls = hand && table.tableId ? [buttonRow([
    { id: `ux:bj:${table.tableId}:hit`, label: "Hit", style: 1 },
    { id: `ux:bj:${table.tableId}:stand`, label: "Stand" },
    ...(hand.cards.length === 2 ? [{ id: `ux:bj:${table.tableId}:double`, label: "Review double" }, { id: `ux:bj:${table.tableId}:split`, label: "Review split" }] : []),
  ])] : undefined;
  return { content: lines.join("\n\n"), ...(controls ? { components: controls } : {}) };
}

function text(options: Options, key: string): string {
  const value = options[key];
  return typeof value === "string" ? value : "";
}

function whole(options: Options, key: string): number | undefined {
  const value = options[key];
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function linesOf(rules: unknown): string {
  return Array.isArray(rules) ? rules.join(" ") : "";
}

export async function runBlackjackCommand(
  db: PrismaClient,
  input: { subcommand?: string; options: Options; guildId: string; userId: string; now: Date },
) {
  const subcommand = input.subcommand || "solo";
  const action = text(input.options, "action") || (subcommand === "receipt" ? "receipt" : "quote");
  const tableId = text(input.options, "table");
  if (subcommand === "receipt" || action === "receipt") {
    const current = await readBlackjack(db, { guildId: input.guildId, userId: input.userId });
    if (current.result !== "ready") {
      return { content: "Blackjack is not open. The notice is not posted." };
    }
    const table = current.tables.find((entry) => "tableId" in entry && entry.tableId === tableId);
    if (table && "tableId" in table) return blackjackTableReply(table, input.userId);
    return { content: `${linesOf(current.rules)}\n\nNo receipt is stored for that table. Choose one of your tables or check the table ID.` };
  }
  if (action === "hit" || action === "stand" || action === "double" || action === "split") {
    const acted = await actBlackjack(db, {
      guildId: input.guildId,
      userId: input.userId,
      tableId,
      action,
      idempotencyKey: `blackjack-act:${input.userId}:${tableId}:${action}:${input.now.toISOString()}`,
      now: input.now,
    });
    if (acted.result === "already_recorded") {
      return { content: "That blackjack action is already recorded. The notice is not posted." };
    }
    if (acted.result === "insufficient") {
      return { content: "The extra stake is not available. Nothing else was charged. The notice is not posted." };
    }
    if ("receipts" in acted) {
      return blackjackTableReply(acted, input.userId);
    }
    return { content: "That blackjack action was not accepted. The notice is not posted." };
  }
  if (action === "open" || action === "join") {
    const quoteId = text(input.options, "quote");
    const opened = action === "join"
      ? await joinBlackjackTable(db, { guildId: input.guildId, userId: input.userId, quoteId, tableId, now: input.now })
      : await openBlackjackTable(db, { guildId: input.guildId, userId: input.userId, quoteId, now: input.now });
    if (opened.result === "unfunded") {
      return { content: "The house bankroll cannot cover the split and double exposure. Nothing was charged. The notice is not posted." };
    }
    if (opened.result === "insufficient") {
      return { content: "The stake is not available. Nothing was charged. The notice is not posted." };
    }
    if (opened.result === "already_recorded") {
      return { content: "That blackjack bet is already recorded. The notice is not posted." };
    }
    if ("receipts" in opened) {
      return blackjackTableReply(opened, input.userId);
    }
    return { content: "That blackjack bet was not accepted. Nothing was charged. The notice is not posted." };
  }
  const mode = subcommand === "social" ? "social" : "solo";
  const quoted = await quoteBlackjack(db, {
    guildId: input.guildId,
    userId: input.userId,
    mode,
    ...(tableId ? { tableId } : {}),
    ...(whole(input.options, "stake") !== undefined ? { stakeMarks: whole(input.options, "stake") } : {}),
    idempotencyKey: `blackjack-quote:${input.userId}:${mode}:${text(input.options, "stake")}:${input.now.toISOString()}`,
    now: input.now,
  });
  if (quoted.result === "ready") {
    return { content: `**Blackjack quote**\nInitial stake: **${quoted.stake} Marks**\nNatural profit: ${quoted.naturalProfit}\nRegular profit: ${quoted.regularProfit}\nHouse exposure: ${quoted.exposure}\nBankroll remaining: ${quoted.bankrollRemaining}\n\n${linesOf(quoted.rules)}\n\nNothing was charged.`, components: [buttonRow([{ id: `ux:quote:blackjack:${subcommand}:${quoted.quoteId}`, label: "Review this stake", style: 1 }])] };
  }
  if (quoted.result === "unfunded") {
    return { content: `The house bankroll cannot cover exposure ${"exposure" in quoted ? quoted.exposure : ""}. ${linesOf("rules" in quoted ? quoted.rules : [])} Nothing was charged. The notice is not posted.` };
  }
  return { content: "That blackjack quote was not opened. Nothing was charged. The notice is not posted." };
}
