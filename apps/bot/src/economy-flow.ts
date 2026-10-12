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
  const ingots = wallet.ingots.status === "available" ? `${wallet.ingots.available} available, ${wallet.ingots.escrow} in escrow` : wallet.ingots.status;
  return `Marks ${wallet.marks.available} available, ${wallet.marks.escrow} in escrow. Ingots ${ingots}. Balances are public.`;
}

export async function runEconomyCommand(db: PrismaClient, command: EconomyCommand): Promise<{ content: string }> {
  const member = text(command, "member") || command.userId;
  if (command.subcommand === "wallet" || !command.subcommand) {
    return { content: walletText(await readMemberWallet(db, command.guildId, member)) };
  }
  if (command.subcommand === "history") {
    const staff = (await actorCan(db, { guildId: command.guildId, roleIds: command.roleIds, capability: "economy_operations" })) === "allowed";
    if (member !== command.userId && !staff) {
      return { content: "You can read your own receipts." };
    }
    const receipts = await listReceipts(db, { guildId: command.guildId, userId: member, audience: staff ? "staff" : "member" });
    if (receipts.length === 0) {
      return { content: "No Marks receipts yet." };
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
      return { content: `Transferred ${moved.amount} Marks. This is not new issuance.` };
    }
    return { content: `Transfer was not completed: ${moved.result}.` };
  }
  if (command.subcommand === "adjust") {
    const action = text(command, "action");
    const amount = whole(command, "amount");
    const reason = text(command, "reason");
    if ((action !== "add" && action !== "remove" && action !== "set" && action !== "bulk") || amount === null || !reason.trim()) {
      return { content: "Adjust needs add, remove, set, or bulk, a whole amount, and a reason." };
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
        return { content: "You cannot adjust wallets. Nothing was written." };
      }
      return { content: `Bulk grant ${granted.grants.map((grant) => `${grant.userId} ${grant.result}`).join(", ")}.` };
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
    if (adjusted.result === "denied") {
      return { content: "You cannot adjust wallets. Nothing was written." };
    }
    return { content: `Adjustment ${adjusted.result}.` };
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

function reportText(report: { marksIssued: string; marksReversed: string; marksSpent: string; transferCount: number; escrow: string; wallets: number }): string {
  return `Issued ${report.marksIssued}, reversed ${report.marksReversed}, spent ${report.marksSpent}, transfers ${report.transferCount}, escrow ${report.escrow}, wallets ${report.wallets}.`;
}
