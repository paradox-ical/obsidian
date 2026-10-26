# Decisions

Fixed product policy lives in `docs/MASTER_SPEC.md` section 1. This file records implementation choices made while building. It does not replace that register.

## Preserved product policy

Verification, accounts, statistics, dashboard access, publishing, recurrence, economy, Ingot pricing, earning pace, Steam keys, public wealth, seasons, lottery, Dead Drop, Contracts, RPG, respec, class change, world, combat, ranked play, gear, crates, temporary rooms, and polls stay as written in the fixed decisions register. Package 2 implements the operational boundary around them. It does not implement those modules.

## Package 1 implementation choices

| Choice | Why |
|---|---|
| Node.js 24.21.0 | Active LTS (Krypton) on 7 October 2026. discord.js 14.27.0 documentation requires Node.js 24.17.0 or newer. Node.js 26.10.0 is still Current and does not enter LTS until 28 October 2026. Node.js 22.23.3 remains Maintenance LTS, but it is below the discord.js requirement. Source: https://nodejs.org/dist/index.json and https://discord.js.org/docs/packages/discord.js/stable |
| discord.js 14.27.0 | Current stable release documented by discord.js. The published npm `engines` field still says `>=18`; the installation documentation is the requirement used here. |
| Prisma ORM 7.10.0 with `@prisma/adapter-pg` 7.10.0 and `pg` 8.23.1 | Prisma 7 is the supported stable ORM. Prisma 8 was still a release candidate on 7 October 2026, so it is not pinned. Prisma 7 requires a driver adapter and the `prisma-client` generator. Source: https://www.prisma.io/docs/orm/v7 |
| PostgreSQL 18.6 | Current stable release. PostgreSQL 19 was still beta. Source: https://www.postgresql.org/support/versioning/. The official 18 image stores data under `/var/lib/postgresql`, so Compose mounts that directory rather than `/var/lib/postgresql/data`. |
| TypeScript 5.9.3 | Latest TypeScript 5 release. typescript-eslint 8.71.1 accepts TypeScript `>=4.8.4 <6.1.0`. TypeScript 7.0.2 is outside that range, so the linter cannot use it yet. |
| ESLint 10.12.0 and typescript-eslint 8.71.1 | Current lint stack whose peer range matches the pinned TypeScript. |
| Zod 4.6.5 | Environment schema. Validation errors report variable names only, not values. |
| React 19.3.0, Vite 8.3.3, `@vitejs/plugin-react` 6.1.2, React Router 8.4.0 | React's current stable release and the Vite toolchain documented at https://react.dev/learn/build-a-react-app-from-scratch. React Router supplies the admin route shell. Server-side OAuth is package 2; this package does not pretend the dashboard is logged in. |
| Vitest 5.0.3 | Current test runner. It accepts Node 22.12, 24, or 26. CI and Docker use Node 24.21.0. |
| npm workspaces | npm 11 ships with Node 24. One lockfile pins the workspace. |
| Durable jobs stay in PostgreSQL | Redis is not added. Leases, retries, dead letters, and the outbox use `SKIP LOCKED` in PostgreSQL. Backoff is `1000 * 2^(attempt-1)` milliseconds, capped at 15 minutes. |
| Commands stay unpublished | The 36 parents have subcommand trees and a test-guild tool. The default is a dry run. Apply is refused for the production guild and for a missing credential. No global command URL is called. |
| Local database password `collective` | Used only by `docker-compose.yml` and `.env.example` for a disposable database. It is not a production credential. |
| Host port 5433 | This workstation already had a process listening on 5432. Compose publishes PostgreSQL on 5433 so local development does not take over that server. Inside the Compose network the database remains on 5432. CI uses 5432 because the GitHub Actions service has that port to itself. |

## Package 2 implementation choices

| Choice | Why |
|---|---|
| Foundation revision `0b` | The operations migration updates the existing row. Startup still refuses a different revision. |
| Owner is dashboard recovery, not a capability | A guild owner can open the dashboard. Owner does not grant moderation, statistics, or any other Discord capability. `full_administration` is the grant that matches every capability. |
| Protected modules | Verification and moderation remain available when another module is in maintenance. Setting maintenance on either protected module is rejected. |
| No stored Discord access token | OAuth state and the admin session token are stored as SHA-256 hashes. The session cookie is httpOnly and `SameSite=Lax`. Logout requires the CSRF token. Roles are re-read on each authenticated request. |
| Login rate window | 10 login starts per minute per hashed client address. The test raises that limit. |
| Admin session lifetime | 12 hours. OAuth state expires after 10 minutes and is single use. |
| Statistics response | A member or a moderator without dashboard access receives HTTP 403. An authorised dashboard session receives `module_not_built`, not invented numbers. |

