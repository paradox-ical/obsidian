/**
 * Discord message and embed limits from
 * https://discord.com/developers/docs/resources/message
 * and the embed limits table. Button labels follow the component reference.
 */

export const PUBLICATION_CONTENT_LIMIT = 2_000;
export const PUBLICATION_TITLE_LIMIT = 256;
export const PUBLICATION_DESCRIPTION_LIMIT = 4_096;
export const PUBLICATION_FIELD_LIMIT = 25;
export const PUBLICATION_FIELD_NAME_LIMIT = 256;
export const PUBLICATION_FIELD_VALUE_LIMIT = 1_024;
export const PUBLICATION_FOOTER_LIMIT = 2_048;
export const PUBLICATION_AUTHOR_LIMIT = 256;
export const PUBLICATION_EMBED_TOTAL_LIMIT = 6_000;
export const PUBLICATION_BUTTON_LIMIT = 5;
export const PUBLICATION_BUTTON_LABEL_LIMIT = 80;
export const PUBLICATION_URL_LIMIT = 2_048;
export const PUBLICATION_MENTION_LIMIT = 25;

export interface PublicationField {
  name: string;
  value: string;
  inline: boolean;
}

export interface PublicationButton {
  label: string;
  url: string;
}

export interface PublicationDraftDocument {
  content: string;
  title: string;
  description: string;
  url: string;
  color: string;
  authorName: string;
  authorUrl: string;
  authorIconUrl: string;
  footerText: string;
  footerIconUrl: string;
  timestamp: string;
  imageUrl: string;
  thumbnailUrl: string;
  fields: PublicationField[];
  buttons: PublicationButton[];
  mentionUsers: string[];
  mentionRoles: string[];
  allowEveryone: boolean;
  category: string;
  secondApproval: boolean;
}

export interface PublicationPreview {
  content: string;
  embed: Record<string, unknown> | null;
  components: Array<Record<string, unknown>>;
  allowedMentions: { parse: string[]; users: string[]; roles: string[] };
}

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const URL_PATTERN = /^https?:\/\/\S+$/;
const SNOWFLAKE_PATTERN = /^\d{1,32}$/;

export function emptyPublicationDraft(): PublicationDraftDocument {
  return {
    content: "",
    title: "",
    description: "",
    url: "",
    color: "",
    authorName: "",
    authorUrl: "",
    authorIconUrl: "",
    footerText: "",
    footerIconUrl: "",
    timestamp: "",
    imageUrl: "",
    thumbnailUrl: "",
    fields: [],
    buttons: [],
    mentionUsers: [],
    mentionRoles: [],
    allowEveryone: false,
    category: "general",
    secondApproval: false,
  };
}

export function examplePublicationTemplate(): PublicationDraftDocument {
  return {
    ...emptyPublicationDraft(),
    title: "Announcement",
    description: "Write the announcement here.",
    color: "#c4b59a",
    footerText: "THE COLLECTIVE",
    category: "announcement",
  };
}

export function validatePublicationDraft(value: unknown): { ok: true; document: PublicationDraftDocument } | { ok: false; errors: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: ["Draft must be an object."] };
  }
  const source = value as Record<string, unknown>;
  const errors: string[] = [];
  const document: PublicationDraftDocument = {
    ...emptyPublicationDraft(),
    content: text(source["content"], PUBLICATION_CONTENT_LIMIT, "Content", errors),
    title: text(source["title"], PUBLICATION_TITLE_LIMIT, "Title", errors),
    description: text(source["description"], PUBLICATION_DESCRIPTION_LIMIT, "Description", errors),
    url: optionalUrl(source["url"], "Embed URL", errors),
    color: color(source["color"], errors),
    authorName: text(source["authorName"], PUBLICATION_AUTHOR_LIMIT, "Author name", errors),
    authorUrl: optionalUrl(source["authorUrl"], "Author URL", errors),
    authorIconUrl: optionalUrl(source["authorIconUrl"], "Author icon URL", errors),
    footerText: text(source["footerText"], PUBLICATION_FOOTER_LIMIT, "Footer", errors),
    footerIconUrl: optionalUrl(source["footerIconUrl"], "Footer icon URL", errors),
    timestamp: timestamp(source["timestamp"], errors),
    imageUrl: optionalUrl(source["imageUrl"], "Image URL", errors),
    thumbnailUrl: optionalUrl(source["thumbnailUrl"], "Thumbnail URL", errors),
    fields: fields(source["fields"], errors),
    buttons: buttons(source["buttons"], errors),
    mentionUsers: mentions(source["mentionUsers"], "User mention", errors),
    mentionRoles: mentions(source["mentionRoles"], "Role mention", errors),
    allowEveryone: source["allowEveryone"] === true,
    category: category(source["category"], errors),
    secondApproval: source["secondApproval"] === true,
  };
  if (!document.allowEveryone && /@everyone|@here/.test(document.content)) {
    errors.push("everyone and here mentions require the authorised mention flag.");
  }
  const embedLength = document.title.length + document.description.length + document.authorName.length + document.footerText.length
    + document.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);
  if (embedLength > PUBLICATION_EMBED_TOTAL_LIMIT) {
    errors.push("Embed text exceeds 6,000 characters.");
  }
  if (!document.content && !document.title && !document.description && !document.imageUrl && document.fields.length === 0) {
    errors.push("A draft needs content, a title, a description, an image, or a field.");
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, document };
}

