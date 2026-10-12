/** Support tickets. Purchase and reward modules are not completed here. */

export const TICKET_PURPOSES = ["verification_help", "general", "moderation", "purchase_dispute"] as const;
export type TicketPurpose = (typeof TICKET_PURPOSES)[number];

export const TICKET_REFERENCE_KINDS = ["moderation_case", "purchase", "reward"] as const;
export type TicketReferenceKind = (typeof TICKET_REFERENCE_KINDS)[number];

export interface TicketFormField {
  id: string;
  label: string;
  required: boolean;
}

export interface TicketCategoryInput {
  id: string;
  label: string;
  purpose: TicketPurpose;
  privacy: "channel" | "thread";
  requiresVerified: boolean;
  grantsGeneralAccess: boolean;
  formFields: TicketFormField[];
}

export interface TicketSettingsInput {
  label: string;
  openCap: number;
  cooldownMinutes: number;
  inactivityReminderHours: number;
  inactivityCloseHours: number | null;
  retentionDays: number;
  parentChannelId: string | null;
  categories: TicketCategoryInput[];
}

export interface TicketPolicySnapshot {
  version: number;
  categoryId: string;
  purpose: TicketPurpose;
  privacy: "channel" | "thread";
  requiresVerified: boolean;
  grantsGeneralAccess: false;
  inactivityReminderHours: number;
  inactivityCloseHours: number | null;
  retentionDays: number;
  formFields: TicketFormField[];
}

export const PENDING_TICKET_INTEGRATIONS = [
  { id: "purchase_dispute", module: "shops", status: "module_not_built" },
  { id: "reward_reference", module: "economy", status: "module_not_built" },
] as const;

export function exampleTicketSettings(): TicketSettingsInput {
  return {
    label: "example",
    openCap: 2,
    cooldownMinutes: 10,
    inactivityReminderHours: 24,
    inactivityCloseHours: 72,
    retentionDays: 14,
    parentChannelId: null,
    categories: [
      {
        id: "verification-help",
        label: "Verification help",
        purpose: "verification_help",
        privacy: "thread",
        requiresVerified: false,
        grantsGeneralAccess: false,
        formFields: [{ id: "need", label: "What do you need?", required: true }],
      },
      {
        id: "general",
        label: "General support",
        purpose: "general",
        privacy: "channel",
        requiresVerified: true,
        grantsGeneralAccess: false,
        formFields: [{ id: "topic", label: "Topic", required: true }],
      },
      {
        id: "moderation",
        label: "Moderation",
        purpose: "moderation",
        privacy: "thread",
        requiresVerified: false,
        grantsGeneralAccess: false,
        formFields: [{ id: "note", label: "Note", required: true }],
      },
      {
        id: "purchase",
        label: "Purchase question",
        purpose: "purchase_dispute",
        privacy: "thread",
        requiresVerified: true,
        grantsGeneralAccess: false,
        formFields: [{ id: "reference", label: "What happened?", required: true }],
      },
    ],
  };
}

export function prepareTicketSettings(input: TicketSettingsInput): TicketSettingsInput {
  return {
    label: input.label.trim() || "example",
    openCap: Math.max(1, input.openCap),
    cooldownMinutes: Math.max(0, input.cooldownMinutes),
    inactivityReminderHours: Math.max(1, input.inactivityReminderHours),
    inactivityCloseHours: input.inactivityCloseHours === null ? null : Math.max(1, input.inactivityCloseHours),
    retentionDays: Math.max(1, input.retentionDays),
    parentChannelId: input.parentChannelId,
    categories: input.categories.map((category) => ({
      ...category,
      requiresVerified: category.purpose === "verification_help" ? false : category.requiresVerified,
      grantsGeneralAccess: false,
    })),
  };
}

export function previewTicketSettings(input: TicketSettingsInput): {
  persisted: false;
  settings: TicketSettingsInput;
  pendingIntegrations: typeof PENDING_TICKET_INTEGRATIONS;
} {
  return {
    persisted: false,
    settings: prepareTicketSettings(input),
    pendingIntegrations: PENDING_TICKET_INTEGRATIONS,
  };
}

export type OpeningSource = "member" | "report" | "appeal";

