import { randomUUID } from "node:crypto";

import {
  claimDecision,
  closeDecision,
  exampleTicketSettings,
  formGaps,
  inactivityDue,
  memberSummary,
  memberTranscript,
  openingDecision,
  panelRequests,
  policySnapshot,
  prepareTicketSettings,
  referenceIntegration,
  reopenDecision,
  transferDecision,
  type OpeningSource,
  type TicketCategoryInput,
  type TicketPolicySnapshot,
  type TicketReferenceKind,
  type TicketSettingsInput,
  type TranscriptMessage,
} from "@collective/domain";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

import { actorCan, enqueueJob, enqueueOutbox, ensureGuild, moduleIsAvailable, writeAudit, type Writer } from "./platform.js";

const HOUR_MS = 60 * 60 * 1000;

export class TicketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TicketError";
  }
}

export interface TicketChannelRequest {
  guildId: string;
  ticketId: string;
  number: number;
  privacy: "channel" | "thread";
  parentChannelId: string | null;
  openerUserId: string;
  staffRoleIds: string[];
}

export type TicketChannelResult =
  | { outcome: "setup_required" }
  | { outcome: "applied"; channelId: string }
  | { outcome: "permission" }
  | { outcome: "missing_parent" };

function asSettings(value: unknown): TicketSettingsInput | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const settings = value as TicketSettingsInput;
  if (!Array.isArray(settings.categories) || typeof settings.openCap !== "number") {
    return null;
  }
  return settings;
}

function asSnapshot(value: unknown): TicketPolicySnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const snapshot = value as TicketPolicySnapshot;
  if (typeof snapshot.retentionDays !== "number" || typeof snapshot.categoryId !== "string") {
    return null;
  }
  return snapshot;
}

async function staffAllowed(db: Writer, guildId: string, roleIds: readonly string[]): Promise<boolean> {
  return (await actorCan(db, { guildId, roleIds, capability: "tickets" })) === "allowed";
}

export async function readTicketSettings(db: Writer, guildId: string) {
  const row = await db.ticketSettings.findUnique({ where: { guildId } });
  if (!row) {
    return { stored: false as const, version: 0, settings: exampleTicketSettings(), pendingIntegrations: "module_not_built" as const };
  }
  const settings = asSettings(row.document);
  if (!settings) {
    throw new TicketError("Stored ticket settings are unreadable.");
  }
  return { stored: true as const, version: row.version, settings: prepareTicketSettings(settings), pendingIntegrations: "module_not_built" as const };
}

export async function ensureTicketSettings(db: Writer, guildId: string) {
  await ensureGuild(db, { guildId });
  const existing = await db.ticketSettings.findUnique({ where: { guildId } });
  if (existing) {
    return readTicketSettings(db, guildId);
  }
  const settings = exampleTicketSettings();
  await db.ticketSettings.create({
    data: { guildId, version: 1, label: settings.label, document: settings as unknown as Prisma.InputJsonValue },
  });
  return readTicketSettings(db, guildId);
}

export async function saveTicketSettings(
  db: Writer,
  input: { guildId: string; settings: TicketSettingsInput; actorUserId: string; reason: string },
) {
  await ensureGuild(db, { guildId: input.guildId });
  const settings = prepareTicketSettings(input.settings);
  const current = await db.ticketSettings.findUnique({ where: { guildId: input.guildId } });
  const version = (current?.version ?? 0) + 1;
  await db.ticketSettings.upsert({
    where: { guildId: input.guildId },
    create: { guildId: input.guildId, version, label: settings.label, document: settings as unknown as Prisma.InputJsonValue },
    update: { version, label: settings.label, document: settings as unknown as Prisma.InputJsonValue },
  });
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "tickets.settings",
    targetType: "ticket_settings",
    targetId: input.guildId,
    reason: input.reason,
  });
  return { version, settings, grantsGeneralAccess: false as const, pendingIntegrations: "module_not_built" as const };
}

