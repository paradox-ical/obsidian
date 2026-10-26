import { commandChoices, type CommandChoice } from "./command-choices.js";

/**
 * Discord limits verified 7 October 2026 from
 * https://docs.discord.com/developers/interactions/application-commands
 * An app can have 100 global CHAT_INPUT commands, and the same number of
 * guild commands per guild. Each command level accepts at most 25 options.
 * Subcommands cannot be mixed with other option types at the same level.
 */
export const DISCORD_GLOBAL_CHAT_INPUT_LIMIT = 100;
export const DISCORD_GUILD_CHAT_INPUT_LIMIT = 100;
export const DISCORD_OPTIONS_PER_LEVEL_LIMIT = 25;

/** Project ceiling from master spec section 3. The target parent count is 36. */
export const PROJECT_PARENT_COMMAND_CEILING = 50;

const NAME_PATTERN = /^[a-z0-9_-]{1,32}$/;

export type ParameterType = "string" | "integer" | "boolean" | "user" | "channel" | "role";

export interface CommandParameter {
  name: string;
  description: string;
  type: ParameterType;
  required: boolean;
  choices?: readonly CommandChoice[];
}

export interface Subcommand {
  name: string;
  description: string;
  options: CommandParameter[];
}

export interface ParentCommandPlan {
  name: string;
  summary: string;
  description: string;
  options: Subcommand[];
}

const PANEL_LINES: Record<string, string> = {
  search: "Look up what a module does",
  actions: "See what you can do from here",
  wizard: "Walk the setup",
  diagnostics: "See what is still missing",
  mappings: "Point the channels and roles",
  embed: "Draft an embed",
  review: "Send a draft for review",
  announce: "Post an announcement",
  pin: "Pin a message",
  sticky: "Hold a message in place",
  rules: "Write a rule that answers for you",
  test: "Try a rule before it fires",
  achievements: "Read the achievement book",
  commendations: "Leave a commendation",
  updates: "Post a game update",
  manage: "Staff the community desk",
};

function command(name: string, summary: string, actions: Array<string | Subcommand>): ParentCommandPlan {
  return {
    name,
    summary,
    description: summary.length <= 100 ? summary : `${summary.slice(0, 97)}...`,
    options: actions.map((action) =>
      typeof action === "string"
        ? { name: action, description: PANEL_LINES[action] ?? `Open ${action.replaceAll("_", " ")}`, options: [] }
        : action,
    ),
  };
}

/**
 * Routing manifest. Panels carry the detailed flows. Nothing here is registered
 * until the explicit test-guild tool is run.
 */
