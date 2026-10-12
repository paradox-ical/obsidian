# THE COLLECTIVE — Cursor Prompt-by-Prompt Guide

6 October 2026 · Companion to the complete Master Specification v1.0.

## Before you begin

Download the complete `The_Collective_New_Bot_Master_Spec.md` and this guide. Open a new project folder in Cursor. Inside that folder create `docs`, then save the specification as `docs/MASTER_SPEC.md` and this guide as `docs/CURSOR_PROMPTS.md`. These two documents are enough to start: Cursor will create the implementation, configuration templates and working documentation.

Do not paste the whole specification into every message. The prompts point Cursor to relevant sections. Paste ONE numbered prompt at a time into its coding agent. Wait for the result, and check the stated acceptance evidence before moving on. A prompt may require several runs; these are work packages, not promises that everything finishes within a single response or token allowance. Do not select the next prompt simply because Cursor stopped talking.

Use the same working project throughout. A new chat is fine after a documented checkpoint; use the New-chat prompt below first. If your project already contains work, Prompt 1 must preserve it and resume rather than recreate it.

The master specification governs product policy. This guide breaks its 11 phases into 26 smaller prompts; it does not reduce scope or add a second competing specification. Backend, Discord interactions, admin controls and tests belong together. Test substitutes must be labelled, never presented as working external integrations.

### Things you will need later, not all before Prompt 1

- A Discord application/bot and a separate test server, with application and guild IDs.
- Bot token and dashboard OAuth client secret, kept in local environment configuration, never pasted into chat or committed.
- Admin identities/roles, Verified role, and the native onboarding/access configuration.
- Test channel mappings; final production destinations can wait.
- A database and hosting environment. Cursor will document supported local setup and deployment prerequisites.
- Your chosen Dead Drop opening hour and lottery draw time, in Australia/Perth.
- Provider credentials where needed, supported game-update feeds, and Steam key stock when ready.
- Reward, jackpot, house-bankroll and exchange-backing allocations before activation.

Missing secrets should block real-provider testing, not unrelated implementation. Mocked tests are useful but are not proof of live Discord/provider behaviour.

## The prompts — paste in this order

### Prompt 1 — Initialise and build the foundation (phase 0A)

```text
Build THE COLLECTIVE as a new standalone Discord bot and admin-only dashboard using docs/MASTER_SPEC.md. Inspect this project first and preserve existing work. Read sections 1–3, 16 and 17. Verify supported dependency versions from official sources and pin them. Implement the TypeScript repository structure, PostgreSQL/Prisma setup, environment validation, migrations, local Docker development setup, basic bot/admin entry points and CI.

Create docs/PROGRESS.md, DECISIONS.md, DATA_MODEL.md, COMMANDS.md, CONFIG_DEFAULTS.md, OPERATIONS.md and REQUIREMENTS.md. REQUIREMENTS must track every master-spec module and acceptance scenario, not only this prompt. Create docs/BUILD_PROTOCOL.md containing: read progress and relevant spec sections before coding; preserve fixed decisions; use shared services; implement real flows, not placeholder success; add meaningful tests; distinguish live verification from substitutes; record blockers; preserve secrets and user edits; do not deploy or mutate production; update progress and identify the next unfinished task after every run. Add a concise AGENTS.md directing future coding sessions to read that protocol.

Complete only this work package. Run build/type/lint checks and local boot checks where available. Report exact checks and failures; do not claim the rest of the bot is built.
```

### Prompt 2 — Durable jobs, permissions and dashboard authentication (phase 0B)

