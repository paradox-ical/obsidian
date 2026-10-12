import { buyTickets, quoteTickets, readDraw, readHistory, type PrismaClient } from "@collective/db";

type Options = Record<string, string | boolean | number>;

function text(options: Options, key: string): string {
  const value = options[key];
  return typeof value === "string" ? value : "";
}

function whole(options: Options, key: string): number | undefined {
  const value = options[key];
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

export async function runLotteryCommand(
  db: PrismaClient,
  input: { subcommand?: string; options: Options; guildId: string; userId: string; now: Date },
) {
  const subcommand = input.subcommand || "draw";
  if (subcommand === "history") {
    const history = await readHistory(db, input.guildId);
    if (history.result !== "ready") {
      return { content: "The lottery is not open." };
    }
    const lines = history.draws.map((draw) => `${draw.drawId} ${draw.status} pot ${draw.pot} bonus ${draw.bonus} tickets ${draw.tickets}`);
    return { content: `${lines.join(" ") || "No settled draws."} The notice is not posted.` };
  }
  if (subcommand === "tickets") {
    const action = text(input.options, "action") || "quote";
    if (action === "buy") {
      const bought = await buyTickets(db, {
        guildId: input.guildId,
        userId: input.userId,
        quoteId: text(input.options, "quote"),
        idempotencyKey: `lottery:${input.userId}:${text(input.options, "quote")}:${input.now.toISOString()}`,
        now: input.now,
      });
      if (bought.result === "ready") {
        return { content: `${bought.receipt} The notice is not posted.` };
      }
      if (bought.result === "already_recorded") {
        return { content: "That ticket purchase is already recorded. The notice is not posted." };
      }
      if (bought.result === "unfunded") {
        return { content: "The lottery budget cannot reserve the 50 percent bonus. Nothing was charged." };
      }
      if (bought.result === "schedule_required") {
        return { content: "The draw time is not selected. Nothing was charged." };
      }
      return { content: "Those tickets were not bought. Nothing else was charged. The notice is not posted." };
    }
    const quoted = await quoteTickets(db, {
      guildId: input.guildId,
      userId: input.userId,
      ...(whole(input.options, "quantity") !== undefined ? { quantity: whole(input.options, "quantity") } : {}),
      idempotencyKey: `lottery-quote:${input.userId}:${input.now.toISOString()}`,
      now: input.now,
    });
    if (quoted.result === "quoted") {
      return { content: `Quote ${quoted.quoteId}. Entries ${quoted.entries}. Tickets ${quoted.tickets}. Odds ${quoted.oddsBasisPoints} of 10000. Contribution ${quoted.contribution}. Bonus ${quoted.subsidy}. Deadline ${quoted.deadline}. Stall ${quoted.stallAt}. Budget remaining ${quoted.budgetRemaining}. ${quoted.rules} Nothing was charged. The notice is not posted.` };
    }
    if (quoted.result === "unfunded" && "subsidy" in quoted) {
      return { content: `The bonus ${quoted.subsidy} is not reserved. Budget remaining ${quoted.budgetRemaining}. Deadline ${quoted.deadline}. Stall ${quoted.stallAt}. Nothing was charged.` };
    }
    if (quoted.result === "schedule_required") {
      return { content: "The draw time is not selected. Nothing was charged. The notice is not posted." };
    }
    return { content: "That quote was not opened. Nothing was charged. The notice is not posted." };
  }
  const current = await readDraw(db, { guildId: input.guildId, userId: input.userId });
  if (current.result === "schedule_required") {
    return { content: "The draw time is not selected. Nothing was charged. The notice is not posted." };
  }
  if (current.result !== "ready") {
    return { content: "The lottery is not open." };
  }
  return { content: `Entries ${current.entries}. Tickets ${current.tickets}. Your tickets ${current.memberTickets}. Odds ${current.oddsBasisPoints} of 10000. Pot ${current.pot}. Bonus ${current.bonus}. Deadline ${current.deadline}. Stall ${current.stallAt}. Budget remaining ${current.budgetRemaining}. ${current.rules} The notice is not posted.` };
}
