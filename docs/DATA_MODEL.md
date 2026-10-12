# Data model

Later modules own their product tables and must follow the invariants below. Do not store member progression in `foundation_revision`.

## Migrated through revision `0x`

`20261007090000_foundation` inserts `foundation_revision` at `0a`. `20261007113000_operations` moves that row to `0b`. `20261007200000_community` moves that row to `0c`. `20261007210000_moderation` moves that row to `0d`. `20261010080000_tickets` moves that row to `0e`. `20261010093000_progression` moves that row to `0f` and adds progression tables. `20261010150000_seasons` moves that row to `0g` and adds seasons, polls, and temporary rooms. `20261010190000_ledger` moves that row to `0h` and adds Marks wallets, the append-only ledger, issuance budgets, and economy settings. `20261011160000_ingots` moves that row to `0i` and adds the Ingot market, quotes, trades, and funded collapse charges. `20261011193000_publications` moves that row to `0j` and adds publication templates, drafts, reviews, messages, and history. `20261011203000_distribution` moves that row to `0k` and adds announcement series and deliveries, bot-managed pins, stickies, reply rules, game-update feeds, and distribution alerts. `20261011210000_gatherings` moves that row to `0l` and adds official events, RSVP, sync records, persistent crews, and session LFG. `20261011220000_activities` moves that row to `0m` and adds predictions, contests, giveaways, and prize stock. `20261011230000_contracts` moves that row to `0n` and adds contract definitions, revisions, shared boards, assignments, rerolls, preferences, notices, and submissions. `20261012000000_characters` moves that row to `0o` and adds classes, character rows, loadouts, held items, and character XP events. `20261012010000_combat` moves that row to `0p` and adds gear templates, gear instances, test opponents, battles, rolls, and actions. `20261012020000_world` moves that row to `0q` and adds world regions, enemies, loot tables, and expeditions. `20261012030000_missions` moves that row to `0r` and adds mission runs, crew missions, crew mission members, and recovery. `20261012040000_pvp` moves that row to `0s` and adds ranked ratings, queue entries, matches, and reviews. `20261012050000_workshop` moves that row to `0t` and adds workshop settings, material stock, craft recipes, trade offers, and market listings. `20261012060000_shop` moves that row to `0u` and adds shop offers, purchases, Steam keys, the delivery inbox, crate tables, entries, pity, grants, and cosmetic items. `20261012070000_lottery` moves that row to `0v` and adds lottery settings, the lottery budget, draws, tickets, purchases, and quotes. `20261012080000_deaddrop` moves that row to `0w` and adds Dead Drop settings, the seed and small-reward budgets, boards, cells, picks, quotes, reminders, notices, and coalesced board posts. `20261012090000_blackjack` moves that row to `0x` and adds blackjack settings, tables, seats, hands, actions, quotes, receipts, and notices. Startup fails the database check when the revision is missing or different.

