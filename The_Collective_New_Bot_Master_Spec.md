# THE COLLECTIVE — Standalone Cursor Build Pack

Version 1.0 · 5 October 2026 · Product decisions complete; numerical defaults subject to simulation.

## 1. Read this first

Build a new Discord application, codebase, database, and admin web dashboard for THE COLLECTIVE, an open gaming community founded by Justin (Paradox) and Lucky. This is a standalone specification. All intended modules below are required; phases specify build order, not permission to omit features. Start with empty member records. Do not invent production Discord IDs, credentials, provider support, game feeds, or successful integrations.

Identity: clean, dark, mysterious, urban underworld; distinctive diamond motif, restrained metallic accents, readable typography. Use original Collective terminology and assets. Avoid excessive roleplay in functional errors. Working labels include Dossier (profile), Contracts (quests), Dead Drop (board), Marks (ordinary currency), Ingots (scarce premium currency), and Seals (seasonal achievements). The bot's final display name is configurable.

**Decision precedence:** explicit fixed decisions in this document take precedence over seeded numerical defaults. All values described as defaults or recommendations are configurable and must be documented as such. Do not silently change agreed policy to simplify implementation. Fix routine implementation details autonomously; record meaningful design decisions. Ask owners only about genuinely blocking product changes.

**Complete means:** working Discord flows, working admin controls, persisted state, appropriate tests, deployment instructions, observable failures, and recovery after restart. Buttons without services, hard-coded mock dashboards, simulated provider success, and TODO-only modules do not qualify.

### Fixed decisions register

| Area | Required policy |
|---|---|
| Verification | Native Community onboarding/rules first; in-Discord CAPTCHA afterward; remember verified members across rejoins. |
| Accounts | Optional linking; no account requirement for ordinary access. |
| Statistics | Staff-only; member leaderboards explicitly allowed. |
| Dashboard | Admin-only. Members and other staff use authorised Discord tools. |
| Publishing | Admin self-approval allowed; preview in selected review channel; edit reloads original draft; approve then select destination. |
| Recurrence | Fresh announcement message every occurrence. |
| Economy | Uncapped Marks; total 5,000 Ingots, including 2,500 protected reserve and 2,500 outside it. |
| Ingot prices | Baseline 10,000 Marks; violent scarcity curve; no economic price ceiling. |
| Earning pace | At least one month to earn 10,000 Marks, including a couple of staff quests/events. |
| Steam keys | Typically about 10 Ingots; direct Ingot shop only, never crates. |
| Wealth | Public Marks/Ingot balances and member wealth leaderboards. |
| Seasons | Three calendar months; Seals and ranked rating reset, persistent progression retained. |
| Lottery | 100 Marks/ticket, five-ticket default cap; 50% funded bonus; three distinct entrants minimum; rollover. |
| Dead Drop | Paid only; three picks/member/board; 6×6; one hour/day; jackpot ends board; unclaimed jackpot carries forward. |
| Contracts | Personal daily selection; shared weekly/monthly; notification preferences; automatic payouts; one unstarted daily reroll. |
| RPG | Separate character and community levels; six classes; level 50 target about six months regular play. |
| Respec | 5,000 Marks, seven-day cooldown. |
| Class change | 15,000 Marks including respec, 30-day cooldown. |
| World | Three urban regions; access by level only; cooldowns, no energy meter. |
| Combat | D20, abilities, items, stat allocation, gear; quick and tactical PvP; PvE; live and asynchronous crews. |
| Ranked | Queue and direct challenges; optional Marks wagers in ranked and casual. |
| Gear | Tradable ordinary gear; selected bound items; named templates with bounded random bonuses. |
| Crates | Earned and bought with Marks; high-end crates with Ingots; no Steam keys. |
| Temporary rooms | Public/private text; six hours continuously empty for voice, 24 hours without human messages for text; no maximum lifespan. |
| Polls | Staff-created only. Suggestions excluded. |

## 2. Architecture and engineering contract

Use a TypeScript modular monolith with a supported Node.js LTS, discord.js, PostgreSQL and Prisma, and an admin dashboard using a maintained React framework. Verify currently supported versions and official documentation before selecting and pinning dependencies. Use a single repository with apps/bot, apps/admin, packages/domain, packages/db, packages/ui, and docs. A worker may share the domain package. Prefer durable PostgreSQL jobs initially; add Redis only where justified. Local Docker Compose must boot the database, bot/worker, and dashboard.

Domain modules own their data and expose services; Discord handlers and HTTP routes call the same services. Cross-module effects use typed domain events and transactional outbox messages. Persist business state before sending Discord messages. Workers claim jobs with leases, retries, backoff, and dead-letter inspection. Never rely on setTimeout or in-memory collectors for durable expiries, financial settlement, turn deadlines, or recurring schedules.

### Common services

- Guild configuration, capability permissions, audit log, feature flags, and versioned definitions.
- Interaction router with opaque persisted session references, actor checks, expiry, and revision checks. Defer interactions promptly where needed; long-lived sessions cannot depend on an old interaction token.
- Durable scheduler, notification preferences, mention controls, and outbox delivery.
- Currency ledger, item inventory and locks, role entitlements, reward budget service, and cooldown service.
- Seeded content import/export, schema validation, asset rendering, and provider adapters.

### Mandatory invariants

Every member record is scoped by guild and Discord user ID; leaving never wipes progression. Never use display names as primary keys. Store timestamps in UTC; evaluate daily/weekly/monthly cycles in Australia/Perth by default. Use calendar months for seasons. Recurring schedules explicitly define missed-run policy and daylight-saving behaviour for other timezones.

Currency quantities use integers, PostgreSQL numeric or bigint as appropriate, and arbitrary precision arithmetic. Never use JavaScript floating-point balances. Store fractional Marks internally only where required for blackjack payouts, at fixed minor-unit precision; format clearly. Ingots are whole units at launch. All mutation commands have idempotency keys. Currency transfers, inventory transfers, stock decrements, and reward entitlement checks occur atomically. Require available balance, not displayed balance including escrow. Never allow negative member wallets.

Buttons and APIs re-check permissions and state at execution, including after role removal. Do not trust disabled controls, client-supplied prices, or an initial HTTP page authorisation. Financial or destructive actions show exact effects before confirmation. History is append-only; corrections are reversal transactions with reasons, never silent row edits.