```text
Read docs/BUILD_PROTOCOL.md, PROGRESS.md and master-spec sections 2–3 and 15. Implement durable PostgreSQL jobs with leases, retries and dead-letter inspection; transactional outbox delivery; the interaction/session router; guild configuration; feature flags; capability authorisation; audit records; and admin-only dashboard authentication boundaries. Add secure Discord OAuth state/session handling and server-side role revalidation. Missing credentials must show setup-required, not fake successful login.

Implement the 36-parent command manifest and legal option-tree/count validation, with explicit test-guild registration tooling. Do not publish commands to production. Test denied member/moderator web access, role removal, stale components, duplicate jobs, restart recovery and outbox retries. Keep operational interfaces reusable for every later module. Update documentation and mark which live OAuth checks remain blocked.
```

### Prompt 3 — Verification, self-select roles, accounts and role entitlements (phase 1A)

```text
Read the build protocol, progress and master-spec section 4. Implement Community-onboarding-aware in-Discord CAPTCHA verification, accessible staff assistance, persisted verified status across rejoins, and the separate Verified role. Validate native pending/onboarding states and the combined permission map; do not replace native rules acceptance.

Implement reaction/button/select role panels that reuse onboarding choices, protected-role exclusions and single/multi-choice rules. Build the role entitlement service, stacking temporary grants and permanent-role overlap handling. Implement optional account handles/privacy/unlink and real provider adapter boundaries, clearly distinguishing self-reported from verified ownership. Provide admin settings and authorised Discord controls. Test rejoin restoration, expired challenges, cooldowns, protected roles and overlapping role expiry. Track unavailable provider credentials explicitly without blocking the other features.
```

### Prompt 4 — Automated moderation, cases, warnings and restricted logs (phase 1B)

```text
Read the protocol, progress and master-spec section 4. Implement configurable spam, mention, link/invite and join-spike automation with exclusions, severity points, safe escalation and staff override. Add manual moderation, case histories, active warning totals, expiry/reversal/appeal handling and private member reports. Respect Discord permission/hierarchy failures and record actual outcomes.

Implement staff-only logs including available message text, excluded channels, retention, audit-actor confidence and unavailable-content labels. Provide admin rule previews and management. Use jobs for sanction expiry and outbox for alerts. Test severity expiry, reversed totals, uncertain attribution, denied access and deletion failures. Never enable an automatic ban policy merely because a heuristic matches. Update the requirements checklist and live-test blockers.
```

### Prompt 5 — Support tickets (phase 1C)

```text
Read the protocol, progress and master-spec section 14 plus the ticket references in section 4. Implement category panels/forms, private tickets, claim/assign/transfer, close/reopen, transcripts, member summaries, separate staff notes, inactivity reminders/closure and member caps/cooldowns. Link tickets to moderation cases and add reusable references for later economy records.

Ensure unverified members can request verification help without gaining general access. Staff-only notes must never appear in member transcripts. Add admin configuration and authorised Discord management. Test role/access changes, ownership, idempotent close/reopen, retention and private export boundaries. Do not mark unrelated purchase dispute integrations complete before their modules exist; record those integration tasks.
```

### Prompt 6 — XP, Dossiers, recruitment, birthdays and achievements (phase 2A)

```text
Read the protocol, progress and master-spec sections 4–5. Implement community chat/voice XP with anti-farming filters, configurable rank bands/roles, Dossiers and private member preferences. Public Dossiers must display Marks/Ingots through a wallet interface, while private account details remain protected. If the ledger is not built yet, keep the integration explicitly pending rather than adding a separate currency implementation.

Implement confidence-based invite attribution, seven-day qualified recruitment defaults and no rejoin rewards. Implement opt-in birthdays, annual gift entitlement and 24-hour role. Add achievements, staff commendations and limited no-currency peer commendations. Rewards must use a shared once-only entitlement/event interface ready for the ledger, not direct ad hoc balance writes. Test duplicate awards, date edits, unknown invites, AFK voice and permanent-role overlap. Add admin controls and update integration blockers.
```

### Prompt 7 — Seasons, leaderboards, staff polls and temporary rooms (phase 2B)