| Table | Purpose |
|---|---|
| `foundation_revision` | One row, id `collective`, revision `0x`. |
| `guild` | Guild id, owner user id, timezone. Default timezone `Australia/Perth`. |
| `config_version` | Numbered draft or published JSON. Active configuration is the newest published row. Drafts are not active. Package 25 exports the active row, imports a validated draft, and rolls back by copying an older document into a new version. |
| `capability_grant` | Role id to a capability. `full_administration` matches every capability. |
| `dashboard_grant` | User or role allowed into the dashboard. A moderator capability is not a dashboard grant. |
| `feature_flag` | Per-module maintenance. Verification and moderation stay available even if a caller tries to pause them. |
| `audit_record` | Append-only. A blank reason is rejected. |
| `job` | Durable work. Unique `idempotencyKey`, status, `runAt`, attempts, and lease columns. |
| `outbox_message` | Same claim pattern. `deliveredAt` is set only after the handler succeeds. |
| `interaction_session` | Opaque id, actor, revision, expiry, optional capability, purpose, and payload. No Discord interaction token is stored. |
| `oauth_state` | SHA-256 of the OAuth state. Single use. The raw state is not stored. |
| `admin_session` | SHA-256 of the session token, CSRF token, user, guild, expiry, and revocation. The Discord access token is not stored. |
| `auth_attempt` | Per-minute counter for login starts. The subject is a hash. |
| `community_settings` | One JSON access plan per guild: Verified role, assistance channel, native mode, channel audiences, and absence pause. |
| `verification_record` | One row per member. Status is `verified`, `unverified`, or `revoked`. Failure count and cooldown are stored. The CAPTCHA answer is not. |
| `captcha_challenge` | Answer hash, expiry, and invalidation. Regeneration invalidates the previous open challenge. |
| `assistance_request` | Staff help note. It does not grant Verified. |
| `role_panel` | Button, select, or reaction panel. Seeded category names are Interest, Region, Platform, and Notification. |
| `role_panel_option` | Role, label, exclusive group, prerequisites, and optional reaction emoji. |
| `role_panel_post` | Discord message that carries a reaction panel. |
| `role_entitlement` | Permanent or temporary grant. Unique per guild, user, role, source, and source id. |
| `linked_account` | Handle, visibility, and `self_reported` or `verified` ownership. Unlink keeps the row and sets `unlinkedAt`. |
| `moderation_policy` | Versioned JSON. The seeded document is labelled `example` and has no ban action. |
| `moderation_case` | One recorded action. `outcome` is `pending`, `applied`, `failed`, `reversed`, or `expired`. |
| `warning_point` | Weighted points. `active` counts. `expired` and `reversed` remain for history. |
| `moderation_appeal` | Private appeal tied to a case. |
| `member_report` | Private report. `ticketStatus` is `linked` when a support ticket was opened. |
| `staff_log` | Staff-only event. `contentLabel` is `available`, `unavailable`, `excluded`, or `expired`. Actor confidence is `reliable` or `unknown`. |
| `moderation_signal` | Recent message hash or join, used to count flood, repeat, and join spikes. The raw message is not stored here. |
| `ticket_settings` | Versioned JSON. The seeded document is labelled `example`. Opening a ticket does not grant general access. |
| `ticket_panel` | Category buttons. A button without a form answer does not create a ticket. |
| `support_ticket` | Private ticket, opener, assignee, policy snapshot, and channel state `pending`, `provisioned`, or `failed`. |
| `ticket_message` | Member-visible text or a staff note. Retention clears `body` and sets `contentLabel` to `expired`. |
| `ticket_reference` | Moderation cases link as `linked`. Purchase and reward ids stay `module_not_built`. |
| `progression_settings` | Versioned JSON. Ten seeded rank bands. Wallet privacy cannot hide Marks or Ingots. |
| `member_progression` | Community XP, current rank band, and daily chat and voice counters. |
| `dossier_profile` | Bio, visibility, title, and cosmetic labels. Private bio is omitted from the public dossier. |
| `birthday_record` | Opt-in month and day, optional year, timezone, and announcement flag. Deletion clears the date. |
| `invite_membership` | One row per recruited member. Confidence is `known`, `vanity`, `unknown`, or `ambiguous`. |
| `invite_event` | Join and correction history, including rejoin and suspicious flags. |
| `reward_event` | Once-only entitlement. A positive Marks amount posts through the ledger and stores `ledgerStatus` `posted`. Badge and title rows stay `not_applicable`. A reversal keeps the row and adds a ledger reversal. An older `module_not_built` row is not backfilled. |
| `member_achievement` | Earned achievement id. A second grant does not add a row. |
| `commendation` | Staff or peer note. Removal sets `status` to `removed` and keeps the row. Peer rows have no currency. |
| `voice_session` | Open eligible voice span. AFK, mute, deafen, or being alone ends it without farming XP. |
| `season_settings` | Versioned JSON. Three-month seasons, room caps, and the reserved treasury, bot, and system ids. |
| `season_state` | Current season id and its inclusive start and exclusive end. |
| `seasonal_score` | Seasonal Seals for one member and season. A new season id starts at zero. Old rows stay. |
| `lifetime_score` | Lifetime Seals. Rollover does not change the row. |
| `season_archive` | Standings copied before rollover, plus the preservation record. Unique per guild, season, and category. |
| `poll` | Staff poll. Anonymous polls still store votes. Suggestions are not a poll kind that can be saved. |
| `poll_choice` | Choice label and position. |
| `poll_vote` | One row per member and choice. Member-facing anonymous results omit the user id. |
| `temp_room` | Voice or text room, owner, occupants, empty time, last human message, and channel state. There is no maximum-lifetime column. |
| `economy_settings` | Versioned JSON for transfer limits and the guild routine pool. The member routine pace is the shared simulation, not a per-module allowance. |
| `wallet` | One row per guild, user, and currency. Marks use minor units, 100 per Mark. Ingots use the same columns as whole units under currency `ingots`. |
| `ledger_entry` | Append-only credit or debit. A reversal is a new row. `idempotencyKey` is unique. Staff reasons stay off member receipts. Market trades use pace `market` and do not spend issuance budgets. |
| `issuance_budget` | Perth-month routine and exceptional pools. Transfers, wagers, and trades do not spend these pools. |
| `ingot_market` | One row per guild. Protected reserve 2,500, inventory, event treasury, charge reserve, backing minor units, revision, curve version, baseline, spread, and quote lifetime. |
| `market_quote` | Open, committed, expired, or stale quote. It stores quantity, total minor units, revision, curve version, and expiry. |
| `market_trade` | A committed settlement. Curve edits do not rewrite these rows. |
| `collapse_charge` | A funded charge drawn from the event treasury. Activation returns those Ingots to inventory once. A Dead Drop special can reserve one; the holder stays empty until that cell is revealed. |
| `publication_template` | Named draft document. Applying it copies the fields into a new draft. |
| `publication_draft` | Current document, revision, and the revision that was last approved. Editing increments the revision and stales open approvals. |
| `publication_review` | Preview payload and separate review controls for one draft revision. |
| `publication_message` | Approved destination, mode, delivery, and the published snapshot. Review controls are not in the snapshot. |
| `publication_history` | Append-only published snapshots with author, approver, revision, and time. |
| `announcement_series` | Approved revision, cadence, timezone, next run, and pause, cancel, or stale status. |
| `announcement_delivery` | One fresh row per series and local occurrence. A repeat of that key does not insert another row. |
| `managed_pin` | Bot-managed pin for one channel. A newer pin replaces the previous one. |
| `sticky_channel` | Opt-in sticky, human-message threshold, cooldown, and the current copy id. |
| `sticky_delivery` | One sticky copy. A repost marks the previous own copy deleted. |
| `reply_rule` | Exact, keyword, trigger, or bounded pattern, with priority, exclusions, and variants. |
| `reply_cooldown` | Last member or channel hit for one rule. |
| `reply_log` | A reply that was actually selected. A refused ordinary ephemeral match is not logged. |
| `feed_source` | JSON adapter, automatic or approval mode, and the last external id. |
| `feed_item` | One source item. The same external id is not inserted again. |
| `distribution_alert` | Staff alert for a stale approval, denied permission, expiry, or unavailable feed. Delivery stays `setup_required`. |
| `event_template` | Saved event fields. A series copies them at creation. |
| `event_series` | Cadence, timezone, host, capacity, rewards, and the next start. |
| `event_occurrence` | One dated occurrence. A detached row keeps an occurrence edit. Sync status is stored on the row. |
| `event_rsvp` | One response per member. The seat is going, waitlisted, or none. |
| `event_sync` | Each native scheduled-event attempt, including `setup_required` and `failed`. |
| `event_link` | One announcement or temporary room linked to an occurrence. |
| `event_reminder` | A pending or delivered reminder. Delivery stays `setup_required`. |
| `crew` | Persistent crew name, leader, game, platform, region, and attendance reward. |
| `crew_member` | Leader, officer, or member. |
| `crew_history` | Append-only crew actions. |
| `crew_session` | An LFG or crew session. `rpgStatus` stays `module_not_built`. |
| `crew_session_member` | Join status, readiness, team, and attendance. |
| `prediction` | Free or staked prediction, lock time, evidence, and resolution rule. House fee is zero. |
| `prediction_outcome` | One labelled choice. |
| `prediction_entry` | One member stake or free entry. The stake cannot change. |
| `prediction_score` | Free-prediction points for one member. |
| `contest` | Vote or judge contest, published rules, deadline, and tie policy. |
| `contest_criterion` | Named judging weight. |
| `contest_entry` | One submission. Edits increment the revision before the deadline. |
| `contest_ballot` | One stored ballot. Reaction counts are not used. |
| `contest_result` | Score and whether that entry is part of a published tie. |
| `prize_stock` | Item, Marks, or external-key stock. External keys stay at zero on hand. |
| `prize_fulfilment` | One private fulfilment. A vault key is `fulfilled` and stores the private-inbox sentence, not the key. An empty vault is `shop_pending` and stores no key. |
| `giveaway` | Rules, bonus cap, claim window, and the immutable closing snapshot. |
| `giveaway_entry` | One free entry or one activity bonus. |
| `giveaway_draw` | A draw or reroll. Sequence 1 is kept when a later row replaces a disqualified winner. |
| `contract_definition` | An authored or seeded objective, its pools, and its current version. |
| `contract_revision` | Append-only snapshot. An assignment stores the revision it started. |
| `contract_board_slot` | Shared weekly or monthly objective for one cycle. |
| `contract_assignment` | Personal progress. The reward key is member, definition, and cycle. A rerolled row keeps its slot free for the replacement. |
| `contract_reroll` | One free daily reroll for a member and cycle. |
| `contract_preference` | Refresh notices, DM or channel delivery, and completion pings. |
| `contract_notice` | Refresh or completion delivery. A failed DM stores an empty public body. |
| `contract_submission` | A manual submission waiting for staff approval. |
| `contract_settings` | Timezone, completion channel, and the 80, 250, and 500 Mark caps. |
| `contract_cursor` | Chat cooldown and repeat state used by contract filters. |
| `character_curve` | XP factor, session XP, and sessions per week. Versioned per guild. |
| `class_definition` | One of the six classes. Base stats and summary are versioned. Editing it does not reset a character. |
| `class_ability` | Passive or active formula, unlock level, cooldown, and target rule. |
| `player_character` | Level, XP, allocated points, respec and class-change timestamps, the introductory reset, ranked debut, and gameplay lock. |
| `character_loadout_slot` | Up to four class or gear abilities. |
| `character_reward` | One starter or milestone key. It does not pay Marks. |
| `character_held_item` | Owned item. A class change can unequip it. `destroyed` stays false. |
| `character_xp_event` | Idempotent character XP. Pending rows apply when a class is chosen. |
| `gear_template` | Named definition. Version, class, level, binding, dice, and bounded affix rules. Editing it does not rewrite existing instances. |
| `gear_instance` | One owned item. Permanent id, rolled affixes, provenance, binding, equipment, upgrade tier, reroll count, upgrade history, and a combat, expedition, mission, trade, or listing lock. Defeat and a failed upgrade do not set `destroyed`. Salvage sets it only after confirmation. |
| `test_opponent` | A seeded dummy used by test duels. Not a queue entry. |
| `battle` | Quick or tactical state, winner, and the tactical deadline. Health lives in the snapshot. |
| `battle_roll` | Secure roll, sequence, purpose, and whether the member view may show it. A retry reads the stored result. |
| `battle_action` | One accepted tactical action. The idempotency key refuses a second roll. |
| `world_region` | Backstreets, Black Docks, or Inner Sanctum. Access compares character level with the stored level. A summary edit bumps the version. |
| `world_enemy` | Accuracy, defence, health, dice, and one ability. A boss is marked. An edit bumps the version and does not rewrite an expedition already started. |
| `loot_table` | Weighted template slugs for one region and difficulty, each with a reward source. |
| `expedition` | One active slot. Deadline, cooldown, reserved item ids, frozen rules, report, and once-only XP and Marks. |
| `mission_run` | One solo mission. Node, waiting state, unbanked loot, log, reserved items, and once-only rewards. The row is the state after a restart. |
| `crew_mission` | One forming or active crew run. Mode, scaled enemy, turn holder, turn deadline, abandon time, rules, and the reserved room id. |
| `crew_mission_member` | One seat. Ready state, health, misses, eligibility, revive count, reserved items, and that seat's loot. |
| `recovery` | One timer per guild and user. Failure sets 30 minutes. A recovery medkit shortens it once and cannot pass 10 minutes. |
| `pvp_rating` | One seasonal rating per guild, user, and season. A new season starts at 1,000 and copies lifetime wins, losses, and draws. |
| `pvp_queue_entry` | A waiting casual or ranked queue row. Pairing requires the same mode and the same stake. |
| `pvp_match` | A proposed, active, settled, forfeited, or cancelled match. Escrow, rating, and reward flags settle once. A repeated pair is casual before acceptance. |
| `pvp_review` | One open review for a match whose last three wagered results alternated winners. The review does not reverse the pot or the rating. |
| `workshop_settings` | Upgrade cap, listing limit, listing hours, listing fee, and reroll base. Later reads do not overwrite a saved row. |
| `material_stock` | Scrap quantity for one guild, user, and slug. A short stock writes nothing. |
| `craft_recipe` | A published recipe. The output affixes are stored with the recipe. The Honed knife seed is inserted only when that slug is missing. |
| `trade_offer` | One proposed offer. Version, both confirmation versions, expiry, and the item and Marks each side offers. Settlement, expiry, and cancellation happen once. |
| `market_listing` | One fixed-price listing. While open, `listingKey` is the item id. After sale, expiry, or cancellation it becomes the listing id. |
| `shop_offer` | One supply or Ingot offer. Stock, price, limit, level, role, class, rotation, and deliverable stay on the row. A seed is inserted only when that slug is missing. |
| `shop_purchase` | One receipt. The idempotency key is unique. A Steam key stays `held` until delivery. |
| `steam_key` | Encrypted key material and a nonce. The plaintext is not stored. Available, assigned, and revealed are the lifecycle. |
| `delivery_inbox` | The private fallback for one purchase. The summary does not contain the key. Direct-message status stays `setup_required` without a bot token. |
| `crate_table` | Published odds owner. Version, pity threshold, guarantee, and `roll_at_acquisition` policy. |
| `crate_entry` | One weighted outcome. A Steam key kind is refused. |
| `crate_pity` | Pity count and the table version last seen, for one member and table slug. |
| `crate_grant` | The stored outcome, the table version used, and pity before and after. Opening does not replace it. |
| `cosmetic_item` | One owned cosmetic. A salvage duplicate adds scrap and does not create a second row. |
| `lottery_settings` | Ticket price, cap, and stall days. The Perth hour and minute stay null until staff save them. |
| `lottery_budget` | Authorized, reserved, and spent bonus. A purchase reserves the 50 percent subsidy before the member is charged. |
| `lottery_draw` | One open draw, or a drawn or refunded result. The snapshot and winner are stored together. Rollover keeps the same row. |
| `lottery_ticket` | One equal chance. Carried tickets stay on the unresolved draw and count toward the cap. |
| `lottery_purchase` | One charged quote. The idempotency key is unique. |
| `lottery_quote` | The odds, contribution, subsidy, deadline, stall, and budget shown before a charge. Confirming it rechecks the budget. |
| `dead_drop_settings` | Pick price, starting prize, small reward, share, and the Perth hour. The hour and minute stay null until staff save them. A pending special reward is not a cell position. |
| `dead_drop_budget` | Separate authorized, reserved, and spent amounts for the starting prize and the small rewards, plus the game-treasury record. |
| `dead_drop_board` | One live board, or a won, rolled, or cancelled result. The jackpot commitment is a hash. Rollover carries the prize onto a new row and does not add another seed. |
| `dead_drop_cell` | One of 36 coordinates. The kind and payload stay covered until a paid reveal or a closed-board audit. |
| `dead_drop_pick` | One charged quote. The idempotency key and quote id are unique. Cancel refunds an open pick once. |
| `dead_drop_quote` | The price, share, jackpot, and window shown before a charge. It does not include the hidden kind. |
| `dead_drop_reminder` | One opt-in per member. Delivery stays `setup_required` without a bot token. |
| `dead_drop_notice` | One reminder row per board and member. It stores no Discord message id. |
| `dead_drop_post` | The coalesced board update. It stores no Discord message id. |
| `blackjack_settings` | Versioned table rules. A save applies to the next table. An open table keeps the rules it stored. |
| `blackjack_table` | One solo or social shoe, the dealer cards, the cursor, and the turn deadline. |
| `blackjack_seat` | One member stake and the house exposure reserved for that bet. |
| `blackjack_hand` | The stored cards for one hand. A split adds a second hand. A retry does not draw a new card. |
| `blackjack_action` | One hit, stand, double, or split. The idempotency key is unique. |
| `blackjack_quote` | The rules version, stake, natural profit, and worst-case exposure shown before a charge. |
| `blackjack_receipt` | The bet, settlement, or refund. The summary names inactivity when the timer stood the hand. |
| `blackjack_notice` | Settlement or refund delivery. It stores no Discord message id. |