Encrypt provider tokens and Steam keys; redact credentials and private ticket text from ordinary logs. Use OAuth state, secure sessions, CSRF protection where applicable, role revalidation, request limits, safe uploads and server-side URL validation. Prevent staff-configured feeds/images from reaching private network addresses. Escape markdown where needed and explicitly set allowed mentions. Configuration backups never export secrets in plaintext.

Definitions have stable IDs and immutable published versions. Existing trades, missions, wagers, tickets, and loot containers retain the versions they started with. Rebalancing cannot silently rewrite a pending reward or combat rule halfway through play.

### Permissions

Capabilities include moderation, verification override, tickets, event management, economy operations, publications, content management, statistics, and full administration. Discord roles map to capabilities. Dashboard access additionally requires configured administrator status; an event coordinator or moderator does not receive web access merely from a capability. Guild owner has recovery access. Staff overrides always require a reason and audit entry. Discord hierarchy and bot permissions remain authoritative limits.

## 3. Command budget and member experience

Discord documents 100 global CHAT_INPUT commands and an equivalent guild-specific allowance, with up to 25 options at a level. Group actions under parent commands; do not register a parent per action. Buttons, selects and modals are the primary navigation once a panel is opened. See official sources in section 17. Validate counts and option trees in CI; target the following **36 parents**, with a project ceiling of 50.

| Parent | Actions or panels |
|---|---|
| /help | Searchable module help, personal available actions |
| /setup | Admin wizard, diagnostics, channel/role mappings |
| /verify | CAPTCHA and assistance |
| /roles | Onboarding-related and extra opt-in panels |
| /accounts | Link, inspect, privacy, unlink |
| /temproles | Staff grants, renewals, expiry |
| /invites | Own recruitment progress; staff attribution controls |
| /birthday | Set date, privacy, reminders |
| /mod | Sanctions, warnings, cases, appeals administration |
| /report | Private member report |
| /logs | Staff search/export/settings |
| /stats | Staff-only reporting |
| /rank | Community XP and rank |
| /economy | Wallet, transfers, ledger history, authorised staff adjustments |
| /market | Ingot chart, pool, quote, buy/sell |
| /leaderboard | Member-facing rankings and season archive |
| /events | Official event management and RSVP |
| /schedule | Event schedule and authorised scheduling controls |
| /crew | Persistent crews, sessions, LFG |
| /prediction | Free and staked predictions |
| /contest | Submissions, ballots, judging |
| /giveaway | Entry, bonuses, staff draw controls |
| /publish | Embeds, review, announcements, pins, stickies |
| /reply | Authorised auto-reply rules and test |
| /lottery | Tickets, current draw, history |
| /contracts | Board, progress, reroll, settings, staff custom contracts |
| /combat | PvP queue/challenge, battle actions and records |
| /character | Class, stats, abilities, respec, loadouts |
| /explore | Expeditions, interactive missions, crew missions |
| /inventory | Gear, materials, crates, trade, crafting, salvage, upgrades |
| /profile | Dossier, cosmetics, privacy and preferences |
| /shop | Supply, Ingot and member marketplace |
| /blackjack | Solo and social tables |
| /deaddrop | Board, paid pick, staff special boards |
| /support | Tickets, temporary rooms, achievements and commendations |
| /community | Staff polls, game updates and authorised management |

These parents are a routing plan, not permission to omit subfeatures. Keep each option tree legal. Where grouped interfaces are too large, use dashboard controls and persistent panels rather than extra roots. Development registers only to a configured test guild; command deployment is explicit and diff-based.

### Channel layout defaults

Map logical destinations to existing channels; never create a whole server layout without explicit setup action. Suggested public destinations: bot-terminal (personal panel entry), contracts, events, market (one updated chart/panel), game-updates, lottery/dead-drop, and activity threads. Private destinations: publication-review, moderation-log, server-log, economy-audit, support tickets. Temporary rooms have separate voice/text categories. Multiple destinations may share a channel. Use threads for battles, missions and blackjack tables; ephemeral panels for private settings and receipts. Public wealth does not imply public account tokens, transaction reasons, private inventories or staff analytics.

## 4. Community administration

### Verification

Let Discord Community handle rules acceptance and native onboarding. After required native steps complete, offer a Verify button that generates an image CAPTCHA inside Discord and opens a modal for the answer. Default six case-insensitive characters, excluding easily confused characters; five-minute expiry; regeneration invalidates prior challenge; three failures cause a ten-minute cooldown. Never log the answer. Provide accessible staff assistance and audited manual verification.

Grant a separate Verified access role. Remember successful verification permanently unless staff revoke it; after a rejoin restore it once the native joining requirements are complete, without another CAPTCHA. Reconciliation checks native pending/onboarding flags, permissions and configured channel access; no assumption that membership-screening completion alone proves all onboarding is done. Community onboarding has its own channel requirements, so setup must validate the combined access plan instead of blanket-hiding every default channel. Fail closed on missing eligibility information and explain the state to staff.

### Reaction and self-select roles

Reuse native onboarding's existing interest/game/region/platform/notification roles. Panels let members change their mind later and add opt-ins not covered by onboarding. Support reactions, buttons and selects, single or multiple selection, current selections, role prerequisites, mutually exclusive groups, and panel retirement. Never offer staff, Verified, progression ranks or privileged roles as self-select options. Validate hierarchy and role permissions at publish and assignment time. Seed categories are editable, not hard-coded games.

### Linked accounts

Optional Dossier identities for Steam, Riot, Battle.net, Epic, EA, Ubisoft, Xbox, PlayStation, Minecraft, Twitch and YouTube. Bungie/Roblox may be added through the same adapter. Provide handle entry, provider-supported OAuth/ownership proof, refresh, unlink, revocation handling, and public/private visibility per account. Distinguish self-reported handles from verified ownership. Discord user connections require user consent and do not expose every provider or gameplay stats universally. Unsupported verification remains clearly labelled, never faked. Linking never blocks ordinary access. Teammate discovery respects chosen visibility. Separate provider modules from core so missing API credentials cannot stop the bot.

