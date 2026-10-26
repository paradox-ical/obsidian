import { chooseMission, previewMission, previewExpedition, readWorldStaff, resolveMissionCheck, resolveMissionCombat, startExpedition, startMission, type PrismaClient } from "@collective/db";

export async function runExploreCommand(
  db: PrismaClient,
  input: { subcommand?: string; options: Record<string, string | boolean | number>; guildId: string; userId: string; now: Date },
) {
  if (input.subcommand === "mission") {
    return runMission(db, input);
  }
  if (input.subcommand !== "expedition") {
    return { content: "Crew jobs live on `/crew`. An expedition or a mission is the explore path." };
  }
  const action = text(input.options, "action") || "preview";
  const region = text(input.options, "region") || "backstreets";
  const difficulty = text(input.options, "difficulty") || "routine";
  if (action === "report") {
    const view = await readWorldStaff(db, input.guildId);
    return { content: `${view.counts.regions} regions, ${view.counts.enemies} enemies, ${view.counts.bosses} bosses. ${view.remaining[0]}` };
  }
  if (action === "start") {
    const item = text(input.options, "item");
    const started = await startExpedition(db, {
      guildId: input.guildId,
      userId: input.userId,
      regionSlug: region,
      difficulty,
      ...(item ? { itemIds: [item] } : {}),
      notify: input.options["notify"] === true,
      idempotencyKey: `explore:${input.userId}:${input.now.toISOString()}`,
      now: input.now,
    });
    if (started.result === "level") {
      return { content: "Your level does not open that region." };
    }
    if (started.result === "busy") {
      return { content: "One expedition is already running." };
    }
    if (started.result === "cooling") {
      return { content: "That region and difficulty are still cooling down." };
    }
    if (started.result === "locked") {
      return { content: "That gear is already locked." };
    }
    if (started.result === "recovery") {
      return { content: "Recovery is still running. Owned gear and the wallet stay available." };
    }
    if (started.result !== "ready") {
      return { content: "That expedition did not start." };
    }
    return { content: `Expedition ${started.expeditionId} returns at ${started.deadline}. Reserved gear stays locked. ${started.notice === "setup_required" ? "The completion notice is not posted." : "No completion notice was requested."}` };
  }
  const preview = await previewExpedition(db, { guildId: input.guildId, userId: input.userId, regionSlug: region, difficulty, now: input.now });
  if (preview.result !== "ready") {
    return { content: "That expedition cannot be previewed." };
  }
  return { next: { label: "Prepare this expedition", subcommand: "expedition", options: { ...input.options, action: "start", region, difficulty } }, content: `${region} ${difficulty}. Access ${preview.access}. Slot ${preview.slot}. Cooldown ${preview.cooldown}. ${preview.tier.xp} XP and ${preview.tier.marks} Marks before caps. ${preview.enemy}. ${preview.remaining[0]}` };
}

async function runMission(
  db: PrismaClient,
  input: { options: Record<string, string | boolean | number>; guildId: string; userId: string; now: Date },
) {
  const action = text(input.options, "action") || "preview";
  const slug = text(input.options, "region") === "black-docks" ? "dock-signal" : "yard-run";
  if (action === "start") {
    const item = text(input.options, "item");
    const started = await startMission(db, {
      guildId: input.guildId,
      userId: input.userId,
      slug,
      ...(item ? { itemIds: [item] } : {}),
      notify: input.options["notify"] === true,
      idempotencyKey: `mission:${input.userId}:${input.now.toISOString()}`,
      now: input.now,
    });
    if (started.result === "level") {
      return { content: "Your level does not open that mission." };
    }
    if (started.result === "recovery") {
      return { content: "Recovery is still running. A medkit can shorten it. It does not heal inside a fight." };
    }
    if (started.result === "locked") {
      return { content: "An expedition, duel, or locked item is already using that loadout." };
    }
    if (started.result !== "ready") {
      return { content: "That mission did not start." };
    }
    return { content: `Mission ${started.missionId} is at ${started.nodeId}. Unbanked loot is not yours until the end. ${started.notice === "setup_required" ? "The notice is not posted." : "No notice was requested."}` };
  }
  if (action === "choose") {
    const chosen = await chooseMission(db, { guildId: input.guildId, userId: input.userId, choiceId: text(input.options, "choice"), now: input.now });
    return { content: chosen.result === "ready" ? `Mission ${chosen.nodeId} is ${chosen.waiting}.` : "That choice did not resolve." };
  }
  if (action === "check") {
    const checked = await resolveMissionCheck(db, { guildId: input.guildId, userId: input.userId, roll: 10, now: input.now });
    return { content: checked.result === "ready" ? `Check stored. Node ${checked.nodeId}.` : "That check did not resolve." };
  }
  if (action === "fight") {
    const fought = await resolveMissionCombat(db, { guildId: input.guildId, userId: input.userId, now: input.now });
    return { content: fought.result === "ready" ? `Fight stored. Status ${fought.status}.` : "That fight did not resolve." };
  }
  const preview = await previewMission(db, { guildId: input.guildId, userId: input.userId, slug, now: input.now });
  if (preview.result !== "ready") {
    return { content: "That mission cannot be previewed." };
  }
  return { next: { label: "Prepare this mission", subcommand: "mission", options: { ...input.options, action: "start" } }, content: `${preview.name}. Access ${preview.access}. Recovery ${preview.recovery}. ${preview.summary}` };
}

function text(options: Record<string, string | boolean | number>, key: string): string {
  const value = options[key];
  return typeof value === "string" ? value : "";
}
