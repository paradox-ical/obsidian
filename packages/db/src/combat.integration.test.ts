import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "./client.js";
import { changeClass, chooseClass, grantCharacterXp } from "./characters.js";
import {
  actInBattle,
  equipGear,
  expireBattleTurns,
  inspectGearTransfer,
  mintGear,
  readBattle,
  saveGearTemplate,
  startQuickDuel,
  startTacticalDuel,
  unequipGear,
} from "./combat.js";
import { fundExceptional, issueMarks } from "./ledger.js";
import { grantCapability } from "./platform.js";
import { rollSeason } from "./seasons.js";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.");
}

const db = createPrismaClient(databaseUrl);
const guildId = `guild-${randomUUID()}`;
const now = new Date("2026-10-11T06:00:00.000Z");
const staff = ["staff"];

afterAll(async () => {
  await db.battleAction.deleteMany({ where: { guildId } });
  await db.battleRoll.deleteMany({ where: { guildId } });
  await db.battle.deleteMany({ where: { guildId } });
  await db.gearInstance.deleteMany({ where: { guildId } });
  await db.gearTemplate.deleteMany({ where: { guildId } });
  await db.testOpponent.deleteMany({ where: { guildId } });
  await db.job.deleteMany({ where: { guildId } });
  await db.characterReward.deleteMany({ where: { guildId } });
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
  await db.economySettings.deleteMany({ where: { guildId } });
  await db.auditRecord.deleteMany({ where: { guildId } });
  await db.capabilityGrant.deleteMany({ where: { guildId } });
  await db.featureFlag.deleteMany({ where: { guildId } });
  await db.guild.deleteMany({ where: { guildId } });
  await db.$disconnect();
});

