import { buttonRow, type OutcomeRow } from "./present.js";

const PATHS: Record<string, { text: string; buttons: Array<{ id: string; label: string }> }> = {
  help: { text: "Search names a command. Actions looks at your sheet and tells you the next honest step.", buttons: [{ id: "go:help:actions", label: "What next" }, { id: "go:setup:wizard", label: "Setup" }] },
  setup: { text: "Diagnostics is the desk. Hours for the lottery and Dead Drop are saved in the admin dashboard. This bot does not invent them.", buttons: [{ id: "go:setup:diagnostics", label: "Diagnostics" }, { id: "go:setup:mappings", label: "Channels" }] },
  verify: { text: "Answer the captcha, or ask staff for help. A help ticket does not verify you.", buttons: [{ id: "go:rank:profile", label: "Your rank" }] },
  roles: { text: "Pick a role the street offers, or clear one you no longer want.", buttons: [{ id: "go:verify:captcha", label: "Verify" }] },
  accounts: { text: "Claim a handle, then decide who can see it.", buttons: [{ id: "go:profile:dossier", label: "Dossier" }] },
  temproles: { text: "A lent role needs a member, a role, a number of days, and a reason.", buttons: [{ id: "go:setup:diagnostics", label: "Diagnostics" }] },
  invites: { text: "Your own count is on progress. Staff correct a link with attribution.", buttons: [{ id: "go:rank:profile", label: "Your rank" }] },
  birthday: { text: "The month is a choice. The day is typed, because a month can have 31 days.", buttons: [{ id: "go:profile:dossier", label: "Dossier" }] },
  mod: { text: "A case needs a member, an action, and a reason. Appeals use the case id.", buttons: [{ id: "go:logs:search", label: "The staff book" }] },
  report: { text: "Say who, and what happened. Staff read it. The channel does not.", buttons: [{ id: "go:support:tickets", label: "A ticket" }] },
  logs: { text: "Search the staff book, or export it with a reason.", buttons: [{ id: "go:stats:report", label: "The till" }] },
  stats: { text: "This is the till, for staff eyes. An export needs a reason.", buttons: [{ id: "go:economy:wallet", label: "The pocket" }] },
  rank: { text: "If there is no life yet, the buttons on this card are the six classes.", buttons: [{ id: "go:character:class", label: "Take a life" }, { id: "go:economy:wallet", label: "The pocket" }] },
  economy: { text: "Wallet, then a transfer or a staff adjustment. Adjust needs a reason.", buttons: [{ id: "go:economy:history", label: "Receipts" }, { id: "go:market:pool", label: "The exchange" }] },
  market: { text: "A quote does not move Ingots until you press Confirm.", buttons: [{ id: "go:market:chart", label: "The chart" }, { id: "go:shop:supply", label: "The shop" }] },
  leaderboard: { text: "Pick a board. The archive is a season that has already closed.", buttons: [{ id: "go:rank:profile", label: "Your rank" }] },
  events: { text: "Manage is for the host. RSVP is whether you are coming.", buttons: [{ id: "go:schedule:view", label: "The schedule" }] },
  schedule: { text: "View is the coming nights. Control links a room or an announcement.", buttons: [{ id: "go:events:manage", label: "Events" }] },
  crew: { text: "Found a crew, then open a session. Looking for a group is the LFG list.", buttons: [{ id: "go:explore:expedition", label: "An expedition" }] },
  prediction: { text: "A free call risks nothing. A staked call holds Marks until it settles.", buttons: [{ id: "go:economy:wallet", label: "The pocket" }] },
  contest: { text: "Submit the work, then a ballot, or staff judging.", buttons: [{ id: "go:giveaway:enter", label: "A giveaway" }] },
  giveaway: { text: "One free entry. Staff close the hat and draw.", buttons: [{ id: "go:contest:submit", label: "A contest" }] },
  publish: { text: "Drafts and review live in the admin editor. This command does not post.", buttons: [{ id: "go:setup:wizard", label: "Setup" }] },
  reply: { text: "Rules are stored. A test tells you which rule would answer. It does not send that answer.", buttons: [{ id: "go:reply:rules", label: "The rules" }] },
  lottery: { text: "Price the tickets before you buy. The draw time stays unset until the admin desk saves one.", buttons: [{ id: "go:lottery:draw", label: "The draw" }, { id: "go:deaddrop:board", label: "Dead Drop" }] },
  deaddrop: { text: "Read the board, then price one cell. The opening hour stays unset until the admin desk saves one.", buttons: [{ id: "go:deaddrop:board", label: "The board" }, { id: "go:lottery:draw", label: "The lottery" }] },
  contracts: { text: "Open the board, then your progress. A reroll is one unstarted daily.", buttons: [{ id: "go:contracts:progress", label: "Progress" }, { id: "go:contracts:board", label: "The board" }] },
  combat: { text: "Practice on the dummy before the queue. A challenge needs another member.", buttons: [{ id: "combat:menu", label: "The floor" }, { id: "go:character:class", label: "Your life" }] },
  character: { text: "Press a life. After that, the points and the abilities.", buttons: [{ id: "go:character:class", label: "The lives" }, { id: "go:combat:action", label: "The floor" }] },
  explore: { text: "Preview an expedition before you start it. Missions branch. Crew missions stay on /crew.", buttons: [{ id: "go:explore:expedition", label: "Preview a job" }, { id: "go:explore:mission", label: "A mission" }] },
  inventory: { text: "Gear first. Crates, craft, salvage, and trades come after you are carrying something.", buttons: [{ id: "go:inventory:gear", label: "Gear" }, { id: "go:shop:supply", label: "The shop" }] },
  profile: { text: "The dossier is what others see. The bio can stay private.", buttons: [{ id: "go:rank:profile", label: "Your rank" }, { id: "go:character:class", label: "Your life" }] },
  shop: { text: "Browse before you buy. A Steam key is not posted in the channel.", buttons: [{ id: "go:shop:supply", label: "The shop" }, { id: "go:shop:marketplace", label: "Listings" }] },
  blackjack: { text: "Price the hand before you open it. The quote does not charge you.", buttons: [{ id: "go:blackjack:receipt", label: "A receipt" }, { id: "go:economy:wallet", label: "The pocket" }] },
  support: { text: "Open a ticket, or a room that does not last. Achievements are the book.", buttons: [{ id: "go:support:tickets", label: "Tickets" }, { id: "go:support:rooms", label: "Rooms" }] },
  community: { text: "Polls are here. Game updates and the community desk are the other two.", buttons: [{ id: "go:community:polls", label: "Polls" }] },
};

