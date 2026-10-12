import { execFileSync } from "node:child_process";

const container = postgresContainer();
const dump = "/tmp/collective-rehearsal.dump";
psql(container, "postgres", "DROP DATABASE IF EXISTS collective_rehearsal WITH (FORCE)");
execFileSync("docker", ["exec", container, "pg_dump", "-U", "collective", "-d", "collective", "--format=custom", "--no-owner", `--file=${dump}`], { stdio: "inherit" });
psql(container, "postgres", "CREATE DATABASE collective_rehearsal");
execFileSync("docker", ["exec", container, "pg_restore", "-U", "collective", "-d", "collective_rehearsal", "--no-owner", "--exit-on-error", dump], { stdio: "inherit" });
psql(container, "collective_rehearsal", "CREATE TABLE rehearsal_marker (id text PRIMARY KEY)");
psql(container, "collective_rehearsal", "INSERT INTO rehearsal_marker (id) VALUES ('disposable')");
const revision = psql(container, "collective_rehearsal", "SELECT revision FROM foundation_revision");
const marker = psql(container, "collective_rehearsal", "SELECT id FROM rehearsal_marker");
const live = psql(container, "collective", "SELECT to_regclass('public.rehearsal_marker')");
psql(container, "postgres", "DROP DATABASE collective_rehearsal WITH (FORCE)");
execFileSync("docker", ["exec", container, "rm", "-f", dump], { stdio: "inherit" });
if (!revision.includes("0x") || !marker.includes("disposable")) {
  throw new Error("The rehearsal database did not restore the foundation revision and the disposable marker.");
}
if (live.includes("disposable") || live.includes("rehearsal_marker")) {
  throw new Error("The rehearsal marker was written to the live database.");
}

const { openSecret, sealSecret } = await import("../packages/domain/dist/index.js");
const sealed = sealSecret("rehearsal-secret", "rehearsal-only");
if (sealed.includes("rehearsal-secret") || openSecret(sealed, "rehearsal-only") !== "rehearsal-secret") {
  throw new Error("The fixture secret did not round-trip.");
}
console.log("Restore rehearsal passed. The disposable database was dropped. The fixture secret was recovered and not written to disk.");

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

function psql(container, database, sql) {
  return execFileSync("docker", ["exec", container, "psql", "-U", "collective", "-d", database, "-v", "ON_ERROR_STOP=1", "-tAc", sql], { encoding: "utf8" });
}