export const COMMAND_PARENTS: readonly ParentCommandPlan[] = [
  command("help", "Ask what a module does, or what you can do", ["search", "actions"]),
  command("setup", "Walk setup, or see what is still missing", ["wizard", "diagnostics", "mappings"]),
  command("verify", "Prove you are here, or ask for help", [
    {
      name: "captcha",
      description: "Start or answer the in-Discord CAPTCHA",
      options: [{ name: "answer", description: "CAPTCHA answer", type: "string", required: false }],
    },
    {
      name: "assistance",
      description: "Ask staff for accessible verification help",
      options: [{ name: "note", description: "What you need help with", type: "string", required: false }],
    },
    {
      name: "review",
      description: "Staff manual verification or revocation",
      options: [
        { name: "member", description: "Member to review", type: "user", required: true },
        { name: "reason", description: "Audit reason", type: "string", required: true },
        { name: "revoke", description: "Revoke verified status", type: "boolean", required: false },
      ],
    },
  ]),
  command("roles", "Take a role the street offers", [
    {
      name: "panel",
      description: "Show role panels",
      options: [{ name: "name", description: "Panel name", type: "string", required: false }],
    },
    {
      name: "optin",
      description: "Choose or clear a self-select role",
      options: [
        { name: "role", description: "Role to change", type: "role", required: true },
        { name: "clear", description: "Remove this selection", type: "boolean", required: false },
      ],
    },
  ]),
  command("accounts", "Claim a handle, or take it back", [
    {
      name: "link",
      description: "Save a self-reported handle",
      options: [
        { name: "provider", description: "Where the handle lives", type: "string", required: true },
        { name: "handle", description: "The name you answer to there", type: "string", required: true },
      ],
    },
    { name: "inspect", description: "Show your linked accounts", options: [] },
    {
      name: "privacy",
      description: "Set account visibility",
      options: [
        { name: "provider", description: "Where the handle lives", type: "string", required: true },
        { name: "visibility", description: "Who can see this handle", type: "string", required: true },
      ],
    },
    {
      name: "unlink",
      description: "Remove one linked account",
      options: [{ name: "provider", description: "Where the handle lives", type: "string", required: true }],
    },
  ]),
  command("temproles", "Lend a role, and say when it ends", [
    {
      name: "grant",
      description: "Grant a temporary role",
      options: [
        { name: "member", description: "Member who receives the role", type: "user", required: true },
        { name: "role", description: "Role to grant", type: "role", required: true },
        { name: "days", description: "Days to add", type: "integer", required: true },
        { name: "reason", description: "Audit reason", type: "string", required: true },
      ],
    },
    {
      name: "renew",
      description: "Stack more time on a temporary grant",
      options: [
        { name: "member", description: "Member whose grant is renewed", type: "user", required: true },
        { name: "role", description: "Role to renew", type: "role", required: true },
        { name: "days", description: "Days to add", type: "integer", required: true },
        { name: "reason", description: "Audit reason", type: "string", required: true },
      ],
    },
    {
      name: "expire",
      description: "Set an exact expiry",
      options: [
        { name: "member", description: "Member whose grant changes", type: "user", required: true },
        { name: "role", description: "Role to update", type: "role", required: true },
        { name: "days", description: "Days from now", type: "integer", required: true },
        { name: "reason", description: "Audit reason", type: "string", required: true },
      ],
    },
  ]),
  command("invites", "See who you brought in", [
    { name: "progress", description: "Show your qualified recruitment count", options: [] },
    {
      name: "attribution",
      description: "Correct an invite attribution",
      options: [
        { name: "member", description: "Recruited member", type: "user", required: true },
        { name: "confidence", description: "How sure the recruit link is", type: "string", required: true },
        { name: "reason", description: "Audit reason", type: "string", required: true },
      ],
    },
  ]),
  command("birthday", "Leave a birthday, if you want one", [
    {
      name: "set",
      description: "Save an opt-in birthday",
      options: [
        { name: "month", description: "The month they were born", type: "integer", required: true },
        { name: "day", description: "Day of the month", type: "integer", required: true },
        { name: "year", description: "Optional year", type: "integer", required: false },
        { name: "timezone", description: "IANA timezone", type: "string", required: false },
        { name: "announce", description: "Announce the day and month", type: "boolean", required: false },
      ],
    },
    {
      name: "privacy",
      description: "Change birthday announcement",
      options: [{ name: "announce", description: "Announce the day and month", type: "boolean", required: true }],
    },
    { name: "reminders", description: "Show the annual gift status", options: [] },
    { name: "remove", description: "Delete stored birthday data", options: [] },
  ]),
  command("mod", "Open a case, or answer an appeal", [
    {
      name: "sanctions",
      description: "Apply a manual sanction",
      options: [
        { name: "member", description: "Member to review", type: "user", required: true },
        { name: "action", description: "What the case should do", type: "string", required: true },
        { name: "reason", description: "Audit reason", type: "string", required: true },
        { name: "points", description: "Warning points", type: "integer", required: false },
        { name: "days", description: "Days until expiry", type: "integer", required: false },
      ],
    },
    {
      name: "warnings",
      description: "Show active warning points",
      options: [{ name: "member", description: "Member to inspect", type: "user", required: true }],
    },
    {
      name: "cases",
      description: "Review or reverse a case",
      options: [
        { name: "case", description: "Case id", type: "string", required: true },
        { name: "reason", description: "Audit reason", type: "string", required: false },
        { name: "revoke", description: "Reverse this case", type: "boolean", required: false },
      ],
    },
    {
      name: "appeals",
      description: "Submit or resolve an appeal",
      options: [
        { name: "case", description: "Case id", type: "string", required: true },
        { name: "note", description: "Appeal note", type: "string", required: false },
        { name: "reason", description: "Resolution reason", type: "string", required: false },
        { name: "revoke", description: "Accept and reverse the case", type: "boolean", required: false },
      ],
    },
  ]),
  command("report", "Tell staff, quietly", [
    {
      name: "submit",
      description: "Send a private report to staff",
      options: [
        { name: "member", description: "Member to report", type: "user", required: true },
        { name: "note", description: "What happened", type: "string", required: true },
      ],
    },
  ]),
  command("logs", "Search the staff book", [
    {
      name: "search",
      description: "Search staff logs",
      options: [{ name: "query", description: "Kind or text", type: "string", required: false }],
    },
    {
      name: "export",
      description: "Export staff logs",
      options: [{ name: "reason", description: "Audit reason", type: "string", required: true }],
    },
    { name: "settings", description: "Show log retention", options: [] },
  ]),
  command("stats", "The till, for staff eyes", [
    { name: "report", description: "Show economy issuance and sinks", options: [] },
    {
      name: "export",
      description: "Export the economy report",
      options: [{ name: "reason", description: "Audit reason", type: "string", required: true }],
    },
  ]),
  command("rank", "Your standing in the community", [
    { name: "profile", description: "Show community level and the public wallet", options: [] },
  ]),
  command("economy", "The pocket, the transfer, and the till", [
    {
      name: "wallet",
      description: "Show a public Marks balance",
      options: [{ name: "member", description: "Member to read", type: "user", required: false }],
    },
    {
      name: "transfer",
      description: "Send Marks to another member",
      options: [
        { name: "member", description: "Recipient", type: "user", required: true },
        { name: "amount", description: "Whole Marks", type: "integer", required: true },
      ],
    },
    {
      name: "history",
      description: "Show Marks receipts",
      options: [{ name: "member", description: "Member to read", type: "user", required: false }],
    },
    {
      name: "adjust",
      description: "Staff hands on the till",
      options: [
        { name: "action", description: "How the Marks should move", type: "string", required: true },
        { name: "member", description: "Member to adjust", type: "user", required: true },
        { name: "amount", description: "Whole Marks", type: "integer", required: true },
        { name: "reason", description: "Audit reason", type: "string", required: true },
      ],
    },
  ]),
  command("market", "The Ingot exchange", [
    { name: "chart", description: "Show recent Ingot exchange prices", options: [] },
    { name: "pool", description: "Show inventory and the next unit price", options: [] },
    {
      name: "quote",
      description: "Price a buy or sell",
      options: [
        { name: "side", description: "Buy from the pool, or sell into it", type: "string", required: true },
        { name: "amount", description: "Whole Ingots", type: "integer", required: true },
      ],
    },
    {
      name: "buy",
      description: "Quote an Ingot purchase",
      options: [{ name: "amount", description: "Whole Ingots", type: "integer", required: true }],
    },
    {
      name: "sell",
      description: "Quote an Ingot sale",
      options: [{ name: "amount", description: "Whole Ingots", type: "integer", required: true }],
    },
  ]),
  command("leaderboard", "The boards, and the seasons already closed", [
    {
      name: "rankings",
      description: "Show a public leaderboard page",
      options: [
        { name: "category", description: "Which board to read", type: "string", required: false },
        { name: "page", description: "Page number", type: "integer", required: false },
      ],
    },
    {
      name: "archive",
      description: "Show an archived season",
      options: [
        { name: "season", description: "Season id", type: "string", required: false },
        { name: "category", description: "Which board to read", type: "string", required: false },
      ],
    },
  ]),
  command("events", "Official nights, and whether you are coming", [
    {
      name: "manage",
      description: "Run the night, or write what happened",
      options: [
        { name: "action", description: "What to do with the event", type: "string", required: true },
        { name: "name", description: "Event name", type: "string", required: false },
        { name: "occurrence", description: "Occurrence id", type: "string", required: false },
        { name: "host", description: "Host user id", type: "string", required: false },
        { name: "scope", description: "This night, or the whole run", type: "string", required: false },
        { name: "when", description: "ISO start time for a one-off event", type: "string", required: false },
        { name: "recap", description: "Recap text", type: "string", required: false },
        { name: "member", description: "Member user id", type: "string", required: false },
      ],
    },
    {
      name: "rsvp",
      description: "Say whether you are coming",
      options: [
        { name: "occurrence", description: "Occurrence id", type: "string", required: true },
        { name: "response", description: "Are you coming", type: "string", required: true },
      ],
    },
  ]),
  command("schedule", "What is coming, and what is attached", [
    { name: "view", description: "Show the upcoming official schedule", options: [] },
    {
      name: "control",
      description: "Link an announcement or temporary room without a second job",
      options: [
        { name: "action", description: "What to attach to the event", type: "string", required: true },
        { name: "occurrence", description: "Occurrence id", type: "string", required: true },
        { name: "target", description: "Announcement series id", type: "string", required: false },
      ],
    },
  ]),
  command("crew", "Crews, tables, and who is looking", [
    {
      name: "persistent",
      description: "Found a crew, or change who runs it",
      options: [
        { name: "action", description: "What happens to the crew", type: "string", required: true },
        { name: "name", description: "Crew name", type: "string", required: false },
        { name: "crew", description: "Crew id", type: "string", required: false },
        { name: "member", description: "Member user id", type: "string", required: false },
      ],
    },
    {
      name: "session",
      description: "Open a table, or take a seat",
      options: [
        { name: "action", description: "What happens to the session", type: "string", required: true },
        { name: "crew", description: "Persistent crew id", type: "string", required: false },
        { name: "session", description: "Session id", type: "string", required: false },
        { name: "name", description: "Session name", type: "string", required: false },
        { name: "game", description: "Game", type: "string", required: false },
        { name: "platform", description: "Platform", type: "string", required: false },
        { name: "region", description: "Region", type: "string", required: false },
        { name: "when", description: "ISO start time", type: "string", required: false },
        { name: "size", description: "Session size", type: "integer", required: false },
        { name: "mode", description: "Who can walk in", type: "string", required: false },
        { name: "member", description: "Member user id", type: "string", required: false },
      ],
    },
    {
      name: "lfg",
      description: "List open sessions or join one",
      options: [
        { name: "action", description: "Look, or take a seat", type: "string", required: true },
        { name: "session", description: "Session id", type: "string", required: false },
      ],
    },
  ]),
  command("prediction", "Calls with nothing on them, and calls with Marks", [
    {
      name: "free",
      description: "Call it, enter it, or settle it",
      options: [
        { name: "action", description: "What to do with the call", type: "string", required: true },
        { name: "title", description: "Prediction title", type: "string", required: false },
        { name: "prediction", description: "Prediction id", type: "string", required: false },
        { name: "outcome", description: "Outcome id or label", type: "string", required: false },
        { name: "choice", description: "Chosen outcome id", type: "string", required: false },
        { name: "evidence", description: "Rules, pre-entry note, or resolution evidence", type: "string", required: false },
        { name: "when", description: "ISO lock time", type: "string", required: false },
        { name: "prize", description: "Funded prize in whole Marks", type: "integer", required: false },
        { name: "points", description: "Points for a correct free entry", type: "integer", required: false },
      ],
    },
    {
      name: "staked",
      description: "Open the pool, or settle the stakes",
      options: [
        { name: "action", description: "What to do with the pool", type: "string", required: true },
        { name: "title", description: "Prediction title", type: "string", required: false },
        { name: "prediction", description: "Prediction id", type: "string", required: false },
        { name: "outcome", description: "Outcome id or label", type: "string", required: false },
        { name: "choice", description: "Chosen outcome id", type: "string", required: false },
        { name: "stake", description: "Stake in whole Marks", type: "integer", required: false },
        { name: "evidence", description: "Rules, pre-entry note, or resolution evidence", type: "string", required: false },
        { name: "when", description: "ISO lock time", type: "string", required: false },
        { name: "reason", description: "Audit reason", type: "string", required: false },
      ],
    },
  ]),
  command("contest", "Enter the work, cast a ballot, or judge", [
    {
      name: "submit",
      description: "Submit or edit an entry before the deadline",
      options: [
        { name: "contest", description: "Contest id", type: "string", required: true },
        { name: "title", description: "Entry title", type: "string", required: true },
        { name: "media", description: "What kind of entry this is", type: "string", required: true },
        { name: "body", description: "Submission body", type: "string", required: false },
      ],
    },
    {
      name: "ballot",
      description: "Cast one ballot. This does not read reactions",
      options: [
        { name: "contest", description: "Contest id", type: "string", required: true },
        { name: "entry", description: "Entry id", type: "string", required: true },
        { name: "score", description: "criterion:points pairs for judging", type: "string", required: false },
      ],
    },
    {
      name: "judge",
      description: "Open the contest, or name a winner",
      options: [
        { name: "action", description: "What to do with the contest", type: "string", required: true },
        { name: "title", description: "Contest title", type: "string", required: false },
        { name: "contest", description: "Contest id", type: "string", required: false },
        { name: "mode", description: "How the winner is chosen", type: "string", required: false },
        { name: "entry", description: "Entry id", type: "string", required: false },
        { name: "reason", description: "Correction reason", type: "string", required: false },
        { name: "stock", description: "Prize stock id", type: "string", required: false },
      ],
    },
  ]),
  command("giveaway", "One free entry, then the draw", [
    {
      name: "enter",
      description: "Take the one free entry",
      options: [{ name: "giveaway", description: "Giveaway id", type: "string", required: true }],
    },
    {
      name: "bonus",
      description: "Add one capped bonus from a verified activity",
      options: [
        { name: "giveaway", description: "Giveaway id", type: "string", required: true },
        { name: "activity", description: "Verified activity id", type: "string", required: true },
      ],
    },
    {
      name: "draw",
      description: "Close the hat, or draw a name",
      options: [
        { name: "action", description: "What to do with the draw", type: "string", required: true },
        { name: "title", description: "Giveaway title", type: "string", required: false },
        { name: "giveaway", description: "Giveaway id", type: "string", required: false },
        { name: "reason", description: "Audit reason", type: "string", required: false },
        { name: "stock", description: "Prize stock id", type: "string", required: false },
        { name: "draw", description: "Draw id", type: "string", required: false },
      ],
    },
  ]),
  command("publish", "Drafts, announcements, pins, and stickies", ["embed", "review", "announce", "pin", "sticky"]),
  command("reply", "Rules that answer for you", ["rules", "test"]),
  command("lottery", "Tickets for the open draw", [
    {
      name: "tickets",
      description: "Quote or buy tickets for the open draw",
      options: [
        { name: "action", description: "Price it, or pay the quote", type: "string", required: true },
        { name: "quantity", description: "Number of tickets", type: "integer", required: false },
        { name: "quote", description: "Quote id to buy", type: "string", required: false },
      ],
    },
    { name: "draw", description: "Show odds, bonus, deadline, and the stall refund", options: [] },
    { name: "history", description: "Show settled draws", options: [] },
  ]),
  command("contracts", "The board, and the work on it", [
    { name: "board", description: "Open today's board, or a longer cycle", options: [{ name: "cycle", description: "Which cycle to open", type: "string", required: false }] },
    { name: "progress", description: "Show progress, deadline, and rewards", options: [] },
    { name: "reroll", description: "Reroll one unstarted daily contract", options: [{ name: "assignment", description: "Assignment id", type: "string", required: true }] },
    {
      name: "settings",
      description: "Choose refresh notices and completion pings",
      options: [
        { name: "pings", description: "Mention completions in the channel", type: "boolean", required: false },
        { name: "delivery", description: "Where the notices land", type: "string", required: false },
        { name: "channel", description: "Channel for opted-in notices", type: "string", required: false },
        { name: "daily", description: "Daily refresh notice", type: "boolean", required: false },
        { name: "weekly", description: "Weekly refresh notice", type: "boolean", required: false },
        { name: "monthly", description: "Monthly refresh notice", type: "boolean", required: false },
      ],
    },
    {
      name: "custom",
      description: "Write a contract, or sign off on one",
      options: [
        { name: "action", description: "What to do with the contract", type: "string", required: true },
        { name: "title", description: "Objective title", type: "string", required: false },
        { name: "kind", description: "What the contract asks for", type: "string", required: false },
        { name: "objective", description: "Objective id", type: "string", required: false },
        { name: "assignment", description: "Assignment id", type: "string", required: false },
        { name: "answer", description: "Riddle answer or submission", type: "string", required: false },
        { name: "reason", description: "Audit reason", type: "string", required: false },
        { name: "policy", description: "What happens to current progress", type: "string", required: false },
        { name: "target", description: "Progress target", type: "integer", required: false },
        { name: "reward", description: "Reward in Marks", type: "integer", required: false },
        { name: "board", description: "Which cycle it belongs to", type: "string", required: false },
      ],
    },
  ]),
  command("combat", "The floor, the queue, and the record", [
    {
      name: "queue",
      description: "Join or leave a casual or ranked queue",
      options: [
        { name: "action", description: "Step in, step out, or take the match", type: "string", required: true },
        { name: "mode", description: "How the match is scored", type: "string", required: false },
        { name: "stake", description: "Equal Marks stake, or zero", type: "integer", required: false },
        { name: "match", description: "Match id for a casual proposal", type: "string", required: false },
      ],
    },
    {
      name: "challenge",
      description: "Call someone out, or answer",
      options: [
        { name: "action", description: "Offer the duel, or answer it", type: "string", required: true },
        { name: "member", description: "Opponent user id", type: "string", required: false },
        { name: "mode", description: "How the match is scored", type: "string", required: false },
        { name: "stake", description: "Equal Marks stake, or zero", type: "integer", required: false },
        { name: "match", description: "Match id", type: "string", required: false },
        { name: "style", description: "How the fight is played", type: "string", required: false },
      ],
    },
    {
      name: "action",
      description: "Fight a test opponent",
      options: [
        { name: "mode", description: "How the fight is played", type: "string", required: true },
        { name: "opponent", description: "Who is waiting on the floor", type: "string", required: false },
        { name: "battle", description: "Battle id", type: "string", required: false },
        { name: "move", description: "What you do this turn", type: "string", required: false },
      ],
    },
    { name: "records", description: "Show a battle record", options: [{ name: "battle", description: "Battle id", type: "string", required: false }] },
  ]),
  command("character", "Pick a life, spend the points, and set the loadout", [
    { name: "class", description: "Look over the six lives, or take one", options: [{ name: "class", description: "The life you take up", type: "string", required: false }] },
    {
      name: "stats",
      description: "Show or spend stat points",
      options: [
        { name: "stat", description: "Where the points go", type: "string", required: false },
        { name: "points", description: "Points to allocate", type: "integer", required: false },
      ],
    },
    { name: "abilities", description: "Show abilities, cooldowns, and formulas", options: [] },
    {
      name: "respec",
      description: "Reset the points, or change the life",
      options: [
        { name: "action", description: "Reset, change class, or use the intro", type: "string", required: true },
        { name: "class", description: "The life you change into", type: "string", required: false },
      ],
    },
    {
      name: "loadout",
      description: "Equip up to four active abilities",
      options: [
        { name: "slot", description: "Which of the four slots", type: "integer", required: false },
        { name: "ability", description: "Which ability takes the slot", type: "string", required: false },
      ],
    },
  ]),
  command("explore", "Jobs that take time, and jobs that branch", [
    {
      name: "expedition",
      description: "Preview or start one timed expedition",
      options: [
        { name: "action", description: "Look, leave, or read the report", type: "string", required: true },
        { name: "region", description: "Where the job is", type: "string", required: false },
        { name: "difficulty", description: "How hard the street is", type: "string", required: false },
        { name: "item", description: "Gear instance to reserve", type: "string", required: false },
        { name: "notify", description: "Store a completion report notice", type: "boolean", required: false },
      ],
    },
    {
      name: "mission",
      description: "Play a branching mission",
      options: [
        { name: "action", description: "Look, start, choose, or fight", type: "string", required: true },
        { name: "choice", description: "Choice id", type: "string", required: false },
        { name: "region", description: "Where the job is", type: "string", required: false },
        { name: "item", description: "Gear instance to reserve", type: "string", required: false },
        { name: "notify", description: "Store a completion notice", type: "boolean", required: false },
      ],
    },
    { name: "crew", description: "Crew missions stay on the crew command", options: [] },
  ]),
  command("inventory", "What you carry, craft, break, and trade", [
    {
      name: "gear",
      description: "Inspect or equip gear",
      options: [
        { name: "action", description: "What to do with the gear", type: "string", required: false },
        { name: "item", description: "Gear instance id", type: "string", required: false },
      ],
    },
    {
      name: "materials",
      description: "List salvage materials",
      options: [],
    },
    {
      name: "crates",
      description: "List or open a stored crate",
      options: [
        { name: "action", description: "What to do with the crate", type: "string", required: true },
        { name: "crate", description: "Crate table or grant id", type: "string", required: false },
      ],
    },
    {
      name: "trade",
      description: "Offer a trade, or walk away from one",
      options: [
        { name: "action", description: "What to do with the trade", type: "string", required: true },
        { name: "member", description: "The other member", type: "user", required: false },
        { name: "item", description: "Gear you offer", type: "string", required: false },
        { name: "request", description: "Gear you request", type: "string", required: false },
        { name: "marks", description: "Marks you offer", type: "integer", required: false },
        { name: "price", description: "Marks you request", type: "integer", required: false },
        { name: "trade", description: "Trade id", type: "string", required: false },
      ],
    },
    {
      name: "craft",
      description: "Preview or craft a published recipe",
      options: [
        { name: "action", description: "What to do with the recipe", type: "string", required: true },
        { name: "recipe", description: "Recipe slug", type: "string", required: false },
      ],
    },
    {
      name: "salvage",
      description: "Preview or confirm salvage",
      options: [
        { name: "action", description: "Look first, or break it down", type: "string", required: true },
        { name: "item", description: "Gear instance id", type: "string", required: false },
      ],
    },
    {
      name: "upgrade",
      description: "Preview or apply a guaranteed upgrade",
      options: [
        { name: "action", description: "Look first, or spend the materials", type: "string", required: true },
        { name: "item", description: "Gear instance id", type: "string", required: false },
      ],
    },
    {
      name: "reroll",
      description: "Preview or replace one affix",
      options: [
        { name: "action", description: "Look first, or replace the affix", type: "string", required: true },
        { name: "item", description: "Gear instance id", type: "string", required: false },
        { name: "affix", description: "Affix slug to replace", type: "string", required: false },
      ],
    },
  ]),
  command("profile", "The dossier you show, and the bio you hide", [
    { name: "dossier", description: "Show a public dossier", options: [{ name: "member", description: "Member to view", type: "user", required: false }] },
    {
      name: "cosmetics",
      description: "Set a frame or background label",
      options: [
        { name: "frame", description: "Frame label", type: "string", required: false },
        { name: "background", description: "Background label", type: "string", required: false },
      ],
    },
    {
      name: "privacy",
      description: "Change bio visibility",
      options: [{ name: "visibility", description: "Who can read the bio", type: "string", required: true }],
    },
    {
      name: "preferences",
      description: "Save a private bio",
      options: [{ name: "bio", description: "Profile bio", type: "string", required: false }],
    },
  ]),
  command("shop", "The shop, the Ingot counter, and member listings", [
    {
      name: "supply",
      description: "Browse or buy the Marks supply shop",
      options: [
        { name: "action", description: "Look through the stock, or buy", type: "string", required: true },
        { name: "offer", description: "Offer slug", type: "string", required: false },
      ],
    },
    {
      name: "ingot",
      description: "Spend Ingots, or take the purchase back",
      options: [
        { name: "action", description: "Look, buy, reveal, or take it back", type: "string", required: true },
        { name: "offer", description: "Offer slug", type: "string", required: false },
        { name: "purchase", description: "Purchase id", type: "string", required: false },
      ],
    },
    {
      name: "marketplace",
      description: "Put gear on the board, or buy what is there",
      options: [
        { name: "action", description: "Look, list, buy, or pull it down", type: "string", required: true },
        { name: "item", description: "Gear instance id", type: "string", required: false },
        { name: "price", description: "Fixed Marks price", type: "integer", required: false },
        { name: "listing", description: "Listing id", type: "string", required: false },
      ],
    },
  ]),
  command("blackjack", "A table alone, or a table with company", [
    {
      name: "solo",
      description: "Sit alone at the table",
      options: [
        { name: "action", description: "Price the hand, or play the cards", type: "string", required: true },
        { name: "stake", description: "Stake in Marks", type: "integer", required: false },
        { name: "quote", description: "Quote id to open", type: "string", required: false },
        { name: "table", description: "Table id", type: "string", required: false },
      ],
    },
    {
      name: "social",
      description: "Sit down with the table",
      options: [
        { name: "action", description: "Price a seat, or play the cards", type: "string", required: true },
        { name: "stake", description: "Stake in Marks", type: "integer", required: false },
        { name: "quote", description: "Quote id", type: "string", required: false },
        { name: "table", description: "Table id", type: "string", required: false },
      ],
    },
    {
      name: "receipt",
      description: "Read a stored table receipt",
      options: [{ name: "table", description: "Table id", type: "string", required: false }],
    },
  ]),
  command("deaddrop", "The covered board, and one paid cell", [
    { name: "board", description: "Show the shared board, jackpot, and picks left", options: [] },
    {
      name: "pick",
      description: "Quote or buy one covered cell",
      options: [
        { name: "action", description: "Price it, or pay the quote", type: "string", required: true },
        { name: "coordinate", description: "Cell from A1 through F6", type: "string", required: false },
        { name: "quote", description: "Quote id to buy", type: "string", required: false },
      ],
    },
    {
      name: "reminder",
      description: "Opt in or out of the opening reminder",
      options: [{ name: "enabled", description: "Receive the opening reminder", type: "boolean", required: false }],
    },
    {
      name: "special",
      description: "Set a special board or activate a Market Collapse",
      options: [
        { name: "action", description: "Lay the board, or spend a charge", type: "string", required: true },
        { name: "kind", description: "What the special board holds", type: "string", required: false },
        { name: "payload", description: "Quantity, slug, or clue", type: "string", required: false },
        { name: "charge", description: "Charge id to activate", type: "string", required: false },
        { name: "reason", description: "Audit reason", type: "string", required: false },
      ],
    },
  ]),
  command("support", "A private ticket, or a room that does not last", [
    {
      name: "tickets",
      description: "Open or manage a private support ticket",
      options: [
        { name: "action", description: "What to do with the ticket", type: "string", required: true },
        { name: "category", description: "Ticket category", type: "string", required: false },
        { name: "ticket", description: "Ticket id", type: "string", required: false },
        { name: "note", description: "Form answer or message", type: "string", required: false },
        { name: "member", description: "Staff member to assign", type: "user", required: false },
        { name: "reason", description: "Audit reason", type: "string", required: false },
        { name: "case", description: "Moderation case id", type: "string", required: false },
        { name: "reference", description: "Purchase or reward id", type: "string", required: false },
        { name: "kind", description: "What the ticket points at", type: "string", required: false },
      ],
    },
    {
      name: "rooms",
      description: "Create or manage a temporary room",
      options: [
        { name: "action", description: "What to do with the room", type: "string", required: true },
        { name: "kind", description: "A voice room, or a text room", type: "string", required: false },
        { name: "name", description: "Room name", type: "string", required: false },
        { name: "room", description: "Room id", type: "string", required: false },
        { name: "member", description: "Member to invite or transfer to", type: "user", required: false },
      ],
    },
    "achievements",
    "commendations",
  ]),
  command("community", "Polls, updates, and the community desk", [
    {
      name: "polls",
      description: "Create or vote in a staff poll",
      options: [
        { name: "action", description: "What to do with the poll", type: "string", required: true },
        { name: "question", description: "Poll question", type: "string", required: false },
        { name: "choice", description: "Choice labels or a choice id", type: "string", required: false },
        { name: "poll", description: "Poll id", type: "string", required: false },
        { name: "kind", description: "How the answers work", type: "string", required: false },
        { name: "role", description: "Eligible role", type: "role", required: false },
        { name: "anonymous", description: "Hide voter ids from members", type: "boolean", required: false },
      ],
    },
    "updates",
    "manage",
  ]),
];

