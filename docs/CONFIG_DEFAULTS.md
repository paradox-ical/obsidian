# Configuration defaults

Values below are configurable defaults from the master spec unless a row says the policy is fixed. The timezone default is in code. Game, economy, and moderation configuration are not seeded.

Unset operational inputs, from master spec section 17, are not invented: application token, client secret, test and production guild IDs, admin role and user mappings, Verified role, onboarding permission map, destination channels, Dead Drop hour, lottery time, provider credentials, feed sources, Steam key stock, backing and reward funding, hosting domain, and backup destination.

| Key | Default | Policy | Where it lives |
|---|---|---|---|
| `DEFAULT_TIMEZONE` | `Australia/Perth` | Cycle evaluation default | Env default and new guild rows |
| Command parents | 36 names, ceiling 50 | Routing plan | Manifest and dry-run tool. Not published. |
| Discord global CHAT_INPUT | 100 | Platform limit | Constant, not a deployment |
| Options per command level | 25 | Platform limit | Enforced by `validateCommandManifest` |
| Job retry | 1s, 2s, 4s… capped at 15 minutes | Operational default | `retryDelayMs` |
| Job attempts | 5 | Operational default | `enqueueJob` when the caller omits `maxAttempts` |
| OAuth state | 10 minutes, single use | Operational default | `oauth_state` |
| Admin session | 12 hours | Operational default | httpOnly cookie |
| Login starts | 10 per minute | Operational default | `auth_attempt` |
| Verification CAPTCHA | 6 unconfused characters, 5-minute expiry, 3 failures, 10-minute cooldown | Default | `packages/domain/src/community.ts`. The answer is stored only as a hash. |
| Absence and temporary roles | Wall-clock expiry. `pauseEntitlementsWhileAbsent` defaults to false | Default | Community settings document |
| Account providers | Steam, Riot, Battle.net, Epic, EA, Ubisoft, Xbox, PlayStation, Minecraft, Twitch, YouTube, Bungie, Roblox | Optional | Empty keys in `.env.example` stay `setup_required`. Minecraft and Roblox ownership proof is unavailable. |
| Moderation policy | Labelled example: flood, repeat, mention, link/invite, join spike. No automatic ban | Default until replaced | `examplePolicy()`. Saving a ban action removes it. |
| Warning points | Active total excludes expired and reversed rows. History remains | Default | `warning_point.status` |
| Log retention | 14 days, then message text is removed and labelled `expired` | Default | `moderation.log.retain` |
| Support tickets | Example categories: verification help, general, moderation, purchase question. Open cap 2. Cooldown 10 minutes. Inactivity reminder 24 hours. Optional closure 72 hours. Retention 14 days. No general-access grant | Default until replaced | `exampleTicketSettings()`. Purchase and reward resolution stays `module_not_built`. |
| Qualified invite | Verified membership retained 7 days, default reward 100 Marks | Default | Posted to the Marks ledger once. A correction reverses that credit when the balance can cover it. |
| Birthday role | 24 hours | Default | `grantSystemRole` source `birthday`. Expiry uses `community.role.expire`. |
| Birthday gift | 50 Marks, once per member per year | Default amount | Posted to the Marks ledger. A second call in the same year does not pay again. |
| Marks supply | Uncapped | Fixed | Issuance is only through the ledger. There is no maximum supply. |
| Ingot supply | 5,000 total; 2,500 protected reserve; 2,500 active | Fixed | Seeded on the first market read. Ordinary release of the protected reserve returns `policy_required`. |
| Ingot baseline | 10,000 Marks, curve `ceil(10,000 × (2,500 / A)^3)`, no price ceiling | Curve is a tunable default; scarcity and no ceiling are fixed | Seeded. A buy of q units sums each step. Inventory 0 disables buys. |
| Sell spread | 5 percent | Tunable default | Each reverse step pays `floor(0.95 × p(A+1))`. The spread stays in backing above the un-discounted liability. |
| Quote lifetime | 30 seconds | Tunable default | Confirmation requires the stored revision, curve version, and recomputed total. A mismatch or expiry does not charge a new price. |
| Publication approval | Admin self-approval allowed. A draft can require a second admin. | Per draft | Approval chooses the destination and publishes now or schedules one time. A later edit requires a new approval. |
| Announcements | Timezone `Australia/Perth`. Cadence once, daily, weekly, or monthly. Grace window 15 minutes. At most 5 role mentions and 5 user mentions. | Per series | A missed backlog is skipped. Removal is optional and does not post a replacement. |
| Stickies | Off until a channel is saved. Cooldown and human-message threshold are set on that channel. | Per channel | Bots and the current sticky copy do not count. |
| Auto replies | Off until a rule is saved. Patterns are limited to 64 characters and reject nested quantifiers. | Per rule | An ordinary message cannot send an ephemeral interaction response. |
| Game updates | JSON adapter only. A source is automatic or approval-queue. | Per source | A missing or bad feed stays unavailable and does not invent an update. |
| Official events | Timezone `Australia/Perth`. Capacity and waitlist are set per series. Check-in opens 15 minutes before the start. | Per series | Discord scheduled-event sync is `setup_required` without a bot token. |
| Crews and LFG | A session is open or approval-only. Attendance reward is once per crew. | Per crew | A second session does not pay again. RPG missions stay `module_not_built`. |
| Predictions | House fee is zero. Stakes are whole Marks. Free mode awards points, and an optional prize uses the exceptional pool. | Per prediction | A short exceptional pool records the result as unfunded and does not invent Marks. |
| Contests | Tie policy is publish. Self-votes are off. Edits are allowed before the deadline. | Per contest | A published tie does not pick one winner. |
| Giveaways | One free entry. Bonus cap is set per giveaway. Claim window defaults to 60 minutes. | Per giveaway | A vault key is fulfilled into the private inbox. An empty vault stays `shop_pending` and does not invent a key. |
| Contracts | Three personal dailies. Shared caps are 80 Marks a day, 250 a week, and 500 a month, inside the 7,987 routine total. Timezone `Australia/Perth`. One free reroll of an unstarted daily. | Per guild | Completion pings default on and do not control the payout. `rpg_crafting` and `rpg_pvp` are ready and stay off the automatic boards. Seeded objectives grant 0 character XP until staff set a value. |
| Characters | Level cap 50. Three points per level gained. XP to leave level L is 100 times L. A regular week is four sessions of 1,200 character XP. | Per guild curve | A respec costs 5,000 Marks and waits seven days. A class change costs 15,000 Marks, includes the respec, and waits 30 days. One introductory reset is free below level 10 before a ranked debut. |
| Gear and combat | 49 templates, including the recovery medkit. Affix amounts stay inside the template rule, and a weapon takes at most one. Combined accuracy and defence caps are 8. Healing caps at 8. A tactical turn lasts 2 minutes. | Fixed bounds | The Training Dummy and Range Marker are test opponents. |
| Reference earning pace | 7,987 Marks in the documented month, so 10,000 takes 2 months | Simulation default, shared by every routine source | `simulateMonthlyEarnings()`. Assumptions: 30-day month, weekly line `round(250 × (365.25 / 7) / 12) = 1,087`, daily cap not counted again per contract, exceptional prizes outside the routine total. |
| Lottery | 100 Marks/ticket, cap 5, 50 percent funded bonus, 3 distinct entrants, 7-day stall default | Ticket price, cap, and stall are tunable; bonus and entrant rule are specified | The Perth draw time stays unset until staff save an hour and minute. No default hour is stored. |
| Dead Drop | 6×6, 3 picks, 100 Marks/pick, one configured Perth hour, paid only, 200 Mark starting prize, 20 Mark small reward on 4 cells, 50 percent of each pick to the jackpot | Hour is unset; pick price, starting prize, small reward, and share are tunable | The Perth opening hour stays unset until staff save an hour and minute. No default hour is stored. One card back and one icon per reward kind render the board. |
| Seasons | Three calendar months from January, timezone `Australia/Perth`, one seasonal title and 100 Marks posted to the ledger | Length is fixed; the start month is tunable | `exampleSeasonSettings()` |
| Character cap | Level 50, 3 stat points per level gained | Specified | Package 15 |
| Respec | 5,000 Marks, 7-day cooldown | Fixed | Package 15 |
| Class change | 15,000 Marks including respec, 30-day cooldown | Fixed | Package 15 |
| Regions | Backstreets 1, Black Docks 15, Inner Sanctum 35 | Seeded defaults. Access is the character level. | Package 17 |
| Expeditions | One slot. Routine is 10 minutes, a 15-minute cooldown, 40 XP, and 8 Marks. Standard is 30, 45, 80, and 15. Severe is 60, 120, 160, and 25. The daily expedition XP cap is 400. | Seeded durations and rewards. Scale adds enemy defence and 4 health. | Package 17 |
| Missions and recovery | A won solo mission is 60 XP and 12 Marks. An eligible crew seat is 40 XP and 10 Marks. Recovery is 30 minutes, a medkit shortens it by 15, and it cannot pass 10. Crews are 2–5. Live turns are 2 minutes, async turns are 30, and abandonment is 6 hours. One revive. Two misses exclude rewards. | Fixed. No energy, hunger, thirst, or durability. | A failed mission does not destroy owned gear. |
| Ranked play | Starting rating 1,000. Elo K is 32 and the scale is 400. The ranked allocation budget is 12. Gear affix power budget is 8. Abilities above level 10 are closed. The first 2 ranked matches against one opponent each Perth day change rating. Disconnect grace is 2 minutes. Two missed turns forfeit after an automatic defend. A ranked win pays 8 Marks and 20 XP from the routine budget. A wager is 0 to 1,000 equal Marks, and zero stays available. | Fixed | Package 19 |
| Workshop | Upgrade cap 3. The next tiers cost 25, 50, and 100 Marks plus 1 scrap. Salvage pays 1 scrap plus 1 per tier and destroys only after confirmation. The reroll base is 10 Marks and rises with that item's reroll count. A member can list 3 items for 72 hours. The listing fee starts at 0. A direct trade lasts 24 hours. Honed knife spends 2 scrap and crafts a field knife with honed damage 1. | Caps, listing fee, and recipes are per guild. The seed recipe is inserted only when that slug is missing. | Upgrades never destroy an item. A trade or listing does not mint Marks. |
| Shops and crates | Field knife 50 Marks, stock 5, limit 2. Scrap bundle 20 Marks. Field crate 40 Marks and pity 5. Steam key 10 Ingots, stock starts at 0, limit 1. Night glass 2 Ingots. Vault crate 3 Ingots and pity 4. The later ration starts 1 January 2027. | Per offer and table. A seed is inserted only when that slug is missing. | Steam keys are direct Ingot shop only. A crate cannot contain one. Results are stored at acquisition. Duplicate salvage pays 2 scrap. Direct messages stay `setup_required`. |
| Temporary rooms | Voice empty 6 hours; text 24 hours without a human message; no maximum lifespan; one of each per member; five of each per server; 10-minute creation cooldown; private text by default | Durations are fixed; caps and cooldown are tunable | `exampleSeasonSettings()` |
| Rank bands | Ten bands across community levels 0–100 | Seeded default | `exampleProgressionSettings()` |
| Blackjack | Dealer stands on soft 17, natural 3:2, regular 1:1, one split, split aces take one card, and a split blackjack pays 1:1. Minimum bet 1 Mark, maximum 10, table cap 5, join window 60 seconds, turn 45 seconds, six decks. | Tunable before the next table is created. The default maximum loss of 40 Marks stays small beside the 7,987 Mark routine month. | Package 24 |
| `BACKUP_PASSPHRASE` | Unset | Required only to seal Discord and provider values. An empty value stays `setup_required` and does not write a file. | `scripts/secret-backup.mjs`. The passphrase is not stored in PostgreSQL or in a configuration export. |

Local Docker defaults that are not product policy:

| Key | Local value |
|---|---|
| `DATABASE_URL` | `postgresql://collective:collective@postgres:5432/collective` inside Compose. Host tools use `localhost:5433`. |
| Bot health | `0.0.0.0:8081` |
| Worker health | `0.0.0.0:8082` |
| Admin | `0.0.0.0:5173` |
| `NODE_ENV` | `development` in Compose |
| `LOG_LEVEL` | `info` |
