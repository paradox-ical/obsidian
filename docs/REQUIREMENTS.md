# Requirements

Status values: `not_started`, `implemented`, `tested`, `blocked`.

`implemented` means the repository contains the behaviour. `tested` means a check in `docs/PROGRESS.md` exercised it. A local or unit check is not live Discord verification. Package 1 does not mark product modules complete.

## Package 1 foundation

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| F-01 | TypeScript modular monolith: `apps/bot`, `apps/admin`, `packages/domain`, `packages/db`, `packages/ui`, `docs` | tested | `npm run build` and `npm run typecheck` passed |
| F-02 | Supported dependency versions verified and pinned | tested | `docs/DECISIONS.md`; Docker bot container reported Node.js v24.21.0 |
| F-03 | Environment validation that does not echo secrets | tested | `packages/domain/src/env.test.ts` |
| F-04 | PostgreSQL, Prisma, and a committed migration | tested | Migration `20261007090000_foundation` applied; integration test passed |
| F-05 | Local Docker Compose boots database, bot, worker, and admin | tested | All four Compose services became healthy |
| F-06 | Bot entry point with real gateway login only when credentials exist | tested | Boot and Compose health returned `discord: setup_required`. Live login was not run. |
| F-07 | Admin entry point that denies access and does not simulate login | tested | `/health` returned `access: denied`; the page contains the access-closed text |
| F-08 | CI for build, types, lint, unit tests, migration, and boot | implemented | `.github/workflows/ci.yml` exists. GitHub Actions was not executed. |
| F-09 | 36-parent command names held under the Discord and project ceilings | tested | `packages/domain/src/commands.test.ts`. Commands were not registered. |

## Phase 0 remainder (package 2)

Local tests use PostgreSQL and a fake Discord directory. They are not live Discord verification.

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| F-10 | Durable PostgreSQL jobs with leases, retries, backoff, and dead-letter inspection | tested | `packages/db/src/platform.integration.test.ts` |
| F-11 | Transactional outbox; persist state before Discord sends | tested | Same file: rollback plus one retry then delivery |
| F-12 | Interaction router with persisted sessions, actor checks, expiry, and revision checks | tested | Stale session stays unconsumed; component route denies a member |
| F-13 | Guild configuration, feature flags, and versioned definitions | tested | Drafts are inactive; verification maintenance is rejected |
| F-14 | Capability permissions, audit records, and staff override reasons | tested | Empty audit reasons are rejected; statistics capability is separate from web access |
| F-15 | Admin-only Discord OAuth, secure state, CSRF where applicable, and server-side role revalidation | tested | Fake directory only. Live token exchange and live member lookup are blocked |
| F-16 | Legal option trees for the 36 parents and explicit test-guild registration tooling | tested | `commands.test.ts` and `register.test.ts`. No command PUT was sent |
| F-17 | Denied member and moderator web access, with guild-owner recovery access | tested | `apps/admin/server/auth.integration.test.ts` |

## Section 4 — Community administration

| ID | Requirement | Status |
|---|---|---|
| C-01 | Native Community onboarding first; in-Discord CAPTCHA after; verified status restored on rejoin without another CAPTCHA | tested |
| C-02 | Separate Verified role, accessible staff assistance, audited manual verification, fail closed on missing eligibility | tested |
| C-03 | Reaction, button, and select role panels with prerequisites, exclusive groups, and no privileged self-select roles | tested |
| C-04 | Optional linked accounts, self-reported handles distinct from verified ownership, no ordinary-access block | tested |
| C-05 | One role-entitlement service; stacked durations; expiry removes a role only when no grant or permanent ownership remains | tested |
| C-06 | Invite snapshots and confidence; seven-day qualified recruitment; one award per recruited member; no rejoin reward | tested |
| C-07 | Opt-in birthdays, 24-hour role, one annual gift, date-edit controls, and user deletion | tested |
| C-08 | Configurable moderation automation that does not ban on one uncertain heuristic | tested |
| C-09 | Cases, weighted warnings, appeals, hierarchy failures recorded as failures | tested |
| C-10 | Restricted logs with unavailable-content labels and uncertain audit actors | tested |
| C-11 | Staff-only aggregate statistics and exports | tested |

## Section 5 — Progression, Dossiers, seasons

| ID | Requirement | Status |
|---|---|---|
| P-01 | Community chat and voice XP with anti-farming filters and ten configurable rank bands | tested |
| P-02 | Dossiers with public Marks and Ingots; private inventories, birthdays, and account visibility | tested |
| P-03 | Member leaderboards for the specified categories, including archives and estimated wealth labelled as estimated | tested |
| P-04 | Three-calendar-month seasons; Seals and ranked rating reset; progression, gear, and wallets retained; awards once | tested |
| P-05 | Achievements, staff commendations, and limited no-currency peer commendations | tested |

## Section 6 — Economy and Ingot exchange

| ID | Requirement | Status |
|---|---|---|
| E-01 | Integer or numeric ledger, escrow, idempotent rewards, source budgets, transfers, and reversals | tested |
| E-02 | Uncapped Marks issued only by explicit reward services; aggregate earning budget and reproducible monthly simulation | tested |
| E-03 | Exactly 5,000 Ingots, including 2,500 protected reserve and 2,500 active holdings | tested |
| E-04 | Discrete scarcity curve, integrated multi-unit quotes, reverse-step sale spread, expiring confirmations, atomic settlement | tested |
| E-05 | Backing liability, no silent minting, paused curve edits, and alerts on broken invariants | tested |
| E-06 | Market Collapse consumes one funded charge and moves existing event-treasury Ingots | tested |

