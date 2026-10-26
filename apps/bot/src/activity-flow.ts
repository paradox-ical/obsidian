import {
  addGiveawayBonus,
  awardContest,
  cancelGiveaway,
  cancelPrediction,
  castContestBallot,
  claimGiveaway,
  closeContest,
  closeGiveaway,
  correctContest,
  createContest,
  createGiveaway,
  createPrediction,
  disqualifyGiveaway,
  drawGiveaway,
  enterGiveaway,
  enterPrediction,
  lockPrediction,
  publishContest,
  readContest,
  readPrediction,
  rerollGiveaway,
  resolvePrediction,
  reversePrediction,
  submitContestEntry,
  type PrismaClient,
} from "@collective/db";

export async function runActivityCommand(
  db: PrismaClient,
  input: {
    name: string;
    subcommand?: string;
    options: Record<string, string | boolean | number>;
    guildId: string;
    userId: string;
    roleIds: string[];
    now: Date;
  },
) {
  const action = text(input.options, "action");
  const actor = { guildId: input.guildId, actorUserId: input.userId, actorRoleIds: input.roleIds, now: input.now };
  if (input.name === "prediction") {
    return { content: await predictionCommand(db, input, actor, action) };
  }
  if (input.name === "contest") {
    return { content: await contestCommand(db, input, actor, action) };
  }
  if (input.name === "giveaway") {
    return { content: await giveawayCommand(db, input, actor, action) };
  }
  return { content: "That activity is not available." };
}

async function predictionCommand(
  db: PrismaClient,
  input: { subcommand?: string; options: Record<string, string | boolean | number>; guildId: string; userId: string; roleIds: string[]; now: Date },
  actor: { guildId: string; actorUserId: string; actorRoleIds: string[]; now: Date },
  action: string,
) {
  const mode = input.subcommand === "staked" ? "staked" : "free";
  const predictionId = text(input.options, "prediction");
  if (action === "view") {
    const board = await readPrediction(db, { guildId: input.guildId, predictionId });
    if (board.result !== "ok") {
      return activityText(board.result);
    }
    return `${board.prediction.title}. Lock ${board.prediction.lockAt.toISOString()}. ${board.prediction.rules} House fee is zero. ${board.settlement.remainder}`;
  }
  if (action === "create") {
    const when = text(input.options, "when");
    const lockAt = when ? new Date(when) : new Date(input.now.getTime() + 60 * 60 * 1000);
    const created = await createPrediction(db, {
      ...actor,
      title: text(input.options, "title"),
      mode,
      rules: text(input.options, "evidence") || "Official result after the lock.",
      evidence: text(input.options, "evidence") || "Evidence is recorded at resolution.",
      outcomes: ["Yes", "No"],
      lockAt,
      points: number(input.options, "points", 1),
      prizeMarks: number(input.options, "prize", 0),
    });
    if (created.result !== "open") {
      return activityText(created.result);
    }
    return `Prediction ${created.prediction.id} is open. The house fee is zero. Discord is not used for the pool.`;
  }
  if (action === "enter" || action === "confirm") {
    const saved = await enterPrediction(db, {
      guildId: input.guildId,
      predictionId,
      userId: input.userId,
      outcomeId: text(input.options, "choice"),
      stakeMarks: number(input.options, "stake", 0),
      roleIds: input.roleIds,
      accountAgeDays: 365,
      acknowledged: action === "confirm",
      now: input.now,
    });
    if (saved.result === "preview") {
      return `${saved.title}. ${saved.rules} Lock ${saved.lockAt.toISOString()}. Confirm to enter. Ties, cancellation, and no winner refund every stake.`;
    }
    if (saved.result === "recorded") {
      return mode === "staked" ? "Stake held in escrow. It cannot change after the lock." : "Free entry recorded.";
    }
    return activityText(saved.result);
  }
  if (action === "lock") {
    return activityText((await lockPrediction(db, { ...actor, predictionId })).result);
  }
  if (action === "resolve") {
    const resolved = await resolvePrediction(db, { ...actor, predictionId, outcomeId: text(input.options, "outcome"), evidence: text(input.options, "evidence") });
    if (resolved.result === "refunded") {
      return `Refunded. ${resolved.rule === "tie" ? "A tie refunds every stake." : "No winning entry refunds every stake."}`;
    }
    if (resolved.result === "resolved") {
      return "Resolution recorded. Payouts use the actual pool and a zero house fee.";
    }
    if (resolved.result === "unfunded") {
      return "Points were recorded. The funded prize was not paid because the exceptional pool is short.";
    }
    return activityText(resolved.result);
  }
  if (action === "cancel") {
    const cancelled = await cancelPrediction(db, { ...actor, predictionId });
    return cancelled.result === "cancelled" ? "Cancelled. Every stake was refunded." : activityText(cancelled.result);
  }
  if (action === "reverse") {
    const reversed = await reversePrediction(db, { ...actor, predictionId, reason: text(input.options, "reason") });
    if (reversed.result === "insufficient") {
      return "Reversal stopped. A wallet could not cover the payout, so balances were left unchanged.";
    }
    return reversed.result === "reversed" ? "Reversal recorded." : activityText(reversed.result);
  }
  return "Choose a prediction action.";
}