## Package 3 implementation choices

| Choice | Why |
|---|---|
| Foundation revision `0c` | `20261007200000_community` updates the existing row and adds community tables. `20261007203000_panel_delivery` adds panel emoji and posted-message bindings without another revision bump. |
| Native rules stay on Discord's pending flag | The bot never writes rules acceptance. A null pending or onboarding flag fails closed. Known incomplete native steps end the Verified grant until those steps finish, then restore it without a new CAPTCHA. A missing flag does not strip an existing role. Revoked status does not restore. |
| CAPTCHA answer is hashed | The stored value is SHA-256 of the challenge id and the normalised answer. The image is generated for the reply. Tests decode that image. The answer is not logged. |
| One entitlement row per source | Verification, panel choices, and staff grants are separate rows. Expiry removes the Discord role only when no remaining grant holds it. Staff renewal stacks on the same row: remaining time plus the added days. |
| Shipped ownership adapter cannot verify | Missing credentials and unavailable providers skip the adapter. A present key still returns `live_exchange_unavailable` until a real provider exchange exists. An injected adapter may mark ownership verified only when it returns a subject. No route accepts a client-supplied verified flag. |

## Package 4 implementation choices

| Choice | Why |
|---|---|
| Foundation revision `0d` | `20261007210000_moderation` updates the existing row and adds cases, warnings, appeals, reports, staff logs, and moderation signals. |
| Automatic ban stays off | A rule action of `ban` is removed when the policy is saved or prepared. Heuristic matches cannot create a ban. A staff member can still request a manual ban, and hierarchy or permission failure is stored as `failed`. |
| Sanction expiry and log retention are jobs | `moderation.warning.expire`, `moderation.sanction.expire`, and `moderation.log.retain` survive restart. Alerts and Discord sanctions go through the outbox. Missing token throws `setup_required` and does not mark the case applied. |
| Audit actors need one match | Zero or several candidates in the five-second window are `unknown`. Message text from an excluded channel is not stored. Missing text is `unavailable`. Retention clears stored text and labels it `expired`. |
| Reports do not invent tickets | Private reports and appeals set `ticketStatus` to `not_built` until the ticket package exists. Package 5 replaces this with a real linked ticket. |

## Package 5 implementation choices

| Choice | Why |
|---|---|
| Foundation revision `0e` | `20261010080000_tickets` adds ticket settings, panels, tickets, messages, and references, and stores the linked ticket id on reports and appeals. |
| Verification help does not grant access | Unverified members can open that category during ticket maintenance. The ticket does not write a verification record or a role entitlement. Other categories still require verified status when the category says so. |
| Staff notes stay out of member exports | Notes use visibility `staff`. Member transcripts and summaries filter them. Audit reasons do not copy the note text. Retention clears stored text and then refuses reopen. |
| Open tickets keep their policy snapshot | Later setting changes do not rewrite an open ticket's inactivity or retention rules. |
| Purchase and reward links stay unfinished | A staff member can store the id. `integrationStatus` is `module_not_built`. This package does not resolve a shop purchase or pay a reward. |
| Private Discord delivery is not faked | No token returns `setup_required` and leaves the channel pending. Permission denial is stored as `failed` while the ticket stays open. A missing parent channel is `missing_parent`. |

## Package 6 implementation choices

| Choice | Why |
|---|---|
| Foundation revision `0f` | `20261010093000_progression` adds XP, dossiers, birthdays, invite history, reward events, achievements, commendations, and voice sessions. |
| No second currency store | Marks and Ingot readings always return `module_not_built` and `privacy: public`. Birthday gifts, recruitment, and achievement Marks are reward events for the later ledger. They do not write a balance. |
| Reward events are once-only | The idempotency key blocks a second payout for the same member, year, or achievement, including after a reversal. |
| Rank and birthday roles use the entitlement service | Rank changes end only the previous rank grant. A birthday expiry ends only the birthday grant, so a permanent grant of the same role still holds it. |
| Invite confidence is explicit | Unknown, vanity, and ambiguous joins do not qualify. A rewarded member's later join is a rejoin and is not paid again. |
| Chat text is not taken from Discord | Message-content intent is not requested. XP is awarded only when the caller supplies text. Empty text does not earn XP. |

## Package 7 implementation choices

