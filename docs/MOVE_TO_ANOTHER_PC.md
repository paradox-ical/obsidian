# Move this project to another PC

The short version is [SETUP.md](../SETUP.md). This page is the extra detail.

This folder is the whole local project. The zip made for copying also contains `cursor-chat/`, which is the Cursor conversation that built it. That chat folder is not part of git. Copy the zip, not only a later git checkout, if you need the conversation.

## What you need on the new PC

- Docker Desktop
- Node.js 24.21.0 (the version pinned for this project)
- This zip, unpacked somewhere such as `F:\Obsidian`

## Start it

From the unpacked folder:

```bash
copy .env.example .env
docker compose up --build -d
npm ci
npm run prisma:generate
npm run prisma:deploy
npm run build
npm run boot:check
```

On Windows PowerShell, `copy .env.example .env` is the same step. The example database password is only for this local Docker database. Do not reuse it on a shared machine. Do not copy an old `.env` from the first PC if it contains real Discord tokens; fill those on the new PC and do not commit them.

`npm run boot:check` should report Discord as `setup_required` until a token and application id are set. That is a successful local boot, not a login.

Admin: `http://127.0.0.1:5173/`

The page says admin access is closed until Discord OAuth is configured.

## Keep the chat context

`cursor-chat/` holds the agent transcript and the compaction summaries. Cursor on the new PC will not show that old sidebar automatically.

Open this folder in Cursor, start a chat, and say:

> Read `cursor-chat` and `docs/PROGRESS.md` before changing anything.

`docs/ACCEPTANCE_REPORT.md` is the latest audit. `docs/PROGRESS.md` names what is still blocked: live Discord credentials, a named test guild, and a separate instruction before any production step.

## Do not copy

- `node_modules/` — `npm ci` rebuilds it
- `.env` — secrets stay on the machine that created them
- `backups/` — database dumps are local data, not source
