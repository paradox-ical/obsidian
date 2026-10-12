import type { AffixRule } from "./combat.js";

export const UPGRADE_CAP = 3;
export const UPGRADE_MARKS = [25, 50, 100] as const;
export const MATERIAL_SLUG = "scrap";
export const UPGRADE_SCRAP = 1;
export const SALVAGE_SCRAP = 1;
export const SALVAGE_SCRAP_PER_TIER = 1;
export const REROLL_BASE_MARKS = 10;
export const LISTING_LIMIT = 3;
export const LISTING_HOURS = 72;
export const LISTING_FEE_MARKS = 0;
export const TRADE_HOURS = 24;
export const PRICE_MAX = 100_000;

export const WORKSHOP_RULES = [
  "A direct trade moves one item and Marks only after both members confirm the same version.",
  "Any edit clears both confirmations. Rolls, binding, upgrade history, and the reroll counter stay on the item.",
  "The member marketplace holds the listed item until it sells, expires, or the seller cancels. The listing fee starts at zero.",
  "Upgrades are guaranteed up to a cap. They spend Marks and scrap and never destroy the item.",
  "Salvage destroys an item only after a separate confirmation and pays a published scrap amount.",
  "A recipe shows its materials and the exact item it crafts. A reroll replaces one affix inside the published range, and the next reroll on that item costs more.",
].join(" ");

export function priceDecision(amount: number): "allowed" | "invalid" {
  if (!Number.isInteger(amount) || amount < 0 || amount > PRICE_MAX) {
    return "invalid";
  }
  return "allowed";
}

export function upgradeQuote(tier: number, cap = UPGRADE_CAP): { result: "capped" } | { result: "ready"; nextTier: number; marks: number; material: string; amount: number } {
  if (!Number.isInteger(tier) || tier < 0 || tier >= cap) {
    return { result: "capped" };
  }
  return { result: "ready", nextTier: tier + 1, marks: UPGRADE_MARKS[tier] ?? UPGRADE_MARKS[UPGRADE_MARKS.length - 1] ?? 100, material: MATERIAL_SLUG, amount: UPGRADE_SCRAP };
}

export function salvageQuote(tier: number): { material: string; amount: number } {
  const safeTier = Number.isInteger(tier) && tier > 0 ? tier : 0;
  return { material: MATERIAL_SLUG, amount: SALVAGE_SCRAP + safeTier * SALVAGE_SCRAP_PER_TIER };
}

export function rerollMarks(count: number, base = REROLL_BASE_MARKS): number {
  const safeCount = Number.isInteger(count) && count > 0 ? count : 0;
  const safeBase = Number.isInteger(base) && base > 0 ? base : REROLL_BASE_MARKS;
  return safeBase * (safeCount + 1);
}

export function affixWindow(rule: AffixRule | undefined): { result: "missing" } | { result: "ready"; slug: string; stat: string; min: number; max: number } {
  if (!rule) {
    return { result: "missing" };
  }
  return { result: "ready", slug: rule.slug, stat: rule.stat, min: rule.min, max: rule.max };
}

export function tradeDue(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}