| Choice | Why |
|---|---|
| Foundation revision `0g` | `20261010150000_seasons` adds season state, Seal scores, archives, polls, and temporary rooms. |
| Seasonal awards reuse reward events | The winner receives one title and one Marks event. The ledger status stays `module_not_built`. A repeated rollover does not insert a second pair. |
| Pending boards stay empty | Marks, Ingots, PvP, Contracts, and estimated wealth return `module_not_built`. Estimated wealth is labelled estimated and price-sensitive. Treasury, bot, and system ids are excluded from real boards. |
| Character, gear, and ranked data are not invented | Rollover does not create those tables and does not delete community XP, lifetime Seals, reward events, or entitlements. The preservation record says they are retained and `module_not_built`. |
| Polls are bot-enforced | Eligible roles are checked in the service. Native Discord polls are not used, because they would not enforce the role rule. Anonymous results hide voter ids from members. The vote rows stay. |
| Suggestions have no workflow | Kind `suggestion` is rejected before a row is written. There is no suggestion command. |
| Room timers are jobs | Voice cleanup is six hours after `emptySince`. Text cleanup is 24 hours after `lastHumanAt`. Bot and system messages do not change that timestamp. A sweep recreates a missing due job from the stored timestamp. There is no maximum lifetime. |
| Room Discord delivery can fail closed | No token throws `setup_required` and leaves `channelId` empty. Closing an occupied voice room sets disconnect delivery to `setup_required` and does not clear occupants. Automatic cleanup of an empty room does not disconnect anyone. |
| Creating a room is not a reward | Room creation writes an audit row and no reward event. |

## Package 8 implementation choices

| Choice | Why |
|---|---|
| Foundation revision `0h` | `20261010190000_ledger` adds Marks wallets, append-only ledger entries, issuance budgets, and economy settings. |
| One Marks scale | One Mark is 100 minor units, stored as `bigint`. Command amounts are whole Marks. Readings are fixed two-decimal strings. JavaScript floats are not used for balances. |
| One routine pace | The reference month is 80×30, plus `round(250 × (365.25 / 7) / 12)`, plus 500, plus two 2,000 staff activities: 7,987 Marks. Birthday, invite, achievement, season, and staff grants share that member total and one guild pool. They do not each receive 10,000. |
| Exceptional prizes are funded | A lottery-style credit spends an exceptional pool that staff must fund. It does not consume the 7,987 routine pace. The supply of Marks stays uncapped. |
| Reversals append | The original ledger row stays. A new reversal row moves the balance and frees routine budget. If available Marks cannot cover it, the reward stays recorded and the balance stays non-negative. |
| Transfers are not issuance | A member transfer moves available Marks and does not increase budget spent. |
| Public Marks, private reasons | Dossier and wallet readings show available and escrow Marks. Ingots and estimated wealth stay `module_not_built`. Member receipts omit staff reasons. |
| Statistics boundaries differ | Discord `/stats` and its component require the statistics capability. The admin `/api/stats` requires a dashboard session and returns the ledger report. This replaces the package 2 pending statistics response. The owner is dashboard recovery and does not gain `economy_operations` or `statistics`. Staff adjustments require `economy_operations`. |
| Old reward rows are not backfilled | A reward event that was stored as `module_not_built` returns `already_recorded` and is not paid again. |

## Package 9 implementation choices

| Choice | Why |
|---|---|
| Foundation revision `0i` | `20261011160000_ingots` adds the market, quotes, trades, and collapse charges. |
| One wallet, two currencies | Ingots are whole units in `wallet.currency = ingots`. Marks stay 100 minor units. Market prices are stored as Mark minor units. There is no second balance store. |
| Integer scarcity curve | `p(A) = ceil(baseline × 2,500³ / A³)` uses bigint division. A q-unit buy sums each step. A sale prices `p(A+1)`, `p(A+2)`, and so on, then keeps 95 percent of each step. A flat price and `q` times the opening quote are not used. |
| Quotes bind the market | Confirmation requires the stored revision, curve version, recomputed total, and an unexpired timestamp. A miss marks the quote stale or expired and does not substitute a higher price. |
| Backing is a column | Buy proceeds increase it. Sells debit it. Liability is the un-discounted reverse sum. The 5 percent spread is withdrawable only above that liability. An unpayable sell or a broken invariant writes an audit row and moves no wallet. |
| Protected reserve stays put | Ordinary release returns `policy_required` after an audit and does not move the 2,500. |
| Shops and collapse stay services | Hold, commit, and refund are the later shop boundary. Commit returns inventory and does not withdraw backing. A pool allocation must fund the integrated buy cost first. A charge exists only when the treasury already holds the units. Activation returns those units once. |
| Estimated wealth is labelled | The board is available, estimated, and price-sensitive. The score is Marks plus the integrated sell value of that member's Ingots. Values above the safe integer clamp on the numeric board only. |

## Package 10 implementation choices

