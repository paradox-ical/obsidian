import {
  approveContract,
  assignContract,
  openContractBoard,
  rejectContract,
  rerollContract,
  saveContractObjective,
  saveContractPreference,
  submitContract,
  type PrismaClient,
} from "@collective/db";

export async function runContractCommand(
  db: PrismaClient,
  input: {
    subcommand?: string;
    options: Record<string, string | boolean | number>;
    guildId: string;
    userId: string;
    roleIds: string[];
    now: Date;
  },
) {
  const actor = { guildId: input.guildId, actorUserId: input.userId, actorRoleIds: input.roleIds, now: input.now };
  if (input.subcommand === "reroll") {
    const outcome = await rerollContract(db, { guildId: input.guildId, userId: input.userId, assignmentId: text(input.options, "assignment"), now: input.now });
    if (outcome.result === "rerolled") {
      return { content: `Rerolled to ${outcome.assignment.title}. Frozen reward ${outcome.assignment.rewardMarks} Marks. ${outcome.assignment.disclosure}` };
    }
    if (outcome.result === "started") {
      return { content: "That daily contract has already started, so the reroll stays unused." };
    }
    if (outcome.result === "used") {
      return { content: "The free daily reroll is already used." };
    }
    return { content: "That contract cannot be rerolled." };
  }
  if (input.subcommand === "settings") {
    const saved = await saveContractPreference(db, {
      guildId: input.guildId,
      userId: input.userId,
      ...(has(input.options, "daily") ? { refreshDaily: flag(input.options["daily"]) } : {}),
      ...(has(input.options, "weekly") ? { refreshWeekly: flag(input.options["weekly"]) } : {}),
      ...(has(input.options, "monthly") ? { refreshMonthly: flag(input.options["monthly"]) } : {}),
      ...(has(input.options, "delivery") ? { delivery: text(input.options, "delivery") } : {}),
      ...(has(input.options, "channel") ? { channelId: text(input.options, "channel") } : {}),
      ...(has(input.options, "pings") ? { completionPings: flag(input.options["pings"]) } : {}),
      now: input.now,
    });
    if (saved.result !== "saved") {
      return { content: "Contract notices are unavailable." };
    }
    return { content: "Contract notices were saved. Turning off completion pings does not stop the reward." };
  }
  if (input.subcommand === "custom") {
    const action = text(input.options, "action");
    if (action === "submit") {
      const outcome = await submitContract(db, { guildId: input.guildId, userId: input.userId, assignmentId: text(input.options, "assignment"), answer: text(input.options, "answer"), body: text(input.options, "answer"), now: input.now });
      if (outcome.result === "completed") {
        return { content: `Recorded. Payout ${outcome.payoutMarks} Marks${outcome.payoutStatus === "capped" ? " because the cap was reached" : ""}.` };
      }
      if (outcome.result === "incorrect") {
        return { content: "That answer does not match." };
      }
      if (outcome.result === "pending") {
        return { content: "Submitted for staff approval. The reward waits for that approval." };
      }
      if (outcome.result === "already_recorded") {
        return { content: "That contract was already recorded." };
      }
      return { content: "That contract cannot be submitted." };
    }
    if (action === "approve" || action === "reject") {
      const outcome = action === "approve"
        ? await approveContract(db, { ...actor, submissionId: text(input.options, "assignment"), now: input.now })
        : await rejectContract(db, { ...actor, submissionId: text(input.options, "assignment"), reason: text(input.options, "reason") || "Rejected", now: input.now });
      if (outcome.result === "completed") {
        return { content: `Approved. Payout ${outcome.payoutMarks} Marks. Completion pings do not control the reward.` };
      }
      if (outcome.result === "rejected") {
        return { content: "The submission was rejected. No reward was posted." };
      }
      if (outcome.result === "denied") {
        return { content: "Contract approval is limited to event staff." };
      }
      return { content: "That submission was not changed." };
    }
    const saved = await saveContractObjective(db, {
      ...actor,
      ...(action === "edit" ? { id: text(input.options, "objective") } : {}),
      title: text(input.options, "title"),
      prompt: text(input.options, "answer") || text(input.options, "title"),
      kind: text(input.options, "kind"),
      target: integer(input.options, "target", 1),
      rewardMarks: integer(input.options, "reward", 0),
      answer: text(input.options, "answer"),
      policy: text(input.options, "policy") === "migrate" ? "migrate" : "preserve",
      now: input.now,
    });
    if (saved.result === "module_not_built") {
      return { content: "That objective is stored as a later RPG hook and is not assigned automatically." };
    }
    if (saved.result === "denied") {
      return { content: "Contract authoring is limited to event staff." };
    }
    if (saved.result !== "saved") {
      return { content: "That objective was not saved." };
    }
    if (action === "assign") {
      const assigned = await assignContract(db, { ...actor, userId: input.userId, definitionId: saved.objectiveId, board: text(input.options, "board") || "daily", now: input.now });
      if (assigned.result === "module_not_built") {
        return { content: "That objective is not built." };
      }
      if (assigned.result === "assigned" || assigned.result === "already_assigned") {
        return { content: `Assigned ${assigned.assignment.title}. Progress ${assigned.assignment.progress}/${assigned.assignment.target}. ${assigned.assignment.disclosure}` };
      }
      return { content: "That objective was saved but not assigned." };
    }
    return { content: `Objective version ${saved.version} was saved.` };
  }
  const opened = await openContractBoard(db, { guildId: input.guildId, userId: input.userId, board: text(input.options, "cycle") || "daily", now: input.now });
  if (opened.result !== "ready") {
    return { content: "Contracts are unavailable." };
  }
  if (opened.assignments.length === 0) {
    return { content: "No contracts are assigned for this cycle." };
  }
  const lines = opened.assignments.map((row) => `${row.title}: ${row.progress}/${row.target}, due ${row.deadline}, ${row.rewardMarks} Marks. ${row.disclosure}`);
  return { content: `${opened.board} ${opened.cycleId}. ${lines.join(" ")}` };
}

function text(options: Record<string, string | boolean | number>, key: string): string {
  const value = options[key];
  return typeof value === "string" ? value : "";
}

function integer(options: Record<string, string | boolean | number>, key: string, fallback: number): number {
  const value = options[key];
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function flag(value: string | boolean | number | undefined): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return value !== "false" && value !== "0";
}

function has(options: Record<string, string | boolean | number>, key: string): boolean {
  return options[key] !== undefined;
}