export async function publishTicketPanel(
  db: Writer,
  input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; reason: string },
) {
  if (!(await staffAllowed(db, input.guildId, input.actorRoleIds))) {
    return { result: "denied" as const };
  }
  const stored = await ensureTicketSettings(db, input.guildId);
  const id = randomUUID();
  await db.ticketPanel.create({
    data: {
      id,
      guildId: input.guildId,
      label: stored.settings.label,
      categoryIds: stored.settings.categories.map((category) => category.id),
    },
  });
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "tickets.panel",
    targetType: "ticket_panel",
    targetId: id,
    reason: input.reason,
  });
  return { result: "published" as const, panelId: id, requests: panelRequests(stored.settings.categories) };
}

async function verifiedMember(db: Writer, guildId: string, userId: string): Promise<boolean> {
  const record = await db.verificationRecord.findUnique({ where: { guildId_userId: { guildId, userId } } });
  return record?.status === "verified";
}

function categoryFor(settings: TicketSettingsInput, categoryId: string, source: OpeningSource): TicketCategoryInput | null {
  if (source === "report" || source === "appeal") {
    return settings.categories.find((category) => category.purpose === "moderation") ?? null;
  }
  return settings.categories.find((category) => category.id === categoryId) ?? null;
}

export async function openTicket(
  db: Writer,
  input: {
    guildId: string;
    userId: string;
    categoryId: string;
    answers: Record<string, string>;
    source: OpeningSource;
    now: Date;
    caseId?: string;
  },
) {
  const stored = await ensureTicketSettings(db, input.guildId);
  const category = categoryFor(stored.settings, input.categoryId, input.source);
  const maintenance = !(await moduleIsAvailable(db, input.guildId, "tickets"));
  const openCount = await db.supportTicket.count({ where: { guildId: input.guildId, openerUserId: input.userId, status: "open" } });
  const lastClosed = await db.supportTicket.findFirst({
    where: { guildId: input.guildId, openerUserId: input.userId, status: "closed" },
    orderBy: { closedAt: "desc" },
  });
  const decision = openingDecision({
    category,
    verified: await verifiedMember(db, input.guildId, input.userId),
    openCount,
    lastClosedAt: lastClosed?.closedAt ?? null,
    now: input.now,
    settings: stored.settings,
    maintenance,
    source: input.source,
  });
  if (decision !== "allowed" || !category) {
    return { result: decision, grantsGeneralAccess: false as const };
  }
  const gaps = formGaps(category, input.answers);
  if (gaps.length > 0) {
    return { result: "invalid_form" as const, fields: gaps, grantsGeneralAccess: false as const };
  }
  const latest = await db.supportTicket.aggregate({ where: { guildId: input.guildId }, _max: { number: true } });
  const number = (latest._max.number ?? 0) + 1;
  const id = randomUUID();
  const snapshot = policySnapshot(stored.version, stored.settings, category);
  const answerText = category.formFields
    .map((field) => input.answers[field.id]?.trim())
    .filter((value): value is string => Boolean(value))
    .join("\n");
  await db.supportTicket.create({
    data: {
      id,
      guildId: input.guildId,
      number,
      openerUserId: input.userId,
      status: "open",
      formAnswers: input.answers,
      summary: null,
      policySnapshot: snapshot as unknown as Prisma.InputJsonValue,
      channelState: "pending",
      lastHumanAt: input.now,
      contentLabel: "available",
    },
  });
  await db.ticketMessage.create({
    data: {
      id: randomUUID(),
      ticketId: id,
      guildId: input.guildId,
      authorUserId: input.userId,
      authorKind: "member",
      visibility: "member",
      body: answerText,
      contentLabel: "available",
    },
  });
  const staff = await db.capabilityGrant.findMany({ where: { guildId: input.guildId, capability: "tickets" } });
  await enqueueOutbox(db, {
    guildId: input.guildId,
    eventType: "discord.ticket.open",
    payload: {
      guildId: input.guildId,
      ticketId: id,
      number,
      privacy: snapshot.privacy,
      parentChannelId: stored.settings.parentChannelId,
      openerUserId: input.userId,
      staffRoleIds: staff.map((grant) => grant.roleId),
    },
    idempotencyKey: `ticket-open:${id}`,
  });
  await enqueueJob(db, {
    guildId: input.guildId,
    jobType: "ticket.inactivity",
    payload: { ticketId: id },
    idempotencyKey: `ticket:${id}:inactivity:${input.now.toISOString()}`,
    runAt: new Date(input.now.getTime() + snapshot.inactivityReminderHours * HOUR_MS),
  });
  if (input.caseId) {
    await linkReferenceRecord(db, { guildId: input.guildId, ticketId: id, kind: "moderation_case", targetId: input.caseId });
  }
  return {
    result: "opened" as const,
    ticketId: id,
    number,
    grantsGeneralAccess: false as const,
    channelState: "pending" as const,
    economyIntegration: category.purpose === "purchase_dispute" ? ("module_not_built" as const) : ("not_applicable" as const),
  };
}