### Temporary roles

Staff grants and event/birthday/shop rewards use one entitlement service. Renewals stack remaining duration: three days remaining plus seven becomes ten. Staff can override an exact expiry with a reason. Independent grants and permanent ownership are tracked separately; expiry removes the role only when no applicable grant remains. Recover expiries after restart and rejoin. Configuration says whether absence pauses a grant; default wall-clock expiry.

### Invites and birthdays

Invite attribution uses snapshots and confidence levels, not invented certainty. Unknown, vanity and ambiguous joins are explicitly represented. Qualified recruitment defaults to verified membership retained for seven days. Award once per distinct recruited member; no reward for rejoin loops. Caps, suspicious patterns, attribution corrections and history are staff-visible. Corrections reverse affected rewards where appropriate.

Birthdays are opt-in day/month, optional year, timezone and public announcement controls. Publish a configured greeting, grant a 24-hour birthday role, and automatically award a small annual Marks gift. One gift per member per year regardless of edits or rejoins. Date edits have cooldown/audit; leap-day policy configurable. Users can remove their birthday data.

### Automated moderation and sanctions

Configurable automation covers flooding, repeated content, mention spam, blocked links/invites, suspicious joining spikes and raid containment. Rules have channel/role exclusions, thresholds, severity weights and actions: delete, warn, timeout, containment, escalation and staff alert. Ban behaviour must be explicitly configured; shipped rules must not ban on one uncertain heuristic. Support human override and safe previews of changed rules.

Warnings contribute configurable severity points rather than every warning having equal weight. Define thresholds, active point expiry, sanction durations and appeals. Seed only a labelled example policy. Case history retains expired/reversed entries; active totals exclude overturned cases. All automated and manual actions record actor, target, reason, evidence, rule version, sanction, timestamps and related cases. Member reports and appeals use private intake and ticket integration. Hierarchy failures produce a case failure rather than a success message.

### Logs and statistics

Restricted logs capture joins/leaves, roles, messages/edits/deletions when content is actually available, channels, sanctions, configuration and economy actions. Message text in staff logs is allowed; honour excluded channels, retention and sensitive ticket boundaries. Missing uncaptured text is labelled unavailable. Attribute audit-log actors only with a reliable match; otherwise say unknown. Retention jobs remove expired content.

All aggregate statistics, reports and exports are staff-only: growth, activity, attendance, retention, invites, moderation workload and economy issuance/sinks. Scope exports and audit downloads. Public individual Dossiers and explicit leaderboards are separate permitted features.

## 5. Community progression, Dossiers and seasons

Community XP comes from meaningful chat and eligible voice participation. Use message cooldowns, daily caps, excluded channels, anti-repeat filters and voice checks requiring multiple eligible humans; prevent muted/deafened/AFK farming according to configured rules. Events and Contracts may award XP. Seed ten rank bands across levels 0–100 with configurable names, thresholds and role mappings. Rank transitions preserve unrelated roles and use the entitlement service.

Dossiers show community rank, character level, class, title, loadout, inspectable equipment/stats, achievements, seasonal badges, PvP record, crew and opted-in accounts. Marks and Ingot balances are public. Bio, backgrounds and cosmetic frames are customisable. Inventory details, birthdays and account visibility have independent controls; wallet privacy cannot hide wealth because public wealth is fixed policy. Private panels manage loadouts, holdings in escrow, preferences and transaction receipts.

Member-facing leaderboards: community XP, Marks, Ingots, seasonal/lifetime Seals, PvP, Contracts and qualified recruitment. Include own position, pagination, time period and archives. Separate currency rankings; optional combined mark-to-market wealth clearly labelled estimated and price-sensitive. Exclude treasury/bot/system wallets.

Seasons are three calendar months with configurable start boundaries. Reset seasonal Seals and ranked ratings, retain lifetime totals, community ranks, character levels, stat points, gear, region unlocks, wallets and inventory. Archive standings before rollover, grant budgeted prizes/titles once, and publish a recap. Seals are non-transferable achievement scoring, not spendable money.

Achievements include participation, Contracts, exploration, bosses, recruitment, PvP and events; lifetime, seasonal and hidden discoveries. Mainly reward badges, titles and cosmetics; selected Marks awards are budgeted. Staff commendations and peer commendations show category and reason. Peer commendations have no currency reward, no self-awards, cooldowns and repeated-pair limits. Staff can remove abuse with history retained.

## 6. Economy and Ingot exchange

### Marks, budgets and earning targets

Marks have no maximum supply. Only explicit reward services issue them. Ordinary chat/voice directly award community XP; Marks come through limited Contracts, activities and authorised awards. Support member-to-member Marks transfers with limits/cooldowns, history, admin add/remove/set/bulk grants, reasoned adjustments and refunds. Every issuance identifies its source and budget. Transfers, wagers and market trades are not issuance.

**Target:** a regular member needs at least one month for 10,000 Marks, even with a couple of staff events/quests. This is an aggregate budget across RPG and community earnings, not a 10,000 allowance per module. Seed an illustrative budget: up to 80 routine Marks/day shared by recurring Contracts and RPG earnings (~2,400/month), weekly completion up to 250 (~1,087 averaged/month), monthly milestone 500, two staff activities at 2,000 each = about 7,987/month. Other ordinary bonuses should keep the reference participant below 10,000. These are defaults to simulate, not individually promised payouts. Do not double-count the daily cap and per-contract rewards.

Invite rewards, birthdays, achievements and promotional bonuses share source caps and a guild issuance budget. Lotteries and funded contests can produce exceptional winners, so the target is normal earning pace, not a hard prohibition on one member winning more. Simulate participation rates, lottery subsidies, mission farming, shop sinks and gifting before enabling economy features. Activities can continue for fun when payout limits are reached; disclose reduced rewards before entry.

### Supply accounting

Total Ingots always equal 5,000: protected reserve 2,500 plus 2,500 assigned among exchange inventory, members, trade/wager escrow if applicable, event treasury and other explicitly defined active holdings. Protected reserve is outside ordinary exchange pricing. No issuance above 5,000. Protected transfers require a reviewed policy/version change and an audit; default ordinary tools cannot release it.

