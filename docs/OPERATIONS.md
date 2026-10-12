# Operations

The local stack can boot a database, bot, worker, and admin process, and the worker can lease PostgreSQL jobs. It cannot operate the community. Do not point these commands at a production database or guild.

## Prerequisites

- Docker, for the local stack. The image is `node:24.21.0-bookworm-slim` and `postgres:18.6`.
- Node.js 24.21.0 and npm, for host checks and CI. The workstation used during package 1 had Node.js 22.14.0, which is below the discord.js requirement. Host unit tests may still run there; Discord gateway code is supported on Node 24.
- A Discord test application later. Leave `DISCORD_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_TEST_GUILD_ID`, `DISCORD_PRODUCTION_GUILD_ID`, and `DISCORD_CLIENT_SECRET` empty until a test application exists. Do not paste them into chat or commit them. OAuth is ready only when the token, application id, and client secret are all set. The bot token is what later revalidates guild roles.

## Local Docker stack

From the repository root:

```bash
docker compose up --build
```

Compose starts PostgreSQL, applies migrations when the bot and worker start, then serves:

| Service | URL | Ready means |
|---|---|---|
| Bot | `http://127.0.0.1:8081/health` | `database` is `ok`. Discord is `setup_required` until both token and application ID are set. `jobs` is `not_applicable` because the worker owns the loop. |
| Worker | `http://127.0.0.1:8082/health` | `database` is `ok`, `jobs` is `ok`, and `status` is `ok` while the loop is running. |
| Admin | `http://127.0.0.1:5173/` | The page says admin access is closed. `/health` returns `access: denied`. `dashboardAuth` is `setup_required` or `oauth_ready`. Neither value is a session. |

`docker compose down` stops the stack. The named volume `collective_postgres` keeps the local database and is mounted at `/var/lib/postgresql`, which is the PostgreSQL 18 image layout. `docker compose down -v` deletes that disposable data.

The local password is `collective`. Replace it before any shared host. `.env.example` is the template; `.env` stays uncommitted.

## Host database commands

```bash
npm ci
npm run prisma:generate
npm run prisma:deploy
```

Copy `.env.example` to `.env` once. `prisma:deploy`, `test:integration`, and `boot:check` read `DATABASE_URL` from that file when the shell does not already set it. The example uses host port 5433. Port 5432 is already taken on this workstation by another PostgreSQL process, and Compose does not bind it. An environment variable already set in the shell wins over `.env`.

## Process entry points

- `npm run start:bot` migrates, then runs the bot.
- `npm run start:worker` migrates, then runs the worker.
- `npm run start:admin` serves the built admin files and the auth routes. Build first with `npm run build`.
- `npm run commands:plan` validates the 36-parent manifest and does not call Discord. Add `-- --apply` only for the configured test guild. A missing token or application id prints `setup_required` and does not send the PUT.

The bot loads discord.js only when both Discord variables are present. A failed login is reported as `login_failed` and is not treated as a ready session. Commands are not registered on login. The worker claims due jobs and outbox rows. A type with no handler is retried and then dead-lettered. It is not reported as success. Run one worker. A second loop can take a job the first loop still expects to finish.

Admin login stores only hashes of the OAuth state and the session token. Role checks read the guild member with the bot token on each authenticated request. Without the OAuth secret, `GET /auth/discord` returns HTTP 503 and `setup_required`, and it does not write `oauth_state`. Unauthenticated `/health` always includes `access: denied` and never includes secrets.

Health responses are JSON without secrets. A database failure returns HTTP 503 and `database: unavailable`. That is a failed check, not a healthy bot. The bot and worker health responses allow the configured admin origin, including `localhost` and `127.0.0.1` on that same port, so the dashboard can read them. Other origins are refused.

## Backups and deployment

The database and the secrets are backed up separately. A configuration export never contains plaintext tokens. `prisma migrate deploy` applies forward migrations only. A bad migration is corrected by a new migration. Do not edit a migration that has already been applied, and do not run `docker compose down -v` against a database you intend to keep.

From the repository root, with the Compose PostgreSQL container running:

```bash
npm run build
npm run prisma:deploy
npm run backup:database
npm run backup:secrets
npm run backup:rehearse
```

`backup:database` writes a custom-format dump under `backups/`. That directory is gitignored. `backup:secrets` seals the set environment values whose names contain `TOKEN`, `SECRET`, `PASSWORD`, or `API_KEY`. It refuses to run without `BACKUP_PASSPHRASE` and prints `setup_required`. The passphrase is not written into the sealed file. `backup:rehearse` restores the live database into `collective_rehearsal`, writes a marker only in that database, checks `foundation_revision`, drops `collective_rehearsal`, and round-trips a fixture secret. It does not change the live database.

To restore a dump onto a replacement database, point `pg_restore` at that database and then run `npm run prisma:deploy`. Do not restore over the live database until the rehearsal against a copy has passed.

Local deployment is `docker compose up --build -d`. The services are `postgres` on host port 5433, `bot` on 8081, `worker` on 8082, and `admin` on 5173. `npm run boot:check` uses ports 18081, 18082, and 15173 and does not log in to Discord. `npm run commands:plan` prints the 36-parent manifest and does not send it.