```text
Read the protocol, progress and master-spec sections 5 and 14. Implement three-calendar-month seasons, archived rankings and once-only seasonal award entitlements. Preserve wallets, character progression and gear across rollover. Implement public leaderboards and staff-only poll creation, with voting eligibility enforced. Suggestions are excluded.

Implement temporary voice/text rooms with owner controls, public/private text, creation caps and manual closure. Voice deletion occurs after six continuous hours empty; text deletion after 24 hours without human messages. There is no fixed maximum lifetime. Persist timers, recover after restart and ignore bot text as activity. Test joining during deletion races, ownership transfer, bot-message timer behaviour and denied poll creation. Character/ranked integrations not built yet remain tracked for later verification.
```

### Prompt 8 — Currency ledger, budgets and staff statistics (phase 3A)

```text
Read the protocol, progress and master-spec sections 2, 4–6 and 15. Implement integer/fixed-precision wallets, immutable ledger/reversals, escrow, idempotent rewards, source budgets, member Marks transfers, staff adjustments/bulk grants and receipts. Marks are uncapped. Build public wallet readings and staff-only statistics/exports. Enforce permissions at every command, component and API boundary.

Connect birthday, invite, achievement and seasonal award entitlements from prior prompts to the ledger; finish their integration tests. Implement an aggregate routine earning budget, not an allowance per module. Add a reproducible monthly earning simulation based on the master-spec defaults, with documented assumptions and exceptional funded winners. Test concurrent spends, retries, reversals, caps and negative-balance prevention. Ensure no alternate wallet code remains elsewhere.
```

### Prompt 9 — Ingot exchange and supply/backing invariants (phase 3B)

```text
Read the protocol, progress and master-spec section 6 carefully. Implement exactly 5,000 total Ingots, including 2,500 protected reserve and 2,500 active holdings. Implement the proposed arbitrary-precision discrete scarcity curve, integrated multi-unit quotes, reverse-step sale spread, market revisions, expiring confirmations, backing liability checks and atomic settlement. Baseline is 10,000 Marks and there is no configured price ceiling; zero inventory disables buys.

Implement public market chart/panel and admin supply/backing diagnostics. Provide a funded event-treasury allocation service for later Market Collapse, but do not issue unbacked effects. Test full/depleted inventory, huge quotes, stale confirmations, race conditions, same-unit round trips and backing after inventory returns. Run a supply-conservation simulation and document how future shops/events use these services. Do not substitute a flat price or q times the initial quote.
```

### Prompt 10 — Embed editor and publication approval (phase 4A)

```text
Read the protocol, progress and master-spec section 8. Build the functional admin-only web embed editor, templates, drafts, validation and preview. Implement sending a preview to a selected Discord review channel with Approve, Edit, Request changes and Cancel. Edit must reopen the complete original draft in the authenticated editor. Approval must select the destination and publish now or schedule. Admin self-approval is allowed.

Bind approval to the exact draft revision; editing invalidates it. Keep review controls out of the published content. Add published-message revision/history and destination permission rechecks. Test two-reviewer races, stale buttons, denied review, lost channel permissions and editor round trips with all fields. The editor must really save and publish through shared services, not only render a mock preview.
```

### Prompt 11 — Scheduled posts, pins, stickies, replies and game feeds (phase 4B)

```text
Read the protocol, progress and master-spec section 8. Implement one-off/recurring announcements, calendars, timezone settings, pause/reschedule/cancel, expiry, delivery history and failure alerts. Every recurrence posts a fresh message. Implement bot-managed pins and optional sticky reposts with cooldowns and old-copy cleanup.

Implement conversation and deliberate-trigger auto replies, rule priority/exclusions, safe patterns, random variants and dashboard testing. Ordinary message triggers cannot send ephemeral interaction responses. Implement supported game-update adapters with per-source automatic versus approval-queue modes, deduplication and original-source links. Missing feed access must not fake new updates. Test missed runs, duplicate delivery, mention limits, sticky loops, feed replay and edit approval invalidation. Provide admin management for each feature.
```

