export const STEAM_KEY_INGOTS = 10;
export const FIELD_CRATE_MARKS = 40;
export const VAULT_CRATE_INGOTS = 3;
export const FIELD_PITY = 5;
export const VAULT_PITY = 4;
export const DUPLICATE_SCRAP = 2;
export const CRATE_POLICY = "roll_at_acquisition";

export const SHOP_RULES = [
  "The supply shop spends Marks. The Ingot shop holds a purchase in escrow until private delivery is committed, then returns those Ingots to the exchange.",
  "Steam keys are sold only in the Ingot shop. A crate cannot contain one.",
  "Odds, the loot-table version, the guarantee, and pity progress are shown before a crate is bought. The result is stored when the crate is acquired. Opening it does not roll again.",
  "A refund before delivery restores stock. After a Steam key is revealed, a refund needs staff review and cannot unreveal the secret.",
  "Ingot-shop gear still uses the ranked power budget.",
  "Member listings stay on the marketplace.",
].join(" ");

export const PRIVATE_INBOX_DETAIL = "A Steam key is in the private inbox. It was not posted.";

export function shopPriceDecision(amount: number): "allowed" | "invalid" {
  if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000) {
    return "invalid";
  }
  return "allowed";
}

export function offerOpen(now: Date, startsAt: Date | null, endsAt: Date | null): boolean {
  if (startsAt && now.getTime() < startsAt.getTime()) {
    return false;
  }
  if (endsAt && now.getTime() >= endsAt.getTime()) {
    return false;
  }
  return true;
}

export function pityDue(count: number, threshold: number): boolean {
  return Number.isInteger(count) && Number.isInteger(threshold) && count >= 0 && threshold >= 1 && count + 1 >= threshold;
}

export function crateTableDecision(entries: readonly { kind: string; weight: number }[]): "allowed" | "invalid" {
  if (entries.length === 0 || entries.some((entry) => entry.kind === "steam_key" || !Number.isInteger(entry.weight) || entry.weight < 1)) {
    return "invalid";
  }
  return "allowed";
}

export function publishedOdds(entries: readonly { slug: string; weight: number }[]): Array<{ slug: string; weight: number; basisPoints: number }> {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let used = 0;
  return entries.map((entry, index) => {
    const basisPoints = total <= 0 ? 0 : index === entries.length - 1 ? 10_000 - used : Math.floor((entry.weight * 10_000) / total);
    used += basisPoints;
    return { slug: entry.slug, weight: entry.weight, basisPoints };
  });
}
