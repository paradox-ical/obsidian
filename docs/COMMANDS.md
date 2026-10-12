# Commands

Commands are not registered on boot. `npm run commands:plan` validates the manifest and prints a dry run. It does not call Discord. `npm run commands:plan -- --apply` sends a PUT only when `DISCORD_TEST_GUILD_ID` is set, the target guild is that same id, the production guild id is different, and both the bot token and application id exist. Otherwise the tool stops with `setup_required` or a refusal and does not call Discord. No production registration is in scope.

## Limits checked against Discord

Verified 7 October 2026 from https://docs.discord.com/developers/interactions/application-commands:

- 100 global `CHAT_INPUT` commands.
- The same number of guild-specific commands per guild, for every type except `PRIMARY_ENTRY_POINT`.
- At most 25 options at each option level.
- Discord also documents a global rate limit of 200 application command creates per day, per guild. This repository does not create commands.

The project ceiling is 50 parent commands. The target is 36. `packages/domain/src/commands.ts` lists those parents as subcommand trees. Unit tests reject duplicate names, counts above the ceiling, and more than 25 options at one level. `/verify`, `/roles`, `/accounts`, and `/temproles` call the community services. The other parents remain routing panels. Commands are still not registered.

## Parent plan

| Parent | Actions or panels |
|---|---|
| `/help` | Searchable module help, personal available actions |
| `/setup` | Admin wizard, diagnostics, channel/role mappings |
| `/verify` | `captcha` (optional answer), `assistance` (optional note), `review` (member, reason, optional revoke) |
| `/roles` | `panel` (optional name), `optin` (role, optional clear) |
| `/accounts` | `link`, `inspect`, `privacy`, `unlink` |
| `/temproles` | `grant`, `renew`, `expire` |
| `/invites` | `progress`, `attribution` |
| `/birthday` | `set`, `privacy`, `reminders`, `remove` |
| `/mod` | `sanctions`, `warnings`, `cases`, `appeals` |
| `/report` | `submit` |
| `/logs` | `search`, `export`, `settings` |
| `/stats` | `report`, `export` (reason). Discord requires the statistics capability. |
| `/rank` | `profile` |
| `/economy` | `wallet` (optional member), `transfer` (member, amount), `history` (optional member), `adjust` (action, member, amount, reason). Adjust requires economy operations. |
| `/market` | `chart`; `pool`; `quote` (side, amount); `buy` (amount); `sell` (amount). Confirm button `market:confirm:{quoteId}`. |
| `/leaderboard` | `rankings` (category, page), `archive` (season, category) |
| `/events` | `manage` (action, name, occurrence, host, scope, when, recap, member) and `rsvp` (occurrence, response). Manage requires event management. |
| `/schedule` | `view` lists occurrences and sync status. `control` links one room or announcement. |
| `/crew` | `persistent`, `session`, and `lfg`. A crew mission action opens the existing crew's Backstreets run. A one-member crew is short. A ready reply includes the rules and says the notice is not posted. |
| `/prediction` | `free` and `staked`. Confirm shows the rules before a stake is held. Resolution evidence is required. |
| `/contest` | `submit`, `ballot`, and `judge`. Ballots are stored. A published tie is not broken silently. |
| `/giveaway` | `enter`, `bonus`, and `draw`. The draw uses the locked snapshot. A vault key says it is in the private inbox and was not posted. An empty vault says shop delivery is not built. |
| `/publish` | `embed` and `review` point at the admin editor. Approve, Edit, Request changes, and Cancel are review buttons. `announce`, `pin`, and `sticky` point at the same admin tools and do not post. |
| `/reply` | Authorised auto-reply rules and test |
| `/lottery` | `tickets` quotes or buys. The quote shows odds, bonus, deadline, and the stall refund, and it does not charge. `draw` shows the open draw. `history` shows settled results. The reply says the notice is not posted. |
| `/contracts` | `board`, `progress`, `reroll`, `settings`, and `custom`. A closed DM is not claimed as sent. Turning pings off does not stop the reward. |
| `/combat` | `action` starts a quick or tactical test duel, or sends strike, defend, ability, or item. `records` reads a stored battle. `queue` joins, leaves, or accepts a casual or ranked queue. `challenge` offers, accepts, or cancels a direct match. The stake is an equal Marks amount, including zero. The reply says the notice is not posted. |
| `/character` | `class`, `stats`, `abilities`, `respec`, and `loadout`. A respec costs 5,000 Marks. A class change costs 15,000 Marks. The reply does not claim a Discord post was sent. |
| `/explore` | `expedition` previews or starts one timed run, or reads the stored report. `mission` previews, starts, chooses, checks, or fights a stored graph. `crew` stays on the crew command. A notice without a bot token stays setup-required and is not claimed as posted. |
| `/inventory` | `gear` lists, equips, or unequips an instance. `materials`, `trade`, `craft`, `salvage`, `upgrade`, and `reroll` use the workshop. `crates` previews odds and pity, opens a stored result, or lists grants. Opening does not roll again. A reply that can be posted says the notice is not posted. |
| `/profile` | `dossier`, `cosmetics`, `privacy`, `preferences` |
| `/shop` | `supply` and `ingot` browse or buy. A Steam key stays in escrow until the private inbox is ready, and reveal says the key was not posted. `marketplace` browses, lists, buys, or cancels a fixed-price listing. The reply says the notice is not posted. |
| `/blackjack` | `solo` and `social` quote, open, join, hit, stand, double, or split. `receipt` reads the stored result. The quote shows the rules version, the natural profit, and the reserved exposure. A reply that can be posted says the notice is not posted. |
| `/deaddrop` | `board` shows the shared 6×6 grid, jackpot, and picks left. `pick` quotes or buys one covered cell. `reminder` opts into the opening notice. `special` sets the next staff reward or activates a held Market Collapse. A reply that can be posted says the notice is not posted. |
| `/support` | `tickets` (open, list, close, reopen, claim, transfer, note, transcript, link), `rooms` (create, join, leave, close, claim, transfer, hold), `achievements`, `commendations` |
| `/community` | `polls` (create, vote, results, close); `updates` and `manage` are not built |

These names are a routing plan. They are not permission to drop a subfeature, and they are not deployed slash commands.

## Channel layout

No channels are created. Logical destinations from master spec section 3 stay unmapped until setup configuration exists: bot-terminal, contracts, events, market, game-updates, lottery/dead-drop, activity threads, publication-review, moderation-log, server-log, economy-audit, support tickets, and temporary-room categories.