async function linkReferenceRecord(
  db: Writer,
  input: { guildId: string; ticketId: string; kind: TicketReferenceKind; targetId: string },
) {
  if (input.kind === "moderation_case") {
    const record = await db.moderationCase.findUnique({ where: { id: input.targetId } });
    if (!record || record.guildId !== input.guildId) {
      return { result: "missing" as const };
    }
  }
  const status = referenceIntegration(input.kind);
  const existing = await db.ticketReference.findUnique({
    where: { ticketId_kind_targetId: { ticketId: input.ticketId, kind: input.kind, targetId: input.targetId } },
  });
  if (existing) {
    return { result: "linked" as const, integrationStatus: existing.integrationStatus };
  }
  await db.ticketReference.create({
    data: {
      id: randomUUID(),
      ticketId: input.ticketId,
      guildId: input.guildId,
      kind: input.kind,
      targetId: input.targetId,
      integrationStatus: status,
    },
  });
  return { result: "linked" as const, integrationStatus: status };
}

export async function linkTicketReference(
  db: Writer,
  input: {
    guildId: string;
    ticketId: string;
    actorUserId: string;
    actorRoleIds: readonly string[];
    kind: TicketReferenceKind;
    targetId: string;
    reason: string;
  },
) {
  if (!(await staffAllowed(db, input.guildId, input.actorRoleIds))) {
    return { result: "denied" as const };
  }
  const ticket = await db.supportTicket.findUnique({ where: { id: input.ticketId } });
  if (!ticket || ticket.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  const linked = await linkReferenceRecord(db, input);
  if (linked.result === "missing") {
    return linked;
  }
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "tickets.reference",
    targetType: "ticket_reference",
    targetId: input.ticketId,
    reason: input.reason,
  });
  return linked;
}

async function loadTicket(db: Writer, guildId: string, ticketId: string) {
  const ticket = await db.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket || ticket.guildId !== guildId) {
    return null;
  }
  return ticket;
}

export async function claimTicket(
  db: Writer,
  input: { guildId: string; ticketId: string; actorUserId: string; actorRoleIds: readonly string[]; reason: string },
) {
  const ticket = await loadTicket(db, input.guildId, input.ticketId);
  if (!ticket) {
    return { result: "missing" as const };
  }
  const decision = claimDecision({
    assigneeUserId: ticket.assigneeUserId,
    actorUserId: input.actorUserId,
    staff: await staffAllowed(db, input.guildId, input.actorRoleIds),
  });
  if (decision === "claim") {
    await db.supportTicket.update({ where: { id: ticket.id }, data: { assigneeUserId: input.actorUserId } });
    await writeAudit(db, {
      guildId: input.guildId,
      actorUserId: input.actorUserId,
      action: "tickets.claim",
      targetType: "support_ticket",
      targetId: ticket.id,
      reason: input.reason,
    });
  }
  return { result: decision, assigneeUserId: decision === "claim" ? input.actorUserId : ticket.assigneeUserId, openerUserId: ticket.openerUserId };
}

