import { MODULE_COPY } from "./experience-catalog.js";
import { buttonRow, type OutcomeRow } from "./present.js";

const CODES: Record<string, string> = {
  denied: "You are not allowed to do that.", missing: "That record was not found.",
  invalid: "Check the details and try again.", maintenance: "This feature is paused for maintenance.",
  cooldown: "This action is still on cooldown.", locked: "This is locked by an active activity.",
  insufficient: "Your available balance does not cover the cost.",
  saved: "Saved.", updated: "Updated.", removed: "Removed.", recorded: "Recorded.",
  granted: "Granted.", restored: "Restored.", closed: "Closed.", reopened: "Reopened.",
  claimed: "Claimed.", transferred: "Transferred.", already: "This was already completed.",
};

export function spokenCode(result: string): string {
  return CODES[result] ?? `Result: ${result.replaceAll("_", " ")}. Check the current record before retrying.`;
}

export function polish(body: string): string {
  return body
    .replace(/(?:\s*-#\s*)?\s*The notice is not posted\./g, "")
    .replaceAll("The Marks pocket is closed.", "Your Marks wallet is unavailable.")
    .replaceAll("The pocket does not cover", "Your available balance does not cover")
    .replaceAll("The points and the abilities", "Your stats and abilities")
    .replaceAll("The points", "Stat points")
    .replaceAll("The pocket", "Your wallet")
    .replaceAll("the pocket", "your wallet")
    .replaceAll("The staff book", "Staff logs")
    .replaceAll("The till", "Economy statistics")
    .replaceAll("setup_required", "awaiting configuration")
    .replaceAll("setup-required", "awaiting configuration")
    .replaceAll("module_not_built", "unavailable in this build")
    .trim();
}

export function sourceParent(source: string): string {
  const parts = source.split(":");
  if (parts[0] === "go") return parts[1] ?? "help";
  if (parts[0] === "ux") return "help";
  if (parts[0] === "ticket") return "support";
  if (parts[0] === "community" && ["role", "select"].includes(parts[1] ?? "")) return "roles";
  return parts[0] ?? "help";
}

export function guideReply(source: string, body: string, existing?: ReadonlyArray<OutcomeRow>): { body: string; rows?: OutcomeRow[] } {
  const parent = sourceParent(source);
  const copy = MODULE_COPY[parent];
  const polished = polish(body);
  if (existing?.length) return { body: polished, rows: [...existing] };
  if (!copy) return { body: polished };
  const failed = /not allowed|cannot|could not|unavailable|not accepted|did not|not found|not open|expired|stale|denied|insufficient/i.test(polished);
  const next = failed ? "Review the details or choose another action below." : `Continue in **${copy.title}**, or explore another section.`;
  const shortcuts = parent === "economy" ? [{ id: "go:economy:history", label: "Transaction history" }] : [];
  return {
    body: `${polished}\n\n**Next**\n${next}`,
    rows: [buttonRow([...shortcuts, { id: `go:${parent}:open`, label: copy.title }, { id: "ux:home", label: "All sections" }])],
  };
}
