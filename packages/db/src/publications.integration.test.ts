import { randomUUID } from "node:crypto";

import { emptyPublicationDraft, validatePublicationDraft } from "@collective/domain";
import { afterAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "./client.js";
import { grantCapability } from "./platform.js";
import {
  approvePublication,
  cancelPublicationReview,
  deliverDuePublication,
  listPublicationTemplates,
  openPublicationEditor,
  readPublicationDraft,
  readPublicationHistory,
  requestPublicationChanges,
  savePublicationDraft,
  savePublicationTemplate,
  sendPublicationPreview,
  type ChannelProbe,
} from "./publications.js";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.");
}

const db = createPrismaClient(databaseUrl);
const guildId = `guild-${randomUUID()}`;
const now = new Date("2026-10-11T11:00:00.000Z");
const editors = ["editor-role"];
const denyLost: ChannelProbe = async ({ channelId }) => (channelId === "lost" ? "denied" : "setup_required");

const raw = {
  ...emptyPublicationDraft(),
  content: "Doors open at dusk.",
  title: "Night market",
  description: "Bring a lamp.",
  url: "https://example.com/market",
  color: "#C4B59A",
  authorName: "Herald",
  authorUrl: "https://example.com/herald",
  authorIconUrl: "https://example.com/herald.png",
  footerText: "THE COLLECTIVE",
  footerIconUrl: "https://example.com/mark.png",
  timestamp: "2026-10-11T12:00:00.000Z",
  imageUrl: "https://example.com/image.png",
  thumbnailUrl: "https://example.com/thumb.png",
  fields: [{ name: "Where", value: "The yard", inline: true }],
  buttons: [{ label: "Map", url: "https://example.com/map" }],
  mentionUsers: ["111"],
  mentionRoles: ["222"],
  allowEveryone: false,
  category: "events",
  secondApproval: false,
};

afterAll(async () => {
  await db.publicationHistory.deleteMany({ where: { guildId } });
  await db.publicationMessage.deleteMany({ where: { guildId } });
  await db.publicationReview.deleteMany({ where: { guildId } });
  await db.publicationDraft.deleteMany({ where: { guildId } });
  await db.publicationTemplate.deleteMany({ where: { guildId } });
  await db.job.deleteMany({ where: { guildId, jobType: "publication.deliver" } });
  await db.auditRecord.deleteMany({ where: { guildId } });
  await db.capabilityGrant.deleteMany({ where: { guildId } });
  await db.guild.deleteMany({ where: { guildId } });
  await db.$disconnect();
});

