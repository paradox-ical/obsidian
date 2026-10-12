# Acceptance report

Written 12 October 2026 from the workstation. Host Node.js is v22.14.0, below the pinned `>=24.17.0 <25` range. Docker uses Node.js 24.21.0. Foundation revision on disk and in PostgreSQL is `0x`. No production guild, command PUT, or hosting change was made.

Status words used here:

| Status | Meaning |
|---|---|
| verified | A check in this session, or a named test file, exercised the behaviour against local code or local PostgreSQL. |
| unverified | The code path exists and the live call was not made because credentials or a named test guild are absent. |
| blocked | A missing secret or an explicit instruction stops that live step only. |
| missing | The repository does not contain the behaviour. |

A unit test, fixture, health JSON, or local page is not a Discord, OAuth, or provider proof.

## Checks run in this session

| Check | Result |
|---|---|
| `npm run build` | Passed. Admin client build transformed 109 modules. |
| `npm run typecheck` | Passed for admin, bot, db, domain, and ui. |
| `npm run lint` | Passed with no findings. |
| `npm test` | Passed. Vitest 5.0.3, 32 files, 84 tests. |
| `npm run test:integration` | Passed. 26 files, 48 tests, PostgreSQL on `localhost:5433`. The Compose worker was stopped first. Discord was not called. |
| `npm run prisma:deploy` | Passed. 25 migrations, none pending. |
| `npm run boot:check` | Passed. Bot `discord` is `setup_required` and `foundationRevision` is `0x`. Worker `jobs` is `ok`. Admin `access` is `denied` and `dashboardAuth` is `setup_required`. Discord login was not attempted. |
| `npm run commands:plan` | Passed. Printed `Dry run: commands were not sent. Parent count: 36.` |
| `npm audit` | Exit 1. Four high findings, listed under Security. No package was upgraded or downgraded. |
| `npm run backup:rehearse` | Passed. Restored into `collective_rehearsal`, read revision `0x` and the disposable marker, confirmed the marker was absent from the live database, dropped `collective_rehearsal`, and recovered a fixture secret that was not written to disk. |
| `npm run backup:secrets` | Printed `setup_required`. `BACKUP_PASSPHRASE` was unset, so no secret file was written. |
| Supply and ledger query | `negative_wallets` is 0. `foundation_revision` is `0x`. 72 `ingot_market` rows remain from local test guilds. Each row's protected reserve and inventory sum to 180,000, which is 72 times 2,500. Treasury and charge sums are 0. That is per-guild seed state, not one shared pool of 180,000. |
| Simulations | `operationsSimulations()` returned `persisted: false`, `grants: none`, routine Marks 7987, two months to reach 10,000, blackjack worst loss 40, character level 50 after 26 weeks. `simulateSupplyConservation()` returned `conserved: true` and total `5000`. `catalogCounts()` returned 3 regions, 15 enemies, 3 bosses, and 49 gear templates. |

After the integration run, `docker start obsidian-worker-1` started the Compose worker again. `postgres`, `bot`, and `admin` were already healthy.

## Fixed decisions

Each row is the policy in master spec section 1. Local evidence is a test or service. Live Discord delivery for that row is unverified unless the scenario table says otherwise.