## Checks

```bash
npm run prisma:generate
npm run build
npm run typecheck
npm run lint
npm test
```

With PostgreSQL running and `.env` present:

```bash
npm run test:integration
npm run boot:check
```

`boot-check` clears Discord variables for the child processes, listens on ports 18081, 18082, and 15173 so it can run beside Compose, and asserts the setup-required and access-denied reports. It does not log in to Discord. The script name is `test:integration`.

CI (`.github/workflows/ci.yml`) runs these steps on Node.js 24.21.0 against PostgreSQL 18.6. CI does not deploy and does not receive Discord secrets.

## What is intentionally absent

- Live Discord OAuth, live member lookup, a live command PUT, a live provider ownership exchange, live Discord moderation REST calls, live private ticket channel or thread creation, live chat XP, live voice XP, and live birthday announcements. The code paths exist. They were not called. The gateway does not request privileged message-content or member intents.
- Live temporary-room channel create, delete, occupied-room warning, and disconnect. The worker calls Discord only when a bot token exists. None was called. A missing token stays `setup_required`.
- A live Ingot market panel post. The exchange, quotes, and backing are in PostgreSQL. Refresh without a panel channel stays `setup_required` and does not enqueue a job. A local ledger credit is not a Discord payout.
- A live publication, announcement, pin, sticky, reply, game-update, Discord scheduled event, or activity announcement. Drafts, recurrence, pins, stickies, replies, feeds, official events, crews, predictions, contests, and giveaways are in PostgreSQL. Event sync and draw notices stay `setup_required` without a bot token. No Discord event id is invented. A vault key is fulfilled into the private inbox and is not posted. An empty vault stays `shop_pending` and does not invent a key. Live conversation and sticky intake are blocked because message content is not read.
- A live contract DM or completion mention. Assignments, payouts, and notice rows are in PostgreSQL. Without a bot token the notice stays `setup_required` and no Discord id is invented. A closed DM is not copied to a public channel. Live chat and voice intake are blocked because those intents are not requested.
- A live character command reply. Respec and class-change fees are ledger debits in PostgreSQL. They are not Discord payouts and they do not spend the routine issuance budget.
- A live combat or inventory command reply. Rolls, gear locks, and battle deadlines are PostgreSQL rows. A timeout is not a process timer. No duel was posted to Discord. A ranked win uses the shared routine budget. A wager does not mint Marks.
- A live trade, listing, upgrade, salvage, craft, reroll, shop, crate, lottery, Dead Drop, or blackjack reply. Offers, listings, scrap, recipes, upgrade history, reroll counts, shop purchases, encrypted keys, crate results, quotes, lottery draws, Dead Drop boards, and blackjack shoes are PostgreSQL. Expiry is a job plus a sweep, not a process timer. Without a bot token the notice stays `setup_required`. No Discord message id is invented. These flows do not mint Marks from the routine pace. A pending Ingot purchase stays in escrow until delivery is committed. An empty vault does not invent a key. No lottery draw time was assumed. No Dead Drop opening hour was assumed. A Market Collapse activation returns allocated event-treasury Ingots and does not mint or reset the price curve. A blackjack win pays reserved house Marks and does not mint. A retry reads the stored shoe.
- A live match notice. Match rows, equal-stake escrow, disconnect grace, turn deadlines, and reviews are PostgreSQL. Without a bot token the notice stays `setup_required`. No match was posted to Discord.
- A live expedition report. The deadline, the reserved gear lock, and the preselected encounter are PostgreSQL rows. Completion is a job plus a sweep, not a process timer. Without a bot token the notice stays `setup_required` and no Discord message id is invented. No expedition report was posted. Expedition Marks use the shared routine budget.
- A live mission notice or crew-room channel. Turn deadlines, mission locks, abandonment, and recovery are PostgreSQL timestamps and jobs, not process timers. Without a bot token the notice stays `setup_required` and the room channel stays `pending`. No mission report was posted to Discord. Mission Marks use the shared routine budget.
- Production hosting. Local backup, encrypted secret recovery, and a disposable restore rehearsal are documented above. They were not pointed at a production database.
- Any write to a production Discord guild.

Production rollout remains a separate decision after later packages. Do not treat this file as permission to execute it.

## Failure signs

| Observation | Meaning |
|---|---|
| `Environment validation failed: DATABASE_URL` | The process has no database URL. |
| `Environment validation failed: DISCORD_TOKEN, DISCORD_APPLICATION_ID` | Only one of the pair is set. |
| Foundation revision is missing | Migrations have not been applied. |
| `discord: setup_required` | Expected without credentials. Not a successful login. |
| `jobs: not_applicable` on the bot | Expected. The worker reports `jobs: ok` when its loop is running. |
| `dashboardAuth: setup_required` and `access: denied` | Expected while OAuth credentials are missing. This is not a login. |
| `dashboardAuth: oauth_ready` and `access: denied` | Credentials exist and no session was presented to `/health`. |
| `discord: login_failed` | Discord rejected the configured token. The process does not claim to be online. |
