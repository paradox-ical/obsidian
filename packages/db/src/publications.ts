import { randomUUID } from "node:crypto";

import {
  previewContainsReviewControls,
  publicationPreview,
  reviewControls,
  validatePublicationDraft,
  type PublicationDraftDocument,
  type PublicationPreview,
} from "@collective/domain";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

import { actorCan, ensureGuild, moduleIsAvailable, writeAudit, type Writer } from "./platform.js";

type Tx = Prisma.TransactionClient;
type Root = PrismaClient;

export type ChannelAccess = "allowed" | "denied" | "setup_required";
export type ChannelProbe = (input: { guildId: string; channelId: string; purpose: "review" | "destination" }) => Promise<ChannelAccess>;

export const setupRequiredProbe: ChannelProbe = async () => "setup_required";

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function labelOf(document: PublicationDraftDocument): string {
  const source = document.title || document.content || "Untitled";
  return source.slice(0, 80);
}

async function gate(db: Writer, input: { guildId: string; actorRoleIds: readonly string[] }) {
  if (!(await moduleIsAvailable(db, input.guildId, "publications"))) {
    return "maintenance" as const;
  }
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "publications" })) !== "allowed") {
    return "denied" as const;
  }
  return "ok" as const;
}

async function lockDraft(tx: Tx, draftId: string) {
  await tx.$queryRaw`SELECT "id" FROM "publication_draft" WHERE "id" = ${draftId} FOR UPDATE`;
}

async function lockReview(tx: Tx, reviewId: string) {
  await tx.$queryRaw`SELECT "id" FROM "publication_review" WHERE "id" = ${reviewId} FOR UPDATE`;
}

async function lockMessage(tx: Tx, messageId: string) {
  await tx.$queryRaw`SELECT "id" FROM "publication_message" WHERE "id" = ${messageId} FOR UPDATE`;
}

function documentOf(value: unknown): PublicationDraftDocument | null {
  const validated = validatePublicationDraft(value);
  return validated.ok ? validated.document : null;
}

