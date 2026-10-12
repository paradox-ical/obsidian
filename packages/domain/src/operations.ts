import { MODULE_KEYS, PROTECTED_MODULES, isModuleKey, moduleAvailable, type ModuleKey } from "./access.js";
import { simulateBlackjackEconomy } from "./blackjack.js";
import { simulateRegularPlay } from "./characters.js";
import { simulateMonthlyEarnings } from "./economy.js";
import { simulateSupplyConservation } from "./ingots.js";
import { simulateMissionRewards } from "./missions.js";

const SECRET_KEY = /token|secret|password|credential|apikey|authorization|cookie/i;
const SECRET_TEXT = /(token|secret|password|apikey|authorization)\s*[:=]\s*\S+/gi;
export const OPERATIONS_DOCUMENT_LIMIT = 65_536;

export function publicHttpUrl(value: string): "allowed" | "rejected" {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "rejected";
  }
  if (url.username || url.password || (url.protocol !== "http:" && url.protocol !== "https:")) {
    return "rejected";
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".localhost") || host === "::1" || host === "0.0.0.0") {
    return "rejected";
  }
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) {
    return host.includes(":") ? "rejected" : "allowed";
  }
  const octets = match.slice(1).map((part) => Number(part));
  const first = octets[0];
  const second = octets[1];
  if (first === undefined || second === undefined || octets.some((part) => part > 255)) {
    return "rejected";
  }
  const privateAddress = first === 10 || first === 127 || first === 0
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || first >= 224;
  return privateAddress ? "rejected" : "allowed";
}

export function redactText(value: string): string {
  return value.replace(SECRET_TEXT, "$1=[redacted]");
}

export function maintenanceDecision(moduleKey: string, maintenance: boolean): "invalid" | "protected" | "allowed" {
  if (!isModuleKey(moduleKey)) {
    return "invalid";
  }
  if (maintenance && (PROTECTED_MODULES as readonly string[]).includes(moduleKey)) {
    return "protected";
  }
  return "allowed";
}

export interface OperationsDocument {
  label?: string;
  [key: string]: unknown;
}

export function validateOperationsDocument(document: unknown): { ok: true; document: OperationsDocument } | { ok: false; errors: string[] } {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return { ok: false, errors: ["Configuration must be an object."] };
  }
  const errors: string[] = [];
  walk(document, "document", errors);
  if (JSON.stringify(document).length > OPERATIONS_DOCUMENT_LIMIT) {
    errors.push("Configuration exceeds 64 KiB.");
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, document: document as OperationsDocument };
}

export function redactOperationsDocument(document: OperationsDocument): OperationsDocument {
  return redactValue(document) as OperationsDocument;
}

export function previewOperationsDocument(document: unknown) {
  const validated = validateOperationsDocument(document);
  if (!validated.ok) {
    return { persisted: false as const, ok: false as const, errors: validated.errors };
  }
  return { persisted: false as const, ok: true as const, document: redactOperationsDocument(validated.document) };
}

export function operationsSimulations() {
  const economy = simulateMonthlyEarnings();
  return {
    persisted: false as const,
    grants: "none" as const,
    economy,
    blackjack: simulateBlackjackEconomy(economy.routineMarks),
    characters: simulateRegularPlay(),
    missions: simulateMissionRewards(),
    ingots: simulateSupplyConservation(),
  };
}

export function moduleMaintenanceView(flags: ReadonlyArray<{ moduleKey: string; maintenance: boolean }>) {
  const stored = new Map(flags.map((flag) => [flag.moduleKey, flag.maintenance]));
  return MODULE_KEYS.map((moduleKey: ModuleKey) => {
    const maintenance = stored.get(moduleKey) ?? false;
    return {
      moduleKey,
      maintenance,
      available: moduleAvailable(moduleKey, maintenance),
      protected: (PROTECTED_MODULES as readonly string[]).includes(moduleKey),
    };
  });
}

function walk(value: unknown, path: string, errors: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, errors));
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const next = `${path}.${key}`;
    if (SECRET_KEY.test(key)) {
      errors.push(`${next} is not stored in configuration.`);
    }
    if ((key === "url" || key.endsWith("Url")) && typeof child === "string" && child.length > 0 && publicHttpUrl(child) !== "allowed") {
      errors.push(`${next} must be a public http or https URL.`);
    }
    if (key === "label" && child !== undefined && (typeof child !== "string" || child.length > 80)) {
      errors.push("label must be text of at most 80 characters.");
    }
    walk(child, next, errors);
  }
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const copy: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    copy[key] = SECRET_KEY.test(key) ? "[redacted]" : redactValue(child);
  }
  return copy;
}
