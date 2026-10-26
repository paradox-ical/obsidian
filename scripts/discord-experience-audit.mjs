import { readdir, writeFile } from "node:fs/promises";
import { COMMAND_PARENTS, commandChoices, validateCommandManifest } from "../packages/domain/dist/index.js";
import { catalogProblems } from "../apps/bot/dist/experience.js";

const handlers = {
  "activity-flow.ts": "prediction, contest, giveaway",
  "blackjack-flow.ts": "blackjack",
  "character-flow.ts": "character",
  "combat-flow.ts": "combat, inventory gear",
  "community-flow.ts": "verify, roles, accounts, temproles; role buttons, role selects, reactions, CAPTCHA",
  "contract-flow.ts": "contracts",
  "dead-drop-flow.ts": "deaddrop",
  "desk-flow.ts": "help, setup, reply",
  "economy-flow.ts": "economy, stats",
  "explore-flow.ts": "explore expeditions and solo missions",
  "gathering-flow.ts": "events, schedule, crew, explore crew missions",
  "lottery-flow.ts": "lottery",
  "market-flow.ts": "market and persisted quote confirmations",
  "moderation-flow.ts": "mod, report, logs",
  "progression-flow.ts": "rank, profile, birthday, invites",
  "publish-flow.ts": "publish and review controls/modal submissions",
  "season-flow.ts": "leaderboard, community, support rooms",
  "shop-flow.ts": "shop supply and ingot, inventory crates",
  "ticket-flow.ts": "support tickets, achievements and commendations",
  "workshop-flow.ts": "inventory workshop and trades, shop marketplace",
};
const files = await readdir(new URL("../apps/bot/src/", import.meta.url));
const errors = [...validateCommandManifest(), ...catalogProblems()];
for (const file of files.filter((name) => name.endsWith("-flow.ts"))) if (!handlers[file]) errors.push(`Unreviewed flow: ${file}`);
if (errors.length) throw new Error(errors.join("\n"));
const routes = COMMAND_PARENTS.flatMap((p) => p.options.filter((s) => s.name !== "open").map((s) => ({ parent: p.name, sub: s.name, choices: commandChoices(p.name, s.name, "action") })));
const actionCount = routes.reduce((sum, r) => sum + (r.choices?.length ?? 1), 0);
const report = [
  "# Discord experience coverage", "",
  "Generated with `npm run experience:audit` after `npm run build`. This is a source and local-test coverage inventory, not proof of live Discord delivery.", "",
  `Coverage: **${COMMAND_PARENTS.length} parent commands**, **${routes.length} existing subcommands**, **${actionCount} routes/action variants**, plus one guided \`open\` entry per parent. All existing slash names and option keys remain available.`, "",
  "## Commands and action variants", "",
  "| Parent | Existing subcommands and action variants | Guided entry |", "|---|---|---|",
  ...COMMAND_PARENTS.map((p) => `| /${p.name} | ${routes.filter((r) => r.parent === p.name).map((r) => `${r.sub}${r.choices ? ` (${r.choices.map((c) => c.value).join(', ')})` : ''}`).join('; ')} | /${p.name} open |`),
  "", "## Existing handler coverage", "", "| Handler | Surface |", "|---|---|",
  ...Object.entries(handlers).map(([file, surface]) => `| ${file} | ${surface} |`),
  "", "## Interaction and delivery coverage", "",
  "| Surface | Experience and preserved boundary |", "|---|---|",
  "| Slash commands and go shortcuts | Shared guided catalog, result navigation and pagination; existing handler executes every action. |",
  "| Class and combat buttons | Existing parsers and services, clear labels, live battle turns do not require redundant confirmation. |",
  "| Market confirmation | Existing saved quote, expiry, ownership and price checks. |",
  "| Role buttons, selects and reactions | Existing entitlement and prerequisite service; multi-panel selection no longer needs a typed panel name. |",
  "| Ticket category buttons | Guided category/details collection, then existing ticket service and private channel delivery. |",
  "| Publication edit, approve, changes and cancel | Original draft/revision and permissions preserved; existing approval and feedback modals retained. |",
  "| CAPTCHA button/modal | Existing challenge, cooldown and answer service; CAPTCHA now displayed as an image. |",
  "| Guided action, value, resume, review, confirm, edit and cancel controls | Persisted actor/guild/config-revision/expiry checks and atomic one-use consumption. No collectors. |",
  "| Native user, role and channel selects | Native Discord choices; target roles and hierarchy refreshed before existing handler execution. |",
  "| Guided text/numeric modals | Validated typed values; invalid input can be corrected without consuming the form. |",
  "| Help autocomplete | Public command metadata only, at most 25 choices, no service mutation or private record lookup. |",
  "| Long results and page buttons | Persisted complete text, private reader binding, no silent truncation. |",
  "| Blackjack hand controls | Visible own cards, total, stake, turn and receipt; hidden dealer card and other players' hands stay hidden. Double and split review extra cost. |",
  "| Moderation alerts, birthdays, ticket inactivity reminders, room closure warnings and verification assistance | All five implemented worker message POST paths use the same branded card renderer and retain no-mention policy and original destinations. |",
  "| Publications, recurring announcements, pins, stickies and replies | Authored content/formatting and versioning preserved. Command outcomes use the shared renderer; existing setup-required delivery adapters remain setup-required. |",
  "| Event, contract, expedition, mission, game, shop and other persisted notices without a live delivery adapter | Existing state, schedules, privacy and failure status preserved. No fake sent status and no new delivery implementation. |",
  "| Unknown, denied, expired, failed and stale outcomes | Clear recovery path; uncertain exceptions tell the member to inspect current state before retrying. |",
  "", "## Verification limits", "",
  "Local unit tests cover catalog completeness, contextual fields, confirmation, cancellation, duplicate clicks, actor/guild/expiry boundaries, invalid modal corrections, private/public message routing, autocomplete, pagination, notifications, currency precision and session compare-and-set. Existing economy/domain tests remain in the suite.", "",
  "No live token, named test-guild registration, guild mutation, production deployment or new database migration is part of this change. A live test-guild pass remains required to verify rendering, attachments, modal timing, permissions, long messages and all families against real persisted records.", "",
].join("\n");
await writeFile(new URL("../docs/DISCORD_EXPERIENCE_COVERAGE.md", import.meta.url), report);
process.stdout.write(`Audited ${COMMAND_PARENTS.length} parents, ${routes.length} subcommands, ${actionCount} action variants and ${Object.keys(handlers).length} flow handlers.\n`);