| Decision | Local status | Evidence |
|---|---|---|
| Native onboarding, then CAPTCHA; verified members are remembered | verified | `packages/db/src/community.integration.test.ts` restores a verified member with `captchaIssued: false` |
| Optional accounts; no ordinary-access block | verified | `packages/domain/src/community.test.ts` and the community integration file. Provider exchange stays `live_exchange_unavailable` |
| Staff-only statistics; member leaderboards allowed | verified | `apps/admin/server/auth.integration.test.ts` denies a session-less stats read. Leaderboards are in `packages/db/src/seasons.integration.test.ts` |
| Admin-only dashboard | verified | Logged-out `/health` is `access: denied`. Moderator capability is not a dashboard grant |
| Self-approval, preview, edit reloads the draft, approve then destination | verified | `packages/db/src/publications.integration.test.ts` |
| Fresh announcement message every occurrence | verified | `packages/db/src/distribution.integration.test.ts` |
| Uncapped Marks; 5,000 Ingots with 2,500 protected | verified | `packages/domain/src/economy.test.ts`, `packages/domain/src/ingots.test.ts`, `packages/db/src/market.integration.test.ts` |
| Baseline 10,000 Marks, scarcity curve, no price ceiling | verified | `packages/domain/src/ingots.test.ts` |
| At least one month to earn 10,000 Marks | verified | This session's simulation: 7987 routine Marks, `monthsToReachTarget` 2 |
| Steam keys only in the direct Ingot shop | verified | `packages/db/src/shop.integration.test.ts` refuses a Steam-key crate entry |
| Public Marks and Ingot balances | verified | `packages/db/src/progression.integration.test.ts` dossier reads |
| Three-month seasons; Seals and ranked rating reset; progression retained | verified | `packages/db/src/seasons.integration.test.ts` and `packages/db/src/pvp.integration.test.ts` |
| Lottery price, cap, bonus, three entrants, rollover | verified | `packages/db/src/lottery.integration.test.ts` |
| Dead Drop paid board, three picks, jackpot closes, unfound prize rolls | verified | `packages/db/src/dead-drop.integration.test.ts`. No opening hour was invented |
| Contract boards, preferences, automatic payout, one unstarted reroll | verified | `packages/db/src/contracts.integration.test.ts` |
| Separate character progression, six classes, level 50 in about six months | verified | `packages/domain/src/characters.test.ts` and this session's simulation |
| Respec 5,000 Marks and seven-day cooldown; class change 15,000 Marks and 30-day cooldown | verified | `packages/db/src/characters.integration.test.ts` |
| Three regions, level gates, cooldowns, no energy meter | verified | `packages/domain/src/world.test.ts` |
| Shared D20 combat, quick and tactical play | verified | `packages/db/src/combat.integration.test.ts` and `packages/db/src/pvp.integration.test.ts` |
| Ranked queue, challenges, optional equal wagers | verified | `packages/db/src/pvp.integration.test.ts` |
| Tradable ordinary gear, bound items, bounded affixes | verified | `packages/db/src/workshop.integration.test.ts` |
| Crates without Steam keys | verified | `packages/db/src/shop.integration.test.ts` |
| Room timers and no maximum lifespan | verified | `packages/db/src/seasons.integration.test.ts` |
| Staff polls only; suggestions excluded | verified | `packages/domain/src/seasons.test.ts` and `packages/db/src/seasons.integration.test.ts` |

## Acceptance scenarios

| ID | Local status | Evidence | Not live |
|---|---|---|---|
| AC-01 | verified | `packages/db/src/community.integration.test.ts`: after CAPTCHA, `reconcileMember` returns `restored` and `captchaIssued: false`. The Marks wallet stays 2500 available and 100 escrow. The dossier bio stays `kept`. | Discord did not emit a member leave or join. |
| AC-02 | verified | `packages/db/src/progression.integration.test.ts` expires the birthday grant and leaves the permanent grant. | The Discord role API was not called. |
| AC-03 | verified | `packages/db/src/moderation.integration.test.ts` records a case for a moderation role. `apps/admin/server/auth.integration.test.ts` denies dashboard and stats access without a dashboard grant. | No live Discord case action was sent. |
| AC-04 | verified | `packages/db/src/ledger.integration.test.ts` lets one of two full holds succeed. `packages/db/src/shop.integration.test.ts` sells the last item once. | No Discord shop post was made. |
| AC-05 | verified | `packages/db/src/market.integration.test.ts` and `packages/domain/src/ingots.test.ts`. | No live market panel was posted. |
| AC-06 | verified | `packages/db/src/dead-drop.integration.test.ts` activates one funded charge, keeps supply 5,000, and leaves backing unchanged. | No Discord announcement was posted. |
| AC-07 | verified | `packages/db/src/publications.integration.test.ts` and `packages/db/src/distribution.integration.test.ts`. | Delivery stays `setup_required` without a bot token. |
| AC-08 | verified | `packages/db/src/contracts.integration.test.ts`. | Contract DMs were not sent. |
| AC-09 | verified | `packages/db/src/workshop.integration.test.ts`. | No trade post was made. |
| AC-10 | verified | `packages/db/src/pvp.integration.test.ts`. | No match notice was posted. |
| AC-11 | verified | `packages/db/src/lottery.integration.test.ts`. | No draw time was assumed and no Discord post was made. |
| AC-12 | verified | `packages/db/src/dead-drop.integration.test.ts`. | No opening hour was assumed. |
| AC-13 | verified | `packages/db/src/blackjack.integration.test.ts`. | No table notice was posted. |
| AC-14 | verified | `packages/db/src/seasons.integration.test.ts`. | Channel create, delete, and disconnect stay `setup_required`. |
| AC-15 | verified | `packages/db/src/seasons.integration.test.ts`. | No season announcement was posted. |
| AC-16 | verified | `packages/domain/src/characters.test.ts`, `packages/domain/src/economy.test.ts`, and this session's simulation. | The simulation does not grant Marks. |
| AC-17 | verified | `packages/domain/src/world.test.ts` and `catalogCounts()`: 3 regions, 15 enemies, 3 bosses, 49 gear templates. Six classes are in `packages/domain/src/characters.ts`. | Content was not posted to Discord. |
| AC-18 | verified for the closed shell | Package 25 browser check: logged-out home, operations, community, and economy pages; 390-pixel width did not overflow; skip link focuses `#dashboard-content`; unauthenticated module APIs return 403. | Signed-in forms were not clicked. Discord OAuth is `setup_required`. |