export async function transferTicket(
  db: Writer,
  input: {
    guildId: string;
    ticketId: string;
    actorUserId: string;
    actorRoleIds: readonly string[];
    targetUserId: string;
    targetRoleIds: readonly string[];
    reason: string;
  },
) {
  const ticket = await loadTicket(db, input.guildId, input.ticketId);
  if (!ticket) {
    return { result: "missing" as const };
  }
  const decision = transferDecision({
    staff: await staffAllowed(db, input.guildId, input.actorRoleIds),
    targetStaff: await staffAllowed(db, input.guildId, input.targetRoleIds),
    assigneeUserId: ticket.assigneeUserId,
    targetUserId: input.targetUserId,
  });
  if (decision === "transfer") {
    await db.supportTicket.update({ where: { id: ticket.id }, data: { assigneeUserId: input.targetUserId } });
    await writeAudit(db, {
      guildId: input.guildId,
      actorUserId: input.actorUserId,
      action: "tickets.transfer",
      targetType: "support_ticket",
      targetId: ticket.id,
      reason: input.reason,
    });
  }
  const fresh = decision === "transfer" ? await loadTicket(db, input.guildId, ticket.id) : ticket;
  return { result: decision, assigneeUserId: fresh?.assigneeUserId ?? null, openerUserId: ticket.openerUserId };
}

async function writeClose(
  db: Writer,
  ticket: { id: string; guildId: string; status: string; policySnapshot: unknown; closedAt: Date | null },
  input: { now: Date; reason: string; actorUserId: string },
) {
  if (closeDecision(ticket.status) === "already_closed") {
    return { result: "already_closed" as const, closedAt: ticket.closedAt };
  }
  const snapshot = asSnapshot(ticket.policySnapshot);
  const retentionDays = snapshot?.retentionDays ?? 14;
  const reopenUntil = new Date(input.now.getTime() + retentionDays * 24 * HOUR_MS);
  await db.supportTicket.update({
    where: { id: ticket.id },
    data: { status: "closed", closedAt: input.now, closeReason: input.reason, reopenUntil },
  });
  await enqueueJob(db, {
    guildId: ticket.guildId,
    jobType: "ticket.retain",
    payload: { ticketId: ticket.id },
    idempotencyKey: `ticket:${ticket.id}:retain:${input.now.toISOString()}`,
    runAt: reopenUntil,
  });
  if (input.actorUserId !== "system") {
    await writeAudit(db, {
      guildId: ticket.guildId,
      actorUserId: input.actorUserId,
      action: "tickets.close",
      targetType: "support_ticket",
      targetId: ticket.id,
      reason: input.reason,
    });
  }
  return { result: "closed" as const, closedAt: input.now };
}

export async function closeTicket(
  db: Writer,
  input: { guildId: string; ticketId: string; actorUserId: string; actorRoleIds: readonly string[]; reason: string; now: Date },
) {
  const ticket = await loadTicket(db, input.guildId, input.ticketId);
  if (!ticket) {
    return { result: "missing" as const };
  }
  const staff = await staffAllowed(db, input.guildId, input.actorRoleIds);
  if (!staff && ticket.openerUserId !== input.actorUserId) {
    return { result: "denied" as const };
  }
  return writeClose(db, ticket, input);
}

