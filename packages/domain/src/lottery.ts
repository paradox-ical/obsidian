import { DEFAULT_TIMEZONE } from "./foundation.js";

export const LOTTERY_TICKET_MARKS = 100;
export const LOTTERY_CAP = 5;
export const LOTTERY_MIN_ENTRANTS = 3;
export const LOTTERY_STALL_DAYS = 7;
export const LOTTERY_BONUS_RATE = "50 percent";

export const LOTTERY_RULES = [
  "A ticket is bought from the open draw. The default price is 100 Marks and the default cap is five tickets for each member on that unresolved draw.",
  "One winning ticket receives the whole pool. The pool is every ticket payment plus a 50 percent bonus reserved from the Collective lottery budget.",
  "The bonus is reserved when the ticket is bought. If the budget cannot cover the advertised bonus, the purchase is refused before the member is charged.",
  "A draw needs three distinct members. Otherwise the tickets, the paid pool, and the bonus already reserved roll forward. Rollover does not add that bonus again.",
  "Carried tickets stay eligible and count toward the cap. The stall deadline is shown before purchase. When it passes, ticket payments are refunded and the reserved bonus returns to the budget.",
  "The draw time is not selected until staff save one. No default hour is assumed.",
].join(" ");

export function lotteryPriceDecision(marks: number): "allowed" | "invalid" {
  if (!Number.isSafeInteger(marks) || marks < 1 || marks > 1_000_000) {
    return "invalid";
  }
  return "allowed";
}

export function lotteryCapDecision(cap: number): "allowed" | "invalid" {
  if (!Number.isSafeInteger(cap) || cap < 1 || cap > 20) {
    return "invalid";
  }
  return "allowed";
}

export function lotteryStallDecision(days: number): "allowed" | "invalid" {
  if (!Number.isSafeInteger(days) || days < 1 || days > 30) {
    return "invalid";
  }
  return "allowed";
}

export function lotteryClockDecision(hour: number | null, minute: number | null): "unset" | "allowed" | "invalid" {
  if (hour === null && minute === null) {
    return "unset";
  }
  if (hour === null || minute === null || !Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return "invalid";
  }
  return "allowed";
}

export function lotteryBonusMinor(priceMinor: bigint): bigint {
  return priceMinor / 2n;
}

export function lotteryOdds(memberTickets: number, totalTickets: number): number {
  if (!Number.isInteger(memberTickets) || !Number.isInteger(totalTickets) || memberTickets < 0 || totalTickets < 1) {
    return 0;
  }
  return Math.floor((memberTickets * 10_000) / totalTickets);
}

export function entrantsMet(distinctMembers: number): boolean {
  return Number.isInteger(distinctMembers) && distinctMembers >= LOTTERY_MIN_ENTRANTS;
}

export function nextPerthClock(now: Date, hour: number, minute: number): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DEFAULT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [year, month, day] = parts.split("-").map((part) => Number(part));
  const perthMidnightUtc = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1) - 8 * 60 * 60 * 1000;
  let instant = perthMidnightUtc + (hour * 60 + minute) * 60 * 1000;
  if (instant <= now.getTime()) {
    instant += 24 * 60 * 60 * 1000;
  }
  return new Date(instant);
}
