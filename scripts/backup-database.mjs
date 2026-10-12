import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const container = postgresContainer();
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const directory = resolve("backups");
mkdirSync(directory, { recursive: true });
const file = resolve(directory, `collective-${stamp}.dump`);
execFileSync("docker", ["exec", container, "pg_dump", "-U", "collective", "-d", "collective", "--format=custom", "--file=/tmp/collective-backup.dump"], { stdio: "inherit" });
execFileSync("docker", ["cp", `${container}:/tmp/collective-backup.dump`, file], { stdio: "inherit" });
execFileSync("docker", ["exec", container, "rm", "-f", "/tmp/collective-backup.dump"], { stdio: "inherit" });
console.log(`Backup written to ${file}. Secrets are not included.`);

function postgresContainer() {
  const names = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" })
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter((name) => name.includes("postgres"));
  if (names.length === 0) {
    throw new Error("No running PostgreSQL container was found. Start the stack with docker compose up -d.");
  }
  return names[0];
}