## Section 7 — Events and activities

| ID | Requirement | Status |
|---|---|---|
| A-01 | Official events, RSVP, attendance, recurrence, and visible native scheduled-event sync failures | tested |
| A-02 | Persistent crews and session crews / LFG, without a second crew system for RPG | tested |
| A-03 | Free and staked predictions with proportional funded payouts and idempotent resolution | tested |
| A-04 | Contests with voting or judging, published ties, and stocked prizes | tested |
| A-05 | Giveaways with one free entry, capped activity bonuses, immutable snapshots, and audited rerolls | tested |

## Section 8 — Publications

| ID | Requirement | Status |
|---|---|---|
| U-01 | Admin embed editor, drafts, validation, and preview | tested |
| U-02 | Review channel flow; edit reloads the original draft; approval binds one revision and then selects the destination | tested |
| U-03 | One-off and recurring announcements; every occurrence is a fresh message; missed runs do not flood | tested |
| U-04 | Bot-managed pins and optional sticky reposts | tested |
| U-05 | Auto replies from conversation or deliberate triggers; ordinary messages cannot send ephemeral interaction responses | tested |
| U-06 | Supported game-update adapters with automatic or approval-queue mode; missing feeds stay unavailable | tested |

## Section 9 — Lottery and Dead Drop

| ID | Requirement | Status |
|---|---|---|
| G-01 | Daily lottery at 100 Marks, five-ticket default cap, 50 percent funded bonus, three-entrant minimum, and rollover without a second subsidy | tested |
| G-02 | Dead Drop 6×6 paid board, three picks, one configured hour, jackpot closes the board, unfound jackpot rolls once | tested |

## Section 10 — Contracts

| ID | Requirement | Status |
|---|---|---|
| Q-01 | Personal daily selection, shared weekly and monthly boards, one unstarted daily reroll, and once-only automatic payout | tested |
| Q-02 | Notification preferences; disabling completion pings does not forfeit rewards | tested |

## Section 11 — RPG, combat, and equipment

| ID | Requirement | Status |
|---|---|---|
| R-01 | Separate character progression, level 50, six classes, stat points, respec, and class change at the fixed prices and cooldowns | tested |
| R-02 | Named gear instances, bounded affixes, binding, and inventory locks | tested |
| R-03 | Shared D20 combat engine, quick and tactical play, persisted rolls | tested |
| R-04 | Casual and ranked queues and challenges, optional equal Marks wagers, repeated-pair rating limits | tested |
| R-05 | Three regions, expeditions, interactive and crew missions, recovery, and seeded enemies, bosses, and gear | tested |
| R-06 | Trades, marketplace, upgrades, salvage, crafting, and single-affix rerolls | tested |

## Section 12 — Shops and crates

| ID | Requirement | Status |
|---|---|---|
| S-01 | Marks supply shop, Ingot premium shop, and member marketplace | tested |
| S-02 | Steam keys only in the direct Ingot shop, delivered privately, never in crates | tested |
| S-03 | Crates with published odds, pity, versioned results, and no presentation reroll | tested |

## Section 13 — Blackjack

| ID | Requirement | Status |
|---|---|---|
| B-01 | Solo and social blackjack, exact minor-unit payouts, and house-bankroll exposure reserved before bets | tested |

## Section 14 — Support, rooms, and polls

| ID | Requirement | Status |
|---|---|---|
| T-01 | Private tickets, transcripts, staff-only notes, and verification help without general access | tested |
| T-02 | Temporary voice and text rooms with the six-hour and 24-hour inactivity rules and no maximum lifespan | tested |
| T-03 | Staff-created polls only; suggestions excluded | tested |

## Section 15 — Admin dashboard and operations

| ID | Requirement | Status |
|---|---|---|
| D-01 | Admin-only OAuth dashboard for every configured module; no member dashboard or public admin API | tested |
| D-02 | View, edit, validate, preview, and publish controls; drafts distinct from active configuration | tested |
| D-03 | Backups, separate encrypted secret recovery, restore rehearsal, and health metrics | tested |
| D-04 | Desktop, mobile, and keyboard access with server-side permission checks | tested |

## Acceptance scenarios

All 18 scenarios from master spec section 16 are required. The status column is the current local result. A local test is not live Discord verification.

