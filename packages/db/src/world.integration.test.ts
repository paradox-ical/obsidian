import { randomUUID } from "node:crypto";

import { cycleId, routineMonthlyMarks } from "@collective/domain";
import { afterAll, describe, expect, it } from "vitest";

import { changeClass, chooseClass } from "./characters.js";
import { createPrismaClient } from "./client.js";
import { mintGear, equipGear, startQuickDuel, unequipGear } from "./combat.js";
import { assignContract, saveContractObjective } from "./contracts.js";
import { grantCapability } from "./platform.js";
import { rollSeason } from "./seasons.js";
import { completeDueExpeditions, saveWorldEnemy, startExpedition } from "./world.js";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.");
}

const db = createPrismaClient(databaseUrl);
const guildId = `guild-${randomUUID()}`;
const now = new Date("2026-10-11T06:00:00.000Z");
const staff = ["staff"];
const win = Array.from({ length: 8 }, () => ({ attack: 18, damage: [6] }));

afterAll(async () => {
  await db.expedition.deleteMany({ where: { guildId } });
  await db.lootTable.deleteMany({ where: { guildId } });
  await db.worldEnemy.deleteMany({ where: { guildId } });
  await db.worldRegion.deleteMany({ where: { guildId } });
  await db.battleAction.deleteMany({ where: { guildId } });
  await db.battleRoll.deleteMany({ where: { guildId } });
  await db.battle.deleteMany({ where: { guildId } });
  await db.gearInstance.deleteMany({ where: { guildId } });
  await db.gearTemplate.deleteMany({ where: { guildId } });
  await db.testOpponent.deleteMany({ where: { guildId } });
  await db.job.deleteMany({ where: { guildId } });
  await db.contractAssignment.deleteMany({ where: { guildId } });
  await db.contractRevision.deleteMany({ where: { guildId } });
  await db.contractDefinition.deleteMany({ where: { guildId } });
  await db.contractSettings.deleteMany({ where: { guildId } });
  await db.characterXpEvent.deleteMany({ where: { guildId } });
  await db.playerCharacter.deleteMany({ where: { guildId } });
  await db.classAbility.deleteMany({ where: { guildId } });
  await db.classDefinition.deleteMany({ where: { guildId } });
  await db.characterCurve.deleteMany({ where: { guildId } });
  await db.seasonArchive.deleteMany({ where: { guildId } });
  await db.seasonState.deleteMany({ where: { guildId } });
  await db.seasonSettings.deleteMany({ where: { guildId } });
  await db.ledgerEntry.deleteMany({ where: { guildId } });
  await db.wallet.deleteMany({ where: { guildId } });
  await db.issuanceBudget.deleteMany({ where: { guildId } });
  await db.auditRecord.deleteMany({ where: { guildId } });
  await db.capabilityGrant.deleteMany({ where: { guildId } });
  await db.featureFlag.deleteMany({ where: { guildId } });
  await db.guild.deleteMany({ where: { guildId } });
  await db.$disconnect();
});