| Choice | Why |
|---|---|
| Foundation revision `0j` | `20261011193000_publications` adds templates, drafts, reviews, messages, and history. |
| One draft document | Content, embed fields, colour, author, footer, timestamp, images, link buttons, and explicit mentions live in one JSON document. Discord limits are checked before save. |
| Review controls stay beside the preview | Approve, Edit, Request changes, and Cancel are stored on the review. The published snapshot is only the draft preview. |
| Approval binds the revision | A save increments the revision and marks older reviews stale. Two approvers of the same revision cannot both publish. |
| Destination is chosen at approval | Publish now records delivery `setup_required` when Discord cannot be posted. Schedule stores a `publication.deliver` job. The job rechecks the revision and the destination permission before writing history. |
| Self-approval is the default | A draft can set `secondApproval` for its category. Otherwise the author may approve their own review. |
| Edit returns to the admin editor | The Discord Edit button does not publish and does not put the review controls into the draft. The editor loads the stored document. |

## Package 11 implementation choices

| Choice | Why |
|---|---|
| Foundation revision `0k` | `20261011203000_distribution` adds announcements, pins, stickies, replies, feeds, and alerts. |
| One fresh row per occurrence | The idempotency key is the series id plus the local date. A retry of that key returns `already_recorded`. |
| Missed runs skip | Occurrences older than 15 minutes are marked skipped. At most the newest in-grace occurrence is posted. Resume computes the next future slot. |
| Approval stays bound | A series stores the approved revision. A later draft edit pauses it as stale and writes an alert. It does not post the new text. |
| Pins and stickies are records | Without a bot token the delivery is `setup_required`. A sticky ignores bots and its own current copy, then marks that copy deleted when it reposts. |
| Replies do not read Discord | The gateway does not request message content. Tests and the dashboard supply the text. An ordinary message cannot send an ephemeral interaction response. |
| Feeds do not invent news | The JSON adapter parses a supplied payload. A missing URL, a failed fetch, or a bad payload keeps the last id and inserts nothing. Approval mode creates a draft. Automatic mode stores the source URL. |

## Package 12 implementation choices

| Choice | Why |
|---|---|
| Foundation revision `0l` | `20261011210000_gatherings` adds events, RSVP, sync records, crews, and sessions. |
| Occurrence ids stay distinct | A series edit updates scheduled rows that are not detached. An occurrence edit sets `detached` and leaves the others alone. |
| Sync never invents an id | The default adapter returns `setup_required`. A failed adapter stores `failed` and leaves `discordEventId` null. |
| One seat under a lock | RSVP and session join lock the parent row. The second arrival for the last seat is waitlisted. |
| Attendance uses the reward record | Crew attendance is keyed by the crew id. A second session returns `already_recorded` and does not pay again. |
| Rooms stay on the room service | Linking a session or event calls `createRoom`. A second link returns `already_linked`. Cleanup still uses the six-hour voice rule. |
| RPG missions stay pending | `requestCrewMission` returns `module_not_built`. There is no second crew table for combat. |

## Package 13 implementation choices

| Choice | Why |
|---|---|
| Foundation revision `0m` | `20261011220000_activities` adds predictions, contests, giveaways, and prize stock. |
| Whole-Mark remainder | Payouts use integer Marks. Leftover Marks go to the largest remainder, then the earliest user id. The house fee is zero. |
| Refunds are explicit | A tie, a cancellation, and a winning outcome with no entries release every stake. |
| Reversal stops on a short wallet | The payout is removed only when available Marks cover it. Otherwise the wallet and the resolution stay as they are. |
| Ballots, not reactions | Contest votes and judge scores are rows. A published tie does not award one prize to one entry. |
| One activity, one bonus | A partial unique index rejects the same activity id twice. The cap is checked under a row lock. |
| Snapshot before draw | Closing writes the ticket list once. A second close does not rewrite it. |
| Keys stay pending | External-key stock cannot be given an on-hand count. Fulfilment is `shop_pending` and the detail is "Shop key delivery is not built." |

## Package 14 implementation choices

| Choice | Why |
|---|---|
| Foundation revision `0n` | `20261011230000_contracts` adds definitions, frozen revisions, boards, assignments, rerolls, preferences, notices, and submissions. |
| Caps pay the remaining room | A contract payout takes the minimum of the frozen reward, the board cap, the member routine cap, and the guild routine cap. Weekly and monthly payouts do not spend the daily cap. |
| One reward key | The ledger key is guild, member, definition, and cycle. A retry returns the existing row. Manual approval uses that same path. |
| Versions freeze | Preserve keeps every assignment. Migrate rewrites only assignments whose progress is still zero. |
| Pings do not pay | A disabled completion mention is stored as skipped. The Marks row is already posted. |
| Closed DMs stay private | A DM-only failure stores `failed` and an empty public body. It is not copied to a channel. Without a bot token the notice is `setup_required` and no Discord id is invented. |
| RPG hooks stay typed | Exploration, PvE, crafting, and PvP return `module_not_built` and are excluded from automatic selection. |

