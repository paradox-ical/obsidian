import { formatMinor, routineMonthlyMarks } from "./economy.js";

/** One Mark is 100 minor units. A 3:2 natural on one Mark is 150 minor units, shown as 1.50. */
export const BLACKJACK_MINOR = 100n;
export const BLACKJACK_MIN_BET_MARKS = 1;
export const BLACKJACK_MAX_BET_MARKS = 10;
export const BLACKJACK_TABLE_CAP = 5;
export const BLACKJACK_JOIN_SECONDS = 60;
export const BLACKJACK_TURN_SECONDS = 45;
export const BLACKJACK_DECKS = 6;
export const BLACKJACK_HOUSE = "blackjack-house";

export const BLACKJACK_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
export const BLACKJACK_SUITS = ["S", "H", "D", "C"] as const;

export interface BlackjackRules {
  minBetMarks: number;
  maxBetMarks: number;
  tableCap: number;
  joinSeconds: number;
  turnSeconds: number;
  decks: number;
  hitSoft17: boolean;
  naturalNum: number;
  naturalDen: number;
  regularNum: number;
  regularDen: number;
  maxSplits: number;
  splitAcesOneCard: boolean;
  splitBlackjackPaysRegular: boolean;
  version: number;
}

export function defaultBlackjackRules(version = 1): BlackjackRules {
  return {
    minBetMarks: BLACKJACK_MIN_BET_MARKS,
    maxBetMarks: BLACKJACK_MAX_BET_MARKS,
    tableCap: BLACKJACK_TABLE_CAP,
    joinSeconds: BLACKJACK_JOIN_SECONDS,
    turnSeconds: BLACKJACK_TURN_SECONDS,
    decks: BLACKJACK_DECKS,
    hitSoft17: false,
    naturalNum: 3,
    naturalDen: 2,
    regularNum: 1,
    regularDen: 1,
    maxSplits: 1,
    splitAcesOneCard: true,
    splitBlackjackPaysRegular: true,
    version,
  };
}

export function blackjackRulesText(rules: BlackjackRules): string[] {
  const soft = rules.hitSoft17 ? "Dealer hits soft 17." : "Dealer stands on soft 17.";
  const splitNatural = rules.splitBlackjackPaysRegular
    ? "A split blackjack pays a regular win."
    : "A split blackjack pays the natural rate.";
  const aces = rules.splitAcesOneCard ? "Split aces receive one card." : "Split aces can take more cards.";
  return [
    "Solo and social tables play independent hands against one dealer and one shoe.",
    `These are table rules version ${rules.version}.`,
    soft,
    `A natural pays ${rules.naturalNum}:${rules.naturalDen}. A regular win pays ${rules.regularNum}:${rules.regularDen}. A push returns the stake.`,
    `A player may split ${rules.maxSplits === 1 ? "once" : `${rules.maxSplits} times`}. ${aces} ${splitNatural}`,
    "The house reserves the worst-case split and double payout before it accepts a bet, a double, or a split.",
    "The shoe is shuffled once and stored. A retry reads those cards and does not shuffle again.",
    "An inactive player stands. A system cancellation refunds every unsettled stake.",
    "There is no hidden forced-loss rule. The stored cards and this rules version decide the hand.",
  ];
}

export function cardRank(card: string): string {
  return card.startsWith("10") ? "10" : card.slice(0, 1);
}

