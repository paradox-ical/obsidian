import {
  exportLogs,
  listCases,
  manualSanction,
  readModerationPolicy,
  resolveAppeal,
  reverseCase,
  searchLogs,
  submitAppeal,
  submitReport,
  warningTotal,
  type PrismaClient,
} from "@collective/db";
import { MODERATION_ACTIONS, type ModerationAction } from "@collective/domain";

import { spokenCode } from "./guide.js";

export interface ModerationCommand {
  name: string;
  subcommand?: string;
  options: Record<string, string | boolean | number>;
  guildId: string;
  userId: string;
  roleIds: string[];
  actorPosition: number;
  targetPosition: number | null;
  targetIsOwner: boolean;
  botPosition: number;
  botPermissions: string;
  now: Date;
}

export async function runModerationCommand(db: PrismaClient, command: ModerationCommand): Promise<{ content: string }> {
  if (command.name === "report" && command.subcommand === "submit") {
    const submitted = await submitReport(db, {
      guildId: command.guildId,
      reporterUserId: command.userId,
      targetUserId: stringOption(command, "member"),
      note: stringOption(command, "note"),
    });
    return { content: `Report ${submitted.reportId} is private. Ticket status: ${submitted.ticketStatus}.` };
  }

  if (command.name === "logs" && command.subcommand === "search") {
    const found = await searchLogs(db, { guildId: command.guildId, actorRoleIds: command.roleIds, query: stringOption(command, "query") });
    if (found.result === "denied") {
      return { content: "You cannot view staff logs." };
    }
    if (found.logs.length === 0) {
      return { content: "No staff logs matched." };
    }
    return {
      content: found.logs
        .map((log) => `${log.kind}: ${log.contentLabel}${log.actorConfidence === "unknown" ? ", actor unknown" : ""}`)
        .join("\n"),
    };
  }

  if (command.name === "logs" && command.subcommand === "export") {
    const exported = await exportLogs(db, {
      guildId: command.guildId,
      actorUserId: command.userId,
      actorRoleIds: command.roleIds,
      reason: stringOption(command, "reason"),
    });
    if (exported.result === "denied") {
      return { content: "You cannot export staff logs." };
    }
    return { content: `Exported ${exported.logs.length} staff log rows. Unavailable text stays labelled.` };
  }

  if (command.name === "logs" && command.subcommand === "settings") {
    const policy = await readModerationPolicy(db, command.guildId);
    const allowed = await searchLogs(db, { guildId: command.guildId, actorRoleIds: command.roleIds, query: "" });
    if (allowed.result === "denied") {
      return { content: "You cannot view log settings." };
    }
    return { content: `Log retention is ${policy.policy.retentionDays} days. Automatic ban is disabled.` };
  }

  if (command.name === "mod" && command.subcommand === "warnings") {
    const total = await warningTotal(db, command.guildId, stringOption(command, "member"), command.now);
    const allowed = await listCases(db, { guildId: command.guildId, actorRoleIds: command.roleIds });
    if (allowed.result === "denied") {
      return { content: "You cannot view warning points." };
    }
    return { content: `Active warning points: ${total}. Reversed and expired points are excluded.` };
  }

  if (command.name === "mod" && command.subcommand === "cases") {
    if (command.options["revoke"] === true) {
      const reversed = await reverseCase(db, {
        guildId: command.guildId,
        actorUserId: command.userId,
        actorRoleIds: command.roleIds,
        caseId: stringOption(command, "case"),
        reason: stringOption(command, "reason") || "Staff reversed the case.",
        now: command.now,
      });
      return { content: reversed.result === "denied" ? "You cannot reverse cases." : reversed.result === "reversed" ? "The case is reversed." : spokenCode(reversed.result) };
    }
    const cases = await listCases(db, { guildId: command.guildId, actorRoleIds: command.roleIds });
    if (cases.result === "denied") {
      return { content: "You cannot view cases." };
    }
    const match = cases.cases.find((record) => record.id === stringOption(command, "case"));
    return { content: match ? `Case ${match.id} outcome: ${match.outcome}.` : "That case was not found." };
  }

  if (command.name === "mod" && command.subcommand === "appeals") {
    if (command.options["revoke"] === true) {
      const appeal = await db.moderationAppeal.findFirst({
        where: { guildId: command.guildId, caseId: stringOption(command, "case"), status: "open" },
      });
      if (!appeal) {
        return { content: "There is no open appeal for that case." };
      }
      const resolved = await resolveAppeal(db, {
        guildId: command.guildId,
        actorUserId: command.userId,
        actorRoleIds: command.roleIds,
        appealId: appeal.id,
        accept: true,
        reason: stringOption(command, "reason") || "Staff accepted the appeal.",
        now: command.now,
      });
      return { content: resolved.result === "denied" ? "You cannot resolve appeals." : resolved.result === "accepted" ? "The appeal is accepted." : spokenCode(resolved.result) };
    }
    const submitted = await submitAppeal(db, {
      guildId: command.guildId,
      userId: command.userId,
      caseId: stringOption(command, "case"),
      note: stringOption(command, "note") || stringOption(command, "reason"),
    });
    return { content: submitted.result === "submitted" ? `Appeal ${submitted.appealId} is private. Ticket status: ${submitted.ticketStatus}.` : "That case cannot be appealed." };
  }

  if (command.name === "mod" && command.subcommand === "sanctions") {
    const action = stringOption(command, "action");
    if (!isAction(action)) {
      return { content: "That sanction is not available." };
    }
    if (command.targetPosition === null) {
      return { content: "That member's roles could not be confirmed, so the sanction was not recorded as a success." };
    }
    const recorded = await manualSanction(db, {
      guildId: command.guildId,
      actorUserId: command.userId,
      actorRoleIds: command.roleIds,
      targetUserId: stringOption(command, "member"),
      action,
      reason: stringOption(command, "reason"),
      points: Number(command.options["points"] ?? 1),
      days: typeof command.options["days"] === "number" ? command.options["days"] : null,
      actorPosition: command.actorPosition,
      targetPosition: command.targetPosition,
      botPosition: command.botPosition,
      botPermissions: command.botPermissions,
      targetIsOwner: command.targetIsOwner,
      now: command.now,
    });
    if (recorded.result === "denied") {
      return { content: "You cannot apply sanctions." };
    }
    if (recorded.result === "failed") {
      return { content: `Sanction failed: ${recorded.reason}.` };
    }
    return { content: `Sanction recorded. Outcome: ${recorded.outcome}.` };
  }

  return { content: "That moderation control is not available on this command." };
}

function stringOption(command: ModerationCommand, name: string): string {
  const value = command.options[name];
  return typeof value === "string" ? value : "";
}

function isAction(value: string): value is ModerationAction {
  return (MODERATION_ACTIONS as readonly string[]).includes(value);
}