export function openingDecision(input: {
  category: TicketCategoryInput | null;
  verified: boolean;
  openCount: number;
  lastClosedAt: Date | null;
  now: Date;
  settings: TicketSettingsInput;
  maintenance: boolean;
  source: OpeningSource;
}): "allowed" | "verification_required" | "capped" | "cooldown" | "maintenance" | "unknown_category" {
  if (!input.category) {
    return "unknown_category";
  }
  const intake = input.source === "report" || input.source === "appeal";
  const verificationHelp = input.category.purpose === "verification_help";
  if (!intake && !verificationHelp && input.maintenance) {
    return "maintenance";
  }
  if (!intake && input.category.requiresVerified && !input.verified) {
    return "verification_required";
  }
  if (!intake && input.openCount >= input.settings.openCap) {
    return "capped";
  }
  if (!intake && input.lastClosedAt) {
    const until = input.lastClosedAt.getTime() + input.settings.cooldownMinutes * 60 * 1000;
    if (input.now.getTime() < until) {
      return "cooldown";
    }
  }
  return "allowed";
}

export function formGaps(category: TicketCategoryInput, answers: Readonly<Record<string, string>>): string[] {
  return category.formFields.filter((field) => field.required && !(answers[field.id] ?? "").trim()).map((field) => field.id);
}

export function policySnapshot(version: number, settings: TicketSettingsInput, category: TicketCategoryInput): TicketPolicySnapshot {
  return {
    version,
    categoryId: category.id,
    purpose: category.purpose,
    privacy: category.privacy,
    requiresVerified: category.requiresVerified,
    grantsGeneralAccess: false,
    inactivityReminderHours: settings.inactivityReminderHours,
    inactivityCloseHours: settings.inactivityCloseHours,
    retentionDays: settings.retentionDays,
    formFields: category.formFields,
  };
}

export function referenceIntegration(kind: TicketReferenceKind): "linked" | "module_not_built" {
  return kind === "moderation_case" ? "linked" : "module_not_built";
}

export interface TranscriptMessage {
  id: string;
  authorUserId: string;
  authorKind: string;
  visibility: string;
  body: string | null;
  contentLabel: string;
}

export function memberTranscript(messages: readonly TranscriptMessage[]): TranscriptMessage[] {
  return messages.filter((message) => message.visibility === "member");
}

export function memberSummary(input: {
  summary: string | null;
  contentLabel: string;
  messages: readonly TranscriptMessage[];
}): { summary: string | null; contentLabel: string; messages: TranscriptMessage[] } {
  return {
    summary: input.contentLabel === "available" ? input.summary : null,
    contentLabel: input.contentLabel,
    messages: memberTranscript(input.messages).map((message) => ({
      ...message,
      body: message.contentLabel === "available" ? message.body : null,
    })),
  };
}

export function closeDecision(status: string): "close" | "already_closed" {
  return status === "closed" ? "already_closed" : "close";
}

export function reopenDecision(input: {
  status: string;
  reopenUntil: Date | null;
  contentLabel: string;
  now: Date;
}): "reopen" | "already_open" | "retention_elapsed" {
  if (input.status === "open") {
    return "already_open";
  }
  if (input.contentLabel === "expired" || (input.reopenUntil !== null && input.now.getTime() > input.reopenUntil.getTime())) {
    return "retention_elapsed";
  }
  return "reopen";
}

export function claimDecision(input: { assigneeUserId: string | null; actorUserId: string; staff: boolean }): "claim" | "already_claimed" | "occupied" | "denied" {
  if (!input.staff) {
    return "denied";
  }
  if (input.assigneeUserId === input.actorUserId) {
    return "already_claimed";
  }
  if (input.assigneeUserId) {
    return "occupied";
  }
  return "claim";
}

export function transferDecision(input: { staff: boolean; targetStaff: boolean; assigneeUserId: string | null; targetUserId: string }): "transfer" | "already_assigned" | "denied" {
  if (!input.staff || !input.targetStaff) {
    return "denied";
  }
  if (input.assigneeUserId === input.targetUserId) {
    return "already_assigned";
  }
  return "transfer";
}

export function inactivityDue(input: {
  status: string;
  lastHumanAt: Date;
  remindedAt: Date | null;
  now: Date;
  reminderHours: number;
  closeHours: number | null;
}): "wait" | "remind" | "close" {
  if (input.status !== "open") {
    return "wait";
  }
  const idleMs = input.now.getTime() - input.lastHumanAt.getTime();
  if (input.closeHours !== null && idleMs >= input.closeHours * 60 * 60 * 1000) {
    return "close";
  }
  if (input.remindedAt === null && idleMs >= input.reminderHours * 60 * 60 * 1000) {
    return "remind";
  }
  return "wait";
}

export function panelRequests(categories: readonly TicketCategoryInput[]): Array<{ customId: string; label: string }> {
  return categories.map((category) => ({ customId: `ticket:open:${category.id}`, label: category.label }));
}