| ID | Scenario | Status |
|---|---|---|
| AC-01 | A verified rejoining member passes native joining steps and regains access without repeat CAPTCHA; wallet and profile remain | tested |
| AC-02 | An expiring birthday entitlement cannot remove a permanently owned role | tested |
| AC-03 | A moderator can use Discord cases but cannot enter the admin dashboard; a member cannot retrieve stats through commands, components, or API | tested |
| AC-04 | Two concurrent buyers cannot double-spend a wallet or the last shop item; ledger and inventory reconcile | tested |
| AC-05 | An Ingot buy/sell cycle cannot profit from post-trade quote misuse; huge quotes do not overflow; a depleted pool rejects buys | tested |
| AC-06 | Market Collapse consumes one funded charge and moves existing event Ingots; supply remains 5,000 and backing holds | tested |
| AC-07 | An edited publication requires new approval and preserves loaded draft data; a recurring post sends one fresh message per occurrence | tested |
| AC-08 | Contract completion retry or restart awards once; notification opt-out does not prevent payment | tested |
| AC-09 | Trade edits clear confirmations; combat or expedition-locked gear cannot be traded or rerolled; a duplicate item transfer fails atomically | tested |
| AC-10 | Ranked challenges and queued wagers settle once; repeated-pair caps, forfeits, disconnects, and system refunds follow the published rules | tested |
| AC-11 | One entrant cannot cash a subsidised lottery; rollover preserves tickets and bonus once; stalled cancellation refunds properly | tested |
| AC-12 | Two Dead Drop picks of one cell charge once; jackpot closes the board; the three-pick limit persists; an unfound prize rolls once; seed is not reissued daily | tested |
| AC-13 | Blackjack bankroll covers split and double exposure; retries never change cards or pay twice | tested |
| AC-14 | Voice remains while occupied and deletes six hours after empty; human text resets the 24-hour timer; bot text does not; restart preserves timers | tested |
| AC-15 | Seasonal reset keeps gear, levels, and wallets, archives standings, and awards winners once | tested |
| AC-16 | Six-month character curve and sub-10k reference monthly Marks earnings are supported by a reproducible simulation | tested |
| AC-17 | All six classes, three regions, about 15 enemy types, three bosses, and 40–60 gear templates exist as usable content | tested |
| AC-18 | Dashboard editor and management flows work on desktop and mobile with keyboard access; denied permissions are enforced server-side | tested |

## Package 2 notes on later rows

D-01 and D-02 stay `not_started`. Package 2 enforces the admin boundary and stores draft versus published configuration. It does not provide module editors, preview, or a dashboard page per product module. At the end of package 2, AC-03 stayed `not_started` because Discord cases were not built. The tested part then was the denial: a moderator grant does not open the dashboard, and a member cannot read statistics through the command helper, a component session, or `/api/stats`.

## Package 3 notes on later rows

C-01 through C-05 were exercised against local PostgreSQL with generated CAPTCHA images and an injected ownership adapter. They are not live Discord or live provider checks. AC-01 stays `not_started` because wallets and profiles were not built in that package; the rejoin half restored Verified access without a new CAPTCHA. At the end of package 3, AC-02 stayed `not_started` because birthdays were not built; the entitlement service was tested with a permanent panel role overlapping an expired temporary grant. Package 6 covers the birthday overlap. C-06 and C-07 were `not_started` until package 6.

## Package 4 notes on later rows

C-08 through C-10 were exercised against local PostgreSQL. A saved rule that asks for a ban is stripped, and a repeat match does not ban. Expired and reversed warnings stay in history and leave the active total. Two audit candidates stay `unknown`. A missing message is stored as a failed delete. A member without moderation cannot read logs or statistics. AC-03 is `tested` for that split: moderation capability can record a case, and dashboard routes still deny a session-less caller. The Discord REST calls and the audit-log query were not live. Package 4 left C-11 `not_started`. Package 8 covers the statistics report.

## Package 5 notes on later rows

T-01 was exercised against local PostgreSQL. An unverified member can open verification help, and that ticket does not create a verification record or a role entitlement. Staff notes are absent from the member transcript. Close and reopen are idempotent. After retention, reopen is refused and message text is cleared. A removed tickets role cannot export or annotate. Purchase and reward ids can be stored, and their integration status stays `module_not_built`. T-02 and T-03 stay `not_started`. Shop, economy, and reward modules are not complete.

## Package 6 notes on later rows

C-06, C-07, P-01, P-02, and P-05 were exercised against local PostgreSQL. Unknown invites are not rewarded. A rejoin does not create a second recruitment reward. AFK voice awards nothing. A birthday date edit inside the cooldown is refused. The same year's gift is recorded once, with ledger status `module_not_built`, and no Marks balance is written. AC-02 is `tested` for the entitlement overlap: expiring the birthday grant leaves the permanent grant holding the role. The Discord role API was not called. Character, event, and contract fields stay `module_not_built`.

## Package 7 notes on later rows

P-03, P-04, T-02, T-03, AC-14, and AC-15 were exercised against local PostgreSQL. Community XP is archived and kept. Seasonal Seals reset by season id, and lifetime Seals stay. The season award is one title and one Marks reward event, and a second rollover does not add another. Marks, Ingots, PvP, Contracts, and estimated wealth return `module_not_built`. Estimated wealth is labelled estimated and price-sensitive. No balance is shown. Character progression, gear, region unlocks, and ranked ratings are not stored; rollover records them as retained and does not invent or delete them. A member cannot create a poll. A suggestion is excluded. A vote without an eligible role is refused. Anonymous member results omit voter ids, and the vote row remains. Joining an empty voice room cancels deletion. Bot and system text do not move the text timer. A room older than any fixed lifetime stays open after a human message. The voice cleanup time is a PostgreSQL job. Closing an occupied voice room records disconnect delivery as `setup_required` and does not claim the members were disconnected. Creating a room writes no reward. Discord channel create and delete were not called.

## Package 8 notes on later rows