## Modules

Discord command parents are the 36 names in `packages/domain/src/commands.ts`. `npm run commands:plan` counted 36 and did not send them. Admin routes live under `apps/admin/server/` and pages under `apps/admin/src/`. Persistence is in `packages/db/src/`. There is no member dashboard route.

| Module | Local status | Main evidence |
|---|---|---|
| Foundation, jobs, outbox, OAuth boundary | verified | `packages/db/src/platform.integration.test.ts`, `apps/admin/server/auth.integration.test.ts` |
| Verification, roles, accounts | verified | `packages/db/src/community.integration.test.ts` |
| Moderation and statistics | verified | `packages/db/src/moderation.integration.test.ts`, `packages/db/src/ledger.integration.test.ts` |
| Tickets | verified | `packages/db/src/tickets.integration.test.ts` |
| Progression, dossiers, invites, birthdays | verified | `packages/db/src/progression.integration.test.ts` |
| Seasons, polls, rooms | verified | `packages/db/src/seasons.integration.test.ts` |
| Ledger and Ingot market | verified | `packages/db/src/ledger.integration.test.ts`, `packages/db/src/market.integration.test.ts` |
| Publications and distribution | verified | `packages/db/src/publications.integration.test.ts`, `packages/db/src/distribution.integration.test.ts` |
| Events, crews, activities | verified | `packages/db/src/gatherings.integration.test.ts`, `packages/db/src/activities.integration.test.ts` |
| Contracts | verified | `packages/db/src/contracts.integration.test.ts` |
| Characters, combat, world, missions | verified | `packages/db/src/characters.integration.test.ts`, `combat.integration.test.ts`, `world.integration.test.ts`, `missions.integration.test.ts` |
| PvP and workshop | verified | `packages/db/src/pvp.integration.test.ts`, `packages/db/src/workshop.integration.test.ts` |
| Shop, crates, keys | verified | `packages/db/src/shop.integration.test.ts` |
| Lottery, Dead Drop, blackjack | verified | `packages/db/src/lottery.integration.test.ts`, `dead-drop.integration.test.ts`, `blackjack.integration.test.ts` |
| Operations, backup, rehearsal | verified | `packages/db/src/operations.integration.test.ts`, `scripts/restore-rehearsal.mjs` |

No product module was found missing from the repository. Live delivery for every module that posts to Discord is unverified.

## Security

`npm audit` reported four high findings and no critical findings:

| Package | Advisory | Why it was not changed |
|---|---|---|
| `deepmerge-ts` before 8.0.0 | GHSA-ggr8-5vv4-36mx, stack exhaustion while merging recursive objects | Transitive through `@prisma/config`. The offered fix downgrades `prisma` to 6.19.3. |
| `mysql2` before 3.22.0 and through 3.23.0 | GHSA-3f6p-5ww8-9rcr and GHSA-rgwj-5xj2-c3m3 | Transitive through `prisma`. This project uses PostgreSQL through `pg`, not MySQL. |
| `prisma` 6.13.0-dev.1 through 8.1.0-dev.6 | Via the two packages above | `docs/DECISIONS.md` pins Prisma ORM 7.10.0. A downgrade to 6.19.3 would violate that pin. |

`npm audit fix --force` was not run. Configuration import rejects secret-named fields and private URLs in `packages/domain/src/operations.ts`. Feed saves reject those URLs in `packages/db/src/distribution.ts`. Health JSON from this session's boot check did not contain a token.

## Secret-safe setup

1. Copy `.env.example` to `.env`. Do not commit `.env`.
2. Leave `DISCORD_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_TEST_GUILD_ID`, `DISCORD_PRODUCTION_GUILD_ID`, and provider keys empty until the values exist outside this repository. Empty Discord values stay `setup_required`.
3. Set `BACKUP_PASSPHRASE` only in the environment or the uncommitted `.env` when a secret seal is required. Do not put the passphrase in PostgreSQL or in a configuration export.
4. From the repository root, with Docker running:

```bash
docker compose up --build -d
npm ci
npm run prisma:generate
npm run prisma:deploy
npm run build
npm run boot:check
npm run commands:plan
```