export function handTotal(cards: readonly string[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    const rank = cardRank(card);
    if (rank === "A") {
      aces += 1;
      total += 11;
    } else if (rank === "K" || rank === "Q" || rank === "J" || rank === "10") {
      total += 10;
    } else {
      total += Number(rank);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return { total, soft: aces > 0 };
}

export function dealerHits(total: number, soft: boolean, hitSoft17: boolean): boolean {
  if (total < 17) {
    return true;
  }
  return total === 17 && soft && hitSoft17;
}

export function orderedShoe(decks: number): string[] {
  const cards: string[] = [];
  const copies = Math.max(1, Math.trunc(decks));
  for (let deck = 0; deck < copies; deck += 1) {
    for (const suit of BLACKJACK_SUITS) {
      for (const rank of BLACKJACK_RANKS) {
        cards.push(`${rank}${suit}`);
      }
    }
  }
  return cards;
}

export function shuffleShoe(cards: readonly string[], random: (max: number) => number): string[] {
  const next = [...cards];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swap = random(index + 1);
    const current = next[index];
    const other = next[swap];
    if (current === undefined || other === undefined) {
      continue;
    }
    next[index] = other;
    next[swap] = current;
  }
  return next;
}

export function exactProfit(stakeMinor: bigint, numerator: number, denominator: number): bigint | null {
  if (stakeMinor <= 0n || numerator <= 0 || denominator <= 0) {
    return null;
  }
  const product = stakeMinor * BigInt(numerator);
  if (product % BigInt(denominator) !== 0n) {
    return null;
  }
  return product / BigInt(denominator);
}

export function worstCaseProfitMinor(stakeMinor: bigint, rules: BlackjackRules): bigint | null {
  const natural = exactProfit(stakeMinor, rules.naturalNum, rules.naturalDen);
  const doubled = exactProfit(stakeMinor * 2n, rules.regularNum, rules.regularDen);
  if (natural === null || doubled === null) {
    return null;
  }
  let worst = natural > doubled ? natural : doubled;
  if (rules.maxSplits >= 1) {
    const bothDoubled = doubled * 2n;
    if (bothDoubled > worst) {
      worst = bothDoubled;
    }
    if (!rules.splitBlackjackPaysRegular) {
      const splitNatural = exactProfit(stakeMinor, rules.naturalNum, rules.naturalDen);
      if (splitNatural === null) {
        return null;
      }
      const bothNaturals = splitNatural * 2n;
      if (bothNaturals > worst) {
        worst = bothNaturals;
      }
    }
  }
  return worst;
}

export type HandResult = "win" | "loss" | "push";

export function handPayout(input: {
  cards: readonly string[];
  stakeMinor: bigint;
  fromSplit: boolean;
  dealerCards: readonly string[];
  rules: BlackjackRules;
}): { result: HandResult; profitMinor: bigint } | null {
  const player = handTotal(input.cards);
  const dealer = handTotal(input.dealerCards);
  if (player.total > 21) {
    return { result: "loss", profitMinor: 0n };
  }
  const playerNatural = !input.fromSplit && input.cards.length === 2 && player.total === 21;
  const dealerNatural = input.dealerCards.length === 2 && dealer.total === 21;
  if (dealerNatural && playerNatural) {
    return { result: "push", profitMinor: 0n };
  }
  if (dealerNatural) {
    return { result: "loss", profitMinor: 0n };
  }
  if (playerNatural) {
    const profit = exactProfit(input.stakeMinor, input.rules.naturalNum, input.rules.naturalDen);
    return profit === null ? null : { result: "win", profitMinor: profit };
  }
  if (dealer.total <= 21 && player.total === dealer.total) {
    return { result: "push", profitMinor: 0n };
  }
  if (dealer.total <= 21 && player.total < dealer.total) {
    return { result: "loss", profitMinor: 0n };
  }
  const splitBlackjack = input.fromSplit && input.cards.length === 2 && player.total === 21;
  const useRegular = !splitBlackjack || input.rules.splitBlackjackPaysRegular;
  const profit = exactProfit(
    input.stakeMinor,
    useRegular ? input.rules.regularNum : input.rules.naturalNum,
    useRegular ? input.rules.regularDen : input.rules.naturalDen,
  );
  return profit === null ? null : { result: "win", profitMinor: profit };
}

export function drawDealer(input: {
  cards: readonly string[];
  shoe: readonly string[];
  cursor: number;
  hitSoft17: boolean;
}): { cards: string[]; cursor: number } | "short" {
  const cards = [...input.cards];
  let cursor = input.cursor;
  while (true) {
    const value = handTotal(cards);
    if (!dealerHits(value.total, value.soft, input.hitSoft17)) {
      return { cards, cursor };
    }
    const card = input.shoe[cursor];
    if (!card) {
      return "short";
    }
    cards.push(card);
    cursor += 1;
  }
}

export function presentDealer(cards: readonly string[], reveal: boolean): Array<{ card?: string; hidden?: true }> {
  return cards.map((card, index) => (index === 1 && !reveal ? { hidden: true } : { card }));
}

export function prepareBlackjackSettings(input: BlackjackRules): BlackjackRules | null {
  const rules: BlackjackRules = {
    minBetMarks: Math.trunc(input.minBetMarks),
    maxBetMarks: Math.trunc(input.maxBetMarks),
    tableCap: Math.trunc(input.tableCap),
    joinSeconds: Math.trunc(input.joinSeconds),
    turnSeconds: Math.trunc(input.turnSeconds),
    decks: Math.trunc(input.decks),
    hitSoft17: input.hitSoft17,
    naturalNum: Math.trunc(input.naturalNum),
    naturalDen: Math.trunc(input.naturalDen),
    regularNum: Math.trunc(input.regularNum),
    regularDen: Math.trunc(input.regularDen),
    maxSplits: Math.trunc(input.maxSplits),
    splitAcesOneCard: input.splitAcesOneCard,
    splitBlackjackPaysRegular: input.splitBlackjackPaysRegular,
    version: Math.trunc(input.version),
  };
  if (rules.minBetMarks < 1 || rules.maxBetMarks < rules.minBetMarks || rules.maxBetMarks > 100) {
    return null;
  }
  if (rules.tableCap < 1 || rules.tableCap > 7 || rules.joinSeconds < 0 || rules.joinSeconds > 600) {
    return null;
  }
  if (rules.turnSeconds < 5 || rules.turnSeconds > 300 || rules.decks < 1 || rules.decks > 8) {
    return null;
  }
  if (rules.maxSplits < 0 || rules.maxSplits > 1 || rules.naturalNum < 1 || rules.naturalDen < 1) {
    return null;
  }
  if (rules.regularNum < 1 || rules.regularDen < 1 || rules.version < 1) {
    return null;
  }
  if (betAllowed(rules.minBetMarks, rules) !== "allowed" || betAllowed(rules.maxBetMarks, rules) !== "allowed") {
    return null;
  }
  const worstLoss = rules.maxBetMarks * (rules.maxSplits >= 1 ? 4 : 2);
  if (worstLoss * 20 > routineMonthlyMarks().routineMarks) {
    return null;
  }
  return rules;
}

export function marksStake(marks: number): bigint | null {
  if (!Number.isSafeInteger(marks) || marks <= 0) {
    return null;
  }
  return BigInt(marks) * BLACKJACK_MINOR;
}

export function betAllowed(stakeMarks: number, rules: BlackjackRules): "invalid" | "bounds" | "inexact" | "allowed" {
  const stake = marksStake(stakeMarks);
  if (stake === null) {
    return "invalid";
  }
  if (stakeMarks < rules.minBetMarks || stakeMarks > rules.maxBetMarks) {
    return "bounds";
  }
  return worstCaseProfitMinor(stake, rules) === null ? "inexact" : "allowed";
}

export function simulateBlackjackEconomy(monthlyMarks?: number) {
  const monthly = monthlyMarks ?? routineMonthlyMarks().routineMarks;
  const rules = defaultBlackjackRules();
  const stake = marksStake(rules.maxBetMarks) ?? 0n;
  const exposure = worstCaseProfitMinor(stake, rules) ?? 0n;
  const worstPlayerLossMarks = rules.maxBetMarks * (rules.maxSplits >= 1 ? 4 : 2);
  return {
    monthlyRoutineMarks: monthly,
    minBetMarks: rules.minBetMarks,
    maxBetMarks: rules.maxBetMarks,
    tableCap: rules.tableCap,
    naturalPayout: `${rules.naturalNum}:${rules.naturalDen}`,
    regularPayout: `${rules.regularNum}:${rules.regularDen}`,
    exampleNaturalProfit: formatMinor(exactProfit(BLACKJACK_MINOR, rules.naturalNum, rules.naturalDen) ?? 0n),
    worstPlayerLossMarks,
    worstHandExposure: formatMinor(exposure),
    worstTableExposureMarks: worstPlayerLossMarks * rules.tableCap,
    smallRelativeToSlowEconomy: worstPlayerLossMarks * 20 <= monthly,
    assumptions: [
      "The default maximum bet is 10 Marks. One split and a double on each hand can put 40 Marks at stake.",
      "That loss is the player's own escrow. The house pays a win only from Marks already reserved in the bankroll.",
      "Forty Marks is small beside the 7,987 Mark routine month. The routine total is unchanged.",
      "A one-Mark natural pays 1.50. The half Mark is 50 minor units, not a rounded float.",
    ],
  };
}

export function sameRank(left: string, right: string): boolean {
  return cardRank(left) === cardRank(right);
}
