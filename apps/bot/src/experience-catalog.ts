import { COMMAND_PARENTS, commandChoices, type CommandParameter } from "@collective/domain";

export const SECTIONS = [
  { name: "Your account", commands: ["verify", "roles", "accounts", "birthday", "invites", "profile", "rank"] },
  { name: "Play & progress", commands: ["character", "combat", "explore", "contracts", "inventory", "leaderboard"] },
  { name: "Markets & games", commands: ["economy", "market", "shop", "lottery", "deaddrop", "blackjack"] },
  { name: "Community", commands: ["events", "schedule", "crew", "prediction", "contest", "giveaway", "support"] },
  { name: "Staff tools", commands: ["setup", "temproles", "mod", "report", "logs", "stats", "publish", "reply", "community", "help"] },
] as const;

export const MODULE_COPY: Record<string, { title: string; description: string }> = {
  help: { title: "The Collective", description: "Find your next move. Browse a section or search for an action." },
  setup: { title: "Server setup", description: "Review configuration, channels and operational diagnostics." },
  verify: { title: "Verification", description: "Complete verification, get accessible help or review a member." },
  roles: { title: "Choose your roles", description: "Browse published role panels and manage your selections." },
  accounts: { title: "Linked accounts", description: "Manage gaming handles, ownership status and visibility." },
  temproles: { title: "Temporary roles", description: "Grant, renew or change a role's expiry with an audit reason." },
  invites: { title: "Recruitment", description: "View your recruitment progress or correct an attribution." },
  birthday: { title: "Birthday settings", description: "Manage your optional birthday, announcements and gift status." },
  mod: { title: "Moderation", description: "Review warnings, cases, sanctions and appeals." },
  report: { title: "Private report", description: "Tell staff what happened. Your report stays private." },
  logs: { title: "Staff logs", description: "Search, export and review log retention. Staff access required." },
  stats: { title: "Staff statistics", description: "Review economy activity and exports. Staff access required." },
  rank: { title: "Community rank", description: "View community progression and your public wallet." },
  economy: { title: "Marks wallet", description: "Check balances, send Marks and view receipts." },
  market: { title: "Ingot exchange", description: "View the market or request a buy or sell quote." },
  leaderboard: { title: "Leaderboards", description: "Browse public rankings and archived seasons." },
  events: { title: "Official events", description: "RSVP, organise an event or manage attendance." },
  schedule: { title: "Event schedule", description: "View upcoming events and manage linked announcements or rooms." },
  crew: { title: "Crews & groups", description: "Build a crew, organise a session or find a group." },
  prediction: { title: "Predictions", description: "Make a free prediction or review the terms of a Marks stake." },
  contest: { title: "Contests", description: "Submit work, cast a ballot or manage a contest." },
  giveaway: { title: "Giveaways", description: "Enter, check bonus entries or manage a draw and claim." },
  publish: { title: "Publications", description: "Open publication tools for drafts, reviews and scheduled posts." },
  reply: { title: "Auto replies", description: "Review reply rules or test a phrase without posting it." },
  lottery: { title: "Lottery", description: "Check the draw, preview ticket costs and review results." },
  contracts: { title: "Contracts", description: "Choose your work, check progress and manage notifications." },
  combat: { title: "Combat", description: "Practise, join a queue, challenge a member or review a battle." },
  character: { title: "Your character", description: "Choose a class, allocate points and manage abilities and loadouts." },
  explore: { title: "Explore", description: "Preview expeditions, play branching missions or assemble a crew." },
  inventory: { title: "Inventory & workshop", description: "Manage gear, crates, materials, trades and crafting." },
  profile: { title: "Your Dossier", description: "Manage your public profile, cosmetics, bio and privacy." },
  shop: { title: "Shops & marketplace", description: "Browse supplies, Ingot offers and member listings." },
  blackjack: { title: "Blackjack", description: "Preview a stake, play a solo or social table and review receipts." },
  deaddrop: { title: "Dead Drop", description: "Inspect the board, preview a paid pick and manage reminders." },
  support: { title: "Support & rooms", description: "Open a ticket, manage temporary rooms or view achievements." },
  community: { title: "Community tools", description: "Manage staff polls, game updates and community settings." },
};