Ingots spent in shops/crates return to exchange inventory, increasing available supply and lowering the next price. Member-to-member transfers do not alter the pool. Purchased consumables/crates never destroy Ingots. Unfulfilled shop purchases remain in escrow and do not affect pool inventory until committed or refunded.

### Proposed executable price curve

This is a **tunable implementation default**, selected to satisfy the violent-scarcity requirement. Whole-unit exchange inventory A is from 0 to K=2,500. Define the next unit's purchase price:

`p(A) = ceil(10,000 × (2,500 / A)^3)` for A >= 1.

There is no price ceiling. At A=0 buying is unavailable; never display infinity as an executable quote. With a finite whole-unit pool there is a finite last-unit quote, which is a consequence of granularity, not a configured cap. Arbitrary precision must support that quote without overflow.

| Available pool | Next purchase quote (Marks) |
|---:|---:|
| 2,500 | 10,000 |
| 2,000 | 19,532 |
| 1,250 | 80,000 |
| 500 | 1,250,000 |
| 250 | 10,000,000 |

A q-unit buy costs the sum of p(A), p(A-1), … p(A-q+1), not q times the starting quote. Selling one unit pays `floor(0.95 × p(A+1))`; selling multiple integrates successive inventory states. Five-percent sell spread is a configurable default. This inverse-step convention avoids buying one unit and selling it at the inflated post-purchase buy quote.

Show exact price, quantity, reserve/pool effect, spread, quote expiry and confirmation. Default quote lifetime 30 seconds. Commit only if the expected market revision and balance still match; otherwise requote, never silently substitute a higher price. Lock pool and wallets together. Render a history chart and persistent market panel with Buy/Sell controls; coalesce graph refreshes rather than posting spam.

### Backing and reserve safety

The exchange Marks backing account is separate from protected Ingot reserve and general budgets. Member buy proceeds enter backing. Member sells debit it. Shop revenue in Ingots returns supply; it cannot siphon Marks backing out. Compute a conservative redemption liability using the same discrete reverse curve for active outstanding units. Under the seeded whole-unit policy, reserving the un-discounted sum `Σ p(a), a=A+1..K` provides a conservative bound, even when some outstanding units are event-held. Pool removals outside normal funded purchases require an equivalent backing contribution before commit. Never pay buybacks using silent Marks minting.

Curve edits and reserve releases are paused, audited operations that recompute liabilities, require funding for any increase, and preserve already committed quotes. Lock market changes during settlement. Ordinary member sells must remain covered under the active invariant; fail safely and alert staff if corrupted accounting violates it. Fees can be withdrawn only above the required backing margin.

### Market Collapse event

Rare event consumable discoverable through special Dead Drop/event rewards; holder chooses when to activate it. Each charge is backed by existing Ingots acquired and allocated to the event treasury through funded exchange purchases or an equivalent audited allocation. Those units remain within the active 2,500; protected reserve stays untouched. Activation atomically consumes the charge and releases its allocated units into exchange inventory, potentially causing a sharp price crash. No temporary arbitrary discount or timer-based price snapback. Normal subsequent trading determines recovery. Prevent duplicate activation and unfunded effect creation. Public announcement shows effect; private audit records allocation and actor. Discovery conditions may be secret, but spend confirmations and market execution are clear.

## 7. Events, crews, predictions, contests and giveaways

Official events are created by authorised staff/coordinators; member crews provide informal activities. Event templates include game, host, description, links, start/end, timezone, capacity, RSVP yes/maybe/no, waitlist, reminders, check-in, verified attendance, cancellation, recurrence, recap and budgeted rewards. Sync Discord native scheduled events where supported and record divergence/failures. Recurring series have occurrence IDs; editing a series versus one occurrence is explicit. Schedules can link events, announcements and room requests without duplicate jobs.

Persistent crews have name, roster, leader/officers and history. Session crews/LFG specify game/platform/region, start time, size, open/approval joining, readiness and teams. Support ownership transfer, disbanding, optional temporary rooms and post-session attendance. Repeated sessions cannot manufacture attendance rewards. Crew RPG missions use the combat system below.

Predictions have two per-event modes: free entries and Marks-staked pools. Show choices, eligibility, lock deadline, rules, evidence and outcomes before entry. Free mode awards prediction points and optional funded prizes. Staked mode escrows entries and pays winners from the actual pool, proportional to winning stake, with deterministic remainder distribution. Default no house fee; ties, cancellations and no-winning-entry outcome refund all stakes. Once locked no edits to outcomes or stakes. Resolution/reversal is staff-audited and idempotent; reversal must not create negative wallets.

Contests support community voting and staff judging, selected per contest. Configure categories, media limits, deadline, edits before close, judging weights, voting eligibility, self-vote rules, prize stock, tie policy and archives. Publish rules before entries. Validate upload types; private submissions and blind judging optional. Track ballots rather than trusting raw reaction counts. Staff corrections have reasons.

Giveaways include one free entry plus capped bonus entries from verified activities. Publish bonus conditions, eligibility, role/age/attendance requirements, closing time, stocked prizes, winners and claim deadline. Deduplicate activity-derived entries; lock the entry snapshot before random draw. Use secure randomness, no duplicate winners by default, private prize delivery, sponsor metadata and audited rerolls only for configured failure/expiry conditions. Each reroll excludes disqualified winners and preserves the initial draw. Never expose Steam keys publicly.

## 8. Embeds, publications, schedules, pins and replies

Admin web editor supports text, embed fields, colour, author/footer, timestamps, images, thumbnails, buttons and explicit mentions, with Discord-limit validation and accurate preview. Provide templates and saved drafts. Long text editing belongs here or in modals, not many cramped slash options.

**Required review flow:** create draft -> send preview to a selected review channel -> Approve/Edit/Request changes/Cancel controls -> Approve privately selects destination channel and Publish now or Schedule -> commit approved exact revision. Admin self-approval is allowed; optional second-admin policy per category. Edit opens the authenticated web editor with the entire original draft loaded. Saving updates preview and invalidates prior approval. Request changes attaches feedback. Separate rendered preview from review controls so only intended content is published. Check reviewer and destination permissions again. Keep author, approver, version, destination and timestamps. Dashboard shows drafts, reviews, scheduled and published; bot-owned published messages can be edited with appropriate review and history.

