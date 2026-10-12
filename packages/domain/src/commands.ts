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

function command(name: string, summary: string, actions: Array<string | Subcommand>): ParentCommandPlan {
  return {
    name,
    summary,
    description: summary.length <= 100 ? summary : `${summary.slice(0, 97)}...`,
    options: actions.map((action) =>
      typeof action === "string"
        ? { name: action, description: `Open the ${action.replaceAll("_", " ")} panel`, options: [] }
        : action,
    ),
  };
}

/**
 * Routing manifest. Panels carry the detailed flows. Nothing here is registered
 * until the explicit test-guild tool is run.
 */
export const COMMAND_PARENTS: readonly ParentCommandPlan[] = [
  command("help", "Searchable module help and personal available actions", ["search", "actions"]),
  command("setup", "Admin wizard, diagnostics, and channel or role mappings", ["wizard", "diagnostics", "mappings"]),
  command("verify", "CAPTCHA and assistance", [
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
  command("roles", "Onboarding-related and extra opt-in panels", [
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
  command("accounts", "Link, inspect, privacy, and unlink", [
    {
      name: "link",
      description: "Save a self-reported handle",
      options: [
        { name: "provider", description: "Account provider", type: "string", required: true },
        { name: "handle", description: "Handle you claim", type: "string", required: true },
      ],
    },
    { name: "inspect", description: "Show your linked accounts", options: [] },
    {
      name: "privacy",
      description: "Set account visibility",
      options: [
        { name: "provider", description: "Account provider", type: "string", required: true },
        { name: "visibility", description: "public or private", type: "string", required: true },
      ],
    },
    {
      name: "unlink",
      description: "Remove one linked account",
      options: [{ name: "provider", description: "Account provider", type: "string", required: true }],
    },
  ]),
  command("temproles", "Staff grants, renewals, and expiry", [
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
  command("invites", "Own recruitment progress and staff attribution controls", [
    { name: "progress", description: "Show your qualified recruitment count", options: [] },
    {
      name: "attribution",
      description: "Correct an invite attribution",
      options: [
        { name: "member", description: "Recruited member", type: "user", required: true },
        { name: "confidence", description: "known, unknown, vanity, or ambiguous", type: "string", required: true },
        { name: "reason", description: "Audit reason", type: "string", required: true },
      ],
    },
  ]),
  command("birthday", "Set date, privacy, and reminders", [
    {
      name: "set",
      description: "Save an opt-in birthday",
      options: [
        { name: "month", description: "Month number", type: "integer", required: true },
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
  command("mod", "Sanctions, warnings, cases, and appeals administration", [
    {
      name: "sanctions",
      description: "Apply a manual sanction",
      options: [
        { name: "member", description: "Member to review", type: "user", required: true },
        { name: "action", description: "warn, timeout, kick, ban, or note", type: "string", required: true },
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
  command("report", "Private member report", [
    {
      name: "submit",
      description: "Send a private report to staff",
      options: [
        { name: "member", description: "Member to report", type: "user", required: true },
        { name: "note", description: "What happened", type: "string", required: true },
      ],
    },
  ]),
  command("logs", "Staff search, export, and settings", [
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
  command("stats", "Staff-only reporting", [
    { name: "report", description: "Show economy issuance and sinks", options: [] },
    {
      name: "export",
      description: "Export the economy report",
      options: [{ name: "reason", description: "Audit reason", type: "string", required: true }],
    },
  ]),
  command("rank", "Community XP and rank", [
    { name: "profile", description: "Show community level and the public wallet", options: [] },
  ]),
  command("economy", "Wallet, transfers, ledger history, and staff adjustments", [
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
      description: "Staff add, remove, set, or bulk grant",
      options: [
        { name: "action", description: "add, remove, set, or bulk", type: "string", required: true },
        { name: "member", description: "Member to adjust", type: "user", required: true },
        { name: "amount", description: "Whole Marks", type: "integer", required: true },
        { name: "reason", description: "Audit reason", type: "string", required: true },
      ],
    },
  ]),
  command("market", "Ingot chart, pool, quote, buy, and sell", [
    { name: "chart", description: "Show recent Ingot exchange prices", options: [] },
    { name: "pool", description: "Show inventory and the next unit price", options: [] },
    {
      name: "quote",
      description: "Price a buy or sell",
      options: [
        { name: "side", description: "buy or sell", type: "string", required: true },
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
  command("leaderboard", "Member-facing rankings and season archive", [
    {
      name: "rankings",
      description: "Show a public leaderboard page",
      options: [
        { name: "category", description: "Ranking category", type: "string", required: false },
        { name: "page", description: "Page number", type: "integer", required: false },
      ],
    },
    {
      name: "archive",
      description: "Show an archived season",
      options: [
        { name: "season", description: "Season id", type: "string", required: false },
        { name: "category", description: "Ranking category", type: "string", required: false },
      ],
    },
  ]),
  command("events", "Official event management and RSVP", [
    {
      name: "manage",
      description: "Create, edit, cancel, transfer, check in, or recap an official event",
      options: [
        { name: "action", description: "create, edit, cancel, transfer, checkin, attendance, or recap", type: "string", required: true },
        { name: "name", description: "Event name", type: "string", required: false },
        { name: "occurrence", description: "Occurrence id", type: "string", required: false },
        { name: "host", description: "Host user id", type: "string", required: false },
        { name: "scope", description: "occurrence or series", type: "string", required: false },
        { name: "when", description: "ISO start time for a one-off event", type: "string", required: false },
        { name: "recap", description: "Recap text", type: "string", required: false },
        { name: "member", description: "Member user id", type: "string", required: false },
      ],
    },
    {
      name: "rsvp",
      description: "RSVP yes, maybe, or no",
      options: [
        { name: "occurrence", description: "Occurrence id", type: "string", required: true },
        { name: "response", description: "yes, maybe, or no", type: "string", required: true },
      ],
    },
  ]),
  command("schedule", "Event schedule and authorised scheduling controls", [
    { name: "view", description: "Show the upcoming official schedule", options: [] },
    {
      name: "control",
      description: "Link an announcement or temporary room without a second job",
      options: [
        { name: "action", description: "link-room or link-announcement", type: "string", required: true },
        { name: "occurrence", description: "Occurrence id", type: "string", required: true },
        { name: "target", description: "Announcement series id", type: "string", required: false },
      ],
    },
  ]),
  command("crew", "Persistent crews, sessions, and LFG", [
    {
      name: "persistent",
      description: "Create a crew, appoint an officer, transfer, or disband",
      options: [
        { name: "action", description: "create, officer, transfer, disband, or mission", type: "string", required: true },
        { name: "name", description: "Crew name", type: "string", required: false },
        { name: "crew", description: "Crew id", type: "string", required: false },
        { name: "member", description: "Member user id", type: "string", required: false },
      ],
    },
    {
      name: "session",
      description: "Open a session, join, approve, ready, attend, or request a room",
      options: [
        { name: "action", description: "create, join, approve, ready, attend, or room", type: "string", required: true },
        { name: "crew", description: "Persistent crew id", type: "string", required: false },
        { name: "session", description: "Session id", type: "string", required: false },
        { name: "name", description: "Session name", type: "string", required: false },
        { name: "game", description: "Game", type: "string", required: false },
        { name: "platform", description: "Platform", type: "string", required: false },
        { name: "region", description: "Region", type: "string", required: false },
        { name: "when", description: "ISO start time", type: "string", required: false },
        { name: "size", description: "Session size", type: "integer", required: false },
        { name: "mode", description: "open or approval", type: "string", required: false },
        { name: "member", description: "Member user id", type: "string", required: false },
      ],
    },
    {
      name: "lfg",
      description: "List open sessions or join one",
      options: [
        { name: "action", description: "list or join", type: "string", required: true },
        { name: "session", description: "Session id", type: "string", required: false },
      ],
    },
  ]),
  command("prediction", "Free and staked predictions", [
    {
      name: "free",
      description: "Open, enter, lock, or resolve a free prediction",
      options: [
        { name: "action", description: "create, view, enter, confirm, lock, resolve, or cancel", type: "string", required: true },
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
      description: "Open, escrow, resolve, refund, or reverse a staked pool",
      options: [
        { name: "action", description: "create, view, enter, confirm, resolve, cancel, or reverse", type: "string", required: true },
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
  command("contest", "Submissions, ballots, and judging", [
    {
      name: "submit",
      description: "Submit or edit an entry before the deadline",
      options: [
        { name: "contest", description: "Contest id", type: "string", required: true },
        { name: "title", description: "Entry title", type: "string", required: true },
        { name: "media", description: "text, image, video, audio, or link", type: "string", required: true },
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
      description: "Create, publish, close, correct, or award a contest",
      options: [
        { name: "action", description: "create, publish, close, correct, or award", type: "string", required: true },
        { name: "title", description: "Contest title", type: "string", required: false },
        { name: "contest", description: "Contest id", type: "string", required: false },
        { name: "mode", description: "vote or judge", type: "string", required: false },
        { name: "entry", description: "Entry id", type: "string", required: false },
        { name: "reason", description: "Correction reason", type: "string", required: false },
        { name: "stock", description: "Prize stock id", type: "string", required: false },
      ],
    },
  ]),
  command("giveaway", "Entry, bonuses, and staff draw controls", [
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
      description: "Close, draw, claim, disqualify, or reroll",
      options: [
        { name: "action", description: "create, close, draw, claim, disqualify, reroll, or cancel", type: "string", required: true },
        { name: "title", description: "Giveaway title", type: "string", required: false },
        { name: "giveaway", description: "Giveaway id", type: "string", required: false },
        { name: "reason", description: "Audit reason", type: "string", required: false },
        { name: "stock", description: "Prize stock id", type: "string", required: false },
        { name: "draw", description: "Draw id", type: "string", required: false },
      ],
    },
  ]),
  command("publish", "Embeds, review, announcements, pins, and stickies", ["embed", "review", "announce", "pin", "sticky"]),
  command("reply", "Authorised auto-reply rules and test", ["rules", "test"]),
  command("lottery", "Tickets, current draw, and history", [
    {
      name: "tickets",
      description: "Quote or buy tickets for the open draw",
      options: [
        { name: "action", description: "quote or buy", type: "string", required: true },
        { name: "quantity", description: "Number of tickets", type: "integer", required: false },
        { name: "quote", description: "Quote id to buy", type: "string", required: false },
      ],
    },
    { name: "draw", description: "Show odds, bonus, deadline, and the stall refund", options: [] },
    { name: "history", description: "Show settled draws", options: [] },
  ]),
  command("contracts", "Board, progress, reroll, settings, and staff custom contracts", [
    { name: "board", description: "Show this cycle's contracts", options: [{ name: "cycle", description: "daily, weekly, or monthly", type: "string", required: false }] },
    { name: "progress", description: "Show progress, deadline, and rewards", options: [] },
    { name: "reroll", description: "Reroll one unstarted daily contract", options: [{ name: "assignment", description: "Assignment id", type: "string", required: true }] },
    {
      name: "settings",
      description: "Choose refresh notices and completion pings",
      options: [
        { name: "pings", description: "Mention completions in the channel", type: "boolean", required: false },
        { name: "delivery", description: "dm or channel", type: "string", required: false },
        { name: "channel", description: "Channel for opted-in notices", type: "string", required: false },
        { name: "daily", description: "Daily refresh notice", type: "boolean", required: false },
        { name: "weekly", description: "Weekly refresh notice", type: "boolean", required: false },
        { name: "monthly", description: "Monthly refresh notice", type: "boolean", required: false },
      ],
    },
    {
      name: "custom",
      description: "Author, submit, or approve a contract",
      options: [
        { name: "action", description: "create, edit, assign, submit, approve, or reject", type: "string", required: true },
        { name: "title", description: "Objective title", type: "string", required: false },
        { name: "kind", description: "Objective kind", type: "string", required: false },
        { name: "objective", description: "Objective id", type: "string", required: false },
        { name: "assignment", description: "Assignment id", type: "string", required: false },
        { name: "answer", description: "Riddle answer or submission", type: "string", required: false },
        { name: "reason", description: "Audit reason", type: "string", required: false },
        { name: "policy", description: "preserve or migrate", type: "string", required: false },
        { name: "target", description: "Progress target", type: "integer", required: false },
        { name: "reward", description: "Reward in Marks", type: "integer", required: false },
        { name: "board", description: "daily, weekly, or monthly", type: "string", required: false },
      ],
    },
  ]),
  command("combat", "Test duels, battle actions, and records", [
    {
      name: "queue",
      description: "Join or leave a casual or ranked queue",
      options: [
        { name: "action", description: "join, leave, or accept", type: "string", required: true },
        { name: "mode", description: "casual or ranked", type: "string", required: false },
        { name: "stake", description: "Equal Marks stake, or zero", type: "integer", required: false },
        { name: "match", description: "Match id for a casual proposal", type: "string", required: false },
      ],
    },
    {
      name: "challenge",
      description: "Offer, accept, or cancel a direct match",
      options: [
        { name: "action", description: "offer, accept, or cancel", type: "string", required: true },
        { name: "member", description: "Opponent user id", type: "string", required: false },
        { name: "mode", description: "casual or ranked", type: "string", required: false },
        { name: "stake", description: "Equal Marks stake, or zero", type: "integer", required: false },
        { name: "match", description: "Match id", type: "string", required: false },
        { name: "style", description: "quick or tactical", type: "string", required: false },
      ],
    },
    {
      name: "action",
      description: "Fight a test opponent",
      options: [
        { name: "mode", description: "quick or tactical", type: "string", required: true },
        { name: "opponent", description: "Test opponent slug", type: "string", required: false },
        { name: "battle", description: "Battle id", type: "string", required: false },
        { name: "move", description: "strike, defend, ability, or item", type: "string", required: false },
      ],
    },
    { name: "records", description: "Show a battle record", options: [{ name: "battle", description: "Battle id", type: "string", required: false }] },
  ]),
  command("character", "Class, stats, abilities, respec, and loadouts", [
    { name: "class", description: "Choose or inspect a class", options: [{ name: "class", description: "Class slug", type: "string", required: false }] },
    {
      name: "stats",
      description: "Show or spend stat points",
      options: [
        { name: "stat", description: "strength, agility, endurance, or focus", type: "string", required: false },
        { name: "points", description: "Points to allocate", type: "integer", required: false },
      ],
    },
    { name: "abilities", description: "Show abilities, cooldowns, and formulas", options: [] },
    {
      name: "respec",
      description: "Respec, change class, or use the intro reset",
      options: [
        { name: "action", description: "respec, class, or intro", type: "string", required: true },
        { name: "class", description: "Class slug", type: "string", required: false },
      ],
    },
    {
      name: "loadout",
      description: "Equip up to four active abilities",
      options: [
        { name: "slot", description: "Slot from 1 to 4", type: "integer", required: false },
        { name: "ability", description: "Ability slug", type: "string", required: false },
      ],
    },
  ]),
  command("explore", "Expeditions, interactive missions, and crew missions", [
    {
      name: "expedition",
      description: "Preview or start one timed expedition",
      options: [
        { name: "action", description: "preview, start, or report", type: "string", required: true },
        { name: "region", description: "backstreets, black-docks, or inner-sanctum", type: "string", required: false },
        { name: "difficulty", description: "routine, standard, or severe", type: "string", required: false },
        { name: "item", description: "Gear instance to reserve", type: "string", required: false },
        { name: "notify", description: "Store a completion report notice", type: "boolean", required: false },
      ],
    },
    {
      name: "mission",
      description: "Play a branching mission",
      options: [
        { name: "action", description: "preview, start, choose, check, or fight", type: "string", required: true },
        { name: "choice", description: "Choice id", type: "string", required: false },
        { name: "region", description: "backstreets or black-docks", type: "string", required: false },
        { name: "item", description: "Gear instance to reserve", type: "string", required: false },
        { name: "notify", description: "Store a completion notice", type: "boolean", required: false },
      ],
    },
    { name: "crew", description: "Crew missions stay on the crew command", options: [] },
  ]),
  command("inventory", "Gear, materials, crates, trade, crafting, salvage, and upgrades", [
    {
      name: "gear",
      description: "Inspect or equip gear",
      options: [
        { name: "action", description: "list, equip, or unequip", type: "string", required: false },
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
        { name: "action", description: "list, preview, or open", type: "string", required: true },
        { name: "crate", description: "Crate table or grant id", type: "string", required: false },
      ],
    },
    {
      name: "trade",
      description: "Offer, inspect, confirm, edit, or cancel a trade",
      options: [
        { name: "action", description: "offer, inspect, confirm, edit, or cancel", type: "string", required: true },
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
        { name: "action", description: "list, preview, or make", type: "string", required: true },
        { name: "recipe", description: "Recipe slug", type: "string", required: false },
      ],
    },
    {
      name: "salvage",
      description: "Preview or confirm salvage",
      options: [
        { name: "action", description: "preview or confirm", type: "string", required: true },
        { name: "item", description: "Gear instance id", type: "string", required: false },
      ],
    },
    {
      name: "upgrade",
      description: "Preview or apply a guaranteed upgrade",
      options: [
        { name: "action", description: "preview or apply", type: "string", required: true },
        { name: "item", description: "Gear instance id", type: "string", required: false },
      ],
    },
    {
      name: "reroll",
      description: "Preview or replace one affix",
      options: [
        { name: "action", description: "preview or apply", type: "string", required: true },
        { name: "item", description: "Gear instance id", type: "string", required: false },
        { name: "affix", description: "Affix slug to replace", type: "string", required: false },
      ],
    },
  ]),
  command("profile", "Dossier, cosmetics, privacy, and preferences", [
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
      options: [{ name: "visibility", description: "public or private", type: "string", required: true }],
    },
    {
      name: "preferences",
      description: "Save a private bio",
      options: [{ name: "bio", description: "Profile bio", type: "string", required: false }],
    },
  ]),
  command("shop", "Supply, Ingot, and member marketplace", [
    {
      name: "supply",
      description: "Browse or buy the Marks supply shop",
      options: [
        { name: "action", description: "browse or buy", type: "string", required: true },
        { name: "offer", description: "Offer slug", type: "string", required: false },
      ],
    },
    {
      name: "ingot",
      description: "Browse, buy, reveal, or refund an Ingot purchase",
      options: [
        { name: "action", description: "browse, buy, reveal, or refund", type: "string", required: true },
        { name: "offer", description: "Offer slug", type: "string", required: false },
        { name: "purchase", description: "Purchase id", type: "string", required: false },
      ],
    },
    {
      name: "marketplace",
      description: "List, buy, or cancel a fixed-price listing",
      options: [
        { name: "action", description: "browse, list, buy, or cancel", type: "string", required: true },
        { name: "item", description: "Gear instance id", type: "string", required: false },
        { name: "price", description: "Fixed Marks price", type: "integer", required: false },
        { name: "listing", description: "Listing id", type: "string", required: false },
      ],
    },
  ]),
  command("blackjack", "Solo and social tables", [
    {
      name: "solo",
      description: "Quote, open, or play a solo hand",
      options: [
        { name: "action", description: "quote, open, hit, stand, double, or split", type: "string", required: true },
        { name: "stake", description: "Stake in Marks", type: "integer", required: false },
        { name: "quote", description: "Quote id to open", type: "string", required: false },
        { name: "table", description: "Table id", type: "string", required: false },
      ],
    },
    {
      name: "social",
      description: "Quote, open, join, or play a social hand",
      options: [
        { name: "action", description: "quote, open, join, hit, stand, double, or split", type: "string", required: true },
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
  command("deaddrop", "Board, paid pick, and staff special boards", [
    { name: "board", description: "Show the shared board, jackpot, and picks left", options: [] },
    {
      name: "pick",
      description: "Quote or buy one covered cell",
      options: [
        { name: "action", description: "quote or buy", type: "string", required: true },
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
        { name: "action", description: "set or activate", type: "string", required: true },
        { name: "kind", description: "collapse, gear, crate, clue, or clear", type: "string", required: false },
        { name: "payload", description: "Quantity, slug, or clue", type: "string", required: false },
        { name: "charge", description: "Charge id to activate", type: "string", required: false },
        { name: "reason", description: "Audit reason", type: "string", required: false },
      ],
    },
  ]),
  command("support", "Tickets, temporary rooms, achievements, and commendations", [
    {
      name: "tickets",
      description: "Open or manage a private support ticket",
      options: [
        { name: "action", description: "open, list, close, reopen, claim, transfer, note, transcript, or link", type: "string", required: true },
        { name: "category", description: "Ticket category", type: "string", required: false },
        { name: "ticket", description: "Ticket id", type: "string", required: false },
        { name: "note", description: "Form answer or message", type: "string", required: false },
        { name: "member", description: "Staff member to assign", type: "user", required: false },
        { name: "reason", description: "Audit reason", type: "string", required: false },
        { name: "case", description: "Moderation case id", type: "string", required: false },
        { name: "reference", description: "Purchase or reward id", type: "string", required: false },
        { name: "kind", description: "moderation_case, purchase, or reward", type: "string", required: false },
      ],
    },
    {
      name: "rooms",
      description: "Create or manage a temporary room",
      options: [
        { name: "action", description: "create, join, leave, close, claim, transfer, or hold", type: "string", required: true },
        { name: "kind", description: "voice or text", type: "string", required: false },
        { name: "name", description: "Room name", type: "string", required: false },
        { name: "room", description: "Room id", type: "string", required: false },
        { name: "member", description: "Member to invite or transfer to", type: "user", required: false },
      ],
    },
    "achievements",
    "commendations",
  ]),
  command("community", "Staff polls, game updates, and authorised management", [
    {
      name: "polls",
      description: "Create or vote in a staff poll",
      options: [
        { name: "action", description: "create, vote, results, or close", type: "string", required: true },
        { name: "question", description: "Poll question", type: "string", required: false },
        { name: "choice", description: "Choice labels or a choice id", type: "string", required: false },
        { name: "poll", description: "Poll id", type: "string", required: false },
        { name: "kind", description: "single, multiple, or suggestion", type: "string", required: false },
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
      options: option.options.map((parameter) => ({
        type: PARAMETER_TYPES[parameter.type],
        name: parameter.name,
        description: parameter.description,
        required: parameter.required,
      })),
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