export async function savePublicationDraft(
  db: Root,
  input: { guildId: string; draftId?: string | null; document: unknown; actorUserId: string; actorRoleIds: readonly string[]; now: Date },
) {
  const gated = await gate(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const validated = validatePublicationDraft(input.document);
  if (!validated.ok) {
    return { result: "invalid" as const, errors: validated.errors };
  }
  await ensureGuild(db, { guildId: input.guildId });
  const document = validated.document;
  if (!input.draftId) {
    const draft = await db.publicationDraft.create({
      data: {
        id: randomUUID(),
        guildId: input.guildId,
        authorUserId: input.actorUserId,
        revision: 1,
        status: "draft",
        label: labelOf(document),
        document: asJson(document),
      },
    });
    await writeAudit(db, {
      guildId: input.guildId,
      actorUserId: input.actorUserId,
      action: "publication.draft",
      targetType: "publication_draft",
      targetId: draft.id,
      reason: "Save a publication draft",
    });
    return { result: "saved" as const, draftId: draft.id, revision: draft.revision, document };
  }
  return db.$transaction(async (tx) => {
    await lockDraft(tx, input.draftId ?? "");
    const current = await tx.publicationDraft.findUnique({ where: { id: input.draftId ?? "" } });
    if (!current || current.guildId !== input.guildId) {
      return { result: "missing" as const };
    }
    const revision = current.revision + 1;
    await tx.publicationReview.updateMany({ where: { draftId: current.id, status: { in: ["open", "approved"] } }, data: { status: "stale" } });
    await tx.publicationMessage.updateMany({ where: { draftId: current.id, status: "scheduled" }, data: { status: "superseded" } });
    await tx.publicationDraft.update({
      where: { id: current.id },
      data: { revision, status: "draft", label: labelOf(document), document: asJson(document), updatedAt: input.now },
    });
    await writeAudit(tx, {
      guildId: input.guildId,
      actorUserId: input.actorUserId,
      action: "publication.draft",
      targetType: "publication_draft",
      targetId: current.id,
      reason: "Edit a publication draft",
    });
    return { result: "saved" as const, draftId: current.id, revision, document };
  });
}

export async function readPublicationDraft(
  db: Writer,
  input: { guildId: string; draftId: string; actorRoleIds: readonly string[] },
) {
  const gated = await gate(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const draft = await db.publicationDraft.findUnique({ where: { id: input.draftId } });
  if (!draft || draft.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  const document = documentOf(draft.document);
  if (!document) {
    return { result: "invalid" as const };
  }
  return { result: "ready" as const, draftId: draft.id, revision: draft.revision, status: draft.status, authorUserId: draft.authorUserId, document };
}

export async function savePublicationTemplate(
  db: Writer,
  input: { guildId: string; name: string; document: unknown; actorUserId: string; actorRoleIds: readonly string[] },
) {
  const gated = await gate(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const validated = validatePublicationDraft(input.document);
  if (!validated.ok || !input.name.trim() || input.name.length > 80) {
    return { result: "invalid" as const, errors: validated.ok ? ["Template name must be 1 to 80 characters."] : validated.errors };
  }
  await ensureGuild(db, { guildId: input.guildId });
  const template = await db.publicationTemplate.create({
    data: {
      id: randomUUID(),
      guildId: input.guildId,
      name: input.name.trim(),
      document: asJson(validated.document),
      authorUserId: input.actorUserId,
    },
  });
  return { result: "saved" as const, templateId: template.id, name: template.name, document: validated.document };
}

export async function listPublicationTemplates(db: Writer, input: { guildId: string; actorRoleIds: readonly string[] }) {
  const gated = await gate(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const rows = await db.publicationTemplate.findMany({ where: { guildId: input.guildId }, orderBy: { createdAt: "asc" } });
  return { result: "ready" as const, templates: rows.flatMap((row) => {
    const document = documentOf(row.document);
    return document ? [{ templateId: row.id, name: row.name, document }] : [];
  }) };
}

export async function sendPublicationPreview(
  db: Root,
  input: { guildId: string; draftId: string; reviewChannelId: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date; probe?: ChannelProbe },
) {
  const gated = await gate(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  if (!input.reviewChannelId.trim()) {
    return { result: "invalid" as const };
  }
  const draft = await db.publicationDraft.findUnique({ where: { id: input.draftId } });
  if (!draft || draft.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  const document = documentOf(draft.document);
  if (!document) {
    return { result: "invalid" as const };
  }
  const probe = input.probe ?? setupRequiredProbe;
  const access = await probe({ guildId: input.guildId, channelId: input.reviewChannelId, purpose: "review" });
  if (access === "denied") {
    return { result: "permission" as const };
  }
  const reviewId = randomUUID();
  const preview = publicationPreview(document);
  const controls = reviewControls(reviewId);
  if (previewContainsReviewControls(preview)) {
    return { result: "invalid" as const };
  }
  await db.publicationReview.create({
    data: {
      id: reviewId,
      guildId: input.guildId,
      draftId: draft.id,
      revision: draft.revision,
      channelId: input.reviewChannelId,
      status: "open",
      delivery: "setup_required",
      preview: asJson(preview),
      controls: asJson(controls),
    },
  });
  await db.publicationDraft.update({ where: { id: draft.id }, data: { status: "in_review", updatedAt: input.now } });
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "publication.preview",
    targetType: "publication_review",
    targetId: reviewId,
    reason: "Send a publication preview to review",
  });
  return { result: "preview" as const, reviewId, revision: draft.revision, delivery: "setup_required" as const, preview, controls };
}

export async function openPublicationEditor(
  db: Writer,
  input: { guildId: string; reviewId: string; actorUserId: string; actorRoleIds: readonly string[] },
) {
  const gated = await gate(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const review = await db.publicationReview.findUnique({ where: { id: input.reviewId } });
  if (!review || review.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  const draft = await db.publicationDraft.findUnique({ where: { id: review.draftId } });
  if (!draft) {
    return { result: "missing" as const };
  }
  if (review.status === "stale" || draft.revision !== review.revision) {
    return { result: "stale" as const };
  }
  const document = documentOf(draft.document);
  if (!document) {
    return { result: "invalid" as const };
  }
  return {
    result: "editor" as const,
    draftId: draft.id,
    revision: draft.revision,
    editorPath: `/publications?draft=${draft.id}`,
    document,
  };
}

export async function approvePublication(
  db: Root,
  input: {
    guildId: string;
    reviewId: string;
    destinationChannelId: string;
    mode: "now" | "schedule";
    scheduledFor: Date | null;
    actorUserId: string;
    actorRoleIds: readonly string[];
    now: Date;
    probe?: ChannelProbe;
  },
) {
  const gated = await gate(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  if (!input.destinationChannelId.trim()) {
    return { result: "destination_required" as const };
  }
  if (input.mode !== "now" && input.mode !== "schedule") {
    return { result: "invalid" as const };
  }
  if (input.mode === "schedule" && (!input.scheduledFor || input.scheduledFor.getTime() <= input.now.getTime())) {
    return { result: "invalid" as const };
  }
  const located = await db.publicationReview.findUnique({ where: { id: input.reviewId } });
  if (!located || located.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  const probe = input.probe ?? setupRequiredProbe;
  return db.$transaction(async (tx) => {
    await lockDraft(tx, located.draftId);
    await lockReview(tx, located.id);
    const review = await tx.publicationReview.findUnique({ where: { id: located.id } });
    const draft = await tx.publicationDraft.findUnique({ where: { id: located.draftId } });
    if (!review || !draft || review.guildId !== input.guildId) {
      return { result: "missing" as const };
    }
    if (draft.revision !== review.revision) {
      await tx.publicationReview.update({ where: { id: review.id }, data: { status: "stale" } });
      return { result: "stale" as const };
    }
    if (review.status !== "open") {
      return { result: review.status === "stale" ? "stale" as const : "already_decided" as const };
    }
    if (draft.committedRevision === review.revision) {
      await tx.publicationReview.update({ where: { id: review.id }, data: { status: "stale" } });
      return { result: "already_decided" as const };
    }
    const document = documentOf(draft.document);
    if (!document) {
      return { result: "invalid" as const };
    }
    if (document.secondApproval && draft.authorUserId === input.actorUserId) {
      return { result: "second_required" as const };
    }
    const access = await probe({ guildId: input.guildId, channelId: input.destinationChannelId, purpose: "destination" });
    if (access === "denied") {
      return { result: "permission" as const };
    }
    const preview = publicationPreview(document);
    if (previewContainsReviewControls(preview)) {
      return { result: "invalid" as const };
    }
    const messageId = randomUUID();
    const recorded = input.mode === "now";
    await tx.publicationMessage.updateMany({ where: { draftId: draft.id, status: "recorded" }, data: { status: "replaced" } });
    await tx.publicationMessage.create({
      data: {
        id: messageId,
        guildId: input.guildId,
        draftId: draft.id,
        reviewId: review.id,
        revision: review.revision,
        destinationChannelId: input.destinationChannelId,
        delivery: recorded ? "setup_required" : "pending",
        status: recorded ? "recorded" : "scheduled",
        mode: input.mode,
        snapshot: asJson(preview),
        authorUserId: draft.authorUserId,
        approverUserId: input.actorUserId,
        scheduledFor: input.mode === "schedule" ? input.scheduledFor : null,
        publishedAt: recorded ? input.now : null,
      },
    });
    if (recorded) {
      await tx.publicationHistory.create({
        data: {
          id: randomUUID(),
          guildId: input.guildId,
          messageId,
          draftId: draft.id,
          revision: review.revision,
          snapshot: asJson(preview),
          authorUserId: draft.authorUserId,
          approverUserId: input.actorUserId,
          recordedAt: input.now,
        },
      });
    } else if (input.scheduledFor) {
      await tx.job.create({
        data: {
          id: randomUUID(),
          guildId: input.guildId,
          jobType: "publication.deliver",
          payload: { messageId },
          idempotencyKey: `publication:${messageId}`,
          status: "pending",
          runAt: input.scheduledFor,
          maxAttempts: 5,
          updatedAt: input.now,
        },
      });
    }
    await tx.publicationReview.update({
      where: { id: review.id },
      data: { status: "approved", actorUserId: input.actorUserId, decidedAt: input.now },
    });
    await tx.publicationReview.updateMany({
      where: { draftId: draft.id, status: "open", NOT: { id: review.id } },
      data: { status: "stale" },
    });
    await tx.publicationDraft.update({
      where: { id: draft.id },
      data: { committedRevision: review.revision, status: recorded ? "published" : "scheduled", updatedAt: input.now },
    });
    await writeAudit(tx, {
      guildId: input.guildId,
      actorUserId: input.actorUserId,
      action: "publication.approve",
      targetType: "publication_message",
      targetId: messageId,
      reason: recorded ? "Publish the approved revision" : "Schedule the approved revision",
    });
    return {
      result: recorded ? "recorded" as const : "scheduled" as const,
      messageId,
      revision: review.revision,
      delivery: recorded ? "setup_required" as const : "pending" as const,
      snapshot: preview,
    };
  });
}

export async function requestPublicationChanges(
  db: Root,
  input: { guildId: string; reviewId: string; feedback: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date },
) {
  const gated = await gate(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  if (!input.feedback.trim()) {
    return { result: "invalid" as const };
  }
  const located = await db.publicationReview.findUnique({ where: { id: input.reviewId } });
  if (!located || located.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  return db.$transaction(async (tx) => {
    await lockDraft(tx, located.draftId);
    await lockReview(tx, located.id);
    const review = await tx.publicationReview.findUnique({ where: { id: located.id } });
    const draft = await tx.publicationDraft.findUnique({ where: { id: located.draftId } });
    if (!review || !draft) {
      return { result: "missing" as const };
    }
    if (draft.revision !== review.revision) {
      await tx.publicationReview.update({ where: { id: review.id }, data: { status: "stale" } });
      return { result: "stale" as const };
    }
    if (review.status !== "open") {
      return { result: review.status === "stale" ? "stale" as const : "already_decided" as const };
    }
    await tx.publicationReview.update({
      where: { id: review.id },
      data: { status: "changes_requested", feedback: input.feedback.trim(), actorUserId: input.actorUserId, decidedAt: input.now },
    });
    await tx.publicationDraft.update({ where: { id: draft.id }, data: { status: "changes_requested", updatedAt: input.now } });
    await writeAudit(tx, {
      guildId: input.guildId,
      actorUserId: input.actorUserId,
      action: "publication.changes",
      targetType: "publication_review",
      targetId: review.id,
      reason: input.feedback.trim(),
    });
    return { result: "changes_requested" as const, feedback: input.feedback.trim() };
  });
}

export async function cancelPublicationReview(
  db: Root,
  input: { guildId: string; reviewId: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date },
) {
  const gated = await gate(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const located = await db.publicationReview.findUnique({ where: { id: input.reviewId } });
  if (!located || located.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  return db.$transaction(async (tx) => {
    await lockDraft(tx, located.draftId);
    await lockReview(tx, located.id);
    const review = await tx.publicationReview.findUnique({ where: { id: located.id } });
    const draft = await tx.publicationDraft.findUnique({ where: { id: located.draftId } });
    if (!review || !draft) {
      return { result: "missing" as const };
    }
    if (draft.revision !== review.revision) {
      await tx.publicationReview.update({ where: { id: review.id }, data: { status: "stale" } });
      return { result: "stale" as const };
    }
    if (review.status !== "open") {
      return { result: review.status === "stale" ? "stale" as const : "already_decided" as const };
    }
    await tx.publicationReview.update({
      where: { id: review.id },
      data: { status: "cancelled", actorUserId: input.actorUserId, decidedAt: input.now },
    });
    await tx.publicationMessage.updateMany({ where: { reviewId: review.id, status: "scheduled" }, data: { status: "superseded" } });
    await tx.publicationDraft.update({ where: { id: draft.id }, data: { status: "cancelled", updatedAt: input.now } });
    await writeAudit(tx, {
      guildId: input.guildId,
      actorUserId: input.actorUserId,
      action: "publication.cancel",
      targetType: "publication_review",
      targetId: review.id,
      reason: "Cancel a publication review",
    });
    return { result: "cancelled" as const };
  });
}

export async function deliverDuePublication(
  db: Root,
  input: { messageId: string; now: Date; probe?: ChannelProbe },
) {
  const located = await db.publicationMessage.findUnique({ where: { id: input.messageId } });
  if (!located) {
    return { result: "missing" as const };
  }
  const probe = input.probe ?? setupRequiredProbe;
  return db.$transaction(async (tx) => {
    await lockDraft(tx, located.draftId);
    await lockMessage(tx, located.id);
    const message = await tx.publicationMessage.findUnique({ where: { id: located.id } });
    const draft = await tx.publicationDraft.findUnique({ where: { id: located.draftId } });
    if (!message || !draft) {
      return { result: "missing" as const };
    }
    if (message.status !== "scheduled") {
      return { result: message.status === "superseded" ? "stale" as const : "already_recorded" as const };
    }
    if (draft.revision !== message.revision || draft.committedRevision !== message.revision) {
      await tx.publicationMessage.update({ where: { id: message.id }, data: { status: "superseded" } });
      return { result: "stale" as const };
    }
    const access = await probe({ guildId: message.guildId, channelId: message.destinationChannelId, purpose: "destination" });
    if (access === "denied") {
      await tx.publicationMessage.update({ where: { id: message.id }, data: { status: "permission", delivery: "permission" } });
      await writeAudit(tx, {
        guildId: message.guildId,
        actorUserId: "system",
        action: "publication.permission",
        targetType: "publication_message",
        targetId: message.id,
        reason: "Destination permission was lost before delivery",
      });
      return { result: "permission" as const };
    }
    await tx.publicationMessage.updateMany({
      where: { draftId: draft.id, status: "recorded", NOT: { id: message.id } },
      data: { status: "replaced" },
    });
    await tx.publicationMessage.update({
      where: { id: message.id },
      data: { status: "recorded", delivery: "setup_required", publishedAt: input.now },
    });
    await tx.publicationHistory.create({
      data: {
        id: randomUUID(),
        guildId: message.guildId,
        messageId: message.id,
        draftId: draft.id,
        revision: message.revision,
        snapshot: message.snapshot as Prisma.InputJsonValue,
        authorUserId: message.authorUserId,
        approverUserId: message.approverUserId,
        recordedAt: input.now,
      },
    });
    await tx.publicationDraft.update({ where: { id: draft.id }, data: { status: "published", updatedAt: input.now } });
    return { result: "setup_required" as const, messageId: message.id, revision: message.revision };
  });
}

export async function readPublicationHistory(
  db: Writer,
  input: { guildId: string; draftId: string; actorRoleIds: readonly string[] },
) {
  const gated = await gate(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const rows = await db.publicationHistory.findMany({ where: { guildId: input.guildId, draftId: input.draftId }, orderBy: { recordedAt: "asc" } });
  return { result: "ready" as const, history: rows.map((row) => ({
    messageId: row.messageId,
    revision: row.revision,
    snapshot: row.snapshot,
    authorUserId: row.authorUserId,
    approverUserId: row.approverUserId,
    recordedAt: row.recordedAt.toISOString(),
  })) };
}

export async function readPublicationBoard(db: Writer, input: { guildId: string; actorRoleIds: readonly string[] }) {
  const gated = await gate(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const [drafts, reviews, messages] = await Promise.all([
    db.publicationDraft.findMany({ where: { guildId: input.guildId }, orderBy: { updatedAt: "desc" } }),
    db.publicationReview.findMany({ where: { guildId: input.guildId }, orderBy: { createdAt: "desc" } }),
    db.publicationMessage.findMany({ where: { guildId: input.guildId }, orderBy: { createdAt: "desc" } }),
  ]);
  return {
    result: "ready" as const,
    drafts: drafts.map((draft) => ({
      draftId: draft.id,
      revision: draft.revision,
      status: draft.status,
      label: draft.label,
      authorUserId: draft.authorUserId,
      document: draft.document,
    })),
    reviews: reviews.map((review) => ({
      reviewId: review.id,
      draftId: review.draftId,
      revision: review.revision,
      status: review.status,
      channelId: review.channelId,
      delivery: review.delivery,
      feedback: review.feedback,
    })),
    scheduled: messages.filter((message) => message.status === "scheduled").map(presentMessage),
    published: messages.filter((message) => message.status === "recorded" || message.status === "replaced").map(presentMessage),
  };
}

function presentMessage(message: {
  id: string;
  draftId: string;
  revision: number;
  destinationChannelId: string;
  discordMessageId: string | null;
  delivery: string;
  status: string;
  mode: string;
  snapshot: Prisma.JsonValue;
  authorUserId: string;
  approverUserId: string;
  scheduledFor: Date | null;
  publishedAt: Date | null;
}) {
  return {
    messageId: message.id,
    draftId: message.draftId,
    revision: message.revision,
    destinationChannelId: message.destinationChannelId,
    discordMessageId: message.discordMessageId,
    delivery: message.delivery,
    status: message.status,
    mode: message.mode,
    snapshot: message.snapshot,
    authorUserId: message.authorUserId,
    approverUserId: message.approverUserId,
    scheduledFor: message.scheduledFor?.toISOString() ?? null,
    publishedAt: message.publishedAt?.toISOString() ?? null,
  };
}

export type { PublicationPreview };