Scheduled announcements support one-off and daily/weekly/monthly recurrence, timezones, end dates, pause/resume/cancel, delivery history, failure alerts and optional removal after a duration. **Every recurrence posts a fresh message.** Idempotency keys prevent repeats after restart; missed runs default to skip stale announcements rather than flood a channel. Explicit role mentions only; everyone/here requires authorised configuration and preview.

Pins: pin publications, expiry-based unpinning, replace prior recurring pin, inspect/remove bot-managed pins and failure alerts. Use current Discord pin endpoints and permissions. Stickies are opt-in per channel, triggered by configurable human-message count and cooldown. Repost then delete the prior sticky, recover IDs after restart, ignore bot messages and prevent loops. Allow pause/expiry; bot owns only its own sticky copies.

Auto replies support exact phrase, keyword and safe bounded pattern rules from ordinary conversation or deliberate text triggers such as !server. Restrict channels/roles; set member/channel cooldowns and rule priority. Reply with text/saved embeds/buttons or randomly choose a variant. Private responses apply to supported interactions or explicitly configured DMs; an ordinary message cannot produce an ephemeral interaction response. Dashboard test reports matched rule and exclusions. Secret clue responses are supported. Ignore bots, own replies and repeated triggering; protect regex execution from runaway patterns.

Game updates route official feeds/APIs or explicitly configured supported sources to channels, with optional game-role mention. Each source selects automatic posting or the publication approval queue. Support categories: patches, announcements, maintenance, releases. Deduplicate by source ID/canonical content; keep source attribution and direct links. Summaries are concise, labelled if generated, and cannot invent changes. Missing feeds show unavailable/setup required. No universal scraping promise. Retry with rate limits; on outage retain last successful state and alert staff rather than repost old news.

## 9. Lottery and Dead Drop are separate games

### Daily lottery

100 Marks/ticket; default maximum five/member/draw. One winning ticket receives the shared pool. Prize equals all ticket payments plus a **50% bonus funded from a configured Collective lottery budget**. Show entries, total tickets, member odds, deadline, contribution and subsidy separately. Reserve the bonus at ticket purchase; reject before charging if budget is exhausted, never silently drop the advertised bonus.

At least three distinct members required for a draw. If not met, tickets, paid pool and already-funded bonus roll forward; each purchase is subsidised once, never again on rollover. Carrying entries retain eligibility and count toward the five-ticket cap for that unresolved draw. Next-day closing retries at configured time. Secure random selection over an immutable ticket snapshot; restart-safe settlement and public result. Configurable long-stall expiry refunds member payments and returns subsidy to treasury. Default 7 days is tunable; announce expiry before buying. No guaranteed solo 50% farming.

### Dead Drop

Generate a shared 6×6 board with A–F rows and 1–6 columns. Reuse one card-back template and reveal icons; no separate image per jackpot position. Preassign and securely store one jackpot, scattered small rewards and empty cells at creation. Keep positions inaccessible to members/admin preview interfaces; audit privileged inspection. Publish a board commitment if useful for later fairness verification.

Open one hour each day at a configured Perth time; no default time has been chosen. Paid only, maximum three picks/member/board. Default 100 Marks/pick is tunable. Select a still-covered coordinate then confirm payment; one transaction charges and reveals it immediately. Do not sell unassigned outstanding tickets. Concurrent selection of the same cell charges only the successful claimant. Update rendered board, claimant and remaining rewards with coalesced message edits.

Finding jackpot ends the board immediately; next opens the following day, never instantly. Members retain small rewards. If the hour expires unfound, carry jackpot value/items into a newly shuffled next-day board, without adding another starting seed. Default jackpot funding: configured starting prize plus 50% of paid picks; percentage is a recommendation distinct from lottery's fixed 50% bonus. Ticket share is diverted into jackpot escrow, not newly issued money. Remaining sales go to the configured game treasury; small rewards use a separate pre-funded daily budget. The jackpot shown grows as paid picks enter; only the current board's funded jackpot is paid. New seed is allocated after a win, not every rollover. Refunds follow recorded allocation and never duplicate carried funds.

Special boards can attach gear/crates/clues or a funded Market Collapse charge. Publish prize rules and available monetary jackpot without revealing positions. Allow opt-in reminders. At close, reveal all unchosen cells for audit; a new board always gets fresh positions. Staff controls create/pause/cancel/special boards with reasoned refund policy, not arbitrary hidden jackpot relocation.

## 10. Contracts

Personalised random daily objectives; shared weekly/monthly boards. Staff can create custom riddles, manual quests, events and RPG tasks. Objectives include meaningful chat/voice, event attendance, crew play, exploration, PvE, crafting and PvP. Participation objectives use the same eligibility filters as XP. Do not require unavailable games/providers to complete daily selection. Seed several alternatives and track equivalent difficulty/reward bands.

One free reroll/day for an unstarted daily contract; transaction verifies progress is still zero. Freeze personal assignment/reward version at refresh. Show progress, deadline and reward breakdown. Auto-pay once when verified complete, no claim requirement, and tag the member in designated completion channel unless completion pings disabled. Batch noisy completions where possible. Manual submissions await staff approval then follow identical payout path.

Member preferences choose daily/weekly/monthly refresh notices and DM versus selected channel mention; personal daily notices show that member's own objectives. Completion pings can be disabled without forfeiting rewards. Closed DMs fall back only to the member's permitted preference, never silently expose private details. Reward uniqueness is member+contract+cycle; restart/rejoin cannot repeat. Weekly/monthly milestones never accidentally double-pay daily source budgets. Staff editing live criteria creates a new version with an explicit preserve/migrate policy.

## 11. RPG, combat and equipment

### Character progression

Separate character XP from community XP. Character cap 50; target around six months regular RPG play. Three stat points per level gained. Start at level 1 with explicit base stats; 49 gains yields 147 allocated points, not accidental level-zero extra points. Stats: Strength, Agility, Endurance, Focus; display exact effects and diminishing returns. Tune bounded D20 accuracy/defence modifiers so stacked stats cannot make every attack impossible. Community chatting never directly awards character stat points; selected Contracts award both XP types explicitly.