### Prompt 12 — Official events, schedules, crews and LFG (phase 5A)

```text
Read the protocol, progress and master-spec section 7. Implement official staff/coordinator events with templates, times/timezones, capacity, RSVP, waitlist, reminders, check-in, verified attendance, recurring occurrences, cancellation and recap. Add native Discord event sync where supported and visible sync failures.

Implement persistent crews with leaders/officers/history and session crews/LFG with game/platform/region, readiness and open/approval joining. Connect optional temporary rooms and attendance rewards to existing services, preventing repeated-session farming. Test capacity/join races, occurrence edits, host transfer, room cleanup and reward-once behaviour. Add functional admin views and authorised Discord flows; mark future RPG mission hooks pending rather than implementing a second crew system.
```

### Prompt 13 — Predictions, contests and giveaways (phase 5B)

```text
Read the protocol, progress and master-spec section 7. Implement free and Marks-staked predictions, entry locking, resolution evidence, proportional funded payouts, deterministic remainders and documented refunds/ties/no-winner rules. Build contests with community voting or staff judging, deadlines, edit rules, weighted criteria, published ties and stocked prizes.

Implement giveaways with one free entry and capped activity-derived bonus entries, immutable closing snapshots, secure random selection, claim deadlines, private fulfilment and audited rerolls. Use shared escrow, inventory/stock interfaces and jobs. Test duplicate activity bonuses, deadline races, cancellations, disqualified winners and once-only payouts. External key delivery can remain an explicitly pending shop integration; do not manufacture prizes to make the test pass.
```

### Prompt 14 — Daily, weekly, monthly and staff Contracts (phase 5C)

```text
Read the protocol, progress and master-spec section 10 and economy section 6. Implement personalised daily assignments, shared weekly/monthly boards, reusable objective evaluators, staff custom riddles/manual submissions and progress displays. Support community objectives now and typed RPG objective hooks for subsequent modules.

Implement one free reroll of an unstarted daily contract, member-controlled refresh notifications and automatic completion payout with configurable completion mentions. Turning off pings cannot disable rewards. Manual approval triggers the same once-only reward path. Freeze versions and cycle identities. Test refresh/reroll/completion races, DM failures, retries, aggregate payout caps and timezone boundaries. Create useful seeded objectives and admin authoring rather than hard-coded sample-only quests.
```

### Prompt 15 — Characters, classes, stats and expensive resets (phase 6A)

```text
Read the protocol, progress and master-spec section 11. Implement separate character/community XP, level 50 cap, three stat points per level gained, bounded Strength/Agility/Endurance/Focus effects and ability loadouts. Seed Hitman, Bruiser, Saboteur, Fixer, Duelist and Gunslinger with real passive/active definitions and milestone unlocks, each viable solo.

Implement 5,000-Mark stat respec with seven-day cooldown and 15,000-Mark class change including respec with 30-day cooldown. Enforce gameplay locks and one restricted introductory reset; preserve level/points and unequip incompatible gear without destroying it. No repeated starter rewards. Test unaffordable/reset races, point conservation, role/class changes and persistent cooldowns. Add admin class/curve management and a six-month progression simulation with clearly defined regular-play assumptions.
```

### Prompt 16 — Gear instances and D20 combat engine (phase 6B)

```text
Read the protocol, progress and master-spec section 11. Implement named gear templates/instances, bounded affixes, binding, class/level requirements, equipment and inventory locks. Shared basic weapons are available to all; selected specialist weapons are class-restricted. Implement the shared D20 combat engine with attack/defence, damage dice, natural 1/20, actions/items, cooldowns, effects, limited reactions and deterministic ordering.

Implement persisted battles, secure persisted rolls, quick auto-resolved duels and tactical action panels against test opponents. Do not yet duplicate queue/rating logic from the later PvP package. Test criticals, healing caps, stacked effects, timeouts, hidden data, item locking and restart recovery. Gear bonuses and allocated stats must remain distinct. Add functional admin content editing and inspectable rules.
```