E-01, E-02, and C-11 were exercised against local PostgreSQL. Marks use 100 minor units in `bigint`. A repeated reward key does not pay twice. Two concurrent holds of the full available balance let one succeed, and available plus escrow stays equal to the original credit. A reversal restores the balance, leaves the original row, and a second reversal does not pay again. A transfer does not increase issuance spent. The shared routine cap is 7,987 Marks; one more Mark from another source is refused and the balance stays. A remove or transfer larger than available writes nothing. A member without economy operations cannot adjust. A bulk grant pays each named member once. An exceptional 5,000 Mark prize posts only after that pool is funded and does not consume the routine cap. The simulation total is 7,987, and 10,000 takes 2 months. Birthday, recruitment, recruiter achievement, and the seasonal Marks award post. Correcting an invite reverses the 100 recruitment Marks and leaves the 25 achievement Marks. A second season rollover does not add Marks. Ingots and estimated wealth stay `module_not_built`. Discord statistics deny a member and a moderator. A dashboard owner can read `/api/stats` without the statistics capability, and a session-less caller receives 403. AC-04 stays `not_started`: the wallet race is covered, and the last shop item is not built. AC-16 stays `not_started`: the Marks month is simulated, and the character curve is not. P-02, P-03, P-04, and AC-15 stay `tested` with real Marks balances. Character, gear, and ranked ratings stay unstored.

## Package 9 notes on later rows

E-03, E-04, E-05, AC-05, and the funded-charge half of E-06 and AC-06 were exercised against local PostgreSQL. Supply stays 5,000, with the protected 2,500 refused by ordinary release. A two-unit buy is not 20,000. A round trip at a full pool pays 10,000 and receives 9,500. An expired quote and a quote whose curve changed are not charged a new price. Two concurrent confirms of one unit let one commit. Inventory 0 refuses a buy. The last-unit quote is 156,250,000,000,000 Marks and stays inside `bigint`. Returning a shop-held Ingot to inventory does not withdraw backing. A collapse charge can be created only from treasury Ingots, activates once, returns those units to inventory, and leaves backing unchanged. An empty treasury cannot create a charge. Dead Drop discovery, the chance-game flow, and a live announcement channel are not built. Shops, crates, and lottery stay unbuilt; the shop helpers are the later boundary. A broken backing invariant and an unpayable sell write an audit row. No Discord alert was sent. AC-04 stays `not_started` because the last shop item is not built. AC-16 stays `not_started` because the character curve is not built.

## Package 14 notes on later rows

Q-01, Q-02, and AC-08 were exercised against local PostgreSQL. Two refreshes produced three assignments. Two rerolls produced one replacement, and an assignment with progress could not be rerolled. Two completing notes produced one ledger row. Manual approvals of 50 and 50 paid 50 then 30 against the 80 Mark daily cap. A 250 Mark weekly payout left that daily spent unchanged. A member already at the 7,987 routine cap completed with payout zero. A closed DM stored `failed` with an empty public body, and a later retry did not pay again. Completion pings off stored `skipped` and still posted the ledger row. An authored riddle paid once. RPG kinds returned `module_not_built` and were not on the daily board. Contract DMs, completion mentions, and live chat or voice intake were not sent to Discord. The contracts page was opened without a session and did not assign or pay. The authenticated forms were not clicked because Discord OAuth is setup-required.

## Package 15 notes on later rows

R-01 and AC-16 were exercised against local PostgreSQL. Level 1 starts with zero earned points and level 50 has 147. Chat raises community XP and leaves character points unchanged. A selected contract with 1,200 character XP pays once. Two respecs against 5,000 Marks produce one debit and one refusal. 4,999 Marks changes nothing. Two class changes against 15,000 Marks produce one change; level, XP, and earned points stay, and the starter reward is not inserted again. A Hitman item is unequipped and not destroyed. The introductory reset works once below level 10, then refuses a second use, level 10, and a ranked debut. A combat lock spends no Marks. The cooldown is still in the future on a later read. The default curve reaches level 50 in 26 weeks of four 1,200 XP sessions, and 122,500 XP is the cost of that climb. The Marks month remains 7,987 and is not added to the character curve. A season rollover keeps the character row. Gear, combat, regions, and ranked ratings stay unbuilt. No character command was sent to Discord. The characters page was opened without a session and did not choose a class, respec, or spend Marks. The authenticated forms were not clicked because Discord OAuth is setup-required.

## Package 16 notes on later rows

R-02 and R-03 were exercised against local PostgreSQL. A field knife with keen +2 shows accuracy from gear at 2 and accuracy from allocated stats at 0. An affix of 3 is refused and creates no row. The custom revolver refuses a Hitman, and the suppressed rifle refuses level 1. The same quick-duel key returns the stored battle and the same rolls. The member view omits the unrevealed opponent attack, and the staff view still has it. Equipped gear locked by the duel cannot be unequipped, and the transfer decision returns locked. A second timeout sweep at the same timestamp does not add another defend. Repeating an action key stores one action. After the battle, a class change unequips the rifle and leaves `destroyed` false. The unbound knife can transfer. The bound rifle cannot. Editing the knife template moves the definition to version 2 and leaves the instance affix at 2. Season rollover keeps the gear row and reports gear retained. A natural 20 doubles the dice and not the flat bonus. Healing stops at 8 and at maximum health. Defend does not stack and bleed caps at 2. No duel was posted to Discord. Casual queues, ranked ratings, and wagers were not resolved. AC-09 stays `not_started` because trades, marketplace edits, and rerolls are not built; the combat-lock half refuses unequip and transfer while the item is locked. AC-17 stays `not_started`: this package seeds 11 templates and 2 test opponents, not about 15 enemies, 3 bosses, and 40–60 templates. R-04, R-05, and R-06 stay `not_started`. The combat page was opened without a session and did not equip gear, start a duel, or change a roll. The authenticated forms were not clicked because Discord OAuth is setup-required.