## Package 15 implementation choices

| Choice | Why |
|---|---|
| Foundation revision `0o` | `20261012000000_characters` adds the curve, six classes, character rows, loadouts, held items, and character XP events. |
| Chat is not character XP | Community XP stays on `member_progression`. A contract grants character XP only when its frozen `characterXp` is above zero, once, through an idempotency key. |
| 147 points at level 50 | Level 1 has none. Each of the 49 gains adds three points. Class bases are not part of that pool. |
| Bounded bonuses | `min(cap, floor(cap × total / (total + 20)))`. Accuracy and defence caps are 6, so a low roll can still miss. |
| Fees are debits | 5,000 Marks and 15,000 Marks leave the wallet in the same transaction as the cooldown. They do not increase routine issuance spent. |
| One introductory reset | It is free below level 10 before a ranked debut, and it does not start the paid cooldowns. A second use is refused. |
| Gear stays owned | An incompatible held item is unequipped. The row remains and `destroyed` stays false. Starter and milestone keys are unique, so a return to a class does not insert them again. |
| Six-month assumption | Four sessions a week, 1,200 character XP each, for 26 weeks, is 124,800 XP. The default climb costs 122,500 XP. The 7,987 Mark month is a separate simulation. |

## Package 16 implementation choices

| Choice | Why |
|---|---|
| Foundation revision `0p` | `20261012010000_combat` adds gear templates, instances, test opponents, battles, rolls, and actions. |
| Eleven templates | Shared field knife and service baton. Class-restricted bound weapons for the six classes, plus the Fixer trauma kit. The 40–60 launch catalogue waits for regions. |
| Separate bonuses | Allocated-stat accuracy and gear accuracy stay on different fighter fields. The combined total, including effects, cannot pass 8. Defence uses the same cap. |
| Dice-only criticals | A natural 20 multiplies the rolled dice. Flat damage is added after that. A natural 1 misses. |
| One reaction | It reduces damage by 2 once in the round and cannot trigger another reaction. |
| Item button | A tactical button is one choice. Item spends the turn on defend and then one consumable, capped at 8 healing and at maximum health. |
| Stored rolls | `randomInt` writes `battle_roll` before the result is used. The same battle key returns that row. The member view omits an unrevealed opponent attack. |
| Timeout is a timestamp | The deadline and a `combat.timeout` job live in PostgreSQL. A later sweep at the same time does not defend again. |
| No second matchmaker | `/combat queue` and `/combat challenge` say those systems are not built. This package does not rate, wager, or mint Marks. |
| Transfer is a decision | Bound, equipped, or locked gear is refused. The function does not move the item. |
| Season keeps gear | Rollover reports gear retained and does not delete `gear_instance`. Materials and crates stay unbuilt. |

## Package 17 implementation choices

| Choice | Why |
|---|---|
| Foundation revision `0q` | `20261012020000_world` adds regions, enemies, loot tables, and expeditions. |
| Level is the gate | Seeded levels are Backstreets 1, Black Docks 15, and Inner Sanctum 35. There is no narrative unlock flag. |
| One slot and a timestamp | The character row is locked, then the active count is checked. The deadline, cooldown, and `expedition.complete` job are PostgreSQL timestamps. A second sweep at the same time finds the rewards already posted. |
| Outcome is frozen | Enemy, loot roll, affixes, and the encounter log are stored at the start. A later catalogue edit does not rewrite them. |
| Expedition lock is not a gameplay lock | Reserved gear uses lock `expedition`. A duel can start, ignores that gear, and clears only a `combat` lock. Respec, class change, and the introductory reset still refuse. |
| Shared earning caps | Expedition XP stops at 400 for the Perth day. Marks use `issueMarks` at pace `routine` and the existing 7,987 member budget. A capped member still receives XP. |
| Unavailable loot is stored | A retired, wrong-class, or under-level template is recorded and not minted. An eligible drop uses one idempotency key. |
| Contracts stay on the old path | `rpg_exploration` notes on every completion and `rpg_pve` notes on a win. `rpg_crafting` and `rpg_pvp` stay `module_not_built`. Those four seeds stay out of the automatic boards. |
| Season keeps regions | Rollover reports region unlocks retained. It does not delete `world_region` or `expedition`. |
| Prompt 18 remains | Interactive missions, crew missions, and recovery are named as remaining work. Defeat banks nothing and does not destroy gear, and it does not start a timer. |

## Package 18 implementation choices