### Prompt 17 — Regions and timed expeditions (phase 7A)

```text
Read the protocol, progress and master-spec section 11. Implement Backstreets, Black Docks and Inner Sanctum with level-only access; use the seeded level 1/15/35 defaults. Implement one-slot timed expeditions, difficulty tiers, loadout reservation, completion reports, automatic once-only loot/XP and optional notifications. Interactive play while waiting must not violate item locks.

Seed usable content across the launch targets: around 15 enemies, three bosses and 40–60 gear templates, with level bands, reward sources and loot tables. Every entry needs actual mechanics, not only a name. Connect exploration/defeat objectives to Contracts. Test unavailable gear, repeated completion jobs, cooldowns and combined earning caps. Add admin location/enemy/loot management and record remaining interactive mission work accurately.
```

### Prompt 18 — Interactive and crew PvE, recovery and async play (phase 7B)

```text
Read the protocol, progress and master-spec section 11. Implement branching interactive missions with choices, checks, combat, discoveries, retreat and loot. Implement two-to-five-player live and asynchronous crew missions using the existing crew and combat services: readiness, locked loadouts, difficulty scaling, turn deadlines, notifications, automatic defence, participation eligibility, individual loot and limited revives.

Implement failure losing only unbanked loot and triggering free timed recovery, with medkits shortening it. Owned gear/wallets remain safe. Preserve mission state across restart and integrate temporary-room reservations with finite abandonment handling. No energy, hunger, thirst, durability or mandatory story gates. Test stalled missions, missed turns, duplicate rewards, recovery items and crew-member level qualification. Finish corresponding Contract integrations and run progression/reward simulations.
```

### Prompt 19 — PvP queue, challenges, ranking and wagers (phase 8A)

```text
Read the protocol, progress and master-spec section 11. Implement casual/ranked matchmaking queues and direct challenges using the existing combat engine. Ranked play has standardised bases/stat budgets and published equipment/ability limits. Implement rating changes, seasonal integration, records, leaderboards and first-two-ranked-matches-per-opponent/day eligibility.

Support optional equal Marks wagers in both ranked and casual, for queue and direct matches. Agree before starting, escrow atomically, winner takes pot, draws/system cancellations refund and forfeits lose. Queue wager preferences must match. Implement disconnect grace/turn rules and suspicious-pattern review. Test simultaneous matching, accepting/cancelling races, repeated-opponent limits, refund/restart settlement and no duplicate rating/rewards. Repeated-pair matches must not quietly remain reward-eligible ranked games.
```

### Prompt 20 — Trading, marketplace and gear progression (phase 8B)

```text
Read the protocol, progress and master-spec section 11. Implement direct item/Marks trades with inspectable offers, both confirmations and confirmation reset on any edit. Implement fixed-price member marketplace escrow, expiry/cancellation and atomic settlement. Enforce item binding and gameplay locks.

Implement guaranteed capped upgrades, salvage with destruction confirmation, recipe crafting and single-affix rerolls with increasing per-item costs and visible possible outcomes. Trading must preserve rolls, upgrade history and reroll counters. Add admin recipes/caps/ranges and member Discord controls. Test duplicate item races, expired listings, equipped-item protection, trade edits and material/balance conservation. No failure-based item destruction system; randomness belongs in loot and affix rerolls.
```

### Prompt 21 — Supply/Ingot shops, crates and private Steam keys (phase 8C)