## Package 17 notes on later rows

The region, expedition, and catalogue half of R-05 was exercised against local PostgreSQL. AC-17 is `tested`: six classes were already present, and this package seeds Backstreets, Black Docks, and Inner Sanctum at levels 1, 15, and 35, 15 enemies, 3 bosses, and 48 gear templates. Each enemy ability and each template mechanic is defined, not only named. Black Docks refuses level 1. A reserved knife cannot be unequipped, and a duel during the expedition leaves that lock in place and uses no gear accuracy. The stored enemy and the unavailable maul stay as they were when the expedition started. A second completion sweep grants nothing. The cooldown refuses an immediate restart. Combined with a 350 XP row, the next 40 XP grant is 10. A member already at the routine cap receives the XP and no Marks. Exploration and defeat objectives pay once through the existing contract path. Season rollover keeps the expedition and reports region unlocks retained. R-05 stays `not_started` because interactive missions, crew missions, and recovery are Prompt 18. Defeat banks no loot and does not destroy gear, and it does not start a recovery timer. R-04, R-06, AC-09, and AC-10 stay `not_started`. No expedition report was posted to Discord. The regions page was opened without a session and did not start an expedition, reserve gear, or change a loot table. The authenticated forms were not clicked because Discord OAuth is setup-required.

## Package 18 notes on later rows

R-05 is `tested`. The mission half was exercised against local PostgreSQL after the region and expedition half in package 17. Dock Signal refuses level 1. A mission lock blocks unequip, class change, and a quick duel, and the duel does not clear that lock. A lost fight mints nothing, leaves owned gear `destroyed` false, writes no ledger debit, and starts recovery at 30 minutes. The recovery medkit shortens it once to 15 minutes. A second use is refused, and the battle medkit stays intact. A won Yard Run banks one bandage. A second close does not mint again. The loft text says the clue does not raise the level gate, and the unavailable maul is not minted. Retreat drops unbanked loot and does not move recovery. Exploration pays on completion and a defeat objective pays only on a win. A level 1 member cannot ready Black Docks. A two-member Backstreets crew reserves a text room whose channel stays `pending`, scales the enemy, and pays each eligible member once. A later strike does not pay again. Two missed turns exclude a member. When every seat is excluded the crew fails, recovery starts, and no loot is minted. A forming mission past six hours is abandoned with no rewards. An active mission past that time closes its room. Season rollover keeps the mission row and reports mission state retained. The recovery medkit brings the catalogue to 49 templates, still inside 40–60. AC-17 stays `tested`. R-04, R-06, AC-09, and AC-10 stay `not_started`. No mission notice was posted to Discord. The regions page was opened without a session and did not start a mission, shorten recovery, or reserve a crew room. The authenticated forms were not clicked because Discord OAuth is setup-required.

## Package 19 notes on later rows

R-04 and AC-10 are `tested`. Casual and ranked queues, direct challenges, and equal Marks wagers were exercised against local PostgreSQL. Two simultaneous ranked joins created one match. Equal ratings moved by 16, and a second settle did not add another reward or another rating change. The second ranked match the same day stayed eligible and paid once. The third ranked offer was casual and ineligible before acceptance, and accepting it did not change rating or pay the ranked reward. A later ranked queue for that pair stayed proposed and casual until it was cancelled. An equal 10 Mark wager paid the pot once. A draw refunded both stakes, and accepting again did not move Marks. Both players disconnecting past the grace cancelled the match and refunded. An accept and cancel race held the stake at most once. A wallet that could not cover the stake cancelled the match and left the other wallet untouched. Different queue stakes did not pair. One disconnect inside the grace stayed active, and after two minutes the disconnected player forfeited the pot with no system reward. The first missed tactical turn defended, a sweep at the same time did not add another miss, and that player's second miss forfeited. Three alternating wagered wins opened one review and did not reverse the pots. Season rollover archived the PvP board, kept the rating row, and the next season started at 1,000 with lifetime wins copied. Owned gear stayed intact. No Discord id was written. R-06, AC-09, shops, lottery, trades, crafting, and Market Collapse discovery stay unfinished. The combat page was opened without a session and did not join a queue, accept a challenge, or settle a wager. The authenticated forms were not clicked because Discord OAuth is setup-required.

## Package 20 notes on later rows

