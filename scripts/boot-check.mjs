import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../.env");
if (existsSync(envPath)) {
  loadDotenv({ path: envPath });
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  process.stderr.write(
    "boot-check requires DATABASE_URL. Copy .env.example to .env, then start PostgreSQL with docker compose up -d postgres.\n",
  );
  process.exit(1);
}

const sharedEnv = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  NODE_ENV: process.env.NODE_ENV ?? "test",
  BOT_HEALTH_HOST: "127.0.0.1",
  DISCORD_TOKEN: "",
  DISCORD_APPLICATION_ID: "",
  DISCORD_CLIENT_SECRET: "",
  DISCORD_TEST_GUILD_ID: "",
  DISCORD_PRODUCTION_GUILD_ID: "",
};

const checks = [
  {
    name: "bot",
    file: "apps/bot/dist/index.js",
    port: "18081",
    expect: {
      service: "bot",
      database: "ok",
      discord: "setup_required",
      jobs: "not_applicable",
      dashboardAuth: "not_applicable",
      foundationRevision: "0x",
      status: "degraded",
    },
  },
  {
    name: "worker",
    file: "apps/bot/dist/worker.js",
    port: "18082",
    expect: {
      service: "worker",
      database: "ok",
      discord: "not_applicable",
      jobs: "ok",
      dashboardAuth: "not_applicable",
      foundationRevision: "0x",
      status: "ok",
    },
  },
  {
    name: "admin",
    file: "apps/admin/dist-server/serve.js",
    port: "15173",
    env: { ADMIN_HOST: "127.0.0.1" },
    expect: {
      service: "admin",
      access: "denied",
      dashboardAuth: "setup_required",
      jobs: "not_applicable",
      status: "degraded",
    },
  },
];

async function waitForHealth(port, expected) {
  const deadline = Date.now() + 20_000;
  let lastError = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      const body = await response.json();
      const serialized = JSON.stringify(body);
      if (serialized.includes(databaseUrl)) {
        throw new Error(`${expected.service} health response included the database URL.`);
      }
      for (const [key, value] of Object.entries(expected)) {
        if (body[key] !== value) {
          lastError = `${key} was ${JSON.stringify(body[key])}, expected ${JSON.stringify(value)}`;
          await delay(250);
          continue;
        }
      }
      if (Object.entries(expected).every(([key, value]) => body[key] === value)) {
        return body;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : "request failed";
      await delay(250);
    }
  }
  throw new Error(`Timed out waiting for ${expected.service} health: ${lastError}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCheck(check) {
  const child = spawn(process.execPath, [check.file], {
    env: { ...sharedEnv, ...check.env, ADMIN_PORT: check.port, BOT_HEALTH_PORT: check.port, WORKER_HEALTH_PORT: check.port },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    logs += chunk.toString();
  });
  try {
    const body = await waitForHealth(check.port, check.expect);
    process.stdout.write(`${check.name} health passed: ${JSON.stringify(body)}\n`);
    if (check.name === "admin") {
      const page = await fetch(`http://127.0.0.1:${check.port}/`);
      const html = await page.text();
      if (!page.ok || !html.includes("Admin access is closed")) {
        throw new Error("Admin page did not serve the access-denied shell.");
      }
      process.stdout.write("admin page passed: access-denied shell served\n");
    }
  } catch (error) {
    process.stderr.write(logs);
    throw error;
  } finally {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), delay(5_000)]);
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
  }
}

for (const check of checks) {
  await runCheck(check);
}

process.stdout.write("Local boot checks passed for bot, worker, and admin. Discord login was not attempted.\n");