export function assertParentCommandBudget(
  parents: readonly { name: string }[] = COMMAND_PARENTS,
): void {
  const names = parents.map((parent) => parent.name);
  if (new Set(names).size !== names.length) {
    throw new Error("Parent command names must be unique.");
  }
  if (parents.length > PROJECT_PARENT_COMMAND_CEILING) {
    throw new Error(
      `Parent command count ${parents.length} exceeds the project ceiling of ${PROJECT_PARENT_COMMAND_CEILING}.`,
    );
  }
  if (parents.length > DISCORD_GLOBAL_CHAT_INPUT_LIMIT) {
    throw new Error(
      `Parent command count ${parents.length} exceeds Discord's global CHAT_INPUT limit of ${DISCORD_GLOBAL_CHAT_INPUT_LIMIT}.`,
    );
  }
}

export function validateCommandManifest(parents: readonly ParentCommandPlan[] = COMMAND_PARENTS): string[] {
  const errors: string[] = [];
  try {
    assertParentCommandBudget(parents);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Parent budget is invalid.");
  }

  for (const parent of parents) {
    if (!NAME_PATTERN.test(parent.name)) {
      errors.push(`/${parent.name} has an illegal command name.`);
    }
    if (parent.description.length < 1 || parent.description.length > 100) {
      errors.push(`/${parent.name} description must be 1-100 characters.`);
    }
    if (parent.options.length < 1 || parent.options.length > DISCORD_OPTIONS_PER_LEVEL_LIMIT) {
      errors.push(`/${parent.name} has ${parent.options.length} subcommands; the legal range is 1-25.`);
    }
    const names = new Set<string>();
    for (const option of parent.options) {
      if (!NAME_PATTERN.test(option.name)) {
        errors.push(`/${parent.name} ${option.name} has an illegal option name.`);
      }
      if (names.has(option.name)) {
        errors.push(`/${parent.name} repeats option ${option.name}.`);
      }
      names.add(option.name);
      if (option.description.length < 1 || option.description.length > 100) {
        errors.push(`/${parent.name} ${option.name} description must be 1-100 characters.`);
      }
      if (option.options.length > DISCORD_OPTIONS_PER_LEVEL_LIMIT) {
        errors.push(`/${parent.name} ${option.name} exceeds 25 nested options.`);
      }
      const nested = new Set<string>();
      for (const parameter of option.options) {
        if (!NAME_PATTERN.test(parameter.name)) {
          errors.push(`/${parent.name} ${option.name} ${parameter.name} has an illegal option name.`);
        }
        if (nested.has(parameter.name)) {
          errors.push(`/${parent.name} ${option.name} repeats ${parameter.name}.`);
        }
        nested.add(parameter.name);
        if (parameter.description.length < 1 || parameter.description.length > 100) {
          errors.push(`/${parent.name} ${option.name} ${parameter.name} description must be 1-100 characters.`);
        }
        const choices = commandChoices(parent.name, option.name, parameter.name);
        if (!choices) {
          continue;
        }
        if (choices.length < 1 || choices.length > 25) {
          errors.push(`/${parent.name} ${option.name} ${parameter.name} must offer 1-25 choices.`);
        }
        const values = new Set<string>();
        for (const choice of choices) {
          const value = String(choice.value);
          if (choice.name.length < 1 || choice.name.length > 100 || value.length < 1 || value.length > 100) {
            errors.push(`/${parent.name} ${option.name} ${parameter.name} has a choice outside 1-100 characters.`);
          }
          if (values.has(value)) {
            errors.push(`/${parent.name} ${option.name} ${parameter.name} repeats choice ${value}.`);
          }
          values.add(value);
          const numeric = typeof choice.value === "number";
          if (numeric !== (parameter.type === "integer")) {
            errors.push(`/${parent.name} ${option.name} ${parameter.name} choice ${value} does not match the option type.`);
          }
        }
      }
    }
  }
  return errors;
}