describe("publication editor", () => {
  it("saves every field, binds approval to one revision, and keeps review controls unpublished", async () => {
    const validated = validatePublicationDraft(raw);
    if (!validated.ok) {
      throw new Error("Fixture draft was invalid.");
    }
    const document = validated.document;
    await grantCapability(db, { guildId, roleId: "editor-role", capability: "publications", actorUserId: "owner", reason: "Open the editor" });

    expect(await savePublicationDraft(db, { guildId, document, actorUserId: "member", actorRoleIds: [], now })).toMatchObject({ result: "denied" });
    expect(await savePublicationDraft(db, { guildId, document: { ...document, title: "x".repeat(257) }, actorUserId: "author", actorRoleIds: editors, now })).toMatchObject({ result: "invalid" });

    const saved = await savePublicationDraft(db, { guildId, document, actorUserId: "author", actorRoleIds: editors, now });
    expect(saved).toMatchObject({ result: "saved", revision: 1, document });
    if (saved.result !== "saved") {
      throw new Error("Draft was not saved.");
    }
    expect(await readPublicationDraft(db, { guildId, draftId: saved.draftId, actorRoleIds: editors })).toMatchObject({ result: "ready", document });
    expect(await savePublicationTemplate(db, { guildId, name: "Night market", document, actorUserId: "author", actorRoleIds: editors })).toMatchObject({ result: "saved", document });
    expect(await listPublicationTemplates(db, { guildId, actorRoleIds: editors })).toMatchObject({ templates: [expect.objectContaining({ name: "Night market", document })] });

    expect(await sendPublicationPreview(db, {
      guildId, draftId: saved.draftId, reviewChannelId: "lost", actorUserId: "author", actorRoleIds: editors, now, probe: denyLost,
    })).toMatchObject({ result: "permission" });
    const preview = await sendPublicationPreview(db, {
      guildId, draftId: saved.draftId, reviewChannelId: "review-channel", actorUserId: "author", actorRoleIds: editors, now,
    });
    expect(preview).toMatchObject({ result: "preview", delivery: "setup_required", revision: 1 });
    if (preview.result !== "preview") {
      throw new Error("Preview was not stored.");
    }
    expect(JSON.stringify(preview.preview)).not.toContain("publish:");
    expect(JSON.stringify(preview.controls)).toContain(`publish:approve:${preview.reviewId}`);
    expect(await openPublicationEditor(db, { guildId, reviewId: preview.reviewId, actorUserId: "author", actorRoleIds: editors })).toMatchObject({
      result: "editor",
      document,
      editorPath: `/publications?draft=${saved.draftId}`,
    });
    expect(await approvePublication(db, {
      guildId, reviewId: preview.reviewId, destinationChannelId: "yard", mode: "now", scheduledFor: null, actorUserId: "member", actorRoleIds: [], now,
    })).toMatchObject({ result: "denied" });
    expect(await approvePublication(db, {
      guildId, reviewId: preview.reviewId, destinationChannelId: "lost", mode: "now", scheduledFor: null, actorUserId: "author", actorRoleIds: editors, now, probe: denyLost,
    })).toMatchObject({ result: "permission" });
    const published = await approvePublication(db, {
      guildId, reviewId: preview.reviewId, destinationChannelId: "yard", mode: "now", scheduledFor: null, actorUserId: "author", actorRoleIds: editors, now,
    });
    expect(published).toMatchObject({ result: "recorded", delivery: "setup_required", revision: 1 });
    if (published.result !== "recorded") {
      throw new Error("Approval was not recorded.");
    }
    expect(JSON.stringify(published.snapshot)).not.toContain("publish:");
    expect(published.snapshot).toMatchObject({ content: document.content, embed: expect.objectContaining({ title: document.title }) });
    expect(await db.publicationMessage.findUnique({ where: { id: published.messageId } })).toMatchObject({ discordMessageId: null, delivery: "setup_required" });
    expect(await readPublicationHistory(db, { guildId, draftId: saved.draftId, actorRoleIds: editors })).toMatchObject({ history: [expect.anything()] });

    const revised = { ...document, title: "Night market revised" };
    const edited = await savePublicationDraft(db, { guildId, draftId: saved.draftId, document: revised, actorUserId: "author", actorRoleIds: editors, now });
    expect(edited).toMatchObject({ result: "saved", revision: 2, document: revised });
    expect(await readPublicationDraft(db, { guildId, draftId: saved.draftId, actorRoleIds: editors })).toMatchObject({ document: revised });
    expect(await approvePublication(db, {
      guildId, reviewId: preview.reviewId, destinationChannelId: "yard", mode: "now", scheduledFor: null, actorUserId: "author", actorRoleIds: editors, now,
    })).toMatchObject({ result: "stale" });
    expect(await openPublicationEditor(db, { guildId, reviewId: preview.reviewId, actorUserId: "author", actorRoleIds: editors })).toMatchObject({ result: "stale" });

    const first = await sendPublicationPreview(db, { guildId, draftId: saved.draftId, reviewChannelId: "review-channel", actorUserId: "author", actorRoleIds: editors, now });
    const second = await sendPublicationPreview(db, { guildId, draftId: saved.draftId, reviewChannelId: "review-channel", actorUserId: "reviewer", actorRoleIds: editors, now });
    if (first.result !== "preview" || second.result !== "preview") {
      throw new Error("Race previews were not stored.");
    }
    const raced = await Promise.all([
      approvePublication(db, { guildId, reviewId: first.reviewId, destinationChannelId: "yard", mode: "now", scheduledFor: null, actorUserId: "author", actorRoleIds: editors, now }),
      approvePublication(db, { guildId, reviewId: second.reviewId, destinationChannelId: "hall", mode: "now", scheduledFor: null, actorUserId: "reviewer", actorRoleIds: editors, now }),
    ]);
    expect(raced.map((row) => row.result).sort()).toEqual(["recorded", "stale"]);
    const history = await readPublicationHistory(db, { guildId, draftId: saved.draftId, actorRoleIds: editors });
    expect(history).toMatchObject({ result: "ready" });
    if (history.result !== "ready") {
      throw new Error("History was not readable.");
    }
    expect(history.history).toHaveLength(2);
    expect(JSON.stringify(history.history[1]?.snapshot)).not.toContain("publish:");
    expect(await db.publicationMessage.count({ where: { draftId: saved.draftId, status: "recorded" } })).toBe(1);

    const later = new Date(now.getTime() + 60 * 60 * 1000);
    const scheduledDraft = await savePublicationDraft(db, { guildId, document, actorUserId: "author", actorRoleIds: editors, now });
    if (scheduledDraft.result !== "saved") {
      throw new Error("Scheduled draft was not saved.");
    }
    const scheduledPreview = await sendPublicationPreview(db, { guildId, draftId: scheduledDraft.draftId, reviewChannelId: "review-channel", actorUserId: "author", actorRoleIds: editors, now });
    if (scheduledPreview.result !== "preview") {
      throw new Error("Scheduled preview was not stored.");
    }
    const scheduled = await approvePublication(db, {
      guildId, reviewId: scheduledPreview.reviewId, destinationChannelId: "yard", mode: "schedule", scheduledFor: later, actorUserId: "author", actorRoleIds: editors, now,
    });
    expect(scheduled).toMatchObject({ result: "scheduled", delivery: "pending" });
    if (scheduled.result !== "scheduled") {
      throw new Error("Schedule was not stored.");
    }
    expect(await db.job.findFirst({ where: { guildId, jobType: "publication.deliver", idempotencyKey: `publication:${scheduled.messageId}` } })).toMatchObject({ runAt: later });
    await savePublicationDraft(db, { guildId, draftId: scheduledDraft.draftId, document: revised, actorUserId: "author", actorRoleIds: editors, now });
    expect(await deliverDuePublication(db, { messageId: scheduled.messageId, now: later })).toMatchObject({ result: "stale" });

    const permissionDraft = await savePublicationDraft(db, { guildId, document, actorUserId: "author", actorRoleIds: editors, now });
    if (permissionDraft.result !== "saved") {
      throw new Error("Permission draft was not saved.");
    }
    const permissionPreview = await sendPublicationPreview(db, { guildId, draftId: permissionDraft.draftId, reviewChannelId: "review-channel", actorUserId: "author", actorRoleIds: editors, now });
    if (permissionPreview.result !== "preview") {
      throw new Error("Permission preview was not stored.");
    }
    const permissionApproval = await approvePublication(db, {
      guildId, reviewId: permissionPreview.reviewId, destinationChannelId: "lost-later", mode: "schedule", scheduledFor: later, actorUserId: "author", actorRoleIds: editors, now,
    });
    if (permissionApproval.result !== "scheduled") {
      throw new Error("Permission schedule was not stored.");
    }
    const lostProbe: ChannelProbe = async () => "denied";
    expect(await deliverDuePublication(db, { messageId: permissionApproval.messageId, now: later, probe: lostProbe })).toMatchObject({ result: "permission" });
    expect(await readPublicationHistory(db, { guildId, draftId: permissionDraft.draftId, actorRoleIds: editors })).toMatchObject({ history: [] });

    const changeDraft = await savePublicationDraft(db, { guildId, document, actorUserId: "author", actorRoleIds: editors, now });
    if (changeDraft.result !== "saved") {
      throw new Error("Change draft was not saved.");
    }
    const changePreview = await sendPublicationPreview(db, { guildId, draftId: changeDraft.draftId, reviewChannelId: "review-channel", actorUserId: "author", actorRoleIds: editors, now });
    if (changePreview.result !== "preview") {
      throw new Error("Change preview was not stored.");
    }
    expect(await requestPublicationChanges(db, {
      guildId, reviewId: changePreview.reviewId, feedback: "Tighten the title", actorUserId: "reviewer", actorRoleIds: editors, now,
    })).toMatchObject({ result: "changes_requested", feedback: "Tighten the title" });
    expect(await db.publicationMessage.count({ where: { draftId: changeDraft.draftId } })).toBe(0);

    const cancelDraft = await savePublicationDraft(db, { guildId, document, actorUserId: "author", actorRoleIds: editors, now });
    if (cancelDraft.result !== "saved") {
      throw new Error("Cancel draft was not saved.");
    }
    const cancelPreview = await sendPublicationPreview(db, { guildId, draftId: cancelDraft.draftId, reviewChannelId: "review-channel", actorUserId: "author", actorRoleIds: editors, now });
    if (cancelPreview.result !== "preview") {
      throw new Error("Cancel preview was not stored.");
    }
    expect(await cancelPublicationReview(db, { guildId, reviewId: cancelPreview.reviewId, actorUserId: "author", actorRoleIds: editors, now })).toMatchObject({ result: "cancelled" });
    expect(await db.publicationMessage.count({ where: { draftId: cancelDraft.draftId } })).toBe(0);

    const paired = { ...document, secondApproval: true, category: "policy" };
    const pairedDraft = await savePublicationDraft(db, { guildId, document: paired, actorUserId: "author", actorRoleIds: editors, now });
    if (pairedDraft.result !== "saved") {
      throw new Error("Second-approval draft was not saved.");
    }
    const pairedPreview = await sendPublicationPreview(db, { guildId, draftId: pairedDraft.draftId, reviewChannelId: "review-channel", actorUserId: "author", actorRoleIds: editors, now });
    if (pairedPreview.result !== "preview") {
      throw new Error("Second-approval preview was not stored.");
    }
    expect(await approvePublication(db, {
      guildId, reviewId: pairedPreview.reviewId, destinationChannelId: "yard", mode: "now", scheduledFor: null, actorUserId: "author", actorRoleIds: editors, now,
    })).toMatchObject({ result: "second_required" });
    expect(await approvePublication(db, {
      guildId, reviewId: pairedPreview.reviewId, destinationChannelId: "yard", mode: "now", scheduledFor: null, actorUserId: "reviewer", actorRoleIds: editors, now,
    })).toMatchObject({ result: "recorded", delivery: "setup_required" });
  });
});