async function contestCommand(
  db: PrismaClient,
  input: { subcommand?: string; options: Record<string, string | boolean | number>; guildId: string; userId: string; roleIds: string[]; now: Date },
  actor: { guildId: string; actorUserId: string; actorRoleIds: string[]; now: Date },
  action: string,
) {
  const contestId = text(input.options, "contest");
  if (input.subcommand === "submit") {
    const saved = await submitContestEntry(db, {
      guildId: input.guildId,
      contestId,
      userId: input.userId,
      title: text(input.options, "title"),
      mediaType: text(input.options, "media"),
      body: text(input.options, "body"),
      roleIds: input.roleIds,
      now: input.now,
    });
    return saved.result === "submitted" ? "Entry submitted." : activityText(saved.result);
  }
  if (input.subcommand === "ballot") {
    const score = text(input.options, "score");
    const scores: Record<string, number> = {};
    for (const pair of score.split(",").filter(Boolean)) {
      const [id, value] = pair.split(":");
      if (id && value && Number.isFinite(Number(value))) {
        scores[id] = Number(value);
      }
    }
    const saved = await castContestBallot(db, {
      guildId: input.guildId,
      contestId,
      entryId: text(input.options, "entry"),
      voterUserId: input.userId,
      roleIds: input.roleIds,
      ...(Object.keys(scores).length > 0 ? { scores } : {}),
      now: input.now,
    });
    return saved.result === "recorded" ? "Ballot recorded. Reaction counts are not used." : activityText(saved.result);
  }
  if (action === "create") {
    const mode = text(input.options, "mode") === "judge" ? "judge" : "vote";
    const created = await createContest(db, {
      ...actor,
      title: text(input.options, "title"),
      mode,
      rules: "Published rules apply before entries.",
      category: "community",
      allowedTypes: ["text", "image"],
      closesAt: new Date(input.now.getTime() + 60 * 60 * 1000),
      ...(mode === "judge" ? { criteria: [{ name: "craft", weight: 1 }] } : {}),
      stockId: text(input.options, "stock"),
      prizeQuantity: text(input.options, "stock") ? 1 : 0,
    });
    return created.result === "draft" ? `Contest ${created.contest.id} is a draft. Publish the rules before entries.` : activityText(created.result);
  }
  if (action === "publish") {
    const published = await publishContest(db, { ...actor, contestId });
    return published.result === "published" ? "Rules published. Entries can open." : activityText(published.result);
  }
  if (action === "close") {
    const closed = await closeContest(db, { ...actor, contestId });
    return closed.result === "tie_published" ? "Closed. The tie is published and no single winner was chosen." : activityText(closed.result);
  }
  if (action === "correct") {
    const corrected = await correctContest(db, { ...actor, contestId, entryId: text(input.options, "entry"), reason: text(input.options, "reason") });
    return corrected.result === "corrected" ? "Correction recorded." : activityText(corrected.result);
  }
  if (action === "award") {
    const awarded = await awardContest(db, { ...actor, contestId, winnerEntryId: text(input.options, "entry"), reason: text(input.options, "reason") || "Award the published result" });
    if (awarded.result === "tie_published") {
      return "The tie stays published. The prize was not given to one entry.";
    }
    if (awarded.result === "awarded" && "fulfilment" in awarded && awarded.fulfilment === "shop_pending") {
      return "Award recorded. The key is still waiting on the shop. No key was created or posted.";
    }
    if (awarded.result === "awarded" && "detail" in awarded && awarded.detail === "A Steam key is in the private inbox. It was not posted.") {
      return "Award recorded. The Steam key is in the private inbox and was not posted.";
    }
    return awarded.result === "awarded" ? "Prize recorded from stock." : activityText(awarded.result);
  }
  const board = await readContest(db, { guildId: input.guildId, contestId, audience: "member" });
  return board.result === "ok" ? `${board.contest.title}. ${board.contest.rules}` : activityText(board.result);
}

