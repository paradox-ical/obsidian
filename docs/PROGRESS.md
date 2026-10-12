# Progress

Work package 26 (phase 10B, acceptance audit) is the current package. No further build prompt is waiting. The production checklist was not executed.

## Earlier packages, kept as history

Package 1 built the workspace, revision `0a`, Compose, and CI. Package 2 added jobs, the outbox, sessions, guild configuration, admin OAuth boundaries, and the 36-parent command manifest at revision `0b`. Package 3 added verification, role panels, entitlements, and account handles at revision `0c`. Package 4 added moderation automation, cases, warnings, and staff logs at revision `0d`. Package 5 added support tickets at revision `0e`. Package 6 added community XP, dossiers, invites, birthdays, and achievements at revision `0f`. Package 7 added three-month seasons, archives, staff polls, and temporary rooms at revision `0g`. Package 8 added the Marks ledger, budgets, transfers, and staff statistics at revision `0h`. Package 9 added the Ingot supply, scarcity curve, quotes, and backing at revision `0i`. Package 10 added the publication editor, review, and exact-revision approval at revision `0j`. Package 11 added announcements, pins, stickies, auto replies, and game-update feeds at revision `0k`. Package 12 added official events, crews, and LFG at revision `0l`. Package 13 added predictions, contests, and giveaways at revision `0m`. Package 14 added daily, weekly, monthly, and staff contracts at revision `0n`. Package 15 added character progression, six classes, stat points, and paid resets at revision `0o`. Package 16 added gear instances and the shared D20 combat engine at revision `0p`. Package 17 added Backstreets, Black Docks, and Inner Sanctum, one-slot timed expeditions, and the launch enemy and gear catalogue at revision `0q`. Package 18 added branching solo missions, crew missions, and recovery at revision `0r`. Package 19 added casual and ranked queues, challenges, ratings, and equal Marks wagers at revision `0s`. Package 20 added direct trades, marketplace escrow, upgrades, salvage, crafting, and affix rerolls at revision `0t`. Package 21 added the Marks supply shop, the Ingot shop, private Steam keys, and versioned crates at revision `0u`. Package 22 added the funded daily lottery at revision `0v`. Package 23 added the Dead Drop board and a funded Market Collapse at revision `0w`. Package 24 added solo and social blackjack at revision `0x`. Package 25 finished the admin pages, operations tools, and backup rehearsal. Live Discord OAuth, live member lookup, live command registration, live provider ownership, live moderation REST, live ticket channels, live chat XP, live voice XP, live birthday announcements, live room channels, and a live market panel stayed blocked. Do not restart those packages.

## Done in package 26

- `docs/ACCEPTANCE_REPORT.md` records every fixed decision, every module, and all 18 acceptance scenarios with the test file or command that supports the local result.
- The community integration test now keeps a Marks wallet and a dossier bio when a verified member is restored without a new CAPTCHA.
- Build, typecheck, lint, unit tests, integration tests, command plan, boot check, ledger query, simulations, and the disposable restore rehearsal passed. `npm audit` reported four high transitive findings. Prisma stayed at 7.10.0.

## Not done

- Live Discord OAuth, live member lookup, a live test-guild command PUT, live provider ownership, live moderation REST, live ticket channels, live chat XP, live voice XP, live birthday announcements, live room channels, a live market panel, and a live Discord scheduled event. No token was available. The gateway does not request the privileged message-content intent or the voice-state intent.
- A live publication, announcement, pin, sticky, reply, game-update, event, activity, contract DM, completion mention, character command, duel, trade, or listing post. No Discord channel write was made.
- An empty key vault does not invent a prize key. No lottery draw time was assumed. No Dead Drop opening hour was assumed.
- `BACKUP_PASSPHRASE` was unset, so no real secret file was sealed. Production hosting was not changed. The production rollout and rollback checklists in the acceptance report were not executed.

## Checks

Run on 12 October 2026 from the workstation. Host Node.js is v22.14.0, which is below the pinned `>=24.17.0 <25` range. npm prints that warning. Docker uses Node.js 24.21.0.

| Check | Result |
|---|---|
| `npm run build` | Passed, including the admin client build (109 modules). |
| `npm run typecheck` | Passed for admin, bot, db, domain, and ui. |
| `npm run lint` | Passed with no findings. |
| `npm test` | Passed. Vitest 5.0.3, 32 files, 84 tests. |
| `npm run prisma:deploy` | Passed. No pending migrations. Foundation revision stays `0x`. |
| `npm run test:integration` | Passed. 26 files, 48 tests, against PostgreSQL on `localhost:5433`. The worker was stopped first and started again afterward. The verified-member restore left the wallet at 2500 available and 100 escrow and left the dossier bio unchanged. Discord was not called. |
| `npm run boot:check` | Passed. Bot `discord` is `setup_required`, `jobs` is `not_applicable`, and `foundationRevision` is `0x`. Worker `jobs` is `ok`. Admin access is `denied` and `dashboardAuth` is `setup_required`. Discord login was not attempted. |
| `npm run commands:plan` | Passed. Printed `Dry run: commands were not sent. Parent count: 36.` |
| `npm audit` | Exit 1. Four high findings in `deepmerge-ts`, `mysql2`, and `prisma`. The offered fix downgrades Prisma to 6.19.3. That downgrade was not applied. |
| Ledger and supply query | Zero wallets have a negative available or escrow balance. 72 local test markets each still hold the 2,500 protected and 2,500 inventory split. Foundation revision is `0x`. |
| Simulations | Routine Marks 7987, two months to 10,000, blackjack worst loss 40, character level 50 in 26 weeks, Ingot supply conserved at 5000, catalogue 3 regions, 15 enemies, 3 bosses, 49 gear templates. Nothing was granted. |
| `npm run backup:rehearse` | Passed. The disposable database was dropped. The fixture secret was recovered and not written to disk. |
| `npm run backup:secrets` | Printed `setup_required`. No secret file was written. |
| Compose | `postgres`, `bot`, `worker`, and `admin` were healthy after the worker was started again. |

`docker compose down -v` deletes the local database volume.

## Next unfinished task

No build prompt remains. The remaining work is the prerequisite list in `docs/ACCEPTANCE_REPORT.md`: Discord credentials, a named test guild before any command PUT, dashboard grants, channel and schedule choices, provider keys, funding, a backup passphrase, and a hosting destination. Do not execute the production rollout or rollback checklist without a separate instruction. No default Dead Drop hour or lottery draw time has been chosen.