R-06 and AC-09 are `tested`. Direct trades, fixed-price listings, upgrades, salvage, crafting, and single-affix rerolls were exercised against local PostgreSQL. Two offers of one item created one trade and one locked refusal. Confirming one side left the offer proposed. An edit raised the version and cleared both confirmations. Both confirmations of that version settled once, the second confirm moved no Marks, and the combined balance stayed the same. The traded item kept its reroll count. A bound rifle was refused. An equipped item could not be offered or rerolled. An expedition lock blocked a trade and a reroll. A combat lock blocked an upgrade. Two buyers of one listing produced one sale, the seller gained the price once, and the other buyer's balance stayed unchanged. Sweeping at the listing deadline returned the item to the seller and moved no Marks. A second sweep at that time expired nothing. Salvage preview left the item intact. Two confirmed salvages paid 2 scrap, one craft spent them and created the published honed knife, and a second craft wrote nothing. An upgrade spent 25 Marks and 1 scrap, reached tier 1, and left `destroyed` false. A later upgrade with no scrap left the tier at 1. An assigned crafting objective completed once. S-01 stays `not_started` because the Marks supply shop, the Ingot shop, crates, and private key delivery are not built. No key was created. The combat page was opened without a session and did not offer a trade, list gear, or confirm salvage. The authenticated forms were not clicked because Discord OAuth is setup-required.

## Package 26 notes on later rows

AC-01 is `tested` locally. `packages/db/src/community.integration.test.ts` restores a verified member without a new CAPTCHA and leaves the Marks wallet at 2500 available and 100 escrow, with the dossier bio unchanged. Discord did not emit a leave or join. `docs/ACCEPTANCE_REPORT.md` records the 12 October 2026 build, type, lint, unit, integration, audit, command-plan, simulation, ledger query, and backup rehearsal. `npm audit` reported four high transitive findings. They were not fixed because the offered fix downgrades Prisma from 7.10.0 to 6.19.3. Live Discord, OAuth, provider exchange, and the production checklist stay unverified. Signed-in dashboard forms were not clicked.

## Package 25 notes on later rows

D-01, D-02, D-03, D-04, and AC-18 are `tested`. Every configured module has an admin route. Logged-out pages show the closed shell and no authoring form. Unauthenticated operations, economy, market, community, moderation, ticket, and season routes returned 403. Provider status is behind the same session. Draft configuration stays inactive until publish. Rollback copies an older version and leaves history in place. Verification and moderation maintenance returns `protected`. The simulation result is `grants: none`. `npm run backup:rehearse` restored into `collective_rehearsal`, confirmed revision `0x` and a disposable marker, and dropped that database. The marker was not in the live database. `npm run backup:secrets` printed `setup_required` because `BACKUP_PASSPHRASE` was unset, so no secret file was written. The logged-out home, operations, community, and economy pages were opened in the browser. A 390-pixel viewport did not overflow the operations page. The skip link is in the tab order. Authenticated forms were not clicked because Discord OAuth is setup-required.

## Package 24 notes on later rows

B-01 and AC-13 are `tested`. Solo and social blackjack were exercised against local PostgreSQL. A quote before the house bankroll could cover a split and two doubles returned `unfunded` and did not charge. Funding three Marks still could not open a bet. One more Mark covered exactly one worst-case reserve. A second member was refused, a blank cancel reason refunded nothing, and the real cancel returned the stake and the reserve once. Two members racing for the last social seat produced one charge. A natural paid 1.50. A split ace and ten paid 1.00. Two naturals pushed. Standing on soft 17 left the dealer on two cards and pushed a matching 17. The same shoe after the rules changed to hit soft 17 drew further cards and paid 1.00, while the earlier table kept the stand rule. An inactive player with 20 won 1.00 when the dealer had 17. A double paid 2.00 from the reserve already held, and a second double did not charge again. The same hit key returned the stored card, the next hit took the next stored card, and a second settlement did not pay again. A dealer natural settled without offering a hit. The issue count did not rise during play. The logged-out blackjack page showed the closed shell, the 10 Mark maximum, the 40 Mark worst loss beside the 7,987 Mark month, and the 1.50 natural. The authoring form was not shown.

## Package 23 notes on later rows

G-02 and AC-12 are `tested`. The Dead Drop board and a funded Market Collapse reward were exercised against local PostgreSQL. A quote before a saved opening hour returned `schedule_required` and did not charge. A 10 Mark seed budget could not open the board. The quote showed the price, the 50 percent jackpot share, and the treasury share, and it did not charge. Pausing the board charged nothing. Two buys of one cell produced one reveal, and two members buying that same cell charged once. Three picks were stored and a fourth quote charged nothing. A pick racing the close was charged once or refused, and the unfound jackpot rolled to the next day with the same prize and no second seed. A second close did not add a seed. The closed board's history showed the jackpot cell, and the new board's preview did not. Finding the jackpot paid once, left the next board scheduled for the following day, and reserved a new seed. A collapse special stayed unattached while the event treasury was empty. After one treasury Ingot was allocated, the next board reserved that charge. Two activations returned it to inventory once, left the protected reserve at 2,500, kept the 5,000 supply, left backing unchanged, and did not edit the curve. A blank cancel reason refunded nothing. The real cancel refunded the one open pick and released the unpaid seed, and a second cancel did not pay again. Audit reasons did not contain the hidden coordinate or the charge id. AC-13, blackjack, stays `not_started`. The Dead Drop page was opened without a session and did not buy a pick, save an opening hour, fund a prize, or activate a charge. The authenticated form was not clicked because Discord OAuth is setup-required.

## Package 22 notes on later rows

