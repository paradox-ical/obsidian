/** House fee is zero. Payouts come from the actual pool, in whole Marks. */
export const HOUSE_FEE_BPS = 0;

export const SHOP_KEY_DETAIL = "Shop key delivery is not built.";

export const PREDICTION_RULES = {
  houseFee: "The house fee is zero. Winners are paid from the actual staked pool.",
  remainder: "Each winner receives the whole-Mark floor of stake times pool divided by the winning stake. Leftover Marks go one at a time to the largest remainders. Equal remainders go to the earliest user id.",
  tie: "A declared tie refunds every stake.",
  cancel: "Cancellation refunds every stake.",
  noWinner: "A winning outcome with no entries refunds every stake.",
  lock: "After the lock, outcomes and stakes cannot change.",
  reversal: "Reversal refunds every stake and removes a payout only when the wallet can cover it. A short wallet is left unchanged.",
} as const;

export const MEDIA_TYPES = ["text", "image", "video", "audio", "link"] as const;

export type MediaType = (typeof MEDIA_TYPES)[number];

export interface StakeShare {
  userId: string;
  stake: bigint;
}

export interface PayoutShare {
  userId: string;
  payout: bigint;
}

/**
 * Split a pool in whole units. The sum of payouts equals the pool.
 * Leftover units use the largest remainder, then the earliest user id.
 */
export function splitPool(pool: bigint, winners: readonly StakeShare[]): PayoutShare[] | null {
  if (pool < 0n || winners.some((winner) => winner.stake <= 0n)) {
    return null;
  }
  if (winners.length === 0 || pool === 0n) {
    return winners.map((winner) => ({ userId: winner.userId, payout: 0n }));
  }
  const total = winners.reduce((sum, winner) => sum + winner.stake, 0n);
  if (total <= 0n) {
    return null;
  }
  const bases = winners.map((winner) => {
    const product = winner.stake * pool;
    return { userId: winner.userId, payout: product / total, fraction: product % total };
  });
  let remainder = pool - bases.reduce((sum, row) => sum + row.payout, 0n);
  const order = [...bases].sort((left, right) => {
    if (left.fraction === right.fraction) {
      return left.userId < right.userId ? -1 : left.userId > right.userId ? 1 : 0;
    }
    return left.fraction > right.fraction ? -1 : 1;
  });
  const extra = new Map<string, bigint>();
  for (const row of order) {
    if (remainder <= 0n) {
      break;
    }
    extra.set(row.userId, (extra.get(row.userId) ?? 0n) + 1n);
    remainder -= 1n;
  }
  return bases
    .map((row) => ({ userId: row.userId, payout: row.payout + (extra.get(row.userId) ?? 0n) }))
    .sort((left, right) => (left.userId < right.userId ? -1 : left.userId > right.userId ? 1 : 0));
}

export function entryEligibility(input: {
  requiredRoleId: string;
  roleIds: readonly string[];
  minAccountDays: number;
  accountAgeDays: number;
  attendanceRequired: boolean;
  attended: boolean;
}): "allowed" | "role" | "age" | "attendance" {
  if (input.requiredRoleId && !input.roleIds.includes(input.requiredRoleId)) {
    return "role";
  }
  if (input.minAccountDays > 0 && input.accountAgeDays < input.minAccountDays) {
    return "age";
  }
  if (input.attendanceRequired && !input.attended) {
    return "attendance";
  }
  return "allowed";
}

export function mediaAllowed(type: string, allowed: readonly string[]): type is MediaType {
  return (MEDIA_TYPES as readonly string[]).includes(type) && allowed.includes(type);
}

export function weightedScore(criteria: readonly { id: string; weight: number }[], scores: Readonly<Record<string, number>>): number | null {
  if (criteria.length === 0 || criteria.some((criterion) => !Number.isSafeInteger(criterion.weight) || criterion.weight < 1)) {
    return null;
  }
  let total = 0;
  for (const criterion of criteria) {
    const score = scores[criterion.id];
    if (score === undefined || !Number.isSafeInteger(score) || score < 0 || score > 10) {
      return null;
    }
    total += criterion.weight * score;
  }
  return total;
}

export function tiedLeaders(rows: readonly { entryId: string; score: number }[]): { entryId: string; score: number }[] {
  const top = rows.reduce((best, row) => Math.max(best, row.score), 0);
  return rows.filter((row) => row.score === top && row.score > 0);
}

export function bonusDecision(existing: number, cap: number): "allowed" | "capped" {
  if (!Number.isSafeInteger(existing) || !Number.isSafeInteger(cap) || cap < 1 || existing >= cap) {
    return "capped";
  }
  return "allowed";
}

export interface DrawTicket {
  userId: string;
}

/** Draw without replacement. Ticket count is the weight. Excluded users stay out. */
export function drawWinners(
  tickets: readonly DrawTicket[],
  count: number,
  excluded: ReadonlySet<string>,
  randomIndex: (max: number) => number,
): string[] {
  if (!Number.isSafeInteger(count) || count < 1) {
    return [];
  }
  const bag = tickets.filter((ticket) => !excluded.has(ticket.userId));
  const winners: string[] = [];
  const blocked = new Set(excluded);
  while (winners.length < count && bag.length > 0) {
    const index = randomIndex(bag.length);
    const pick = bag[index];
    if (!pick || blocked.has(pick.userId)) {
      if (pick) {
        bag.splice(index, 1);
      } else {
        break;
      }
      continue;
    }
    blocked.add(pick.userId);
    winners.push(pick.userId);
    for (let cursor = bag.length - 1; cursor >= 0; cursor -= 1) {
      if (bag[cursor]?.userId === pick.userId) {
        bag.splice(cursor, 1);
      }
    }
  }
  return winners;
}
