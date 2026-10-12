import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const passphrase = process.env["BACKUP_PASSPHRASE"]?.trim() ?? "";
if (!passphrase) {
  console.log("setup_required");
  console.log("Set BACKUP_PASSPHRASE before sealing Discord or provider values. The database backup does not include them.");
  process.exit(0);
}

const { sealSecret, openSecret } = await import("../packages/domain/dist/index.js");
const keys = Object.keys(process.env).filter((key) => /TOKEN|SECRET|PASSWORD|API_KEY|CLIENT_SECRET/.test(key) && key !== "BACKUP_PASSPHRASE");
const values = {};
for (const key of keys) {
  const value = process.env[key];
  if (value && value.trim()) {
    values[key] = value;
  }
}
if (Object.keys(values).length === 0) {
  console.log("No secret values are set. Nothing was written.");
  process.exit(0);
}

const directory = resolve("backups");
mkdirSync(directory, { recursive: true });
const file = resolve(directory, "secrets.sealed");
const sealed = sealSecret(JSON.stringify(values), passphrase);
if (Object.values(values).some((value) => sealed.includes(value))) {
  throw new Error("The sealed file contained a plaintext secret.");
}
writeFileSync(file, `${sealed}\n`, { mode: 0o600 });
const opened = JSON.parse(openSecret(readFileSync(file, "utf8").trim(), passphrase));
for (const key of Object.keys(values)) {
  if (opened[key] !== values[key]) {
    throw new Error("The sealed file did not recover every secret.");
  }
}
console.log(`Sealed ${Object.keys(values).length} secret values to ${file}. The passphrase was not written.`);