describe("gear and combat", () => {
  it("locks gear, hides unrevealed rolls, and keeps a stored duel across a later read", async () => {
    await grantCapability(db, { guildId, roleId: "staff", capability: "content_management", actorUserId: "owner", reason: "test" });
    await grantCapability(db, { guildId, roleId: "staff", capability: "economy_operations", actorUserId: "owner", reason: "test" });
    expect(await chooseClass(db, { guildId, userId: "duelist", classSlug: "hitman", now })).toMatchObject({ result: "chosen" });
    const knife = await mintGear(db, { guildId, userId: "duelist", templateSlug: "field-knife", affixes: [{ slug: "keen", stat: "accuracy", amount: 2 }], idempotencyKey: "knife" });
    expect(knife.result).toBe("minted");
    if (knife.result !== "minted") {
      return;
    }
    expect(await mintGear(db, { guildId, userId: "duelist", templateSlug: "field-knife", affixes: [{ slug: "keen", stat: "accuracy", amount: 3 }], idempotencyKey: "too-keen" })).toMatchObject({ result: "out_of_range" });
    const revolver = await mintGear(db, { guildId, userId: "duelist", templateSlug: "custom-revolver", idempotencyKey: "revolver" });
    const rifle = await mintGear(db, { guildId, userId: "duelist", templateSlug: "suppressed-rifle", idempotencyKey: "rifle" });
    expect(revolver.result).toBe("minted");
    expect(rifle.result).toBe("minted");
    if (revolver.result !== "minted" || rifle.result !== "minted") {
      return;
    }
    expect(await equipGear(db, { guildId, userId: "duelist", itemId: revolver.itemId })).toMatchObject({ result: "class" });
    expect(await equipGear(db, { guildId, userId: "duelist", itemId: rifle.itemId })).toMatchObject({ result: "level" });
    expect(await equipGear(db, { guildId, userId: "duelist", itemId: knife.itemId })).toMatchObject({ result: "equipped" });
    expect(await mintGear(db, { guildId, userId: "duelist", templateSlug: "medkit", idempotencyKey: "medkit" })).toMatchObject({ result: "minted" });

    const quickKey = "quick-once";
    const first = await startQuickDuel(db, { guildId, userId: "duelist", opponentSlug: "training-dummy", idempotencyKey: quickKey, now });
    const second = await startQuickDuel(db, { guildId, userId: "duelist", opponentSlug: "training-dummy", idempotencyKey: quickKey, now });
    expect(first.result).toBe("ready");
    expect(second.result).toBe("ready");
    if (first.result !== "ready" || second.result !== "ready") {
      return;
    }
    expect(first.battleId).toBe(second.battleId);
    expect(first.fighters[0]).toMatchObject({ accuracyStat: 0, accuracyGear: 2 });
    expect(await db.battle.count({ where: { guildId, idempotencyKey: quickKey } })).toBe(1);
    const rollsAfterRetry = await db.battleRoll.count({ where: { battleId: first.battleId } });
    expect(rollsAfterRetry).toBeGreaterThan(0);
    expect(await db.battleRoll.count({ where: { battleId: second.battleId } })).toBe(rollsAfterRetry);

    const tactical = await startTacticalDuel(db, { guildId, userId: "duelist", opponentSlug: "training-dummy", idempotencyKey: "tactical-once", now });
    expect(tactical.result).toBe("ready");
    if (tactical.result !== "ready") {
      return;
    }
    const memberView = await readBattle(db, { guildId, userId: "duelist", battleId: tactical.battleId, audience: "member" });
    const staffView = await readBattle(db, { guildId, userId: "duelist", battleId: tactical.battleId, audience: "staff" });
    expect(memberView.result).toBe("ready");
    expect(staffView.result).toBe("ready");
    if (memberView.result !== "ready" || staffView.result !== "ready") {
      return;
    }
    expect(memberView.rolls.some((roll) => roll.purpose === "opponent-attack")).toBe(false);
    expect(staffView.rolls.some((roll) => roll.purpose === "opponent-attack" && roll.revealed === false)).toBe(true);
    expect(await unequipGear(db, { guildId, userId: "duelist", itemId: knife.itemId })).toMatchObject({ result: "locked" });
    expect(await inspectGearTransfer(db, { guildId, userId: "duelist", itemId: knife.itemId })).toMatchObject({ result: "locked" });
    expect(await db.gearInstance.findUnique({ where: { id: knife.itemId } })).toMatchObject({ lock: "combat", destroyed: false });

    const later = new Date(now.getTime() + 3 * 60 * 1000);
    expect(await expireBattleTurns(db, later)).toMatchObject({ expired: 1 });
    const afterTimeout = await readBattle(db, { guildId, userId: "duelist", battleId: tactical.battleId, audience: "staff" });
    expect(afterTimeout.result).toBe("ready");
    if (afterTimeout.result !== "ready") {
      return;
    }
    expect(afterTimeout.log.filter((line) => line.includes("defends")).length).toBe(1);
    expect(await expireBattleTurns(db, later)).toMatchObject({ expired: 0 });
    const reread = await readBattle(db, { guildId, userId: "duelist", battleId: tactical.battleId, audience: "member" });
    expect(reread.result).toBe("ready");
    if (reread.result !== "ready") {
      return;
    }
    expect(reread.log).toEqual(afterTimeout.log);

    const itemTurn = await actInBattle(db, { guildId, userId: "duelist", battleId: tactical.battleId, move: "item", idempotencyKey: "item-0", now: new Date(later.getTime() + 1000) });
    expect(itemTurn.result).toBe("ready");
    if (itemTurn.result !== "ready") {
      return;
    }
    const member = itemTurn.fighters[0];
    expect(member).toBeDefined();
    if (!member || !("maxHealth" in member)) {
      return;
    }
    expect(member.health).toBeLessThanOrEqual(member.maxHealth);
    expect(itemTurn.log.some((line) => line.includes("restores"))).toBe(true);
    const repeated = await actInBattle(db, { guildId, userId: "duelist", battleId: tactical.battleId, move: "strike", idempotencyKey: "item-0", now: later });
    expect(repeated.result).toBe("ready");
    expect(await db.battleAction.count({ where: { idempotencyKey: "item-0" } })).toBe(1);

    expect(await changeClass(db, { guildId, userId: "duelist", classSlug: "bruiser", now: later })).toMatchObject({ result: "locked" });
    let status = itemTurn.status;
    for (let step = 0; status === "active" && step < 24; step += 1) {
      const acted = await actInBattle(db, { guildId, userId: "duelist", battleId: tactical.battleId, move: "strike", idempotencyKey: `strike-${step}`, now: new Date(later.getTime() + 2_000 + step * 1000) });
      expect(acted.result).toBe("ready");
      if (acted.result === "ready") {
        status = acted.status;
      }
    }
    expect(status).toBe("resolved");
    expect(await unequipGear(db, { guildId, userId: "duelist", itemId: knife.itemId })).toMatchObject({ result: "unequipped" });
    expect(await db.gearInstance.findUnique({ where: { id: knife.itemId } })).toMatchObject({ equipped: false, destroyed: false, lock: "" });

    const template = await db.gearTemplate.findFirst({ where: { guildId, slug: "field-knife" } });
    expect(await saveGearTemplate(db, { guildId, actorUserId: "owner", actorRoleIds: staff, templateId: template?.id ?? "", summary: "A shared knife with a revised note.", level: 1, classSlug: "", affixMax: 1 })).toMatchObject({ result: "saved", version: 2 });
    expect(await db.gearInstance.findUnique({ where: { id: knife.itemId } })).toMatchObject({ affixes: [{ slug: "keen", stat: "accuracy", amount: 2 }], templateVersion: 1 });

    expect(await grantCharacterXp(db, { guildId, userId: "duelist", amount: 4_500, source: "contract", idempotencyKey: "levels", now: later })).toMatchObject({ level: 10 });
    expect(await equipGear(db, { guildId, userId: "duelist", itemId: rifle.itemId })).toMatchObject({ result: "equipped" });
    expect(await fundExceptional(db, { guildId, amountMarks: 15_000, idempotencyKey: "fund-class", reason: "Class change", actorUserId: "owner", actorRoleIds: staff, now: later })).toMatchObject({ result: "funded" });
    expect(await issueMarks(db, { guildId, userId: "duelist", amountMarks: 15_000, source: "character.test", sourceId: "class", pace: "exceptional", idempotencyKey: "issue-class", reason: "Class change", actorUserId: "owner", now: later })).toMatchObject({ result: "posted" });
    expect(await changeClass(db, { guildId, userId: "duelist", classSlug: "bruiser", now: new Date(later.getTime() + 60_000) })).toMatchObject({ result: "changed", level: 10 });
    expect(await db.gearInstance.findUnique({ where: { id: rifle.itemId } })).toMatchObject({ equipped: false, destroyed: false });
    expect(await inspectGearTransfer(db, { guildId, userId: "duelist", itemId: rifle.itemId })).toMatchObject({ result: "bound" });

    const opened = await rollSeason(db, { guildId, now: later, actorUserId: "owner", reason: "Open the season" });
    expect(opened.result).toBe("not_due");
    if (opened.result !== "not_due") {
      return;
    }
    const rolled = await rollSeason(db, { guildId, now: opened.endsAt, actorUserId: "owner", reason: "Close the season" });
    expect(rolled.result).toBe("rolled");
    expect(rolled.preservation.gear).toEqual({ status: "retained", retained: true });
    expect(await db.gearInstance.findUnique({ where: { id: knife.itemId } })).toMatchObject({ name: "Field Knife" });
  });
});