const PARAMETER_TYPES: Record<ParameterType, number> = {
  string: 3,
  integer: 4,
  boolean: 5,
  user: 6,
  channel: 7,
  role: 8,
};

export function toDiscordCommandBody(parent: ParentCommandPlan): {
  name: string;
  description: string;
  options: Array<Record<string, unknown>>;
} {
  return {
    name: parent.name,
    description: parent.description,
    options: parent.options.map((option) => ({
      type: 1,
      name: option.name,
      description: option.description,
      options: option.options.map((parameter) => {
        const choices = commandChoices(parent.name, option.name, parameter.name);
        return {
          type: PARAMETER_TYPES[parameter.type],
          name: parameter.name,
          description: parameter.description,
          required: parameter.required,
          ...(choices ? { choices: choices.map((choice) => ({ name: choice.name, value: choice.value })) } : {}),
        };
      }),
    })),
  };
}

export function testGuildCommandsUrl(applicationId: string, guildId: string): string {
  return `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`;
}

export type RegistrationDecision =
  | { action: "setup_required"; reason: string }
  | { action: "refused"; reason: string }
  | { action: "dry_run" }
  | { action: "apply"; guildId: string };

export function decideRegistration(input: {
  apply: boolean;
  guildId?: string;
  testGuildId?: string;
  productionGuildId?: string;
  hasToken: boolean;
  hasApplicationId: boolean;
}): RegistrationDecision {
  const guildId = input.guildId ?? input.testGuildId;
  if (input.productionGuildId && guildId && guildId === input.productionGuildId) {
    return { action: "refused", reason: "Refusing to register commands on the production guild." };
  }
  if (!input.apply) {
    return { action: "dry_run" };
  }
  if (!input.hasToken || !input.hasApplicationId) {
    return { action: "setup_required", reason: "Discord application credentials are not configured." };
  }
  if (!input.testGuildId || !guildId || guildId !== input.testGuildId) {
    return { action: "refused", reason: "Command registration is limited to the configured test guild." };
  }
  if (input.productionGuildId && guildId === input.productionGuildId) {
    return { action: "refused", reason: "Refusing to register commands on the production guild." };
  }
  return { action: "apply", guildId };
}