| Choice | Why |
|---|---|
| Foundation revision `0r` | `20261012030000_missions` adds mission runs, crew missions, crew seats, and recovery. |
| Graphs stay in code | Yard Run and Dock Signal are seeded nodes. Access is still the region level. A discovery does not raise that gate. |
| Unbanked until the end | Loot slugs sit on the run. Only a win mints an eligible slug, once. Retreat and failure leave them unminted. Owned gear is unlocked and not destroyed. |
| Recovery is a timestamp | Failure sets 30 minutes. It does not set `gameplayLock`. One recovery medkit, ability `recover`, shortens it by 15 minutes and cannot pass 10 minutes. The battle medkit, ability `patch`, is a different item. |
| Mission lock is not a gameplay lock | Reserved gear uses lock `mission`. A duel refuses to start and cannot clear that lock. Respec, class change, and the introductory reset refuse while a solo run or a forming or active crew seat exists. |
| The existing crew | Two to five active members, one forming or active mission, readiness, and the existing room service. Live turns are 2 minutes and async turns are 30 minutes. Both are PostgreSQL deadlines. A missed turn counts as defence. Two misses exclude rewards. One revive is allowed. Abandonment is 6 hours, then the room closes. |
| Same Marks path | Solo completion is 60 XP and 12 Marks. An eligible crew seat is 40 XP and 10 Marks. Both use `issueMarks` at pace `routine`. The mission-only simulation stays under level 50. Combined with 1,200 contract XP per session it reaches level 50. A month already at 7,987 accepts no further mission Marks. |
| Contracts stay on the old path | `rpg_exploration` notes when a solo mission ends and when an eligible crew wins. `rpg_pve` notes on a win. `crew_session` notes for an eligible crew winner. `rpg_crafting` and `rpg_pvp` stay `module_not_built`. |
| Notices are not posts | `notify` stores `setup_required`. The reply says the notice is not posted. A room channel stays `pending`. No Discord id is invented. |
| Season keeps missions | Rollover reports mission state retained. It does not delete `mission_run`, `crew_mission`, or `recovery`. |

## Package 19 implementation choices

| Choice | Why |
|---|---|
| Foundation revision `0s` | `20261012040000_pvp` adds ratings, queue entries, matches, and reviews. |
| The existing combat engine | Quick and tactical PvP use the shared D20 rules. Ranked keeps class bases, scales allocated stats to a 12-point budget, and drops the highest-power equipped items until affix power fits in 8. Abilities above level 10 are published as closed. Health resets. |
| Demotion before acceptance | The third ranked request for a pair on a Perth day is stored as casual. A queue pair in that state is proposed until both accept. It does not start as a reward-eligible ranked match. |
| One wallet | Equal Marks stakes, including zero, use a paired hold and one settlement. The pot moves existing Marks. A short wallet writes nothing. A draw or a system cancel refunds. A forfeit pays the pot and does not pay the 8 Mark and 20 XP reward. The ranked win uses the routine budget. A wager does not. |
| Deadlines are rows | Disconnect grace is 2 minutes. The first missed tactical turn defends. Two misses by that player forfeit. Both are PostgreSQL timestamps and jobs. |
| Review does not reverse | Three wagered results with alternating winners open one review. The pot and the rating stay. |
| Season reset | A new season starts rating at 1,000 and copies lifetime wins, losses, and draws. Rollover archives the PvP board and does not delete rating, character, gear, or wallet rows. |
| Notices are not posts | The reply says the notice is not posted. No Discord channel or message id is invented. |

## Package 20 implementation choices

| Choice | Why |
|---|---|
| Foundation revision `0t` | `20261012050000_workshop` adds workshop settings, material stock, craft recipes, trade offers, and market listings, and stores upgrade tier, reroll count, and upgrade history on the gear instance. |
| One item each side | A trade offers one item and/or Marks and requests one item and/or Marks. Offering the same item twice, or offering nothing, is invalid. Duplicate races are two operations on one instance. |
| Marks move on settlement | Confirmations do not escrow Marks. Expiry and cancellation unlock the item and write no ledger row. The confirming transaction nets the two sides in user-id order through the existing wallet. Pace is `market` and the kinds are `trade_out` and `trade_in`, so member transfer limits do not apply. |
| The listing is the escrow | Lock `listed` and a unique open `listingKey` hold the item. The fee defaults to 0. A non-zero fee is `workshop_spend` at list time. Sale, expiry, and cancellation clear only that lock. |
| No failure destruction | Upgrades are guaranteed through the cap. Salvage is the only destruction, and only after a separate confirmation. Randomness stays in loot and in the affix reroll amount. |
| The counter stays on the item | A reroll increments even when the amount is unchanged. Trading does not reset it. The preview shows the template minimum and maximum before the roll. |
| Crafting is specified | The seed recipe is inserted only when `honed-knife` is missing. An existing recipe is not rewritten. `rpg_crafting` is ready and stays out of the automatic daily, weekly, and monthly pools. A successful craft notes the signal. |
| Same staff capability | Recipe and cap edits use `content_management`. The audit actions are `workshop.recipe` and `workshop.caps`. |
| Notices are not posts | The reply says the notice is not posted. No Discord channel or message id is invented. Supply shop, Ingot shop, and crate replies stay unbuilt. |
| Season keeps gear | Rollover still reports gear retained. It does not delete materials, recipes, trades, or listings. |

