export const INGOT_TOTAL = 5_000n;
export const PROTECTED_INGOTS = 2_500n;
export const ACTIVE_INGOTS = 2_500n;
export const BASELINE_MARKS = 10_000n;
export const DEFAULT_SPREAD_BPS = 500n;
export const DEFAULT_QUOTE_MS = 30_000;

export interface IngotCurve {
  baselineMarks: bigint;
  activeSupply: bigint;
  spreadBps: bigint;
}

export function exampleCurve(): IngotCurve {
  return { baselineMarks: BASELINE_MARKS, activeSupply: ACTIVE_INGOTS, spreadBps: DEFAULT_SPREAD_BPS };
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

/** Next-unit buy price. Inventory of zero cannot be bought. There is no configured ceiling. */
export function nextUnitBuyMarks(inventory: bigint, curve: IngotCurve = exampleCurve()): bigint | null {
  if (inventory <= 0n || inventory > curve.activeSupply || curve.baselineMarks <= 0n) {
    return null;
  }
  const cubed = inventory * inventory * inventory;
  const numerator = curve.baselineMarks * curve.activeSupply * curve.activeSupply * curve.activeSupply;
  return ceilDiv(numerator, cubed);
}

export function integratedBuyMarks(inventory: bigint, quantity: bigint, curve: IngotCurve = exampleCurve()): bigint | null {
  if (quantity <= 0n || inventory < quantity) {
    return null;
  }
  let total = 0n;
  for (let left = inventory; left > inventory - quantity; left -= 1n) {
    const price = nextUnitBuyMarks(left, curve);
    if (price === null) {
      return null;
    }
    total += price;
  }
  return total;
}

/** Seller receives the discounted price of the unit the pool is about to gain, not the scarcer post-trade buy quote. */
export function integratedSellMarks(inventory: bigint, quantity: bigint, curve: IngotCurve = exampleCurve()): bigint | null {
  if (quantity <= 0n || inventory + quantity > curve.activeSupply || curve.spreadBps < 0n || curve.spreadBps >= 10_000n) {
    return null;
  }
  let total = 0n;
  for (let step = 0n; step < quantity; step += 1n) {
    const gross = nextUnitBuyMarks(inventory + step + 1n, curve);
    if (gross === null) {
      return null;
    }
    total += (gross * (10_000n - curve.spreadBps)) / 10_000n;
  }
  return total;
}

/** Un-discounted Marks required to redeem every active Ingot that is not in the pool. */
export function redemptionLiabilityMarks(inventory: bigint, curve: IngotCurve = exampleCurve()): bigint | null {
  if (inventory < 0n || inventory > curve.activeSupply) {
    return null;
  }
  let total = 0n;
  for (let unit = inventory + 1n; unit <= curve.activeSupply; unit += 1n) {
    const price = nextUnitBuyMarks(unit, curve);
    if (price === null) {
      return null;
    }
    total += price;
  }
  return total;
}

export interface SupplyBooks {
  protectedReserve: bigint;
  inventory: bigint;
  members: ReadonlyMap<string, bigint>;
  escrow: ReadonlyMap<string, bigint>;
  treasury: bigint;
  charges: bigint;
}

export function supplyTotal(books: SupplyBooks): bigint {
  let members = 0n;
  for (const amount of books.members.values()) {
    members += amount;
  }
  let escrow = 0n;
  for (const amount of books.escrow.values()) {
    escrow += amount;
  }
  return books.protectedReserve + books.inventory + members + escrow + books.treasury + books.charges;
}

export function simulateSupplyConservation() {
  const members = new Map<string, bigint>([["member", 0n]]);
  const escrow = new Map<string, bigint>([["member", 0n]]);
  const books: SupplyBooks = {
    protectedReserve: PROTECTED_INGOTS,
    inventory: ACTIVE_INGOTS,
    members,
    escrow,
    treasury: 0n,
    charges: 0n,
  };
  const steps: string[] = [];
  const check = (step: string) => {
    if (supplyTotal(books) !== INGOT_TOTAL) {
      throw new Error(`${step} changed the 5,000 Ingot supply.`);
    }
    steps.push(step);
  };
  check("seed");
  members.set("member", 2n);
  books.inventory -= 2n;
  check("funded buy moves inventory to the member");
  members.set("member", 1n);
  books.inventory += 1n;
  check("sell returns one Ingot to inventory");
  members.set("member", 0n);
  escrow.set("member", 1n);
  check("shop hold keeps the Ingot out of the pool");
  escrow.set("member", 0n);
  books.inventory += 1n;
  check("shop commit returns the Ingot to inventory");
  books.inventory -= 1n;
  members.set("member", 1n);
  check("refund path is a buy back to the member");
  members.set("friend", 1n);
  members.set("member", 0n);
  check("member transfer leaves the pool unchanged");
  members.set("friend", 0n);
  books.treasury = 1n;
  check("funded treasury allocation keeps the Ingot in the active 2,500");
  books.treasury = 0n;
  books.charges = 1n;
  check("a charge can be created only from treasury Ingots");
  books.charges = 0n;
  books.inventory += 1n;
  check("activation returns those Ingots to inventory");
  return {
    conserved: true as const,
    total: INGOT_TOTAL.toString(),
    steps,
    futureUse: [
      "Shops call hold, commit, and refund. Commit returns Ingots to exchange inventory and does not withdraw Marks backing. Unfulfilled purchases stay in escrow.",
      "Crates and consumables never destroy Ingots.",
      "Market Collapse charges are created only from Ingots already in the event treasury. Activation returns those units to inventory. An empty treasury cannot create a charge.",
      "A pool allocation that is not a member purchase must add the matching redemption liability to backing before the inventory moves.",
      "Protected reserve is not a shop, crate, or event source.",
    ],
  };
}
