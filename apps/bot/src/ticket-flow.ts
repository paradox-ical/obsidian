import {
  addStaffNote,
  addTicketMessage,
  claimTicket,
  closeTicket,
  exportTicket,
  linkTicketReference,
  listTickets,
  givePeerCommendation,
  openTicket,
  publishTicketPanel,
  readPublicDossier,
  reopenTicket,
  transferTicket,
  type PrismaClient,
} from "@collective/db";
import type { TicketReferenceKind } from "@collective/domain";

import type { DiscordComponentRow } from "./discord.js";
import { spokenCode } from "./guide.js";
import { runRoomCommand } from "./season-flow.js";
import { buttonRow } from "./present.js";

export interface SupportCommand {
  name: string;
  subcommand?: string;
  options: Record<string, string | boolean | number>;
  guildId: string;
  userId: string;
  roleIds: string[];
  targetRoleIds: string[];
  now: Date;
}

export async function runSupportCommand(db: PrismaClient, command: SupportCommand): Promise<{ content: string; components?: DiscordComponentRow[] }> {
  if (command.subcommand === "rooms") {
    return runRoomCommand(db, command);
  }
  if (command.subcommand === "achievements" || command.subcommand === "commendations") {
    return readBook(db, command);
  }
  if (command.subcommand !== "tickets") {
    return { content: "That support control is not available on this command." };
  }

  const action = stringOption(command, "action");
  const ticketId = stringOption(command, "ticket");
  const reason = stringOption(command, "reason");
  const note = stringOption(command, "note");

  if (action === "panel") {
    const panel = await publishTicketPanel(db, { guildId: command.guildId, actorUserId: command.userId, actorRoleIds: command.roleIds, reason: reason || "Publish the ticket panel" });
    if (panel.result === "denied") {
      return { content: "You cannot publish a ticket panel." };
    }
    return {
      content: "Ticket categories are ready. A category button does not open a ticket until the form is answered, and it does not grant general access.",
      components: Array.from({ length: Math.ceil(panel.requests.length / 5) }, (_, i) => buttonRow(panel.requests.slice(i * 5, i * 5 + 5).map((request) => ({ id: request.customId, label: request.label, style: 1 })))),
    };
  }

  if (action === "open") {
    const opened = await openTicket(db, {
      guildId: command.guildId,
      userId: command.userId,
      categoryId: stringOption(command, "category"),
      answers: { need: note, topic: note, note, reference: note },
      source: "member",
      now: command.now,
    });
    if (opened.result === "opened") {
      return { content: `Ticket ${opened.number} is private. It does not grant general access. Channel delivery is ${opened.channelState}.` };
    }
    if (opened.result === "verification_required") {
      return { content: "That category needs verified status. Verification help stays available and does not grant general access." };
    }
    if (opened.result === "invalid_form") {
      return { content: "The form is incomplete, so no ticket was opened." };
    }
    return { content: `Ticket was not opened: ${opened.result}.` };
  }

  if (action === "list") {
    const listed = await listTickets(db, { guildId: command.guildId, actorUserId: command.userId, actorRoleIds: command.roleIds });
    if (listed.tickets.length === 0) {
      return { content: "You have no tickets here." };
    }
    return { content: listed.tickets.map((ticket) => `#${ticket.number} ${ticket.status}`).join("\n") };
  }

  if (!ticketId) {
    return { content: "That action needs a ticket." };
  }
  if (["close", "reopen", "claim", "transfer", "transcript", "link"].includes(action) && !reason.trim()) {
    return { content: "A reason is required." };
  }

  if (action === "close") {
    const closed = await closeTicket(db, { guildId: command.guildId, ticketId, actorUserId: command.userId, actorRoleIds: command.roleIds, reason, now: command.now });
    return { content: closed.result === "denied" ? "You cannot close that ticket." : closed.result === "closed" ? "The ticket is closed." : spokenCode(closed.result) };
  }
  if (action === "reopen") {
    const reopened = await reopenTicket(db, { guildId: command.guildId, ticketId, actorUserId: command.userId, actorRoleIds: command.roleIds, reason, now: command.now });
    return { content: reopened.result === "denied" ? "You cannot reopen that ticket." : reopened.result === "reopened" ? "The ticket is open again." : spokenCode(reopened.result) };
  }
  if (action === "claim") {
    const claimed = await claimTicket(db, { guildId: command.guildId, ticketId, actorUserId: command.userId, actorRoleIds: command.roleIds, reason });
    return { content: claimed.result === "claim" ? "The ticket is yours." : claimed.result === "already_claimed" || claimed.result === "occupied" ? "Someone already has that ticket." : spokenCode(claimed.result) };
  }
  if (action === "transfer") {
    if (command.targetRoleIds.length === 0) {
      return { content: "That member's roles could not be confirmed, so the ticket was not transferred." };
    }
    const moved = await transferTicket(db, {
      guildId: command.guildId,
      ticketId,
      actorUserId: command.userId,
      actorRoleIds: command.roleIds,
      targetUserId: stringOption(command, "member"),
      targetRoleIds: command.targetRoleIds,
      reason,
    });
    return { content: moved.result === "transfer" ? "The ticket has a new owner." : moved.result === "already_assigned" ? "That member already has the ticket." : spokenCode(moved.result) };
  }
  if (action === "note") {
    const noted = await addStaffNote(db, { guildId: command.guildId, ticketId, actorUserId: command.userId, actorRoleIds: command.roleIds, body: note, now: command.now });
    return { content: noted.result === "added" ? "Staff note saved. Members do not receive it." : "You cannot add a staff note." };
  }
  if (action === "message") {
    const added = await addTicketMessage(db, { guildId: command.guildId, ticketId, actorUserId: command.userId, actorRoleIds: command.roleIds, body: note, now: command.now });
    return { content: added.result === "added" ? "Message added to the ticket." : "You cannot add that message." };
  }
  if (action === "transcript") {
    const staff = await exportTicket(db, { guildId: command.guildId, ticketId, actorUserId: command.userId, actorRoleIds: command.roleIds, audience: "staff", reason });
    if (staff.result === "exported") {
      return { content: renderTranscript(staff.messages) };
    }
    const member = await exportTicket(db, { guildId: command.guildId, ticketId, actorUserId: command.userId, actorRoleIds: command.roleIds, audience: "member", reason });
    if (member.result !== "exported") {
      return { content: "You cannot view that ticket." };
    }
    return { content: renderTranscript(member.messages) };
  }
  if (action === "link") {
    const kind = referenceKind(command);
    const targetId = kind === "moderation_case" ? stringOption(command, "case") : stringOption(command, "reference");
    const linked = await linkTicketReference(db, {
      guildId: command.guildId,
      ticketId,
      actorUserId: command.userId,
      actorRoleIds: command.roleIds,
      kind,
      targetId,
      reason,
    });
    if (linked.result !== "linked") {
      return { content: linked.result === "denied" ? "You cannot link that ticket." : "That reference was not linked." };
    }
    return {
      content: linked.integrationStatus === "module_not_built"
        ? "The id is stored. Purchase and reward resolution is not built."
        : "Moderation case linked.",
    };
  }
  return { content: "That ticket action is not available." };
}

