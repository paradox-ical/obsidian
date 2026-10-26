# THE COLLECTIVE

Standalone Discord bot and admin-only dashboard. The admin pages call the persisted module services. Members and other staff use Discord. See `docs/PROGRESS.md` and `docs/OPERATIONS.md`.

To run this on another PC, follow [SETUP.md](SETUP.md). The portable zip, including the Cursor chat, is on the [releases page](https://github.com/paradox-ical/obsidian/releases).

## Local runtime

Node.js 24.21.0 is the pinned Active LTS. Docker Compose builds that version even when the workstation Node is older. PostgreSQL 18.6 runs as the `postgres` service.

```bash
docker compose up --build
```

- Bot health: `http://127.0.0.1:8081/health`
- Worker health: `http://127.0.0.1:8082/health`
- Admin: `http://127.0.0.1:5173/`

Without a Discord token and application ID, the bot stays up and reports Discord as `setup_required`. It does not log in. `npm run commands:plan` prints the command manifest and does not publish it. The admin page stays access-denied until OAuth credentials exist, and a missing secret is `setup_required` rather than a session.

Copy `.env.example` to `.env` for host-side Prisma commands. The database password in that example is for the disposable local database only.

## Checks

```bash
npm run prisma:generate
npm run build
npm run typecheck
npm run lint
npm test
```

Database migration, the integration test, and `npm run boot:check` need a migrated PostgreSQL database. `docs/OPERATIONS.md` has the exact commands.

## Discord navigation

Use `/help open` or any existing command's `open` subcommand for guided menus, contextual fields and review controls. Direct slash shortcuts remain available. See [Discord experience](docs/DISCORD_EXPERIENCE.md) and the [complete coverage inventory](docs/DISCORD_EXPERIENCE_COVERAGE.md).

After building, `npm run experience:audit` checks all command/action definitions and flow handlers and regenerates the coverage inventory. It does not register commands or contact Discord.