export async function reopenTicket(
  db: Writer,
  input: { guildId: string; ticketId: string; actorUserId: string; actorRoleIds: readonly string[]; reason: string; now: Date },
) {
  const ticket = await loadTicket(db, input.guildId, input.ticketId);
  if (!ticket) {
    return { result: "missing" as const };
  }
  const staff = await staffAllowed(db, input.guildId, input.actorRoleIds);
  if (!staff && ticket.openerUserId !== input.actorUserId) {
    return { result: "denied" as const };
  }
  const decision = reopenDecision({
    status: ticket.status,
    reopenUntil: ticket.reopenUntil,
    contentLabel: ticket.contentLabel,
    now: input.now,
  });
  if (decision !== "reopen") {
    return { result: decision };
  }
  await db.supportTicket.update({
    where: { id: ticket.id },
    data: { status: "open", closedAt: null, closeReason: null, reopenUntil: null, remindedAt: null, lastHumanAt: input.now },
  });
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "tickets.reopen",
    targetType: "support_ticket",
    targetId: ticket.id,
    reason: input.reason,
  });
  const snapshot = asSnapshot(ticket.policySnapshot);
  await enqueueJob(db, {
    guildId: input.guildId,
    jobType: "ticket.inactivity",
    payload: { ticketId: ticket.id },
    idempotencyKey: `ticket:${ticket.id}:inactivity:${input.now.toISOString()}`,
    runAt: new Date(input.now.getTime() + (snapshot?.inactivityReminderHours ?? 24) * HOUR_MS),
  });
  return { result: "reopened" as const };
}

async function messagesOf(db: Writer, ticketId: string): Promise<TranscriptMessage[]> {
  const rows = await db.ticketMessage.findMany({ where: { ticketId }, orderBy: { createdAt: "asc" } });
  return rows.map((row) => ({
    id: row.id,
    authorUserId: row.authorUserId,
    authorKind: row.authorKind,
    visibility: row.visibility,
    body: row.contentLabel === "available" ? row.body : null,
    contentLabel: row.contentLabel,
  }));
}

export async function addTicketMessage(
  db: Writer,
  input: { guildId: string; ticketId: string; actorUserId: string; actorRoleIds: readonly string[]; body: string; now: Date },
) {
  const ticket = await loadTicket(db, input.guildId, input.ticketId);
  if (!ticket || ticket.status !== "open" || ticket.contentLabel !== "available") {
    return { result: "missing" as const };
  }
  const staff = await staffAllowed(db, input.guildId, input.actorRoleIds);
  if (!staff && ticket.openerUserId !== input.actorUserId) {
    return { result: "denied" as const };
  }
  const body = input.body.trim();
  if (!body) {
    throw new TicketError("A ticket message needs text.");
  }
  await db.ticketMessage.create({
    data: {
      id: randomUUID(),
      ticketId: ticket.id,
      guildId: input.guildId,
      authorUserId: input.actorUserId,
      authorKind: staff ? "staff" : "member",
      visibility: "member",
      body,
      contentLabel: "available",
    },
  });
  await db.supportTicket.update({ where: { id: ticket.id }, data: { lastHumanAt: input.now, remindedAt: null } });
  const snapshot = asSnapshot(ticket.policySnapshot);
  await enqueueJob(db, {
    guildId: input.guildId,
    jobType: "ticket.inactivity",
    payload: { ticketId: ticket.id },
    idempotencyKey: `ticket:${ticket.id}:inactivity:${input.now.toISOString()}`,
    runAt: new Date(input.now.getTime() + (snapshot?.inactivityReminderHours ?? 24) * HOUR_MS),
  });
  return { result: "added" as const, visibility: "member" as const };
}

export async function addStaffNote(
  db: Writer,
  input: { guildId: string; ticketId: string; actorUserId: string; actorRoleIds: readonly string[]; body: string; now: Date },
) {
  if (!(await staffAllowed(db, input.guildId, input.actorRoleIds))) {
    return { result: "denied" as const };
  }
  const ticket = await loadTicket(db, input.guildId, input.ticketId);
  if (!ticket || ticket.contentLabel !== "available") {
    return { result: "missing" as const };
  }
  const body = input.body.trim();
  if (!body) {
    throw new TicketError("A staff note needs text.");
  }
  await db.ticketMessage.create({
    data: {
      id: randomUUID(),
      ticketId: ticket.id,
      guildId: input.guildId,
      authorUserId: input.actorUserId,
      authorKind: "staff",
      visibility: "staff",
      body,
      contentLabel: "available",
    },
  });
  await db.supportTicket.update({ where: { id: ticket.id }, data: { lastHumanAt: input.now, remindedAt: null } });
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "tickets.note",
    targetType: "support_ticket",
    targetId: ticket.id,
    reason: "Staff added a private note.",
  });
  return { result: "added" as const, visibility: "staff" as const };
}