Six classes: **Hitman** (precision/mark/execute), **Bruiser** (health/close combat/defence breaking), **Saboteur** (traps/explosives/disruption), **Fixer** (stimulants/healing/buffs), **Duelist** (parry/counter/risk), **Gunslinger** (chained shots/ammunition/burst). All must solo effectively. Milestone ability unlocks; four equipped active abilities plus class passive and bounded gear passives. Gear abilities compete for active slots where applicable. Provide inspectable cooldowns, target rules and formulas.

Stat respec costs 5,000 Marks, seven-day cooldown. Class change costs 15,000 Marks, includes respec, 30-day cooldown; it also sets the seven-day respec cooldown. No use in combat, queue, mission or active expedition. Preserve level/earned points; unequip incompatible equipment, retain ownership. Unlock class abilities by existing level without giving starter or milestone rewards again. One introductory combined reset below level 10 and before first ranked match, consumed once. Cooldowns persist through switching/rejoin/restart; staff corrections audited.

### Combat rules default

Attack is D20 plus bounded accuracy against defence. Natural 1 misses, natural 20 critically hits. Weapon damage uses dice such as 1D6/2D4; define critical multiplier on rolled damage, not accidental doubling of every passive. Each turn one main action and one limited item action; defend grants a temporary defence effect. Abilities have turn-based cooldowns, costs/targets if any, and explicit stack/duration rules. Health caps, healing, shields, bleed, cleanse, counter and stun effects resolve in a deterministic documented order. Cap chained reactions to avoid infinite loops. Consumables have per-match limits. Secure randomness with persisted roll results; retries cannot reroll.

Loadouts lock at start; prevent selling, upgrading or rerolling committed gear. Health resets between PvP matches. No permanent gear loss on defeat. Quick duels auto-resolve using loadout and selected simple tactics; tactical matches use player turns and action buttons. Seed tests for criticals, incapacitation, cooldown boundaries, healing caps and timeouts.

### PvP

Casual and ranked modes, queue and direct challenges. Both explicitly accept mode, rules and optional equal Marks stake. Queues require compatible wager preferences; zero stake remains available. Escrow both stakes atomically; winner receives pot; draw/system cancellation refunds; forfeit loses. No currency minted from wagers. No Ingot wagers at launch.

Ranked uses standardised base stats, equal stat allocation budget, bounded ability access and a published equipment power budget so level/wealth do not determine victory. Classes retain identity and builds matter; casual can use full progression. Matchmaking prioritises rating and expands tolerance with wait time. First two ranked matches against the same opponent/day affect rating and system rewards; later challenges are clearly casual before acceptance, with optional wagers still allowed. Anti-collusion review, minimum participation, disconnect grace and timeout outcomes are explicit. Seasonal rating archives/reset and budgeted rewards; no duplicate ranked rewards through mode switches.

### World and PvE

Initial content: three regions, around 15 enemy types, three bosses and 40–60 gear templates, all editable/importable through the admin dashboard. Backstreets level 1, Black Docks level 15, Inner Sanctum level 35 are seeded defaults. Access by level only; narrative never gates unlocks. Optional branching clues provide flavour. Multiple difficulty tiers keep old regions useful. Crew members must individually qualify.

Both timed expeditions and interactive missions. Default one active expedition slot; interactive play allowed while waiting with separately reserved loadouts or loaner gear, never contradictory item locks. Expeditions choose location/duration/loadout, persist completion time and preselected outcome rules, automatically grant once and send optional report. Interactive missions have choices, D20 checks, encounters, hidden rooms, retreat, loot and bosses. Show difficulty/reward eligibility before starting. No hunger/thirst/durability or energy meter. Activity-specific cooldowns and aggregate XP/Marks reward limits persist through restart/respec.

Failed PvE loses only unbanked mission loot and triggers recovery. Wallet and owned gear safe. Free timed recovery always available; medkit shortens it, with once-only consumption and minimum duration. Community functions and inventory remain usable. Distinguish in-battle healing from recovery use.

Crew missions support two to five players, scalable encounters, ready checks, locked gear, live or asynchronous deadlines, optional turn notifications, individual loot and participation eligibility. Missed turns defend automatically; repeated inactivity excludes completion rewards with rules shown on entry. Limited revives from teammates/items. Long-lived missions retain state and their activity rooms until finalised, then normal inactivity cleanup applies. Abandoned missions have an explicit max wait/abort policy so a room is not held forever by a stalled system state.

### Gear and crafting

Named fixed templates with bounded random affixes; each instance has permanent ID, rolls, provenance, binding, level/class requirements and upgrade history. Shared basic weapons; selected specialist weapons class-restricted. Armour/accessories can add max health, defence, accuracy and abilities. Rarity determines possible ranges, not unlimited ranked power. Inspect exact stats and allowed affix ranges before purchase/reroll.

Ordinary gear tradable; selected prestige/quest gear bound. Direct item/Marks trades require both final confirmations; any offer edit clears acceptance. Atomic swaps, expiries and cancellation; no duplicate instances. Fixed-price member marketplace escrow holds listed gear, limits listing counts/duration, returns unsold items and settles seller Marks atomically. Listing fees default zero and configurable. Equipped or mission-locked items cannot enter trades. Transfers preserve rolls, binding, upgrades and reroll counters.

Guaranteed upgrades consume Marks/materials and cap tiers; salvage confirms destruction and pays defined materials; crafting consumes recipes/materials with known result specification; reroll replaces one selected affix at increasing per-item cost, with visible outcomes. Trading cannot reset reroll cost. No upgrade failure/breakage system. Preview resulting stats/costs and preserve locked items. Materials and recipe sources include exploration, bosses, Contracts, salvage and shops.

## 12. Shops and crates

Supply shop uses Marks for ordinary gear, supplies, consumables and services. Ingot shop sells Steam keys, cosmetics and selected premium items; ranked caps still apply. Member marketplace uses Marks. Dashboard manages stock, prices, purchase limits, role/level requirements, rotation, descriptions and deliverables. Purchase receipts and private key delivery; failures never consume a key twice. A revealable secure delivery inbox can supplement DMs without adding a member web dashboard. Refund before delivery restores stock; post-reveal refunds require staff review because secrets cannot be unrevealed.

