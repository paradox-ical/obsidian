import { Shell } from "@collective/ui";
import { DistributionPanel } from "./distribution-panel.js";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

interface AuthStatus {
  authenticated?: boolean;
  csrfToken?: string;
  oauth?: string;
}

interface DraftState {
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
  fields: Array<{ name: string; value: string; inline: boolean }>;
  buttons: Array<{ label: string; url: string }>;
  mentionUsers: string[];
  mentionRoles: string[];
  allowEveryone: boolean;
  category: string;
  secondApproval: boolean;
}

function emptyDraft(): DraftState {
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

export function PublicationEditor() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [draft, setDraft] = useState<DraftState>(emptyDraft());
  const [draftId, setDraftId] = useState("");
  const [revision, setRevision] = useState<number | null>(null);
  const [reviewId, setReviewId] = useState("");
  const [reviewChannelId, setReviewChannelId] = useState("");
  const [destinationChannelId, setDestinationChannelId] = useState("");
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [scheduledFor, setScheduledFor] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [feedback, setFeedback] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [notice, setNotice] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [search] = useSearchParams();

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/status", { signal: controller.signal })
      .then(async (response) => setAuth((await response.json()) as AuthStatus))
      .catch(() => setAuth({ authenticated: false }));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const id = search.get("draft");
    if (!id || !auth?.authenticated || !auth.csrfToken) {
      return;
    }
    const controller = new AbortController();
    fetch(`/api/publications/draft?id=${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as { result?: string; document?: DraftState; draftId?: string; revision?: number };
        if (body.result === "ready" && body.document && body.draftId) {
          setDraft(body.document);
          setDraftId(body.draftId);
          setRevision(body.revision ?? null);
        }
      })
      .catch(() => setNotice("The draft could not be loaded."));
    return () => controller.abort();
  }, [auth, search]);

  async function post(path: string, body: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": auth?.csrfToken ?? "" },
      body: JSON.stringify(body),
    });
    return (await response.json()) as Record<string, unknown>;
  }

  if (!auth?.authenticated) {
    return (
      <Shell title="Admin access is closed">
        <section className="panel">
          <p>The publication editor requires an admin session. Missing credentials do not save, schedule, pin, or publish a draft.</p>
          <p><a href="/">Return to the dashboard</a></p>
        </section>
      </Shell>
    );
  }

  return (
    <Shell title="Publication editor">
      <section className="panel editor-grid">
        <p>Drafts stay separate from published messages. Review controls are not part of the published content. {revision ? `Revision ${revision}.` : "Unsaved draft."}</p>
        <label htmlFor="content">Content<textarea id="content" value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} /></label>
        <label htmlFor="title">Title<input id="title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        <label htmlFor="description">Description<textarea id="description" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
        <label htmlFor="url">Embed URL<input id="url" value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} /></label>
        <label htmlFor="color">Colour<input id="color" value={draft.color} onChange={(event) => setDraft({ ...draft, color: event.target.value })} /></label>
        <label htmlFor="authorName">Author<input id="authorName" value={draft.authorName} onChange={(event) => setDraft({ ...draft, authorName: event.target.value })} /></label>
        <label htmlFor="authorUrl">Author URL<input id="authorUrl" value={draft.authorUrl} onChange={(event) => setDraft({ ...draft, authorUrl: event.target.value })} /></label>
        <label htmlFor="authorIconUrl">Author icon URL<input id="authorIconUrl" value={draft.authorIconUrl} onChange={(event) => setDraft({ ...draft, authorIconUrl: event.target.value })} /></label>
        <label htmlFor="footerText">Footer<input id="footerText" value={draft.footerText} onChange={(event) => setDraft({ ...draft, footerText: event.target.value })} /></label>
        <label htmlFor="footerIconUrl">Footer icon URL<input id="footerIconUrl" value={draft.footerIconUrl} onChange={(event) => setDraft({ ...draft, footerIconUrl: event.target.value })} /></label>
        <label htmlFor="timestamp">Timestamp<input id="timestamp" value={draft.timestamp} onChange={(event) => setDraft({ ...draft, timestamp: event.target.value })} /></label>
        <label htmlFor="imageUrl">Image URL<input id="imageUrl" value={draft.imageUrl} onChange={(event) => setDraft({ ...draft, imageUrl: event.target.value })} /></label>
        <label htmlFor="thumbnailUrl">Thumbnail URL<input id="thumbnailUrl" value={draft.thumbnailUrl} onChange={(event) => setDraft({ ...draft, thumbnailUrl: event.target.value })} /></label>
        <label htmlFor="category">Category<input id="category" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} /></label>
        <label htmlFor="mentionUsers">User mentions<input id="mentionUsers" value={draft.mentionUsers.join(" ")} onChange={(event) => setDraft({ ...draft, mentionUsers: splitIds(event.target.value) })} /></label>
        <label htmlFor="mentionRoles">Role mentions<input id="mentionRoles" value={draft.mentionRoles.join(" ")} onChange={(event) => setDraft({ ...draft, mentionRoles: splitIds(event.target.value) })} /></label>
        <label htmlFor="allowEveryone"><input id="allowEveryone" type="checkbox" checked={draft.allowEveryone} onChange={(event) => setDraft({ ...draft, allowEveryone: event.target.checked })} /> Allow everyone and here</label>
        <label htmlFor="secondApproval"><input id="secondApproval" type="checkbox" checked={draft.secondApproval} onChange={(event) => setDraft({ ...draft, secondApproval: event.target.checked })} /> Require a second admin</label>
        <fieldset>
          <legend>Fields</legend>
          {draft.fields.map((field, index) => (
            <div key={`field-${index}`}>
              <label htmlFor={`field-name-${index}`}>Name<input id={`field-name-${index}`} value={field.name} onChange={(event) => updateField(index, { name: event.target.value })} /></label>
              <label htmlFor={`field-value-${index}`}>Value<textarea id={`field-value-${index}`} value={field.value} onChange={(event) => updateField(index, { value: event.target.value })} /></label>
              <label htmlFor={`field-inline-${index}`}><input id={`field-inline-${index}`} type="checkbox" checked={field.inline} onChange={(event) => updateField(index, { inline: event.target.checked })} /> Inline</label>
            </div>
          ))}
          <button type="button" onClick={() => setDraft({ ...draft, fields: [...draft.fields, { name: "", value: "", inline: false }] })}>Add field</button>
        </fieldset>
        <fieldset>
          <legend>Buttons</legend>
          {draft.buttons.map((button, index) => (
            <div key={`button-${index}`}>
              <label htmlFor={`button-label-${index}`}>Label<input id={`button-label-${index}`} value={button.label} onChange={(event) => updateButton(index, { label: event.target.value })} /></label>
              <label htmlFor={`button-url-${index}`}>URL<input id={`button-url-${index}`} value={button.url} onChange={(event) => updateButton(index, { url: event.target.value })} /></label>
            </div>
          ))}
          <button type="button" onClick={() => setDraft({ ...draft, buttons: [...draft.buttons, { label: "", url: "" }] })}>Add button</button>
        </fieldset>
        <div className="editor-actions">
          <button type="button" onClick={() => void checkDraft()}>Preview</button>
          <button type="button" onClick={() => void saveDraft()}>Save draft</button>
          <label htmlFor="templateName">Template name<input id="templateName" value={templateName} onChange={(event) => setTemplateName(event.target.value)} /></label>
          <button type="button" onClick={() => void saveTemplate()}>Save template</button>
        </div>
        {errors.length > 0 ? <ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul> : null}
        {notice ? <p role="status">{notice}</p> : null}
        {previewText ? <pre className="preview">{previewText}</pre> : null}
      </section>
      <section className="panel editor-grid">
        <h2>Review</h2>
        <label htmlFor="reviewChannel">Review channel<input id="reviewChannel" value={reviewChannelId} onChange={(event) => setReviewChannelId(event.target.value)} /></label>
        <button type="button" onClick={() => void sendPreview()}>Send preview</button>
        <label htmlFor="reviewId">Review<input id="reviewId" value={reviewId} onChange={(event) => setReviewId(event.target.value)} /></label>
        <label htmlFor="destination">Destination channel<input id="destination" value={destinationChannelId} onChange={(event) => setDestinationChannelId(event.target.value)} /></label>
        <label htmlFor="mode">When
          <select id="mode" value={mode} onChange={(event) => setMode(event.target.value === "schedule" ? "schedule" : "now")}>
            <option value="now">Publish now</option>
            <option value="schedule">Schedule</option>
          </select>
        </label>
        <label htmlFor="scheduledFor">Schedule time<input id="scheduledFor" type="datetime-local" value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} /></label>
        <button type="button" onClick={() => void approve()}>Approve revision</button>
        <label htmlFor="feedback">Requested changes<textarea id="feedback" value={feedback} onChange={(event) => setFeedback(event.target.value)} /></label>
        <button type="button" onClick={() => void requestChanges()}>Request changes</button>
        <button type="button" onClick={() => void cancelReview()}>Cancel review</button>
      </section>
      <DistributionPanel csrfToken={auth.csrfToken ?? ""} draftId={draftId} />
    </Shell>
  );

  function updateField(index: number, patch: Partial<DraftState["fields"][number]>) {
    setDraft({ ...draft, fields: draft.fields.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...patch } : field) });
  }

  function updateButton(index: number, patch: Partial<DraftState["buttons"][number]>) {
    setDraft({ ...draft, buttons: draft.buttons.map((button, buttonIndex) => buttonIndex === index ? { ...button, ...patch } : button) });
  }

  async function checkDraft() {
    const body = await post("/api/publications/check", { document: draft });
    if (body["result"] !== "preview") {
      setErrors(Array.isArray(body["errors"]) ? body["errors"].filter((error): error is string => typeof error === "string") : ["Preview was refused."]);
      setPreviewText("");
      return;
    }
    setErrors([]);
    setPreviewText(JSON.stringify(body["preview"], null, 2));
    setNotice("Preview matches the saved field rules. Review controls are not included.");
  }

  async function saveDraft() {
    const body = await post("/api/publications/draft", { draftId: draftId || null, document: draft });
    if (body["result"] !== "saved" || typeof body["draftId"] !== "string") {
      setErrors(Array.isArray(body["errors"]) ? body["errors"].filter((error): error is string => typeof error === "string") : ["The draft was not saved."]);
      return;
    }
    setDraftId(body["draftId"]);
    setRevision(typeof body["revision"] === "number" ? body["revision"] : null);
    if (body["document"] && typeof body["document"] === "object") {
      setDraft(body["document"] as DraftState);
    }
    setErrors([]);
    setNotice(`Draft ${body["draftId"]} saved at revision ${String(body["revision"])}.`);
  }

  async function saveTemplate() {
    const body = await post("/api/publications/template", { name: templateName, document: draft });
    setNotice(body["result"] === "saved" ? "Template saved." : "The template was not saved.");
  }

  async function sendPreview() {
    const body = await post("/api/publications/preview", { draftId, reviewChannelId });
    if (body["result"] !== "preview" || typeof body["reviewId"] !== "string") {
      setNotice(body["result"] === "permission" ? "The review channel permission check failed." : "The preview was not sent.");
      return;
    }
    setReviewId(body["reviewId"]);
    setNotice(body["delivery"] === "setup_required" ? "Preview stored. Discord delivery is setup-required until a bot token and channel permission exist." : "Preview stored.");
  }

  async function approve() {
    const body = await post("/api/publications/approve", {
      reviewId,
      destinationChannelId,
      mode,
      scheduledFor: mode === "schedule" ? new Date(scheduledFor).toISOString() : null,
    });
    setNotice(typeof body["result"] === "string" ? `Approval result: ${body["result"]}.` : "Approval did not complete.");
  }

  async function requestChanges() {
    const body = await post("/api/publications/changes", { reviewId, feedback });
    setNotice(body["result"] === "changes_requested" ? "Changes requested." : "The request was not stored.");
  }

  async function cancelReview() {
    const body = await post("/api/publications/cancel", { reviewId });
    setNotice(body["result"] === "cancelled" ? "Review cancelled." : "The review was not cancelled.");
  }
}

function splitIds(value: string): string[] {
  return value.split(/[\s,]+/).filter((entry) => entry.length > 0);
}