function renderTranscript(messages: ReadonlyArray<{ visibility: string; body: string | null; contentLabel: string }>): string {
  if (messages.length === 0) {
    return "The transcript is empty.";
  }
  return messages.map((message) => `${message.visibility}: ${message.body ?? message.contentLabel}`).join("\n");
}

async function readBook(db: PrismaClient, command: SupportCommand): Promise<{ content: string }> {
  if (command.subcommand === "commendations" && stringOption(command, "member")) {
    const category = stringOption(command, "category");
    const reason = stringOption(command, "reason");
    if (!category.trim() || !reason.trim()) {
      return { content: "A commendation needs a category and a reason. Nothing was written, and no Marks moved." };
    }
    try {
      const given = await givePeerCommendation(db, {
        guildId: command.guildId,
        fromUserId: command.userId,
        toUserId: stringOption(command, "member"),
        category,
        reason,
        now: command.now,
      });
      if (given.result === "recorded") {
        return { content: "The commendation is recorded. It pays nothing." };
      }
      if (given.result === "self") {
        return { content: "You cannot commend yourself. Nothing was written." };
      }
      if (given.result === "cooldown") {
        return { content: "You already left one recently. Nothing was written." };
      }
      if (given.result === "pair_limit") {
        return { content: "You have already commended that member enough times in this window." };
      }
      return { content: "That commendation was not recorded. No Marks moved." };
    } catch (error) {
      return { content: error instanceof Error ? error.message : "That commendation was not recorded." };
    }
  }
  const dossier = await readPublicDossier(db, command.guildId, command.userId);
  if (command.subcommand === "achievements") {
    const lines = dossier.achievements.map((item) => `**${item.name}**`);
    return { content: lines.length > 0 ? lines.join("\n") : "No achievements earned yet. Hidden achievements remain undisclosed." };
  }
  const lines = dossier.commendations.map((item) => `**${item.category}** — ${item.reason}`);
  return { content: lines.length > 0 ? lines.join("\n") : "No commendation is on the dossier. Leave one with a member, a category, and a reason. It pays nothing." };
}

function referenceKind(command: SupportCommand): TicketReferenceKind {
  const kind = stringOption(command, "kind");
  if (kind === "reward" || kind === "purchase" || kind === "moderation_case") {
    return kind;
  }
  return stringOption(command, "case") ? "moderation_case" : "purchase";
}

function stringOption(command: SupportCommand, name: string): string {
  const value = command.options[name];
  return typeof value === "string" ? value : "";
}