Dead-letter inspection returns id, type, attempts, and the error text. It does not return payloads.

## Invariants for later tables

- Scope member records by guild ID and Discord user ID. Both are strings. Display names are not keys.
- Leaving a guild does not delete progression.
- Store timestamps as UTC `timestamptz`. Evaluate daily, weekly, and monthly cycles in `Australia/Perth` unless configuration says otherwise. Seasons use calendar months.
- Currency amounts use integers, `bigint`, or PostgreSQL `numeric`. Do not use JavaScript floating-point balances. Ingots are whole units. Fractional Marks exist only for blackjack payouts at a fixed minor-unit precision.
- Mutations that move currency, inventory, stock, or reward entitlements are atomic and idempotent. Available balance excludes escrow. Member wallets cannot go negative.
- History is append-only. Corrections are reversal rows with reasons.
- Definitions keep stable IDs and immutable published versions. In-progress trades, missions, wagers, tickets, and loot keep the version they started with.
- Provider tokens and Steam keys are encrypted. Ordinary logs and configuration export omit secrets and private ticket text.

## Planned ownership

These entities are not migrated. The module that introduces them owns the tables.

| Area | Later records |
|---|---|
| Platform | Migrated in `0b`. |
| Community | Verification, role panels, entitlements, and linked accounts are migrated in `0c`. Moderation cases, warnings, and staff logs are migrated in `0d`. Support tickets are migrated in `0e`. Community XP, dossiers, invites, birthdays, and achievements are migrated in `0f`. Seasons, leaderboards, polls, and temporary rooms are migrated in `0g`. Ranked ratings are migrated in `0s`. |
| Economy | Marks wallets, ledger entries, issuance budgets, and economy settings are migrated in `0h`. The Ingot market, quotes, trades, backing, and funded collapse charges are migrated in `0i`. Shops, crates, and private keys are migrated in `0u`. The lottery budget and draws are migrated in `0v`. Dead Drop seed and small-reward budgets are migrated in `0w`. The blackjack house bankroll is Marks already issued into the house wallet in `0x`. |
| Progression | Community XP, Dossiers, seasons, achievements, polls, temporary rooms, and character progression are migrated. |
| Publications | Drafts, reviews, history, recurrence, pins, stickies, replies, and feed cursors are migrated through `0k`. |
| Activities | Official events and crews are migrated in `0l`. Predictions, contests, and giveaways are migrated in `0m`. Contracts are migrated in `0n`. |
| RPG | Classes, characters, loadouts, and character XP are migrated in `0o`. Gear templates, instances, test opponents, battles, rolls, and actions are migrated in `0p`. Regions, enemies, loot tables, and expeditions are migrated in `0q`. Interactive missions, crew missions, and recovery are migrated in `0r`. Casual and ranked queues, challenges, ratings, and wagers are migrated in `0s`. Direct trades, listings, upgrades, salvage, crafting, and rerolls are migrated in `0t`. |
| Markets | Direct trades and member listings are migrated in `0t`. Shops, crates, and private key delivery are migrated in `0u`. |
| Games | Lottery draws are migrated in `0v`. Dead Drop boards and a funded Market Collapse discovery reward are migrated in `0w`. Solo and social blackjack tables are migrated in `0x`. A funded collapse charge is migrated in `0i`; Dead Drop reserves one from the event treasury and does not mint. A blackjack win pays from reserved house Marks and does not mint. |

Public wealth means Marks and Ingots can be read on a Dossier. Estimated wealth is labelled estimated and price-sensitive. It does not mean public account tokens, staff reasons, private inventories, or analytics.