export async function setTicketSummary(
  db: Writer,
  input: { guildId: string; ticketId: string; actorUserId: string; actorRoleIds: readonly string[]; summary: string; reason: string },
) {
  if (!(await staffAllowed(db, input.guildId, input.actorRoleIds))) {
    return { result: "denied" as const };
  }
  const ticket = await loadTicket(db, input.guildId, input.ticketId);
  if (!ticket || ticket.contentLabel !== "available") {
    return { result: "missing" as const };
  }
  await db.supportTicket.update({ where: { id: ticket.id }, data: { summary: input.summary.trim() } });
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "tickets.summary",
    targetType: "support_ticket",
    targetId: ticket.id,
    reason: input.reason,
  });
  return { result: "saved" as const };
}

export async function exportTicket(
  db: Writer,
  input: { guildId: string; ticketId: string; actorUserId: string; actorRoleIds: readonly string[]; audience: "member" | "staff"; reason: string },
) {
  const ticket = await loadTicket(db, input.guildId, input.ticketId);
  if (!ticket) {
    return { result: "missing" as const };
  }
  const staff = await staffAllowed(db, input.guildId, input.actorRoleIds);
  if (input.audience === "staff") {
    if (!staff) {
      return { result: "denied" as const };
    }
    await writeAudit(db, {
      guildId: input.guildId,
      actorUserId: input.actorUserId,
      action: "tickets.export",
      targetType: "support_ticket",
      targetId: ticket.id,
      reason: input.reason,
    });
    const messages = await messagesOf(db, ticket.id);
    return {
      result: "exported" as const,
      audience: "staff" as const,
      summary: ticket.contentLabel === "available" ? ticket.summary : null,
      messages,
    };
  }
  if (ticket.openerUserId !== input.actorUserId) {
    return { result: "denied" as const };
  }
  const view = memberSummary({ summary: ticket.summary, contentLabel: ticket.contentLabel, messages: await messagesOf(db, ticket.id) });
  return { result: "exported" as const, audience: "member" as const, ...view, messages: memberTranscript(view.messages) };
}

export async function listTickets(
  db: Writer,
  input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[] },
) {
  const staff = await staffAllowed(db, input.guildId, input.actorRoleIds);
  const tickets = await db.supportTicket.findMany({
    where: { guildId: input.guildId, ...(staff ? {} : { openerUserId: input.actorUserId }) },
    orderBy: { number: "asc" },
  });
  return {
    result: "ok" as const,
    tickets: tickets.map((ticket) => ({
      id: ticket.id,
      number: ticket.number,
      status: ticket.status,
      openerUserId: ticket.openerUserId,
      assigneeUserId: staff ? ticket.assigneeUserId : ticket.openerUserId === input.actorUserId ? ticket.assigneeUserId : null,
      channelState: ticket.channelState,
    })),
  };
}