```text
Read the protocol, progress and master-spec section 12 and exchange section 6. Implement Marks supply shop, Ingot premium shop and member marketplace navigation. Include stock, prices, purchase limits, requirements, rotating offers, receipts and private Steam key delivery. Keys are direct Ingot-shop only and cannot appear in crates.

Implement earned/Marks-purchased crates and high-end Ingot crates, published odds, minimum guarantees, versioned results, pity counters and duplicate policies. Use persisted outcomes; presentation cannot reroll loot. Ingots spent return to exchange supply only on committed fulfilment; pending purchases use escrow. Test last-stock races, retries, blocked DMs/private fallback, key secrecy, refund restrictions, supply conservation and pity/version changes. Finish giveaway prize-delivery integration and provide real admin shop/loot controls.
```

### Prompt 22 — Funded daily lottery (phase 9A)

```text
Read the protocol, progress and master-spec section 9. Implement the separate daily lottery: 100 Marks/ticket, default five-ticket cap, pooled ticket payments and a reserved 50% Collective bonus. One winning ticket receives the full pool. Show odds, bonus, deadline and budget constraints before charging.

At least three distinct members are required. Otherwise carry entries, pot and the once-funded bonus forward; no repeated subsidy on rollover. Implement secure snapshot draw, persisted settlement/history and published stalled-draw refund policy. Bonus funding failure must prevent purchase, not silently alter payout. Test solo farming, cap across rollover, close/purchase races, retries and long-stall refunds. Add admin schedule/budget settings without assuming the owner has selected the real draw time.
```

### Prompt 23 — Dead Drop board and funded Market Collapse (phase 9B)

```text
Read the protocol, progress and master-spec sections 9 and 6. Implement a dynamically rendered shared 6×6 A–F/1–6 Dead Drop board from reusable art/templates. Preassign one jackpot, smaller rewards and blanks. Paid only, three immediate reveal purchases/member/board, one hour/day; jackpot discovery closes early and the next board opens next day. Unfound jackpot carries to a fresh shuffled board without reissuing its starting seed. Include configured starting prize and ticket-sales share, separately funded smaller rewards and optional reminders.

Implement special reward items including single-use Market Collapse backed by allocated existing event-treasury Ingots. Activation releases those units into the exchange with no minting, protected-reserve use or arbitrary later price reset. Test coordinate races, charge-once, three-pick limits, closing-window races, rollovers, seed funding, hidden positions and duplicate effect activation. Provide admin controls and reusable asset requirements; no need for 36 separate board designs.
```

### Prompt 24 — Solo and social blackjack (phase 9C)

```text
Read the protocol, progress and master-spec section 13. Implement solo blackjack and social tables with independent player hands against a shared dealer/shoe. Include join windows, turn timers, automatic standing, hit/stand/double/split, published table-version rules and precise payouts.

Reserve worst-case exposure from a funded house bankroll before accepting bets, doubles or splits. Persist shoe/cards/turns and hidden dealer information; retries never reroll. Implement receipts, configurable bounds, table caps and audited settlement. Test natural/split blackjack, soft 17, pushes, inactive players, fractional payouts, concurrent joins, depleted bankroll and restart recovery. No hidden forced-loss logic. Add functional admin settings and integrate aggregate economy simulations.
```

### Prompt 25 — Finish the dashboard, operational tools and backups (phase 10A)

```text
Read the protocol, progress and master-spec section 15. Audit every module for a functional admin-only management interface, then finish missing views/editors/previews/validation/history. Members and other staff still use authorised Discord interfaces. Add health/job-failure views, feature maintenance controls, configuration export/import/versioning, safe rollback and simulation tools.

Implement/document database backups, separate encrypted secret recovery and a restoration rehearsal on isolated disposable data. Review retention, uploads/URLs, credential/key redaction, OAuth/CSRF/session access and stale permission checks. Validate dashboard desktop/mobile and keyboard accessibility. Do not call a page complete if its buttons are mocked or disconnected. Update operations, configuration and deployment documentation with real commands for the chosen stack.
```

### Prompt 26 — Full acceptance audit and delivery (phase 10B)