G-01 and AC-11 are `tested`. The funded daily lottery was exercised against local PostgreSQL. A quote before a saved draw time returned `schedule_required` and did not charge. A 40 Mark budget could not reserve the 50 Mark bonus, the quote said so, and the wallet stayed unchanged. A later quote showed entries, tickets, odds, a 100 Mark contribution, a 50 Mark subsidy, the deadline, and the stall time, and it did not charge. Repeating the purchase key and confirming it twice in parallel created one stake. Five tickets on one member rolled forward with the same 500 Mark pot and 250 Mark reserved bonus. A sixth ticket was refused. Two more members joined. A purchase racing the close left one stored winner, the pot matched the ticket count, and a second close with a different index did not pay again. A later three-member draw that reached the stall deadline refunded every stake, returned the reserved bonus, and a second refund did not pay. G-02, Dead Drop, and Market Collapse discovery stay `not_started`. The lottery page was opened without a session and did not buy a ticket, save a draw time, or fund the bonus. The authenticated form was not clicked because Discord OAuth is setup-required.

## Package 21 notes on later rows

S-01, S-02, S-03, and AC-04 are `tested`. The supply shop, Ingot shop, private Steam keys, and versioned crates were exercised against local PostgreSQL. Two buyers of the last item produced one sale and the combined Marks balance fell by that price once. Retrying both keys recorded the winner again and left stock at zero. The same purchase key minted one field knife and spent 50 Marks once. A closed offer, a level gate, and a missing role spent nothing. Importing a key without a shop secret stored nothing. A held Ingot purchase left exchange inventory unchanged. Refunding it restored escrow and stock. Delivery returned that Ingot to inventory, left Marks backing unchanged, and conserved the 5,000 supply. A second delivery assigned no second key. Reveal and a second reveal returned the same secret. A member refund after reveal asked for review, and staff review left the key revealed. Staff reads, purchase rows, the inbox summary, and audit reasons did not contain the secret. A Steam-key crate entry was refused. Four explicit rolls stored scrap, the guarantee, scrap, then duplicate salvage, and the first stored amount stayed 1 after the table moved to version 2. Opening that grant twice returned the stored result. A giveaway with one vault key fulfilled the private inbox, posted no secret, and a second claim took no second key. The empty-vault path from package 13 still stores `shop_pending` and does not invent a key. AC-11, lottery, Dead Drop, and Market Collapse discovery stay `not_started`. The shop page was opened without a session and did not buy stock, import a key, open a crate, or refund a purchase. The authenticated form was not clicked because Discord OAuth is setup-required.

## Package 13 notes on later rows

A-03, A-04, and A-05 were exercised against local PostgreSQL. A free prize without exceptional funding recorded points and paid nothing. A funded prize paid once. A 30/20 staked pool paid 50 Marks to the winner and left the combined balance unchanged. A tie, a cancellation, and a winning outcome with no entries refunded every stake. Reversal of a drained wallet returned insufficient and left the balance at zero. Two concurrent closes of one prediction did not mix a payout with a refund. A contest edit after the deadline did not change the entry. A published tie did not consume the prize. After a reasoned disqualification, the remaining entry received the one stocked item, and a second award did not. Two bonus requests for the last cap produced one ticket. The same activity id did not add another. The closing snapshot was unchanged on a second close. A reroll kept draw sequence 1 and chose someone else. Claiming an external-key prize stored `shop_pending` and the sentence "Shop key delivery is not built." No key was created. The activities page was opened without a session and did not lock a pool or draw a winner. The authenticated forms were not clicked because Discord OAuth is setup-required.

## Package 12 notes on later rows

A-01 and A-02 were exercised against local PostgreSQL. Two RSVPs for the last seat produced one going member and one waitlisted member. Editing one occurrence left the next occurrence on the series name. Host transfer wrote an audit row. A failed Discord sync stored `failed` and a null Discord event id. The default sync stored `setup_required` and did not invent an id. The same member attending two sessions of one crew was paid once. An approval join stayed pending until the leader approved it. A linked voice room closed after seven empty hours through the existing room cleanup. Crew mission requests returned `module_not_built`. The gatherings page was opened without a session and did not schedule an event. The authenticated forms were not clicked because Discord OAuth is setup-required.

## Package 11 notes on later rows

U-03, U-04, U-05, U-06, and AC-07 were exercised against local PostgreSQL. Three overdue daily slots were skipped and nothing was posted. The same occurrence returned `already_recorded` and left one posted row. The next local day created a second delivery id. Six role mentions were refused. A paused series did not run, and resume scheduled the next future slot. Expiry marked the copy removed and did not add another message. A second pin replaced the first, and expiry unpinned it. A bot message and the bot's own sticky id did not advance the counter; the following human threshold reposted and marked the old copy deleted. An ordinary `!server` message matched an ephemeral rule and was refused with no reply log. The same text from an interaction stored one variant. A second try inside the cooldown did not store another. A missing feed URL, a failed fetch, and a replay inserted nothing and kept the last id. Approval mode stored a draft and no publication message. Editing an approved draft made the series stale, wrote an alert, and posted nothing. Discord delivery stayed `setup_required`. The signed-in management forms were not clicked because Discord OAuth is setup-required.

## Package 10 notes on later rows