## Package 21 implementation choices

| Choice | Why |
|---|---|
| Foundation revision `0u` | `20261012060000_shop` adds shop offers, purchases, Steam keys, the delivery inbox, crate tables, entries, pity, grants, and cosmetic items. |
| The existing Ingot move | A shop hold, commit, refund, and reverse use `applyShopIngotMove` inside the purchase transaction. Hold and refund do not change exchange inventory. Commit returns the Ingots to inventory and does not change Marks backing. |
| Escrow until the inbox | A Steam key purchase stays `held` with stock reserved. Delivery assigns one available key. The inbox is the private fallback. `dmStatus` stays `setup_required` because no Discord token is used. |
| Empty vault stays pending | A giveaway assigns a vault key only when the steam-key offer has stock and an available key. Otherwise fulfilment stays `shop_pending` and the detail stays "Shop key delivery is not built." |
| Roll at acquisition | The crate outcome is stored on the grant. Opening reads it. A later table version does not rewrite old grants. Pity stays on the member and table slug. |
| No key in a crate | A crate entry whose kind is `steam_key` is invalid. Staff reads, receipts, and audit reasons do not include plaintext or ciphertext. |
| Revealed secrets stay revealed | A member can refund only while the purchase is held. Staff review of a revealed key records the request and restores nothing. |
| Same staff capability | Offer, crate, key, and refund edits use `economy_operations`. The audit actions are `shop.offer`, `shop.crate`, `shop.key`, and `shop.review`. |
| Season keeps the shop | Rollover does not delete shop, crate, key, or cosmetic rows. Gear preservation stays retained. |

## Package 22 implementation choices

| Choice | Why |
|---|---|
| Foundation revision `0v` | `20261012070000_lottery` adds lottery settings, the lottery budget, draws, tickets, purchases, and quotes. |
| No default draw time | The hour and minute stay null. A purchase before staff save a Perth clock returns `schedule_required` and charges nothing. Midnight is a valid saved time, not a seed. |
| A separate lottery budget | The 50 percent bonus is reserved from that budget, not the routine pace and not the shared exceptional pool. Funding failure is returned before the member debit. |
| Ticket money stays escrow | The stake is not a sink. The winner receives the pot plus the reserved bonus. Losers release escrow. The bonus credit uses pace `exceptional`. |
| One unresolved draw | Fewer than three distinct members moves the deadline forward and keeps the tickets, pot, and reserved bonus. The bonus is not reserved again. The cap counts carried tickets. |
| Snapshot then pay | The close stores the ordered tickets and the chosen index in the same transaction. A later close reads the stored winner and does not draw again. |
| Stall refund | The stall clock starts when the draw opens and does not reset on rollover. At that time, stakes return to available and the reserved bonus returns to the budget. |
| Same staff capability | Settings and funding use `economy_operations`. The audit actions are `lottery.settings` and `lottery.fund`. |
| First season open | Two concurrent joins can both miss the season row. The loser of that insert reads the row that won. The ranked match test still settles one pot. |
| Season keeps the lottery | Rollover does not delete lottery rows. |

## Package 23 implementation choices