export async function advanceTicketInactivity(db: Writer, ticketId: string, now: Date) {
  const ticket = await db.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) {
    return { changed: false as const };
  }
  const snapshot = asSnapshot(ticket.policySnapshot);
  if (!snapshot) {
    return { changed: false as const };
  }
  const due = inactivityDue({
    status: ticket.status,
    lastHumanAt: ticket.lastHumanAt,
    remindedAt: ticket.remindedAt,
    now,
    reminderHours: snapshot.inactivityReminderHours,
    closeHours: snapshot.inactivityCloseHours,
  });
  if (due === "close") {
    const closed = await writeClose(db, ticket, { now, reason: "inactivity", actorUserId: "system" });
    return { changed: closed.result === "closed", action: closed.result };
  }
  if (due !== "remind") {
    return { changed: false as const };
  }
  await db.supportTicket.update({ where: { id: ticket.id }, data: { remindedAt: now } });
  await db.ticketMessage.create({
    data: {
      id: randomUUID(),
      ticketId: ticket.id,
      guildId: ticket.guildId,
      authorUserId: "system",
      authorKind: "system",
      visibility: "member",
      body: `Ticket ${ticket.number} has had no human reply.`,
      contentLabel: "available",
    },
  });
  await enqueueOutbox(db, {
    guildId: ticket.guildId,
    eventType: "ticket.reminder",
    payload: { guildId: ticket.guildId, ticketId: ticket.id, number: ticket.number, channelId: ticket.channelId },
    idempotencyKey: `ticket-remind:${ticket.id}:${now.toISOString()}`,
  });
  return { changed: true as const, action: "reminded" as const };
}

export async function sweepTicketInactivity(db: PrismaClient, now: Date) {
  const open = await db.supportTicket.findMany({ where: { status: "open" } });
  let changed = 0;
  for (const ticket of open) {
    const result = await advanceTicketInactivity(db, ticket.id, now);
    if (result.changed) {
      changed += 1;
    }
  }
  return { changed };
}

export async function retainTicket(db: Writer, ticketId: string, now: Date) {
  const ticket = await db.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket || ticket.status !== "closed" || !ticket.reopenUntil || ticket.reopenUntil.getTime() > now.getTime() || ticket.contentLabel === "expired") {
    return { changed: false as const };
  }
  await db.supportTicket.update({ where: { id: ticket.id }, data: { summary: null, contentLabel: "expired" } });
  await db.ticketMessage.updateMany({ where: { ticketId: ticket.id }, data: { body: null, contentLabel: "expired" } });
  return { changed: true as const };
}

export async function sweepTicketRetention(db: PrismaClient, now: Date) {
  const due = await db.supportTicket.findMany({ where: { status: "closed", contentLabel: "available", reopenUntil: { lte: now } } });
  let changed = 0;
  for (const ticket of due) {
    const result = await retainTicket(db, ticket.id, now);
    if (result.changed) {
      changed += 1;
    }
  }
  return { changed };
}

export async function deliverTicketChannel(
  db: Writer,
  payload: TicketChannelRequest,
  executor: (request: TicketChannelRequest) => Promise<TicketChannelResult>,
) {
  const ticket = await db.supportTicket.findUnique({ where: { id: payload.ticketId } });
  if (!ticket || ticket.channelState === "provisioned") {
    return { result: "skipped" as const };
  }
  const delivered = await executor(payload);
  if (delivered.outcome === "setup_required") {
    throw new Error("Discord ticket channel delivery is setup_required.");
  }
  if (delivered.outcome === "applied") {
    await db.supportTicket.update({ where: { id: ticket.id }, data: { channelId: delivered.channelId, channelState: "provisioned" } });
    return { result: "provisioned" as const, channelId: delivered.channelId };
  }
  await db.supportTicket.update({ where: { id: ticket.id }, data: { channelState: "failed" } });
  return { result: "failed" as const, reason: delivered.outcome };
}

export async function noteSystemActivity(db: Writer, ticketId: string, now: Date) {
  const ticket = await db.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) {
    return { changed: false as const };
  }
  await db.ticketMessage.create({
    data: {
      id: randomUUID(),
      ticketId,
      guildId: ticket.guildId,
      authorUserId: "system",
      authorKind: "system",
      visibility: "member",
      body: "System notice.",
      contentLabel: "available",
      createdAt: now,
    },
  });
  return { changed: true as const, lastHumanAt: ticket.lastHumanAt };
}