async function giveawayCommand(
  db: PrismaClient,
  input: { subcommand?: string; options: Record<string, string | boolean | number>; guildId: string; userId: string; roleIds: string[]; now: Date },
  actor: { guildId: string; actorUserId: string; actorRoleIds: string[]; now: Date },
  action: string,
) {
  const giveawayId = text(input.options, "giveaway");
  if (input.subcommand === "enter") {
    const entered = await enterGiveaway(db, { guildId: input.guildId, giveawayId, userId: input.userId, roleIds: input.roleIds, accountAgeDays: 365, now: input.now });
    return entered.result === "entered" ? "Free entry recorded. One free entry is the limit." : activityText(entered.result);
  }
  if (input.subcommand === "bonus") {
    const bonus = await addGiveawayBonus(db, {
      guildId: input.guildId,
      giveawayId,
      userId: input.userId,
      activityKey: text(input.options, "activity"),
      roleIds: input.roleIds,
      accountAgeDays: 365,
      now: input.now,
    });
    return bonus.result === "recorded" ? "Bonus entry recorded." : activityText(bonus.result);
  }
  if (action === "create") {
    const created = await createGiveaway(db, {
      ...actor,
      title: text(input.options, "title"),
      rules: "One free entry. Bonus entries come from verified activities.",
      bonusRules: "Each verified activity can add one bonus until the cap.",
      closesAt: new Date(input.now.getTime() + 60 * 60 * 1000),
      maxBonus: 1,
      stockId: text(input.options, "stock"),
      sponsor: "",
    });
    return created.result === "open" ? `Giveaway ${created.giveaway.id} is open. The draw uses the closing snapshot.` : activityText(created.result);
  }
  if (action === "close") {
    return activityText((await closeGiveaway(db, { ...actor, giveawayId })).result);
  }
  if (action === "draw") {
    const drawn = await drawGiveaway(db, { ...actor, giveawayId });
    return drawn.result === "drawn" ? "Draw recorded from the locked snapshot. Fulfilment is private, and Discord delivery is setup-required." : activityText(drawn.result);
  }
  if (action === "claim") {
    const claimed = await claimGiveaway(db, { guildId: input.guildId, drawId: text(input.options, "draw"), userId: input.userId, now: input.now });
    if (claimed.result === "claimed" && claimed.fulfilment === "shop_pending") {
      return "Claim recorded. The key is still waiting on the shop. No key was created or posted.";
    }
    if (claimed.result === "claimed" && claimed.detail === "A Steam key is in the private inbox. It was not posted.") {
      return "Claim recorded. The Steam key is in the private inbox and was not posted.";
    }
    return claimed.result === "claimed" ? "Claim recorded. Fulfilment stays private." : activityText(claimed.result);
  }
  if (action === "disqualify") {
    return activityText((await disqualifyGiveaway(db, { ...actor, drawId: text(input.options, "draw"), reason: text(input.options, "reason") })).result);
  }
  if (action === "reroll") {
    const rerolled = await rerollGiveaway(db, { ...actor, giveawayId, reason: text(input.options, "reason") });
    return rerolled.result === "rerolled" ? "Reroll recorded. The first draw is kept, and the disqualified winner stays out." : activityText(rerolled.result);
  }
  if (action === "cancel") {
    return activityText((await cancelGiveaway(db, { ...actor, giveawayId })).result);
  }
  return "Choose a giveaway action.";
}

function activityText(result: string): string {
  if (result === "denied") return "You do not have access to that activity.";
  if (result === "maintenance") return "Activities are in maintenance.";
  if (result === "locked") return "That prediction is locked. Outcomes and stakes stay as they are.";
  if (result === "insufficient") return "The wallet or stock could not cover that.";
  if (result === "unfunded") return "The exceptional prize pool is not funded.";
  if (result === "shop_pending") return "The key is still waiting on the shop. No key was created or posted.";
  if (result === "already_resolved" || result === "already_recorded" || result === "already_claimed" || result === "already_entered") return "That was already recorded.";
  if (result === "capped") return "The bonus cap is already used.";
  if (result === "tie_published") return "The tie is published.";
  if (result === "closed") return "That deadline has passed.";
  if (result === "self_vote") return "You cannot vote for your own entry.";
  if (result === "unpublished") return "The rules are not published yet.";
  return "That activity action was not completed.";
}

function text(options: Record<string, string | boolean | number>, key: string): string {
  const value = options[key];
  return typeof value === "string" ? value.trim() : "";
}

function number(options: Record<string, string | boolean | number>, key: string, fallback: number): number {
  const value = options[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}