Crates earned through exploration/bosses/Contracts/events and purchased with Marks or Ingots for high-end versions. Only RPG items, materials, consumables and cosmetics; no Steam keys. Show odds, loot table version, guaranteed minimum and bad-luck progress before purchase. Implement per-table member pity counters with clear threshold and reset rules; show how renamed/replaced tables handle existing progress. Duplicate handling: keep, trade or salvage; selected rare cosmetic duplicate protection. Loot is committed once, either at acquisition or opening according to a clearly published versioned policy; default roll at acquisition to prevent patch-shopping unopened crates. Presentation animation never determines or changes loot. Staff cannot inspect future unrolled secrets then change live results.

## 13. Blackjack

Solo and multiplayer social tables against dealer, Marks only. Social players have independent hands with a shared dealer/shoe; joining window, turn timers, automatic stand for inactivity. Hit, stand, double, split; exact rules shown before betting. Seed dealer stands on soft 17, natural pays 3:2, regular win 1:1, push refunds, maximum one split, split aces receive one card, split blackjack pays regular win; all tunable before table creation. Internal minor-unit precision handles payouts exactly.

Shuffle with secure randomness; persist shoe/cards/turn state. Reserve maximum payout exposure from a funded house bankroll before accepting bets/doubles/splits. Never mint on a win or debit unavailable stakes. Version table rules, protect hidden dealer card, recover settlement after restart, audit results. Configurable min/max bets and table caps; default bounds are small relative to slow economy and must be simulated. No hidden forced-loss mechanism. Rules distinguish inactivity from system failure; system unrecoverable cancellation refunds unsettled stakes.

## 14. Support, temporary rooms and polls

Tickets have configurable categories/forms, private channels or threads, staff assignment/claim/transfer, close/reopen, private summaries, transcripts, staff-only notes and related sanction/purchase/reward IDs. Per-member caps/cooldowns, inactivity reminders and optional closure. Staff notes never leak through transcript exports to members. Closed records retained per privacy policy; reopening unavailable after configured retention. Support access must be available for verification problems without granting general server access.

Temporary voice and text rooms have owner controls, invite/lock/rename/capacity/transfer as appropriate, manual close and dedicated categories. Public and private text supported, private default; moderation staff retain access. Default one of each/member and five active of each/server, configurable; cooldown on creation, no reward for creating rooms. Voice inactivity means continuously empty for six hours; joining cancels countdown. Text inactivity means 24 hours since last human message; bot messages do not extend it. No maximum lifespan; active rooms can run indefinitely. Persist timestamps and jobs; reconcile deleted/missing channels. Closing occupied voice warns/disconnects; automatic empty cleanup does not. Owner departure transfers ownership to an eligible present member or allows staff claim. Explicit active-mission reservations can defer cleanup, but ordinary events do not automatically grant permanent room exemptions.

Polls staff-created only. Single/multiple selections, anonymous or named, eligible roles, opening/closing schedule, results, cancellation and history. Anonymous means no member-facing voter identities, with documented backend retention. Use native poll support or bot panels where the selected rules require custom enforcement; do not promise native role restrictions without enforcement. Suggestions are excluded: no suggestion board, submit command or suggestion workflow.

## 15. Admin dashboard and operations

Admin-only Discord OAuth login, guild selector if needed, server-side permission revalidation. Modules: overview/health, setup, moderation/cases, logs/statistics, roles/accounts/verification, birthdays/invites, economy/backing/budgets, events/crews/contests/giveaways/predictions, publications/schedules/updates, Contracts, RPG content/gear/recipes/classes, games, tickets/rooms, polls and system settings. No member dashboard or public admin API. Other staff use Discord capabilities.

Every configured module has view/edit/validate/preview/publish controls appropriate to its data. Draft definitions cannot be mistaken for active configuration. Provide audit history, configuration versions, selective rollback, export/import with validation, seeded test fixtures, economy and combat simulation, and dry-run reward previews without real grants. No destructive reset shortcuts outside explicitly confirmed admin operations. Queue health, failures and unavailable providers visible.

Backups: documented PostgreSQL backup/restore, encrypted secrets backup separately, restoration rehearsal, schema migrations and rollback constraints. Health endpoints reveal no secrets; metrics for jobs, Discord failures, pool backing, ledger discrepancies, room cleanup, reward duplication and combat stalls. Alert staff on invariant failures. Feature flags allow maintenance of one module without stopping verification/moderation. Real integrations require secrets in environment/secure configuration and distinct dev/prod IDs.

## 16. Cursor delivery plan and prompts

### How to use this pack

Place this file in the project as docs/MASTER_SPEC.md. Cursor first reads sections 1–3 and the current phase sections, rather than rereading the entire document on every task. Create docs/DECISIONS.md, PROGRESS.md, DATA_MODEL.md, COMMANDS.md, CONFIG_DEFAULTS.md and OPERATIONS.md. Keep concise module handoff notes and acceptance results. Record requirement status as implemented/tested/blocked; no blanket completion claims.

Build the entire intended product incrementally. Each phase ends in a working demo, meaningful verification and a short handoff. Phase completion is a normal work boundary, not a request for approval to implement authorised features. Never deploy to the production guild, distribute prizes or change external systems merely because local tests pass. Use a configured test guild and fixtures first.