describe("regions and expeditions", () => {
  it("reserves gear, grants a stored drop once, and keeps the earning caps", async () => {
    await grantCapability(db, { guildId, roleId: "staff", capability: "content_management", actorUserId: "owner", reason: "test" });
    await grantCapability(db, { guildId, roleId: "staff", capability: "event_management", actorUserId: "owner", reason: "test" });
    expect(await chooseClass(db, { guildId, userId: "explorer", classSlug: "hitman", now })).toMatchObject({ result: "chosen" });
    const knife = await mintGear(db, { guildId, userId: "explorer", templateSlug: "field-knife", affixes: [{ slug: "keen", stat: "accuracy", amount: 2 }], idempotencyKey: "knife" });
    expect(knife.result).toBe("minted");
    if (knife.result !== "minted") {
      return;
    }
    expect(await equipGear(db, { guildId, userId: "explorer", itemId: knife.itemId })).toMatchObject({ result: "equipped" });

    const exploration = await saveContractObjective(db, { guildId, actorUserId: "owner", actorRoleIds: staff, title: "Walk the backstreets", prompt: "Finish one expedition.", kind: "rpg_exploration", target: 1, rewardMarks: 10, now });
    const defeat = await saveContractObjective(db, { guildId, actorUserId: "owner", actorRoleIds: staff, title: "Drop the runner", prompt: "Win one expedition.", kind: "rpg_pve", target: 1, rewardMarks: 10, now });
    expect(exploration.result).toBe("saved");
    expect(defeat.result).toBe("saved");
    if (exploration.result !== "saved" || defeat.result !== "saved") {
      return;
    }
    const exploreAssignment = await assignContract(db, { guildId, actorUserId: "owner", actorRoleIds: staff, userId: "explorer", definitionId: exploration.objectiveId, board: "daily", now });
    const defeatAssignment = await assignContract(db, { guildId, actorUserId: "owner", actorRoleIds: staff, userId: "explorer", definitionId: defeat.objectiveId, board: "daily", now });
    expect(exploreAssignment.result).toBe("assigned");
    expect(defeatAssignment.result).toBe("assigned");
    if (exploreAssignment.result !== "assigned" || defeatAssignment.result !== "assigned") {
      return;
    }

    expect(await startExpedition(db, { guildId, userId: "explorer", regionSlug: "black-docks", difficulty: "routine", idempotencyKey: "too-soon", now, packets: win })).toMatchObject({ result: "level" });
    expect(await db.gearTemplate.count({ where: { guildId } })).toBeGreaterThanOrEqual(40);
    expect(await db.gearTemplate.count({ where: { guildId } })).toBeLessThanOrEqual(60);
    expect(await db.worldEnemy.count({ where: { guildId, boss: false } })).toBe(15);
    expect(await db.worldEnemy.count({ where: { guildId, boss: true } })).toBe(3);
    expect(await db.worldRegion.findMany({ where: { guildId }, orderBy: { level: "asc" } })).toMatchObject([{ slug: "backstreets", level: 1 }, { slug: "black-docks", level: 15 }, { slug: "inner-sanctum", level: 35 }]);
    const first = await startExpedition(db, { guildId, userId: "explorer", regionSlug: "backstreets", difficulty: "routine", itemIds: [knife.itemId], notify: true, idempotencyKey: "run-1", now, packets: win, lootRoll: 2 });
    const again = await startExpedition(db, { guildId, userId: "explorer", regionSlug: "backstreets", difficulty: "routine", itemIds: [knife.itemId], notify: true, idempotencyKey: "run-1", now, packets: win, lootRoll: 1 });
    expect(first.result).toBe("ready");
    expect(again.result).toBe("ready");
    if (first.result !== "ready" || again.result !== "ready") {
      return;
    }
    expect(again.expeditionId).toBe(first.expeditionId);
    expect(await db.expedition.count({ where: { guildId, idempotencyKey: "run-1" } })).toBe(1);
    expect(await unequipGear(db, { guildId, userId: "explorer", itemId: knife.itemId })).toMatchObject({ result: "locked" });
    expect(await changeClass(db, { guildId, userId: "explorer", classSlug: "bruiser", now })).toMatchObject({ result: "locked" });
    const duel = await startQuickDuel(db, { guildId, userId: "explorer", opponentSlug: "training-dummy", idempotencyKey: "loaner", now });
    expect(duel.result).toBe("ready");
    if (duel.result === "ready") {
      expect(duel.fighters[0]).toMatchObject({ accuracyGear: 0 });
    }
    expect(await db.gearInstance.findUnique({ where: { id: knife.itemId } })).toMatchObject({ lock: "expedition", destroyed: false });

    const enemy = await db.worldEnemy.findFirst({ where: { guildId, slug: "alley-runner" } });
    expect(await saveWorldEnemy(db, { guildId, actorUserId: "owner", actorRoleIds: staff, enemyId: enemy?.id ?? "", health: 99, ability: "bleed" })).toMatchObject({ result: "saved", version: 2 });
    const stored = await db.expedition.findUnique({ where: { id: first.expeditionId } });
    const rules = stored?.rules as { enemy?: { health?: number }; loot?: { templateSlug?: string } };
    expect(rules.enemy?.health).toBe(12);
    expect(rules.loot?.templateSlug).toBe("maul");
    expect(await saveWorldEnemy(db, { guildId, actorUserId: "owner", actorRoleIds: staff, enemyId: enemy?.id ?? "", health: 12, ability: "bleed" })).toMatchObject({ result: "saved", version: 3 });

    const later = new Date(now.getTime() + 11 * 60 * 1000);
    expect(await completeDueExpeditions(db, later)).toMatchObject({ completed: 1 });
    expect(await completeDueExpeditions(db, later)).toMatchObject({ completed: 0 });
    const finished = await db.expedition.findUnique({ where: { id: first.expeditionId } });
    expect(finished).toMatchObject({ status: "resolved", grantedXp: 40, grantedMarks: 8, marksResult: "posted", notice: "setup_required", rewardsPosted: true });
    expect(await db.characterXpEvent.count({ where: { idempotencyKey: `expedition-xp:${first.expeditionId}` } })).toBe(1);
    expect(await db.gearInstance.count({ where: { guildId, provenance: "expedition" } })).toBe(0);
    expect(await db.gearInstance.findUnique({ where: { id: knife.itemId } })).toMatchObject({ lock: "", destroyed: false });
    expect(await db.contractAssignment.findUnique({ where: { id: exploreAssignment.assignment.id } })).toMatchObject({ status: "completed", payoutMarks: 10 });
    expect(await db.contractAssignment.findUnique({ where: { id: defeatAssignment.assignment.id } })).toMatchObject({ status: "completed", payoutMarks: 10 });
    expect(await db.ledgerEntry.count({ where: { guildId, idempotencyKey: exploreAssignment.assignment.rewardKey } })).toBe(1);
    expect(await startExpedition(db, { guildId, userId: "explorer", regionSlug: "backstreets", difficulty: "routine", idempotencyKey: "run-too-soon", now: later, packets: win })).toMatchObject({ result: "cooling" });

    const dayKey = cycleId(later, "daily");
    await db.expedition.create({
      data: {
        id: randomUUID(),
        guildId,
        userId: "explorer",
        regionSlug: "black-docks",
        difficulty: "severe",
        status: "resolved",
        deadline: later,
        cooldownUntil: later,
        dayKey,
        reservedItemIds: [],
        rules: {},
        report: {},
        grantedXp: 350,
        rewardsPosted: true,
        idempotencyKey: "spent-xp",
      },
    });
    const secondAt = new Date(later.getTime() + 16 * 60 * 1000);
    const second = await startExpedition(db, { guildId, userId: "explorer", regionSlug: "backstreets", difficulty: "routine", idempotencyKey: "run-2", now: secondAt, packets: win, lootRoll: 1 });
    expect(second.result).toBe("ready");
    if (second.result !== "ready") {
      return;
    }
    const secondDone = new Date(secondAt.getTime() + 11 * 60 * 1000);
    expect(await completeDueExpeditions(db, secondDone)).toMatchObject({ completed: 1 });
    expect(await db.expedition.findUnique({ where: { id: second.expeditionId } })).toMatchObject({ grantedXp: 10, grantedMarks: 8 });
    expect(await db.gearInstance.count({ where: { guildId, userId: "explorer", provenance: "expedition", name: "Field Knife" } })).toBe(1);
    expect(await db.ledgerEntry.count({ where: { guildId, idempotencyKey: exploreAssignment.assignment.rewardKey } })).toBe(1);

    expect(await chooseClass(db, { guildId, userId: "capped", classSlug: "hitman", now })).toMatchObject({ result: "chosen" });
    const full = BigInt(routineMonthlyMarks().routineMarks) * 100n;
    await db.issuanceBudget.create({ data: { guildId, scope: "member_routine", periodKey: "2026-10", subjectId: "capped", authorizedMinor: full, spentMinor: full } });
    const capped = await startExpedition(db, { guildId, userId: "capped", regionSlug: "backstreets", difficulty: "routine", idempotencyKey: "capped-run", now, packets: win, lootRoll: 1 });
    expect(capped.result).toBe("ready");
    if (capped.result !== "ready") {
      return;
    }
    expect(await completeDueExpeditions(db, later)).toMatchObject({ completed: 1 });
    expect(await db.expedition.findUnique({ where: { id: capped.expeditionId } })).toMatchObject({ marksResult: "capped", grantedMarks: 0, grantedXp: 40 });
    expect(await db.ledgerEntry.count({ where: { guildId, userId: "capped", idempotencyKey: `expedition-marks:${capped.expeditionId}` } })).toBe(0);

    const opened = await rollSeason(db, { guildId, now: later, actorUserId: "owner", reason: "Open the season" });
    expect(opened.result).toBe("not_due");
    if (opened.result !== "not_due") {
      return;
    }
    const rolled = await rollSeason(db, { guildId, now: opened.endsAt, actorUserId: "owner", reason: "Close the season" });
    expect(rolled.result).toBe("rolled");
    if (rolled.result === "rolled") {
      expect(rolled.preservation.regionUnlocks).toEqual({ status: "retained", retained: true });
    }
    expect(await db.expedition.findUnique({ where: { id: first.expeditionId } })).toMatchObject({ regionSlug: "backstreets" });
    expect(await db.worldRegion.count({ where: { guildId } })).toBe(3);
  });
});
