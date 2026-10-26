# Discord experience coverage

Generated with `npm run experience:audit` after `npm run build`. This is a source and local-test coverage inventory, not proof of live Discord delivery.

Coverage: **36 parent commands**, **116 existing subcommands**, **235 routes/action variants**, plus one guided `open` entry per parent. All existing slash names and option keys remain available.

## Commands and action variants

| Parent | Existing subcommands and action variants | Guided entry |
|---|---|---|
| /help | search; actions | /help open |
| /setup | wizard; diagnostics; mappings | /setup open |
| /verify | captcha; assistance; review | /verify open |
| /roles | panel; optin | /roles open |
| /accounts | link; inspect; privacy; unlink | /accounts open |
| /temproles | grant; renew; expire | /temproles open |
| /invites | progress; attribution | /invites open |
| /birthday | set; privacy; reminders; remove | /birthday open |
| /mod | sanctions (warn, timeout, kick, ban, note); warnings; cases; appeals | /mod open |
| /report | submit | /report open |
| /logs | search; export; settings | /logs open |
| /stats | report; export | /stats open |
| /rank | profile | /rank open |
| /economy | wallet; transfer; history; adjust (add, remove, set, bulk) | /economy open |
| /market | chart; pool; quote; buy; sell | /market open |
| /leaderboard | rankings; archive | /leaderboard open |
| /events | manage (create, edit, cancel, transfer, checkin, attendance, recap); rsvp | /events open |
| /schedule | view; control (link-room, link-announcement) | /schedule open |
| /crew | persistent (create, officer, transfer, disband, mission); session (create, join, approve, ready, attend, room); lfg (list, join) | /crew open |
| /prediction | free (create, view, enter, confirm, lock, resolve, cancel); staked (create, view, enter, confirm, resolve, cancel, reverse) | /prediction open |
| /contest | submit; ballot; judge (create, publish, close, correct, award) | /contest open |
| /giveaway | enter; bonus; draw (create, close, draw, claim, disqualify, reroll, cancel) | /giveaway open |
| /publish | embed; review; announce; pin; sticky | /publish open |
| /reply | rules; test | /reply open |
| /lottery | tickets (quote, buy); draw; history | /lottery open |
| /contracts | board; progress; reroll; settings; custom (create, edit, assign, submit, approve, reject) | /contracts open |
| /combat | queue (join, leave, accept); challenge (offer, accept, cancel); action; records | /combat open |
| /character | class; stats; abilities; respec (respec, class, intro); loadout | /character open |
| /explore | expedition (preview, start, report); mission (preview, start, choose, check, fight); crew | /explore open |
| /inventory | gear (list, equip, unequip); materials; crates (list, preview, open); trade (offer, inspect, confirm, edit, cancel); craft (list, preview, make); salvage (preview, confirm); upgrade (preview, apply); reroll (preview, apply) | /inventory open |
| /profile | dossier; cosmetics; privacy; preferences | /profile open |
| /shop | supply (browse, buy); ingot (browse, buy, reveal, refund); marketplace (browse, list, buy, cancel) | /shop open |
| /blackjack | solo (quote, open, hit, stand, double, split); social (quote, open, join, hit, stand, double, split); receipt | /blackjack open |
| /deaddrop | board; pick (quote, buy); reminder; special (set, activate) | /deaddrop open |
| /support | tickets (panel, open, list, close, reopen, claim, transfer, note, message, transcript, link); rooms (create, join, leave, close, claim, transfer, hold, invite, lock, rename); achievements; commendations | /support open |
| /community | polls (create, vote, results, close); updates; manage | /community open |

## Existing handler coverage

| Handler | Surface |
|---|---|
| activity-flow.ts | prediction, contest, giveaway |
| blackjack-flow.ts | blackjack |
| character-flow.ts | character |
| combat-flow.ts | combat, inventory gear |
| community-flow.ts | verify, roles, accounts, temproles; role buttons, role selects, reactions, CAPTCHA |
| contract-flow.ts | contracts |
| dead-drop-flow.ts | deaddrop |
| desk-flow.ts | help, setup, reply |
| economy-flow.ts | economy, stats |
| explore-flow.ts | explore expeditions and solo missions |
| gathering-flow.ts | events, schedule, crew, explore crew missions |
| lottery-flow.ts | lottery |
| market-flow.ts | market and persisted quote confirmations |
| moderation-flow.ts | mod, report, logs |
| progression-flow.ts | rank, profile, birthday, invites |
| publish-flow.ts | publish and review controls/modal submissions |
| season-flow.ts | leaderboard, community, support rooms |
| shop-flow.ts | shop supply and ingot, inventory crates |
| ticket-flow.ts | support tickets, achievements and commendations |
| workshop-flow.ts | inventory workshop and trades, shop marketplace |

## Interaction and delivery coverage

| Surface | Experience and preserved boundary |
|---|---|
| Slash commands and go shortcuts | Shared guided catalog, result navigation and pagination; existing handler executes every action. |
| Class and combat buttons | Existing parsers and services, clear labels, live battle turns do not require redundant confirmation. |
| Market confirmation | Existing saved quote, expiry, ownership and price checks. |
| Role buttons, selects and reactions | Existing entitlement and prerequisite service; multi-panel selection no longer needs a typed panel name. |
| Ticket category buttons | Guided category/details collection, then existing ticket service and private channel delivery. |
| Publication edit, approve, changes and cancel | Original draft/revision and permissions preserved; existing approval and feedback modals retained. |
| CAPTCHA button/modal | Existing challenge, cooldown and answer service; CAPTCHA now displayed as an image. |
| Guided action, value, resume, review, confirm, edit and cancel controls | Persisted actor/guild/config-revision/expiry checks and atomic one-use consumption. No collectors. |
| Native user, role and channel selects | Native Discord choices; target roles and hierarchy refreshed before existing handler execution. |
| Guided text/numeric modals | Validated typed values; invalid input can be corrected without consuming the form. |
| Help autocomplete | Public command metadata only, at most 25 choices, no service mutation or private record lookup. |
| Long results and page buttons | Persisted complete text, private reader binding, no silent truncation. |
| Blackjack hand controls | Visible own cards, total, stake, turn and receipt; hidden dealer card and other players' hands stay hidden. Double and split review extra cost. |
| Moderation alerts, birthdays, ticket inactivity reminders, room closure warnings and verification assistance | All five implemented worker message POST paths use the same branded card renderer and retain no-mention policy and original destinations. |
| Publications, recurring announcements, pins, stickies and replies | Authored content/formatting and versioning preserved. Command outcomes use the shared renderer; existing setup-required delivery adapters remain setup-required. |
| Event, contract, expedition, mission, game, shop and other persisted notices without a live delivery adapter | Existing state, schedules, privacy and failure status preserved. No fake sent status and no new delivery implementation. |
| Unknown, denied, expired, failed and stale outcomes | Clear recovery path; uncertain exceptions tell the member to inspect current state before retrying. |

## Verification limits

Local unit tests cover catalog completeness, contextual fields, confirmation, cancellation, duplicate clicks, actor/guild/expiry boundaries, invalid modal corrections, private/public message routing, autocomplete, pagination, notifications, currency precision and session compare-and-set. Existing economy/domain tests remain in the suite.

No live token, named test-guild registration, guild mutation, production deployment or new database migration is part of this change. A live test-guild pass remains required to verify rendering, attachments, modal timing, permissions, long messages and all families against real persisted records.
