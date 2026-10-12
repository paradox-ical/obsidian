# Set up on another PC

You need [Docker Desktop](https://www.docker.com/products/docker-desktop/). Open it and wait until it says it is running. You do not need Node.js for these steps.

## 1. Get the folder

Download `THE-COLLECTIVE-portable.zip` from the [releases page](https://github.com/paradox-ical/obsidian/releases) and unzip it. That zip includes the old Cursor chat in `cursor-chat/`.

Or clone the code only:

```bash
git clone https://github.com/paradox-ical/obsidian.git
cd obsidian
```

## 2. Start the app

In the project folder:

```powershell
copy .env.example .env
docker compose up --build -d
```

The first build takes several minutes. Then open:

- Bot: http://127.0.0.1:8081/health
- Worker: http://127.0.0.1:8082/health
- Admin: http://127.0.0.1:5173/

The admin page says access is closed. The bot is running, and Discord is not connected yet. That is expected.

## 3. Connect Discord

In the [Discord Developer Portal](https://discord.com/developers/applications), open the bot application and do three things:

1. Copy the bot token, the application id, and the OAuth2 client secret.
2. Add this redirect URL: `http://localhost:5173/auth/discord/callback`
3. Use the OAuth2 URL Generator with the `bot` and `applications.commands` scopes, open that invite link, and add the bot to your test server. Copy that server’s guild id.

Edit `.env` in the project folder. Fill only these four lines, and leave `DISCORD_PRODUCTION_GUILD_ID` empty:

```
DISCORD_TOKEN=your-bot-token
DISCORD_APPLICATION_ID=your-application-id
DISCORD_CLIENT_SECRET=your-client-secret
DISCORD_TEST_GUILD_ID=your-test-guild-id
```

Restart the app so it reads the new values:

```powershell
docker compose up -d --force-recreate bot worker admin
```

Publish the commands to that test server. Use the same guild id you put in `.env`:

```powershell
docker compose exec bot npm run commands:plan -- --apply --guild YOUR_TEST_GUILD_ID
```

A dry run that says commands were not sent means the token or the guild id is still missing. Do not point this command at a production server.

## 4. Open the admin dashboard

The server owner can sign in only after that Discord user id is stored once. Replace both ids, then run this in PowerShell from the project folder:

```powershell
@"
INSERT INTO "guild" ("guildId", "ownerUserId", "timezone", "updatedAt")
VALUES ('YOUR_TEST_GUILD_ID', 'YOUR_DISCORD_USER_ID', 'Australia/Perth', NOW())
ON CONFLICT ("guildId") DO UPDATE
SET "ownerUserId" = EXCLUDED."ownerUserId", "updatedAt" = NOW();
"@ | docker compose exec -T postgres psql -U collective -d collective
```

Your Discord user id is the number in your Discord profile, with developer mode turned on. Open http://127.0.0.1:5173/ and sign in with Discord. The account that matches `YOUR_DISCORD_USER_ID` is allowed in. Other people stay out until that owner grants them access.

## Cursor chat

The zip’s `cursor-chat` folder is the conversation that built this project. Cursor will not restore the old sidebar. Open the folder in Cursor and start a chat with: read `cursor-chat` and `docs/PROGRESS.md` before changing anything.