U-01 and U-02 were exercised against local PostgreSQL. A draft round-trips every embed field. Validation rejects an oversized title, a non-http button, and an unauthorised everyone mention. The stored preview has no review controls. Edit loads that same draft and a later save makes the old Approve button stale. Two concurrent approvals of one revision let one commit. A destination the probe denies is not published. A scheduled post whose draft changes before the job runs is not sent. Lost destination permission at delivery writes no history. Self-approval works unless the draft asks for a second admin. Discord delivery stays `setup_required` without a bot token. At the end of package 10, recurrence, pins, stickies, replies, and game feeds were not built, so U-03 through U-06 and AC-07 stayed `not_started`. Package 11 tested those rows. The editor page was opened in the browser without a session and did not save a draft. The authenticated form was not clicked because Discord OAuth is setup-required.

## Live verification

These live checks are blocked until credentials exist and, for command registration, until an explicit instruction names the test guild:

- Discord OAuth code exchange and the browser consent redirect.
- Bot-token `GET /guilds/{guild.id}/members/{user.id}` revalidation against Discord.
- `PUT /applications/{application.id}/guilds/{test-guild.id}/commands`.
- Provider ownership exchange. The shipped adapter returns `live_exchange_unavailable` even when a key is present. Handle entry still saves as `self_reported`.
- Discord message delete, member timeout, kick, and ban. The worker calls those routes only when a bot token exists. None was called.
- Live spam and join-spike intake. The gateway does not request the privileged message-content or member intents.
- Discord audit-log actor lookup. Confidence is calculated from supplied candidates. Zero or several matches stay `unknown`.
- Discord private ticket channel or thread creation, and ticket inactivity reminders. The worker calls those routes only when a bot token and a parent channel exist. None was called. A missing token stays `setup_required` and does not mark the channel provisioned.
- Live chat XP. The gateway does not request the privileged message-content intent, so message text is not read from Discord.
- Live voice XP and birthday announcements. Voice-state subscription and announcement delivery were not called. No token was available.
- A live Ingot market panel post and a Discord staff alert for a broken backing invariant. The exchange, quotes, and backing are stored in PostgreSQL. Refresh without a panel channel stays `setup_required` and does not enqueue a job. No Discord payout was made.
- A live publication, announcement, pin, sticky, reply, game-update, Discord scheduled event, or activity announcement. The records are stored in PostgreSQL. Delivery and event sync stay `setup_required` without a bot token. No Discord event id is invented. A giveaway with a vault key is fulfilled into the private inbox and the key is not posted. An empty vault stays `shop_pending` and does not invent a key. A missing feed stays unavailable and does not invent an update.
- A live contract DM or completion mention, and live chat or voice intake for contract progress. Notices without a bot token stay `setup_required`. A closed DM is stored as `failed` and is not copied to a public channel. The gateway does not request message content or voice state.
- Live temporary-room channel create, delete, warning, and disconnect. A missing token stays `setup_required` and does not mark a channel provisioned or deleted.
- A live character command reply. Class, stat, respec, and loadout rows are in PostgreSQL. No Discord post was made. A season rollover keeps the character row.
- A live combat, inventory, trade, listing, upgrade, salvage, craft, reroll, shop, crate, or lottery reply. Gear, offers, listings, scrap, recipes, upgrade history, reroll counts, shop purchases, encrypted keys, crate results, and lottery draws are in PostgreSQL. Without a bot token the notice stays `setup_required`. No Discord message id is invented. A pending Ingot purchase stays in escrow until delivery is committed. An empty vault does not invent a key. No lottery draw time was assumed.
- A live expedition report. Deadlines, reserved locks, and the preselected encounter are in PostgreSQL. Without a bot token the notice stays `setup_required` and no Discord message id is invented.
- A live mission notice or crew-room channel. Mission state, turn deadlines, recovery, and the room reservation are in PostgreSQL. Without a bot token the notice stays `setup_required` and the room channel stays `pending`. No Discord message id or channel id is invented.

No production guild command write is permitted. A fake directory and an injected `fetch` covered the local boundaries. Missing credentials return `setup_required` and do not count as a successful login.

## Full Discord experience redesign

These rows describe source/local verification. Live Discord rendering and delivery are not implied.

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| UX-01 | Inventory every implemented command/action and flow, not only examples | tested | `experience:audit`, `DISCORD_EXPERIENCE_COVERAGE.md`; catalog completeness unit test |
| UX-02 | Guided entry for all 36 parents; action-specific fields and contextual choices | tested | `experience.test.ts`, original manifest tests; all direct slash paths retained |
| UX-03 | Consistent outcomes, navigation, complete pagination, attachments and private/public routing | tested | `experience.test.ts`, `discord.test.ts`, `present.test.ts`, `guide.test.ts` |
| UX-04 | Review, edit, cancel, expiry, ownership and one-use confirmation | tested | `experience.test.ts`, `platform-session.test.ts`; original services retain permissions and transaction rules |
| UX-05 | Modals, native selects, autocomplete and implemented worker notification paths | tested | `discord.test.ts`, `experience.test.ts`, `notifications.ts`; no live Discord delivery |
| UX-06 | Existing economy/data/permission rules preserved | tested | No schema or economic-rule changes; existing unit suite retained, plus precise bigint display and session compare-and-set checks. PostgreSQL integration remains a CI/live-environment follow-up. |
| UX-07 | Live named-test-guild verification of the full experience | blocked | Credentials and explicit named-test-guild instruction are absent; no registration or deployment performed |