| Phase | Deliverables | Exit evidence |
|---|---|---|
| 0 Foundation | Repository, env validation, database, migrations, jobs/outbox, router, permissions, dashboard auth skeleton, CI | Boot locally; denied access; duplicate-job recovery; command count validation |
| 1 Community safety | Verification, roles, accounts adapters, temp roles, moderation, cases, logs, tickets | CAPTCHA/rejoin/manual override; entitlement overlap; automation and private cases |
| 2 Participation | Community XP, birthdays, invites, Dossiers, leaderboards, seasons, achievements, polls, rooms | Qualified invite once; seasonal rollover; inactivity cleanup after restart; public wealth boundaries |
| 3 Economy | Ledger, budgets, Ingot supply/curve/backing, transfers, audit, market graph | Concurrency/quotes; conservation; buy/sell inverse; liability coverage; aggregate earning simulation |
| 4 Publications | Dashboard editor/review, schedules, fresh recurrence, pins/stickies, replies, update feeds | Exact draft approval; edit invalidation; missed-run handling; per-source queue mode |
| 5 Activities | Events, schedules, persistent/session crews, predictions, contests, giveaways, Contracts | Escrow settlement; deduplicated attendance/bonuses; auto payout; notifications/reroll |
| 6 RPG core | Characters/classes/XP/stats/respec, gear instances, combat engine, inventory locks | D20 edge cases; 5k/15k costs; cooldown persistence; gear preservation |
| 7 RPG world | Regions, expeditions/missions, crew modes, recovery, seeded enemies/bosses/gear | Reward once; async restart; six-month progression simulation; level-only gates |
| 8 PvP and gear economy | Queue/challenges/rating/wagers, trades/marketplace, upgrades/salvage/crafting/rerolls, shops/crates | Match/escrow races; ranked limits; atomic trades; pity/loot version; key secrecy |
| 9 Chance games | Lottery, Dead Drop renderer/escrow, funded Market Collapse, blackjack | Rollover no duplicate subsidy; 3-pick race; jackpot closes; funded effect; bankroll exposure |
| 10 Hardening and delivery | Complete admin tools, tests/observability, backups, docs, Docker deployment, test-guild acceptance | Requirement checklist complete; restore test; accessible desktop/mobile dashboard; no placeholders |

### First Cursor prompt — paste this

> Build THE COLLECTIVE from docs/MASTER_SPEC.md as a new standalone Discord bot and admin-only dashboard. Read sections 1–3 and phase 0 first. Create a short implementation plan, requirements checklist and progress documents. Implement phase 0 fully: modular TypeScript repository, supported pinned dependencies, PostgreSQL schema/migrations, durable jobs/outbox, permissions, interaction router, environment validation, admin OAuth boundaries, Docker development setup and CI. Keep the 36-parent command plan within its validated budget. Do not implement mock successes for external providers. Run meaningful checks, fix failures, and update PROGRESS.md with changed files, verified behaviours, next phase and actual blockers. All later modules remain required. Do not deploy or mutate a production guild. Proceed with routine decisions without repeatedly asking me for confirmation.

### Phase continuation prompt

> Read docs/PROGRESS.md and the current phase's sections in docs/MASTER_SPEC.md. Implement the next incomplete phase end to end, reusing domain services, ledger, entitlements, jobs and permission checks. Preserve fixed product decisions and record tunable defaults. Include its Discord flow, admin controls, persistence, failure recovery and meaningful acceptance tests. Run checks appropriate to the changes, fix failures and update handoff docs. Stop only at a completed phase boundary or a genuine blocking dependency; do not call a module complete because its UI exists. Do not deploy to production.

### Focused task prompt

> Implement [named task] within phase [number]. Read only the relevant master-spec sections and current domain interfaces. Describe the concrete result briefly, implement it, verify its important invariants and update the progress checklist. Avoid unrelated rewrites or repeated full-repository reads. Summarise remaining work and blockers accurately.

### Required acceptance scenarios

1. A verified rejoining member passes native joining steps and regains access without repeat CAPTCHA; their wallet/profile remains.
2. Expiring birthday entitlement cannot remove a permanently owned role.
3. A moderator can use Discord cases but cannot enter admin dashboard; a member cannot retrieve stats through commands, components or API.
4. Two concurrent buyers cannot double-spend wallet or last shop item. Ledger balances and inventory holdings reconcile.
5. Buying/selling the same Ingot cycle cannot create profit from post-trade quote misuse; huge scarcity quotes do not overflow; depleted pool rejects buys.
6. Market Collapse consumes one funded charge and moves existing event Ingots; total supply remains 5,000 and backing invariant holds.
7. Edited publication requires new approval and preserves loaded draft data; recurring post gets a fresh message once per occurrence.
8. Contract completion retry/restart awards once; notification opt-out does not prevent payment.
9. Trade edits clear confirmations; combat/expedition-locked gear cannot be traded/rerolled; duplicate item transfer fails atomically.
10. Ranked challenges and queued wagers settle once; repeated-pair rating cap, forfeits, disconnects and system refunds follow published rules.
11. One entrant cannot cash a subsidised lottery; rollover preserves tickets/bonus once and stalled cancellation refunds properly.
12. Two Dead Drop picks of one cell charge once; jackpot closes board; three-pick limit persists; unfound prize rolls once; seed not reissued daily.
13. Blackjack bankroll covers split/double exposure; retries never change cards or pay twice.
14. Voice remains while occupied and deletes six hours after empty; human text resets 24-hour timer, bot text does not; restart preserves timers.
15. Seasonal reset keeps gear/levels/wallets, archives standings and awards winners once.
16. Six-month character curve and sub-10k reference monthly Marks earnings are supported by a reproducible simulation, including combined source limits.
17. All six classes, three regions, roughly 15 enemy types, three bosses and 40–60 gear templates exist as usable content, not empty IDs.
18. Dashboard editor and management flows work on desktop/mobile with keyboard access; denied permissions are enforced server-side.

## 17. Official references and unresolved operational inputs

Cursor must verify current primary documentation before implementing platform-dependent details. Reference URLs:

- Discord application commands and limits: https://docs.discord.com/developers/interactions/application-commands
- Discord interactions: https://docs.discord.com/developers/interactions/receiving-and-responding
- Discord documentation index: https://docs.discord.com/llms.txt
- Official API source (resources, OAuth, gateway, scheduled events, messages/pins): https://github.com/discord/discord-api-docs/tree/main/developers

Operational inputs needed before real activation: application token/client secret, test/production guild IDs, admin role/user mappings, Verified role and onboarding permission map, destination channels, daily Dead Drop hour and lottery time, provider credentials/feed sources, Steam key stock, backing/reward budget funding, hosting domain and backup destination. Local development uses explicitly labelled seed configuration. These missing inputs do not justify stopping unrelated development or claiming an integration works.

Final deliverables from Cursor: runnable repository, setup/deployment README, environment template without secrets, database migrations and seed data, admin dashboard, command manifest, configuration reference, asset requirements, test results, economy/combat simulations, backup/restore guide and full module acceptance checklist. No references to another bot or prior conversation are needed to understand or implement this project.