export function publicationPreview(document: PublicationDraftDocument): PublicationPreview {
  const embed: Record<string, unknown> = {};
  if (document.title) embed["title"] = document.title;
  if (document.description) embed["description"] = document.description;
  if (document.url) embed["url"] = document.url;
  if (document.color) embed["color"] = Number.parseInt(document.color.slice(1), 16);
  if (document.authorName || document.authorUrl || document.authorIconUrl) {
    embed["author"] = {
      ...(document.authorName ? { name: document.authorName } : {}),
      ...(document.authorUrl ? { url: document.authorUrl } : {}),
      ...(document.authorIconUrl ? { icon_url: document.authorIconUrl } : {}),
    };
  }
  if (document.footerText || document.footerIconUrl) {
    embed["footer"] = {
      ...(document.footerText ? { text: document.footerText } : {}),
      ...(document.footerIconUrl ? { icon_url: document.footerIconUrl } : {}),
    };
  }
  if (document.timestamp) embed["timestamp"] = new Date(document.timestamp).toISOString();
  if (document.imageUrl) embed["image"] = { url: document.imageUrl };
  if (document.thumbnailUrl) embed["thumbnail"] = { url: document.thumbnailUrl };
  if (document.fields.length > 0) {
    embed["fields"] = document.fields.map((field) => ({ name: field.name, value: field.value, inline: field.inline }));
  }
  const hasEmbed = Object.keys(embed).length > 0;
  return {
    content: document.content,
    embed: hasEmbed ? embed : null,
    components: document.buttons.length === 0 ? [] : [{
      type: 1,
      components: document.buttons.map((button) => ({ type: 2, style: 5, label: button.label, url: button.url })),
    }],
    allowedMentions: {
      parse: document.allowEveryone ? ["everyone"] : [],
      users: document.mentionUsers,
      roles: document.mentionRoles,
    },
  };
}

export function reviewControls(reviewId: string): Array<Record<string, unknown>> {
  return [{
    type: 1,
    components: [
      { type: 2, style: 3, label: "Approve", custom_id: `publish:approve:${reviewId}` },
      { type: 2, style: 1, label: "Edit", custom_id: `publish:edit:${reviewId}` },
      { type: 2, style: 2, label: "Request changes", custom_id: `publish:changes:${reviewId}` },
      { type: 2, style: 4, label: "Cancel", custom_id: `publish:cancel:${reviewId}` },
    ],
  }];
}

export function previewContainsReviewControls(preview: PublicationPreview): boolean {
  return JSON.stringify(preview).includes("publish:");
}

function text(value: unknown, limit: number, label: string, errors: string[]): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  if (typeof value !== "string") {
    errors.push(`${label} must be text.`);
    return "";
  }
  if (value.length > limit) {
    errors.push(`${label} exceeds ${limit} characters.`);
  }
  return value;
}

function optionalUrl(value: unknown, label: string, errors: string[]): string {
  const url = text(value, PUBLICATION_URL_LIMIT, label, errors);
  if (url && !URL_PATTERN.test(url)) {
    errors.push(`${label} must be an http or https URL.`);
  }
  return url;
}

function color(value: unknown, errors: string[]): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  if (typeof value !== "string" || !COLOR_PATTERN.test(value)) {
    errors.push("Colour must be a #RRGGBB value.");
    return "";
  }
  return value.toLowerCase();
}

function timestamp(value: unknown, errors: string[]): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    errors.push("Timestamp must be a valid date.");
    return "";
  }
  return new Date(value).toISOString();
}

function category(value: unknown, errors: string[]): string {
  if (value === undefined || value === null || value === "") {
    return "general";
  }
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 32) {
    errors.push("Category must be 1 to 32 characters.");
    return "general";
  }
  return value.trim();
}

function fields(value: unknown, errors: string[]): PublicationField[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    errors.push("Fields must be a list.");
    return [];
  }
  if (value.length > PUBLICATION_FIELD_LIMIT) {
    errors.push("A draft can have at most 25 fields.");
  }
  return value.map((entry, index) => {
    const field = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    const name = text(field["name"], PUBLICATION_FIELD_NAME_LIMIT, `Field ${index + 1} name`, errors);
    const fieldValue = text(field["value"], PUBLICATION_FIELD_VALUE_LIMIT, `Field ${index + 1} value`, errors);
    if (!name || !fieldValue) {
      errors.push(`Field ${index + 1} needs a name and a value.`);
    }
    return { name, value: fieldValue, inline: field["inline"] === true };
  });
}

function buttons(value: unknown, errors: string[]): PublicationButton[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    errors.push("Buttons must be a list.");
    return [];
  }
  if (value.length > PUBLICATION_BUTTON_LIMIT) {
    errors.push("A draft can have at most 5 buttons.");
  }
  return value.map((entry, index) => {
    const button = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    const label = text(button["label"], PUBLICATION_BUTTON_LABEL_LIMIT, `Button ${index + 1} label`, errors);
    const url = optionalUrl(button["url"], `Button ${index + 1} URL`, errors);
    if (!label || !url) {
      errors.push(`Button ${index + 1} needs a label and an https URL.`);
    }
    return { label, url };
  });
}

function mentions(value: unknown, label: string, errors: string[]): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    errors.push(`${label}s must be a list.`);
    return [];
  }
  if (value.length > PUBLICATION_MENTION_LIMIT) {
    errors.push(`${label}s exceed ${PUBLICATION_MENTION_LIMIT}.`);
  }
  return value.map((entry) => {
    if (typeof entry !== "string" || !SNOWFLAKE_PATTERN.test(entry)) {
      errors.push(`${label} ids must be numeric.`);
      return "";
    }
    return entry;
  }).filter((entry) => entry.length > 0);
}