// These lists remove irrelevant options after the action is chosen. A ! marks
// a field required by that action, even when the slash union makes it optional.
export const ACTION_FIELDS: Record<string, Record<string, string>> = {
  "events.manage": { create: "name! host when", edit: "occurrence! name! scope", cancel: "occurrence! scope", transfer: "occurrence! host!", checkin: "occurrence! member", attendance: "occurrence! member!", recap: "occurrence! recap!" },
  "schedule.control": { "link-room": "occurrence!", "link-announcement": "occurrence! target!" },
  "crew.persistent": { create: "name!", officer: "crew! member!", transfer: "crew! member!", disband: "crew!", mission: "crew!" },
  "crew.session": { create: "name! game platform region when size mode crew", join: "session!", approve: "session! member!", ready: "session!", attend: "session! member", room: "session!" },
  "crew.lfg": { list: "", join: "session!" },
  "prediction.free": { create: "title! evidence when points prize", view: "prediction!", enter: "prediction! choice!", confirm: "prediction! choice!", lock: "prediction!", resolve: "prediction! outcome! evidence!", cancel: "prediction!" },
  "prediction.staked": { create: "title! evidence when", view: "prediction!", enter: "prediction! choice! stake!", confirm: "prediction! choice! stake!", resolve: "prediction! outcome! evidence!", cancel: "prediction!", reverse: "prediction! reason!" },
  "contest.judge": { create: "title! mode stock", publish: "contest!", close: "contest!", correct: "contest! entry! reason!", award: "contest! entry! reason" },
  "giveaway.draw": { create: "title! stock!", close: "giveaway!", draw: "giveaway!", claim: "draw!", disqualify: "draw! reason!", reroll: "giveaway! reason!", cancel: "giveaway! reason" },
  "lottery.tickets": { quote: "quantity!", buy: "quote!" },
  "contracts.custom": { create: "title! kind! target reward answer", edit: "objective! title! kind! target reward answer policy", assign: "title! kind! target reward answer board", submit: "assignment! answer!", approve: "assignment!", reject: "assignment! reason!" },
  "combat.queue": { join: "mode stake", leave: "", accept: "match!" },
  "combat.challenge": { offer: "member! mode style stake", accept: "match!", cancel: "match!" },
  "character.respec": { respec: "", class: "class!", intro: "class" },
  "explore.expedition": { preview: "region difficulty", start: "region difficulty item notify", report: "" },
  "explore.mission": { preview: "region", start: "region item notify", choose: "choice!", check: "", fight: "" },
  "inventory.gear": { list: "", equip: "item!", unequip: "item!" },
  "inventory.crates": { list: "", preview: "crate!", open: "crate!" },
  "inventory.trade": { offer: "member! item request marks price", inspect: "trade!", confirm: "trade!", edit: "trade! item request marks price", cancel: "trade!" },
  "inventory.craft": { list: "", preview: "recipe!", make: "recipe!" },
  "inventory.salvage": { preview: "item!", confirm: "item!" },
  "inventory.upgrade": { preview: "item!", apply: "item!" },
  "inventory.reroll": { preview: "item! affix!", apply: "item! affix!" },
  "shop.supply": { browse: "", buy: "offer!" },
  "shop.ingot": { browse: "", buy: "offer!", reveal: "purchase!", refund: "purchase!" },
  "shop.marketplace": { browse: "", list: "item! price!", buy: "listing!", cancel: "listing!" },
  "blackjack.solo": { quote: "stake!", open: "quote!", hit: "table!", stand: "table!", double: "table!", split: "table!" },
  "blackjack.social": { quote: "stake! table", open: "quote!", join: "table! quote!", hit: "table!", stand: "table!", double: "table!", split: "table!" },
  "deaddrop.pick": { quote: "coordinate!", buy: "quote!" },
  "deaddrop.special": { set: "kind! payload reason", activate: "charge!" },
  "support.tickets": { panel: "reason", open: "category! note!", list: "", close: "ticket! reason!", reopen: "ticket! reason!", claim: "ticket! reason!", transfer: "ticket! member! reason!", note: "ticket! note!", message: "ticket! note!", transcript: "ticket! reason!", link: "ticket! kind! case reference reason!" },
  "support.rooms": { create: "name! kind!", join: "room!", leave: "room!", close: "room!", claim: "room!", transfer: "room! member!", hold: "room! name", invite: "room! member!", lock: "room!", rename: "room! name!" },
  "community.polls": { create: "question! choice! kind role anonymous", vote: "poll! choice!", results: "poll!", close: "poll!" },
  "mod.sanctions": { warn: "member! reason! points days", timeout: "member! reason! days", kick: "member! reason!", ban: "member! reason!", note: "member! reason!" },
  "economy.adjust": { add: "member! amount! reason!", remove: "member! amount! reason!", set: "member! amount! reason!", bulk: "member! amount! reason!" },
};