| Choice | Why |
|---|---|
| Foundation revision `0w` | `20261012080000_deaddrop` adds Dead Drop settings, the seed and small-reward budgets, boards, cells, picks, quotes, reminders, notices, and coalesced board posts. |
| No default opening hour | The hour and minute stay null. A pick before staff save a Perth clock returns `schedule_required` and charges nothing. |
| One reusable template | Covered cells use one card back. Revealed cells use one icon per reward kind. The board does not store a design per cell. |
| Hidden until revealed | Member reads and the staff preview omit an unrevealed kind. Inspect writes an audit whose reason does not include the coordinate. Close reveals the remaining cells for history. |
| Escrow, then the recorded split | A pick moves Marks into escrow. The configured share, 50 percent by default, stays with the jackpot. The rest is recorded for the game treasury. Neither path mints Marks. |
| Seed once per win | The starting prize is reserved when a fresh board opens. A rollover carries that prize and the pick share and does not reserve another seed. A win spends the carried seed, and the next board may reserve a new one. |
| Small rewards stay separate | They are reserved from their own budget. Unrevealed amounts return when the board closes. |
| The next board is the next day | A jackpot or an expired hour schedules the following window from that board's opening time. It does not open again in the same hour. |
| The existing collapse charge | A special board reserves units already in the event treasury. The holder is empty until that cell is revealed. Activation uses the existing charge path, returns those units to inventory, and does not mint, touch the protected reserve, or edit the curve. A second activation does nothing. |
| Refunds follow the pick | Cancel returns each open pick once and releases an unpaid seed. It does not also pay the jackpot or move the hidden cell. |
| Same staff capability | Settings, funding, specials, pause, resume, cancel, and inspect use `economy_operations`. |
| Season keeps the board | Rollover does not delete Dead Drop rows. |

## Package 24 implementation choices

| Choice | Why |
|---|---|
| Foundation revision `0x` | `20261012090000_blackjack` adds blackjack settings, tables, seats, hands, actions, quotes, receipts, and notices. |
| One shoe per table | Solo and social hands are independent. The dealer and the shoe are shared. The shoe is stored before the first card, and a retry reads that shoe. |
| Rules are copied onto the table | Staff can change the next table. An open table keeps the version it showed before the bet. Dealer stands on soft 17 unless that version says otherwise. |
| Exposure before the stake | The house wallet reserves the worst split-and-double profit before the bet is accepted. A short bankroll returns `unfunded` and does not charge. A double or split uses that reserve and does not mint. |
| Exact minor units | One Mark is 100 minor units. A one-Mark natural pays 1.50. A stake that cannot pay the published ratio exactly is refused. |
| Inactivity is a stand | The turn timer stands the hand and then settles from the stored cards. It does not force a loss. A staff cancellation refunds every unsettled stake and releases the reserve. |
| The routine month stays 7,987 | The default 10 Mark maximum can lose 40 Marks after one split and two doubles. That figure is reported beside the monthly simulation and does not change the routine total. |
| Same staff capability | Settings, funding, and cancellation use `economy_operations`. |
| Season keeps the tables | Rollover does not delete blackjack rows. |

## Package 25 implementation choices

| Choice | Why |
|---|---|
| No new schema | Health, maintenance, drafts, publish, and rollback use `job`, `outbox_message`, `feature_flag`, `config_version`, and `audit_record`. Foundation revision stays `0x`. |
| Rollback copies a version | The selected document is saved as a new draft and published only when the request sets `confirm`. Older rows stay. There is no database reset on the operations page. |
| Secrets stay out of configuration | Import rejects secret-named fields and private URLs. Export redacts any secret-named field already stored. Feed sources reject loopback and private-network URLs. |
| Secret recovery is a separate file | AES-256-GCM with a passphrase from `BACKUP_PASSPHRASE`. The passphrase is not stored. Without it, `npm run backup:secrets` prints `setup_required`. |
| Rehearsal uses another database | `collective_rehearsal` is created, restored, marked, and dropped. `docker compose down -v` is not the rehearsal. |
| Simulations do not grant | The operations simulation reads the existing economy, blackjack, character, mission, and Ingot calculations and returns `grants: none`. |
| Verification and moderation stay available | A maintenance request for either module returns `protected` and does not write a flag. |

## Package 26 implementation choices

| Choice | Why |
|---|---|
| No schema change | The acceptance audit added a rejoin assertion to the existing community integration test. Foundation revision stays `0x`. |
| Prisma 7.10.0 stays pinned | `npm audit` offers Prisma 6.19.3 as the fix for transitive `deepmerge-ts` and `mysql2` findings. That downgrade contradicts the Prisma 7 pin. This project uses PostgreSQL. |

## Testing access

| Choice | Why |
|---|---|
| Guild owner is staff while `DASHBOARD_OWNER_STAFF` is on | Development turns this on so the server owner can exercise every staff action without first granting a Discord role. The marker is `collective-owner`, which is not a Discord role id. Other members still need a capability grant. `NODE_ENV=test` and `NODE_ENV=production` leave it off unless the variable is exactly `true`. Set it to `false` on a shared host. |
| Testing mode opens paused modules | Bot and admin startup clear `feature_flag.maintenance` while the switch is on. Verification and moderation were already exempt. This does not invent provider keys, prize keys, or a Discord token. |

## Not chosen

- No production Discord IDs, tokens, or provider credentials were invented.
- No Dead Drop opening hour or lottery draw time was selected. The master spec leaves the Dead Drop hour unset.
- No second currency, wallet, or permission model was introduced.