const CODES: Record<string, string> = {
  denied: "You are not allowed to do that.",
  missing: "That record was not found.",
  invalid: "That was not accepted.",
  maintenance: "That desk is paused.",
  cooldown: "That is still on cooldown.",
  locked: "That is locked.",
  insufficient: "The balance does not cover it.",
  saved: "That was saved.",
  updated: "That was updated.",
  removed: "That was removed.",
  recorded: "That was recorded.",
  granted: "That was granted.",
  restored: "That was restored.",
  closed: "That was closed.",
  reopened: "That was reopened.",
  claimed: "That was claimed.",
  transferred: "That was transferred.",
  already: "That was already done.",
};

export function spokenCode(result: string): string {
  return CODES[result] ?? `That ended as ${result.replaceAll("_", " ")}.`;
}

export function polish(body: string): string {
  return body
    .replaceAll(" The notice is not posted.", "\n\n-# Nothing was posted in a channel.")
    .replaceAll("The notice is not posted.", "\n\n-# Nothing was posted in a channel.")
    .replaceAll(" Nothing was charged.", "\n\n-# Nothing was charged.")
    .replaceAll("Nothing was charged.", "\n\n-# Nothing was charged.");
}

export function guideReply(
  source: string,
  body: string,
  existing?: ReadonlyArray<OutcomeRow>,
): { body: string; rows?: OutcomeRow[] } {
  const parts = source.split(":");
  const parent = parts[0] === "go" ? (parts[1] ?? "help") : (parts[0] ?? source);
  const path = PATHS[parent];
  const polished = polish(body);
  const already = /\*\*Next\*\*|Press one|on the buttons/i.test(polished);
  const withNext = !path || already ? polished : `${polished}\n\n**Next**\n${path.text}`;
  if (existing && existing.length > 0) {
    return { body: withNext, rows: [...existing] };
  }
  if (!path || path.buttons.length === 0) {
    return { body: withNext };
  }
  return { body: withNext, rows: [buttonRow(path.buttons)] };
}
