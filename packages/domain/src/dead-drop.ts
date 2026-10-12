import { DEFAULT_TIMEZONE } from "./foundation.js";
import { sha256 } from "./secrets.js";

export const DEAD_DROP_ROWS = ["A", "B", "C", "D", "E", "F"] as const;
export const DEAD_DROP_COLUMNS = [1, 2, 3, 4, 5, 6] as const;
export const DEAD_DROP_PICK_MARKS = 100;
export const DEAD_DROP_PICK_CAP = 3;
export const DEAD_DROP_SEED_MARKS = 200;
export const DEAD_DROP_SMALL_MARKS = 20;
export const DEAD_DROP_SMALL_COUNT = 4;
export const DEAD_DROP_SHARE_BPS = 5000;
export const DEAD_DROP_OPEN_MINUTES = 60;

export const DEAD_DROP_ASSETS = {
  frame: "dead-drop-board",
  back: "dead-drop-card-back",
  jackpot: "dead-drop-icon-jackpot",
  small: "dead-drop-icon-small",
  blank: "dead-drop-icon-blank",
  collapse: "dead-drop-icon-collapse",
  gear: "dead-drop-icon-gear",
  crate: "dead-drop-icon-crate",
  clue: "dead-drop-icon-clue",
} as const;

export const DEAD_DROP_ASSET_NOTES = [
  "Use one card-back template for every covered cell.",
  "Use one reveal icon for each reward kind: jackpot, small reward, blank, Market Collapse, gear, crate, and clue.",
  "Use one board frame. A separate design is not required for each cell or jackpot position.",
] as const;

export const DEAD_DROP_RULES = [
  "Dead Drop is a shared 6 by 6 board. Rows are A through F and columns are 1 through 6. One card-back template and one reveal icon for each reward kind draw every cell. A separate design is not required for each cell or jackpot position.",
  "The board is paid only. The default pick is 100 Marks and each member may reveal three cells on a board. The pick charges and reveals in one step. The opening hour is one configured Perth hour and is not selected until staff save one.",
  "The jackpot is a configured starting prize plus 50 percent of the picks. That share is escrow, not newly issued money. The rest of each pick goes to the game treasury. Small rewards are paid from a separate pre-funded budget.",
  "Finding the jackpot closes the board immediately. The next board opens the following day, not at once. If the hour ends first, the jackpot carries to a new shuffle and does not add another starting seed. A new seed is reserved after a win.",
  "Positions stay hidden until revealed. A cancelled board refunds each recorded pick once and returns an unpaid seed. It does not pay the jackpot as well and it does not move the hidden cell.",
  "A special board can hold gear, a crate, a clue, or one Market Collapse charge backed by event-treasury Ingots. Activation releases those units into the exchange. It does not mint Ingots, use the protected reserve, or reset the price.",
].join(" ");

const SPECIAL_KINDS = new Set(["", "collapse", "gear", "crate", "clue"]);

export function deadDropCoordinates(): string[] {
  return DEAD_DROP_ROWS.flatMap((row) => DEAD_DROP_COLUMNS.map((column) => `${row}${column}`));
}

export function parseCoordinate(value: string): string | null {
  const match = /^([A-Fa-f])([1-6])$/.exec(value.trim());
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return `${match[1].toUpperCase()}${match[2]}`;
}

export function deadDropPriceDecision(marks: number): "allowed" | "invalid" {
  if (!Number.isSafeInteger(marks) || marks < 1 || marks > 1_000_000) {
    return "invalid";
  }
  return "allowed";
}

export function deadDropSeedDecision(marks: number): "allowed" | "invalid" {
  if (!Number.isSafeInteger(marks) || marks < 0 || marks > 1_000_000) {
    return "invalid";
  }
  return "allowed";
}

export function deadDropSmallDecision(marks: number, count: number): "allowed" | "invalid" {
  if (!Number.isSafeInteger(marks) || !Number.isSafeInteger(count) || marks < 0 || marks > 1_000_000 || count < 0 || count > 30) {
    return "invalid";
  }
  return "allowed";
}

export function deadDropShareDecision(shareBps: number): "allowed" | "invalid" {
  if (!Number.isSafeInteger(shareBps) || shareBps < 0 || shareBps > 10_000) {
    return "invalid";
  }
  return "allowed";
}

export function deadDropClockDecision(hour: number | null, minute: number | null): "unset" | "allowed" | "invalid" {
  if (hour === null && minute === null) {
    return "unset";
  }
  if (hour === null || minute === null || !Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return "invalid";
  }
  return "allowed";
}

export function deadDropClockLabel(hour: number | null, minute: number | null): string {
  if (deadDropClockDecision(hour, minute) !== "allowed" || hour === null || minute === null) {
    return "The opening hour is not selected.";
  }
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")} Australia/Perth`;
}

export function deadDropSplit(priceMinor: bigint, shareBps: number): { shareMinor: bigint; treasuryMinor: bigint } {
  const shareMinor = (priceMinor * BigInt(shareBps)) / 10_000n;
  return { shareMinor, treasuryMinor: priceMinor - shareMinor };
}

