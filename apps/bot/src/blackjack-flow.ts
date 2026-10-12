import {
  actBlackjack,
  joinBlackjackTable,
  openBlackjackTable,
  quoteBlackjack,
  readBlackjack,
  type PrismaClient,
} from "@collective/db";

type Options = Record<string, string | boolean | number>;

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
    const receipt = table && "receipts" in table ? (table.receipts ?? []).map((item) => item.summary).join(" ") : "";
    return { content: `${linesOf(current.rules)} ${receipt || "No receipt is stored for that table."} The notice is not posted.` };
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
      const summary = (acted.receipts ?? []).map((item) => item.summary).join(" ");
      return { content: `${summary} The notice is not posted.` };
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
      const summary = (opened.receipts ?? []).map((item) => item.summary).join(" ");
      return { content: `${summary} The notice is not posted.` };
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
    return { content: `Quote ${quoted.quoteId}. Stake ${quoted.stake}. Natural ${quoted.naturalProfit}. Regular ${quoted.regularProfit}. Exposure ${quoted.exposure}. Bankroll ${quoted.bankrollRemaining}. ${linesOf(quoted.rules)} Nothing was charged. The notice is not posted.` };
  }
  if (quoted.result === "unfunded") {
    return { content: `The house bankroll cannot cover exposure ${"exposure" in quoted ? quoted.exposure : ""}. ${linesOf("rules" in quoted ? quoted.rules : [])} Nothing was charged. The notice is not posted.` };
  }
  return { content: "That blackjack quote was not opened. Nothing was charged. The notice is not posted." };
}