```text
Read the protocol, REQUIREMENTS.md and master-spec sections 1 and 16 in full; consult individual sections for each requirement being checked. Audit the entire finished repository against every module, fixed decision and all 18 acceptance scenarios. Create docs/ACCEPTANCE_REPORT.md with implemented, verified, blocked and missing statuses supported by files/tests, not confidence statements.

Run available build/type/lint/unit/integration/security checks, command count/tree validation, supply/ledger reconciliation, earning/progression simulations and backup restoration verification. Repair ordinary defects and missing authorised work in bounded batches. External tests must be marked unverified if credentials/test access are absent. Include exact test-guild manual acceptance steps and secret-safe setup instructions. Deliver a runnable project, not a summary pretending deployment happened. Do not touch production; finish with the actual remaining prerequisites and a production rollout/rollback checklist requiring my separate instruction to execute.
```

## Reusable prompts when Cursor stops or loses context

### Continue the same unfinished package

Use this instead of moving to the next numbered prompt.

```text
Read docs/BUILD_PROTOCOL.md and PROGRESS.md. Continue the current numbered work package from its first incomplete task. Do not restart, repeat planning or move to the next package. Read only the relevant specification sections and implementation interfaces. Finish implementation, add missing tests and fix ordinary failures. Update the checkpoint with concrete completed work, verification evidence, blocked external checks and the next task. If the package is too large for this run, complete one coherent part and preserve a precise continuation note.
```

### Start a new chat without restarting the project

```text
This is the existing THE COLLECTIVE project. Read AGENTS.md, docs/BUILD_PROTOCOL.md and PROGRESS.md before editing. Summarise the current work-package number and first incomplete task in two sentences, then continue that task. Read only its relevant MASTER_SPEC sections and code interfaces. Preserve all existing implementations, fixed decisions and user changes; do not scaffold the repository again. Update the progress/checklist after meaningful verification.
```

### Fix failed checks before advancing

```text
Read the build protocol and latest progress. Diagnose and fix the currently failing checks for this work package without weakening product requirements, removing assertions or marking real integrations successful through mocks. Run the relevant checks again. Report exact remaining failures and update PROGRESS.md. Stay within this package; unrelated existing failures should be recorded separately rather than hidden.
```

### If it says “done” but features are placeholders

```text
Audit the current work package against MASTER_SPEC and REQUIREMENTS. Inspect actual service calls, storage, permission boundaries and error paths behind every command/dashboard control. Replace mock successes, TODO-only handlers and disconnected buttons with working implementations. Distinguish test fixtures from real product behaviour. Add acceptance tests and correct any inaccurate completion claims in the progress documents.
```

### Secret-safe test-server setup, after local implementation

```text
Review docs/OPERATIONS.md and the implemented environment/configuration schema. Give me a numbered, beginner-friendly setup checklist for my separate Discord test server and local dashboard. Identify exact required environment variable names and where I obtain each value, without asking me to paste tokens or secrets into chat. Explain required bot permissions/intents, OAuth redirect configuration, role/channel mappings and module funding. Validate available local configuration without printing secret values. Do not register commands or mutate a guild until I explicitly identify the test guild and authorise the test setup.
```

## How to tell when you can move on

Each Cursor response should identify:

1. The numbered work package and what was actually built.
2. Tests/checks run and their results, separating fixtures from live integration.
3. Remaining incomplete work and genuine external blockers.
4. Updated PROGRESS/REQUIREMENTS entries and the next exact task.

An external credential blocker can coexist with completed local implementation, but the feature remains live-unverified and must be revisited. If Cursor merely provides a plan, ask it to implement. If it did only part of a prompt, use the continuation prompt. After Prompt 26, production launch is a separate decision; generated deployment instructions alone are not permission to execute it.

The final repository should include code, migrations, usable content seeds, real admin tools, test evidence, simulations, environment templates, asset requirements, setup/deployment instructions and backup/restore procedures. Keep the specification intact as the source of truth.