export function perthDeadDropWindow(now: Date, hour: number, minute: number): { opensAt: Date; closesAt: Date } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DEFAULT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [year, month, day] = parts.split("-").map((part) => Number(part));
  const perthMidnightUtc = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1) - 8 * 60 * 60 * 1000;
  const duration = DEAD_DROP_OPEN_MINUTES * 60 * 1000;
  const today = perthMidnightUtc + (hour * 60 + minute) * 60 * 1000;
  if (now.getTime() < today + duration) {
    return { opensAt: new Date(today), closesAt: new Date(today + duration) };
  }
  const next = today + 24 * 60 * 60 * 1000;
  return { opensAt: new Date(next), closesAt: new Date(next + duration) };
}

export function nextDeadDropWindow(opensAt: Date): { opensAt: Date; closesAt: Date } {
  const next = opensAt.getTime() + 24 * 60 * 60 * 1000;
  return { opensAt: new Date(next), closesAt: new Date(next + DEAD_DROP_OPEN_MINUTES * 60 * 1000) };
}

export function deadDropWindowOpen(now: Date, opensAt: Date, closesAt: Date): boolean {
  return now.getTime() >= opensAt.getTime() && now.getTime() <= closesAt.getTime();
}

export function deadDropAsset(kind: string): string {
  if (kind === "jackpot") return DEAD_DROP_ASSETS.jackpot;
  if (kind === "small") return DEAD_DROP_ASSETS.small;
  if (kind === "collapse") return DEAD_DROP_ASSETS.collapse;
  if (kind === "gear") return DEAD_DROP_ASSETS.gear;
  if (kind === "crate") return DEAD_DROP_ASSETS.crate;
  if (kind === "clue") return DEAD_DROP_ASSETS.clue;
  return DEAD_DROP_ASSETS.blank;
}

export function presentDeadDropCell(cell: { coordinate: string; status: string; kind: string; userId: string }): { coordinate: string; covered: boolean; asset: string; kind?: string; claimant?: string } {
  if (cell.status !== "revealed") {
    return { coordinate: cell.coordinate, covered: true, asset: DEAD_DROP_ASSETS.back };
  }
  return { coordinate: cell.coordinate, covered: false, asset: deadDropAsset(cell.kind), kind: cell.kind, ...(cell.userId ? { claimant: cell.userId } : {}) };
}

export function renderDeadDropGrid(cells: readonly { coordinate: string; asset: string }[]): string {
  const assets = new Map(cells.map((cell) => [cell.coordinate, cell.asset]));
  return DEAD_DROP_ROWS.map((row) => DEAD_DROP_COLUMNS.map((column) => {
    const coordinate = `${row}${column}`;
    return `${coordinate} ${assets.get(coordinate) ?? DEAD_DROP_ASSETS.back}`;
  }).join(" ")).join("\n");
}

export function boardCommitment(cells: readonly { coordinate: string; kind: string; payload: string }[]): string {
  const canonical = [...cells]
    .sort((left, right) => left.coordinate.localeCompare(right.coordinate))
    .map((cell) => `${cell.coordinate}:${cell.kind}:${cell.payload}`)
    .join("|");
  return sha256(canonical);
}

export function assignDeadDropCells(input: { random: (max: number) => number; smallCount: number; smallPayload: string; specialKind: string; specialPayload: string }): Array<{ coordinate: string; kind: string; payload: string }> {
  const coordinates = deadDropCoordinates();
  const order = coordinates.map((_, index) => index);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = input.random(index + 1);
    const current = order[index];
    const other = order[swap];
    if (current === undefined || other === undefined) {
      continue;
    }
    order[index] = other;
    order[swap] = current;
  }
  const cells = coordinates.map((coordinate) => ({ coordinate, kind: "blank", payload: "" }));
  const jackpot = order[0];
  if (jackpot === undefined || !cells[jackpot]) {
    return cells;
  }
  cells[jackpot].kind = "jackpot";
  const special = SPECIAL_KINDS.has(input.specialKind) && input.specialKind ? 1 : 0;
  const smalls = Math.max(0, Math.min(input.smallCount, coordinates.length - 1 - special));
  for (let index = 0; index < smalls; index += 1) {
    const slot = order[1 + index];
    const cell = slot === undefined ? undefined : cells[slot];
    if (!cell) {
      continue;
    }
    cell.kind = "small";
    cell.payload = input.smallPayload;
  }
  if (special) {
    const slot = order[1 + smalls];
    const cell = slot === undefined ? undefined : cells[slot];
    if (cell) {
      cell.kind = input.specialKind;
      cell.payload = input.specialPayload;
    }
  }
  return cells;
}

export function deadDropSpecialDecision(kind: string, payload: string): "allowed" | "invalid" {
  if (!SPECIAL_KINDS.has(kind)) {
    return "invalid";
  }
  if (kind === "") {
    return payload === "" ? "allowed" : "invalid";
  }
  if (kind === "collapse") {
    const quantity = Number(payload);
    return Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 2500 ? "allowed" : "invalid";
  }
  if (kind === "clue") {
    return payload.trim().length > 0 && payload.trim().length <= 240 ? "allowed" : "invalid";
  }
  return /^[a-z0-9-]{1,64}$/.test(payload) ? "allowed" : "invalid";
}
