import {
  approvePublication,
  cancelPublicationReview,
  openPublicationEditor,
  requestPublicationChanges,
  type PrismaClient,
} from "@collective/db";

export async function runPublishCommand(
  db: PrismaClient,
  input: {
    name: string;
    subcommand?: string;
    options: Record<string, string | boolean | number>;
    guildId: string;
    userId: string;
    roleIds: string[];
    now: Date;
  },
) {
  const actor = { guildId: input.guildId, actorUserId: input.userId, actorRoleIds: input.roleIds, now: input.now };
  if (input.name.startsWith("publish:edit:")) {
    const opened = await openPublicationEditor(db, { ...actor, reviewId: input.name.slice("publish:edit:".length) });
    if (opened.result === "editor") {
      return { content: `The original draft is open in the admin editor at ${opened.editorPath}. Saving a change invalidates this approval.` };
    }
    return { content: publishText(opened.result) };
  }
  if (input.name.startsWith("publish:cancel:")) {
    const cancelled = await cancelPublicationReview(db, { ...actor, reviewId: input.name.slice("publish:cancel:".length) });
    return { content: publishText(cancelled.result) };
  }
  if (input.name.startsWith("publish:approve-submit:")) {
    const when = typeof input.options["when"] === "string" ? input.options["when"] : "now";
    const scheduledFor = when === "now" || when === "" ? null : new Date(when);
    const approved = await approvePublication(db, {
      ...actor,
      reviewId: input.name.slice("publish:approve-submit:".length),
      destinationChannelId: typeof input.options["destination"] === "string" ? input.options["destination"] : "",
      mode: when === "now" || when === "" ? "now" : "schedule",
      scheduledFor,
    });
    return { content: publishText(approved.result) };
  }
  if (input.name.startsWith("publish:changes-submit:")) {
    const changed = await requestPublicationChanges(db, {
      ...actor,
      reviewId: input.name.slice("publish:changes-submit:".length),
      feedback: typeof input.options["feedback"] === "string" ? input.options["feedback"] : "",
    });
    return { content: publishText(changed.result) };
  }
  if (input.subcommand === "pin" || input.subcommand === "sticky" || input.subcommand === "announce") {
    return { content: "Recurring announcements, pins, and stickies are managed in the admin editor. This command does not post, pin, or repost them." };
  }
  return { content: "Embed drafts and review live in the admin publication editor. This command does not publish." };
}

function publishText(result: string): string {
  if (result === "recorded") return "The approved revision is recorded. Discord delivery is setup-required until a bot token can post it.";
  if (result === "scheduled") return "The approved revision is scheduled. Discord delivery stays pending until that time.";
  if (result === "stale") return "That review button is stale. The draft changed, so it was not published.";
  if (result === "permission") return "The destination permission check failed. Nothing was published.";
  if (result === "denied") return "Publication review is limited to staff with the publications capability.";
  if (result === "second_required") return "This category needs a second admin. Your approval was not recorded.";
  if (result === "destination_required") return "Choose a destination channel before publishing.";
  if (result === "changes_requested") return "The change request is stored on that review.";
  if (result === "cancelled") return "The review is cancelled. Nothing was published.";
  if (result === "already_decided") return "That review was already decided.";
  return "That publication action is unavailable.";
}
