import { describe, expect, it } from "vitest";

import {
  emptyPublicationDraft,
  previewContainsReviewControls,
  publicationPreview,
  reviewControls,
  validatePublicationDraft,
} from "./publications.js";

const complete = {
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

describe("publication drafts", () => {
  it("keeps every field and leaves review controls off the preview", () => {
    const validated = validatePublicationDraft(complete);
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      return;
    }
    expect(validated.document).toMatchObject({ ...complete, color: "#c4b59a" });
    const preview = publicationPreview(validated.document);
    expect(preview.content).toBe("Doors open at dusk.");
    expect(preview.embed).toMatchObject({ title: "Night market", color: 0xc4b59a, timestamp: "2026-10-11T12:00:00.000Z" });
    expect(preview.components).toEqual([{ type: 1, components: [{ type: 2, style: 5, label: "Map", url: "https://example.com/map" }] }]);
    expect(previewContainsReviewControls(preview)).toBe(false);
    expect(JSON.stringify(reviewControls("review-1"))).toContain("publish:approve:review-1");
    expect(JSON.stringify(reviewControls("review-1"))).toContain("publish:edit:review-1");
    expect(JSON.stringify(reviewControls("review-1"))).toContain("publish:changes:review-1");
    expect(JSON.stringify(reviewControls("review-1"))).toContain("publish:cancel:review-1");
  });

  it("rejects an oversized title, an unauthorised everyone mention, and a non-http button", () => {
    expect(validatePublicationDraft({ ...complete, title: "x".repeat(257) }).ok).toBe(false);
    expect(validatePublicationDraft({ ...complete, content: "Hello @everyone" }).ok).toBe(false);
    const allowed = validatePublicationDraft({ ...complete, content: "Hello @everyone", allowEveryone: true });
    expect(allowed.ok).toBe(true);
    if (allowed.ok) {
      expect(publicationPreview(allowed.document).allowedMentions.parse).toEqual(["everyone"]);
    }
    expect(validatePublicationDraft({ ...complete, buttons: [{ label: "Bad", url: "javascript:alert(1)" }] }).ok).toBe(false);
    expect(validatePublicationDraft(emptyPublicationDraft()).ok).toBe(false);
  });
});
