import { randomUUID } from "node:crypto";

import {
  actorCan,
  adjustMarks,
  bulkGrantMarks,
  exportEconomyReport,
  listReceipts,
  readMemberWallet,
  readStatistics,
  transferMarks,
  type PrismaClient,
} from "@collective/db";

export interface EconomyCommand {
  name: string;
  subcommand?: string;
  interactionId?: string;
  options: Record<string, string | boolean | number>;
  guildId: string;
  userId: string;
  roleIds: string[];
  now: Date;
}

function text(command: EconomyCommand, name: string): string {
  const value = command.options[name];
  return typeof value === "string" ? value : "";
}

function whole(command: EconomyCommand, name: string): number | null {
  const value = command.options[name];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function walletText(wallet: Awaited<ReturnType<typeof readMemberWallet>>): string {
  if (wallet.marks.status !== "available") {
    return "Marks are unavailable.";
  }
  const ingots = wallet.ingots.status === "available"
    ? `**${wallet.ingots.available}** available\n**${wallet.ingots.escrow}** in escrow`
    : wallet.ingots.status;
  return `**Marks**\n**${wallet.marks.available}** available\n**${wallet.marks.escrow}** held\n\n**Ingots**\n${ingots}\n\n-# Balances are public.`;
}

export async function runEconomyCommand(db: PrismaClient, command: EconomyCommand): Promise<{ content: string }> {
  const member = text(command, "member") || command.userId;
  if (command.subcommand === "wallet" || !command.subcommand) {
    return { content: walletText(await readMemberWallet(db, command.guildId, member)) };
  }
  if (command.subcommand === "history") {
    const staff = (await actorCan(db, { guildId: command.guildId, roleIds: command.roleIds, capability: "economy_operations" })) === "allowed";
    if (member !== command.userId && !staff) {
      return { content: "Your own receipts are open. Another member's history needs the economy operations role." };
    }
    const receipts = await listReceipts(db, { guildId: command.guildId, userId: member, audience: staff ? "staff" : "member" });
    if (receipts.length === 0) {
      return { content: "The receipt book is empty. Transfers, awards, and staff adjustments will show up here." };
    }
    return {
      content: receipts
        .map((entry) => `${entry.createdAt} ${entry.kind} ${entry.direction} ${entry.amount}${staff && "reason" in entry ? ` (${entry.reason})` : ""}`)
        .join("\n"),
    };
  }
  if (command.subcommand === "transfer") {
    const amount = whole(command, "amount");
    if (amount === null) {
      return { content: "Enter a whole Marks amount." };
    }
    const moved = await transferMarks(db, {
      guildId: command.guildId,
      fromUserId: command.userId,
      toUserId: text(command, "member"),
      amountMarks: amount,
      idempotencyKey: `transfer:${command.interactionId ?? randomUUID()}`,
      now: command.now,
    });
    if (moved.result === "transferred") {
      return { content: `**${moved.amount}** Marks changed hands.\n\n-# This moved Marks that already existed. Nothing new was minted.` };
    }
    if (moved.result === "insufficient") {
      return { content: "The pocket does not cover that transfer. Nothing was moved." };
    }
    return { content: `The transfer did not go through (${moved.result}). Nothing was moved.` };
  }
  if (command.subcommand === "adjust") {
    const action = text(command, "action");
    const amount = whole(command, "amount");
    const reason = text(command, "reason");
    if ((action !== "add" && action !== "remove" && action !== "set" && action !== "bulk") || amount === null || !reason.trim()) {
      return { content: "Pick how the Marks should move, name a whole amount, and leave a reason." };
    }
    const key = `adjust:${command.interactionId ?? randomUUID()}`;
    if (action === "bulk") {
      const granted = await bulkGrantMarks(db, {
        guildId: command.guildId,
        userIds: [text(command, "member")],
        amountMarks: amount,
        reason,
        actorUserId: command.userId,
        actorRoleIds: command.roleIds,
        batchId: key,
        now: command.now,
      });
      if (granted.result === "denied") {
        return { content: adjustmentSentence("denied", action, amount) };
      }
      return {
        content: granted.grants
          .map((grant) => `<@${grant.userId}>: ${adjustmentSentence(grant.result, "add", amount)}`)
          .join("\n"),
      };
    }
    const adjusted = await adjustMarks(db, {
      guildId: command.guildId,
      userId: text(command, "member"),
      action,
      amountMarks: amount,
      reason,
      actorUserId: command.userId,
      actorRoleIds: command.roleIds,
      idempotencyKey: key,
      now: command.now,
    });
    return { content: adjustmentSentence(adjusted.result, action, amount) };
  }
  return { content: "That economy action is not available." };
}

export async function runStatsCommand(db: PrismaClient, command: EconomyCommand): Promise<{ content: string }> {
  if (command.subcommand === "export") {
    const reason = text(command, "reason");
    if (!reason.trim()) {
      return { content: "An export needs a reason." };
    }
    const exported = await exportEconomyReport(db, {
      guildId: command.guildId,
      actorUserId: command.userId,
      actorRoleIds: command.roleIds,
      reason,
    });
    if (exported.result === "denied") {
      return { content: "You cannot view statistics." };
    }
    return { content: reportText(exported.report) };
  }
  const stats = await readStatistics(db, { guildId: command.guildId, roleIds: command.roleIds });
  if (stats.status === "denied") {
    return { content: "You cannot view statistics." };
  }
  return { content: reportText(stats.report) };
}

function adjustmentSentence(result: string, action: string, amount: number): string {
  if (result === "denied") {
    return "Your Discord roles are not allowed to adjust Marks. Nothing was written. The server owner can grant Economy operations to a role from the admin dashboard.";
  }
  if (result === "maintenance") {
    return "The economy is in maintenance. Nothing was written.";
  }
  if (result === "invalid") {
    return "That amount is not a valid Marks total. Nothing was written.";
  }
  if (result === "insufficient") {
    return "That member does not have enough Marks. Nothing was written.";
  }
  if (result === "capped") {
    return "That adjustment would pass the routine Marks budget. Nothing was written.";
  }
  if (result === "unfunded") {
    return "That award is not funded. Nothing was written.";
  }
  if (result === "already_recorded") {
    return "That adjustment was already recorded. The wallet was not changed again.";
  }
  if (result === "posted" || result === "adjusted") {
    if (action === "remove") {
      return `Removed ${amount} Marks. The reason is stored on the staff receipt.`;
    }
    if (action === "set") {
      return `Set the available balance from ${amount} Marks. The reason is stored on the staff receipt.`;
    }
    return `Added ${amount} Marks. The reason is stored on the staff receipt.`;
  }
  return `The adjustment did not finish (${result}). Check the wallet before trying again.`;
}

function reportText(report: { marksIssued: string; marksReversed: string; marksSpent: string; transferCount: number; escrow: string; wallets: number }): string {
  return [
    `**Issued** ${report.marksIssued}`,
    `**Reversed** ${report.marksReversed}`,
    `**Spent** ${report.marksSpent}`,
    `**Transfers** ${report.transferCount}`,
    `**Escrow** ${report.escrow}`,
    `**Wallets** ${report.wallets}`,
  ].join("\n");
}
