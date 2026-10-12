import {
  activateCollapseCharge,
  buyPick,
  quotePick,
  readBoard,
  readDeadDropHistory,
  saveDeadDropSpecial,
  setDeadDropReminder,
  type PrismaClient,
} from "@collective/db";

type Options = Record<string, string | boolean | number>;

function text(options: Options, key: string): string {
  const value = options[key];
  return typeof value === "string" ? value : "";
}

export async function runDeadDropCommand(
  db: PrismaClient,
  input: { subcommand?: string; options: Options; guildId: string; userId: string; roleIds: readonly string[]; now: Date },
) {
  const subcommand = input.subcommand || "board";
  if (subcommand === "reminder") {
    const enabled = input.options["enabled"] !== false;
    const saved = await setDeadDropReminder(db, { guildId: input.guildId, userId: input.userId, enabled });
    if (saved.result !== "saved") {
      return { content: "The reminder was not saved. The notice is not posted." };
    }
    return { content: `Reminder ${saved.enabled ? "on" : "off"}. The notice is not posted.` };
  }
  if (subcommand === "special") {
    const action = text(input.options, "action") || "set";
    if (action === "activate") {
      const activated = await activateCollapseCharge(db, { guildId: input.guildId, chargeId: text(input.options, "charge"), actorUserId: input.userId, now: input.now });
      if (activated.result === "activated") {
        return { content: `Market Collapse returned its allocated Ingots to the exchange. Inventory is ${activated.inventory}. The price was not reset. The notice is not posted.` };
      }
      if (activated.result === "already_activated") {
        return { content: "That Market Collapse charge is already activated. The notice is not posted." };
      }
      return { content: "That Market Collapse charge was not activated. Nothing was minted. The notice is not posted." };
    }
    const saved = await saveDeadDropSpecial(db, {
      guildId: input.guildId,
      actorUserId: input.userId,
      actorRoleIds: input.roleIds,
      kind: text(input.options, "kind"),
      payload: text(input.options, "payload"),
      reason: text(input.options, "reason") || "Set a Dead Drop special board",
      now: input.now,
    });
    if (saved.result === "saved") {
      return { content: "The next board can carry that special reward. Positions stay hidden. The notice is not posted." };
    }
    return { content: "The special board was not saved. The notice is not posted." };
  }
  if (subcommand === "pick") {
    const action = text(input.options, "action") || "quote";
    if (action === "buy") {
      const bought = await buyPick(db, {
        guildId: input.guildId,
        userId: input.userId,
        quoteId: text(input.options, "quote"),
        idempotencyKey: `dead-drop:${input.userId}:${text(input.options, "quote")}:${input.now.toISOString()}`,
        now: input.now,
      });
      if (bought.result === "ready") {
        return { content: `${bought.receipt} The notice is not posted.` };
      }
      if (bought.result === "already_recorded") {
        return { content: "That pick is already recorded. The notice is not posted." };
      }
      if (bought.result === "schedule_required") {
        return { content: "The opening hour is not selected. Nothing was charged. The notice is not posted." };
      }
      if (bought.result === "unfunded" || bought.result === "limit" || bought.result === "taken" || bought.result === "paused" || bought.result === "closed" || bought.result === "insufficient") {
        return { content: "That cell was not revealed. Nothing else was charged. The notice is not posted." };
      }
      return { content: "That pick was not bought. Nothing was charged. The notice is not posted." };
    }
    const quoted = await quotePick(db, {
      guildId: input.guildId,
      userId: input.userId,
      coordinate: text(input.options, "coordinate"),
      idempotencyKey: `dead-drop-quote:${input.userId}:${text(input.options, "coordinate")}:${input.now.toISOString()}`,
      now: input.now,
    });
    if (quoted.result === "quoted") {
      return { content: `Quote ${quoted.quoteId}. ${quoted.coordinate}. Price ${quoted.price}. Share ${quoted.share}. Treasury ${quoted.treasury}. Jackpot ${quoted.jackpot}. Picks left ${quoted.picksLeft}. Opens ${quoted.opensAt}. Closes ${quoted.closesAt}. ${quoted.rules} Nothing was charged. The notice is not posted.` };
    }
    if (quoted.result === "schedule_required") {
      return { content: "The opening hour is not selected. Nothing was charged. The notice is not posted." };
    }
    if (quoted.result === "unfunded") {
      return { content: `The ${quoted.budget} budget is not funded. Nothing was charged. The notice is not posted.` };
    }
    return { content: "That quote was not opened. Nothing was charged. The notice is not posted." };
  }
  if (subcommand === "history") {
    const history = await readDeadDropHistory(db, input.guildId);
    if (history.result !== "ready") {
      return { content: "Dead Drop is not open. The notice is not posted." };
    }
    const lines = history.boards.map((board) => `${board.boardId} ${board.status} jackpot ${board.jackpot}`);
    return { content: `${lines.join(" ") || "No closed boards."} The notice is not posted.` };
  }
  const current = await readBoard(db, { guildId: input.guildId, userId: input.userId });
  if (current.result === "schedule_required") {
    return { content: "The opening hour is not selected. Nothing was charged. The notice is not posted." };
  }
  if (current.result === "unfunded") {
    return { content: `The ${current.budget} budget is not funded. Nothing was charged. The notice is not posted.` };
  }
  if (current.result !== "ready") {
    return { content: "Dead Drop is not open. Nothing was charged. The notice is not posted." };
  }
  return { content: `${current.grid}\nJackpot ${current.jackpot}. Picks left ${current.picksLeft}. Opens ${current.opensAt}. Closes ${current.closesAt}. ${current.rules} The notice is not posted.` };
}
