import { buttonRow, presentOutcome } from "./present.js";

export type NoticeKind = "moderation" | "birthday" | "ticket" | "room" | "verification";

const NOTICE_COPY: Record<NoticeKind, { title: string; next: string; destination: string }> = {
  moderation: { title: "Case review needed", next: "Authorised staff can open Moderation to inspect the case and decide what to do next.", destination: "mod" },
  birthday: { title: "A Collective birthday", next: "Manage your birthday and announcement preferences at any time.", destination: "birthday" },
  ticket: { title: "Ticket activity reminder", next: "Reply in the ticket to restart its activity timer, or review it through Support.", destination: "support" },
  room: { title: "Voice room closing", next: "Leave the room before disconnection. Open Support to manage temporary rooms.", destination: "support" },
  verification: { title: "Verification assistance requested", next: "Authorised staff can review the request. Assistance does not grant verification automatically.", destination: "verify" },
};

export function notificationPayload(kind: NoticeKind, body: string) {
  const copy = NOTICE_COPY[kind];
  const outcome = presentOutcome({ heading: copy.title, body: `${body}\n\n**Next**\n${copy.next}`, warning: kind === "room" || kind === "moderation", rows: [buttonRow([{ id: `go:${copy.destination}:open`, label: kind === "birthday" ? "Birthday settings" : "Open tools" }])] });
  return { ...outcome, allowed_mentions: { parse: [] } };
}