`commands:plan` without `--apply` does not call Discord. `boot:check` clears Discord variables for its child processes and does not log in. The local database password in `.env.example` is for the disposable Compose database only.

## Test-guild manual steps

Do not run the apply step until an instruction names the test guild. The registration code refuses a guild id that equals `DISCORD_PRODUCTION_GUILD_ID`.

1. Create a Discord application that is not the production application. Put its bot token, application id, and OAuth client secret into the uncommitted `.env`. Put only the test guild id in `DISCORD_TEST_GUILD_ID`.
2. Invite the bot to that guild with the permissions the test needs. Do not grant it production channels.
3. In the Discord server, set the Verified role, the assistance channel, and the onboarding channel map. Save them from the admin community page after OAuth succeeds. A missing Verified role fails closed.
4. Choose a Dead Drop opening hour and a lottery draw time in the admin pages. Neither has a default.
5. Fund exceptional and routine budgets, Ingot backing, the lottery bonus, the Dead Drop seed, and the blackjack house only with amounts you intend to spend in the test guild.
6. Run the dry plan and confirm the parent count is 36:

```bash
npm run commands:plan
```

7. Register only after the test guild id is the one named in the instruction:

```bash
npm run commands:plan -- --apply --guild THE_TEST_GUILD_ID
```

Replace `THE_TEST_GUILD_ID` with the snowflake already stored in `DISCORD_TEST_GUILD_ID`. If the token or application id is missing, the command prints `setup_required` and does not send the PUT.

8. Walk one path per area in that guild and record the Discord message id only when Discord returns one: verify and rejoin, open a case as a moderator and confirm that account cannot open the dashboard, buy the last shop unit twice, buy and sell one Ingot, activate one funded collapse, approve one edited publication, complete one contract with pings off, edit a trade, settle one ranked wager, buy one lottery set with fewer than three entrants, pick one Dead Drop cell twice, play one blackjack hand and repeat the settlement, empty a voice room, roll a season in a fixture guild, and open the dashboard on a phone-width browser with the keyboard.

## Production rollout

This checklist was not executed. It requires a separate instruction before any step runs. Do not point these commands at the current local volume and call that production.

1. Confirm the instruction names the production host, domain, guild id, and backup destination.
2. Use a production `.env` that is not the Compose password and is not committed. Set distinct `DISCORD_PRODUCTION_GUILD_ID` and `DISCORD_TEST_GUILD_ID`.
3. Take `npm run backup:database` and `npm run backup:secrets` against the production database before the first migration. Store the dump and the sealed secret file in the named backup destination, not in git.
4. Restore that dump with `npm run backup:rehearse` against an isolated database. Do not continue if the rehearsal marker appears in the live database.
5. Run `npm run prisma:deploy` on the production database. This applies forward migrations only.
6. Start the bot, worker, and admin with the production environment. Confirm `/health` reports `database: ok` and does not print secrets. `discord: setup_required` means credentials are still missing.
7. Do not run `commands:plan -- --apply` against the production guild. The registrar refuses that guild id. A production command PUT needs a later instruction that changes that refusal on purpose.
8. Open the admin dashboard, confirm access is denied without a session, then sign in with a dashboard grant. Pause one non-protected module and confirm verification still answers.

## Production rollback

This checklist was not executed. It also requires a separate instruction.

1. Stop the bot, worker, and admin. Do not run `docker compose down -v`.
2. Keep the pre-change dump. Restore it into a replacement database, run `npm run prisma:deploy` there, and point the application at that database only after the rehearsal query shows the expected revision.
3. Configuration rollback, when the database is still the one you intend to keep, is the operations page: copy the selected version and publish only with the confirm control. That writes a new version and does not delete history.
4. Pause a single module from the operations page if the fault is limited to that module. Verification and moderation stay available.
5. Leave Discord commands as they were. Removing or replacing production commands is a separate PUT and is refused by the current registrar.

## Remaining prerequisites

These are blocked, not missing code:

- Discord bot token, application id, and OAuth client secret.
- A named test guild id before any command PUT.
- A production guild id that stays different from the test guild id.
- Dashboard user and role grants, the Verified role, and the onboarding channel map.
- Destination channels, a Dead Drop opening hour, and a lottery draw time.
- Provider credentials and feed URLs on the public internet.
- Steam key stock, backing, and reward funding.
- A hosting domain and a backup destination.
- `BACKUP_PASSPHRASE` before a real secret seal.
- A decision on the Prisma 7 advisory. The current pin stays 7.10.0 until that decision changes.

No further build prompt is waiting. The next action is one of the prerequisites above, or an explicit instruction to execute the production checklist.