export type Options = Record<string, string | boolean | number>;
export interface Route { parent: string; subcommand: string; options: Options }

export function routeDefinition(route: Route) {
  return COMMAND_PARENTS.find((p) => p.name === route.parent)?.options.find((s) => s.name === route.subcommand && s.name !== "open");
}

export function routeFields(route: Route): CommandParameter[] {
  const definition = routeDefinition(route);
  if (!definition) return [];
  const action = String(route.options["action"] ?? "");
  const fields = ACTION_FIELDS[`${route.parent}.${route.subcommand}`]?.[action];
  if (fields === undefined) return definition.options.filter((o) => o.name !== "action" || !action).map((o) => o.name === "action" ? { ...o, required: true } : o);
  return fields.split(" ").filter(Boolean).flatMap((token) => {
    const name = token.replace("!", "");
    const field = definition.options.find((o) => o.name === name);
    return field ? [{ ...field, required: token.endsWith("!") || field.required }] : [];
  });
}

export function fieldChoices(route: Route, field: CommandParameter): readonly { name: string; value: string | number }[] | undefined {
  return commandChoices(route.parent, route.subcommand, field.name);
}

export function readable(value: string): string {
  return value.replaceAll("_", " ").replaceAll("-", " ").replace(/^\p{L}/u, (c) => c.toUpperCase());
}

export function routeTitle(route: Route): string {
  const action = route.options["action"];
  const label = action === undefined ? "" : commandChoices(route.parent, route.subcommand, "action")?.find((c) => c.value === action)?.name ?? readable(String(action));
  return `${MODULE_COPY[route.parent]?.title ?? readable(route.parent)} · ${label || readable(route.subcommand)}`;
}

const READ_ACTIONS = new Set(["view", "list", "browse", "inspect", "preview", "quote", "report", "results"]);
const READ_ROUTES = new Set(["help.search", "help.actions", "setup.wizard", "setup.diagnostics", "setup.mappings", "verify.captcha", "roles.panel", "accounts.inspect", "invites.progress", "birthday.reminders", "mod.warnings", "logs.search", "logs.settings", "stats.report", "rank.profile", "economy.wallet", "economy.history", "market.chart", "market.pool", "market.buy", "market.sell", "market.quote", "leaderboard.rankings", "leaderboard.archive", "schedule.view", "publish.embed", "publish.review", "publish.announce", "publish.pin", "publish.sticky", "reply.rules", "reply.test", "lottery.draw", "lottery.history", "contracts.board", "contracts.progress", "combat.records", "character.abilities", "inventory.materials", "profile.dossier", "blackjack.receipt", "deaddrop.board", "deaddrop.history", "support.achievements", "community.updates", "community.manage"]);

export function needsConfirmation(route: Route): boolean {
  if (READ_ROUTES.has(`${route.parent}.${route.subcommand}`)) return false;
  const action = String(route.options["action"] ?? "");
  if (READ_ACTIONS.has(action)) return false;
  if (route.parent === "blackjack" && ["hit", "stand"].includes(action)) return false;
  if (route.parent === "mod" && route.subcommand === "cases" && route.options["revoke"] !== true) return false;
  if (route.parent === "character" && ["class", "stats", "loadout"].includes(route.subcommand) && Object.keys(route.options).length === 0) return false;
  if (route.parent === "combat" && route.subcommand === "action") return false;
  if (route.parent === "support" && route.subcommand === "commendations" && !route.options["member"]) return false;
  return true;
}
