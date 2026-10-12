import { randomUUID } from "node:crypto";

import { starterRewardKey } from "@collective/domain";
import { afterAll, describe, expect, it } from "vitest";

import {
  allocateStats,
  changeClass,
  chooseClass,
  clearCharacterCooldown,
  grantCharacterXp,
  introReset,
  lockGameplay,
  noteRankedDebut,
  readCharacter,
  readCharacterStaff,
  respecCharacter,
  retainHeldItem,
  saveCharacterCurve,
  setLoadout,
  unlockGameplay,
} from "./characters.js";
import { createPrismaClient } from "./client.js";
import { assignContract, noteContractSignal, saveContractObjective } from "./contracts.js";
import { fundExceptional, issueMarks } from "./ledger.js";
import { grantCapability } from "./platform.js";
import { recordActivityXp, recordChatActivity } from "./progression.js";
import { rollSeason } from "./seasons.js";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.");
}

const db = createPrismaClient(databaseUrl);
const guildId = `guild-${randomUUID()}`;
const now = new Date("2026-10-11T04:00:00.000Z");
const staff = ["staff"];

afterAll(async () => {
  await db.characterLoadoutSlot.deleteMany({ where: { guildId } });
  await db.characterReward.deleteMany({ where: { guildId } });
  await db.characterHeldItem.deleteMany({ where: { guildId } });
  await db.characterXpEvent.deleteMany({ where: { guildId } });
  await db.playerCharacter.deleteMany({ where: { guildId } });
  await db.classAbility.deleteMany({ where: { guildId } });
  await db.classDefinition.deleteMany({ where: { guildId } });
  await db.characterCurve.deleteMany({ where: { guildId } });
  await db.contractNotice.deleteMany({ where: { guildId } });
  await db.contractSubmission.deleteMany({ where: { guildId } });
  await db.contractAssignment.deleteMany({ where: { guildId } });
  await db.contractBoardSlot.deleteMany({ where: { guildId } });
  await db.contractRevision.deleteMany({ where: { guildId } });
  await db.contractDefinition.deleteMany({ where: { guildId } });
  await db.contractPreference.deleteMany({ where: { guildId } });
  await db.contractCursor.deleteMany({ where: { guildId } });
  await db.contractSettings.deleteMany({ where: { guildId } });
  await db.job.deleteMany({ where: { guildId } });
  await db.outboxMessage.deleteMany({ where: { guildId } });
  await db.seasonArchive.deleteMany({ where: { guildId } });
  await db.seasonState.deleteMany({ where: { guildId } });
  await db.seasonSettings.deleteMany({ where: { guildId } });
  await db.ledgerEntry.deleteMany({ where: { guildId } });
  await db.wallet.deleteMany({ where: { guildId } });
  await db.issuanceBudget.deleteMany({ where: { guildId } });
  await db.economySettings.deleteMany({ where: { guildId } });
  await db.rewardEvent.deleteMany({ where: { guildId } });
  await db.memberAchievement.deleteMany({ where: { guildId } });
  await db.memberProgression.deleteMany({ where: { guildId } });
  await db.progressionSettings.deleteMany({ where: { guildId } });
  await db.auditRecord.deleteMany({ where: { guildId } });
  await db.capabilityGrant.deleteMany({ where: { guildId } });
  await db.featureFlag.deleteMany({ where: { guildId } });
  await db.guild.deleteMany({ where: { guildId } });
  await db.$disconnect();
});

async function fund(userId: string, amount: number, key: string) {
  expect(await fundExceptional(db, { guildId, amountMarks: amount, idempotencyKey: `fund:${key}`, reason: "Character test", actorUserId: "owner", actorRoleIds: staff, now })).toMatchObject({ result: "funded" });
  expect(await issueMarks(db, { guildId, userId, amountMarks: amount, source: "character.test", sourceId: key, pace: "exceptional", idempotencyKey: `issue:${key}`, reason: "Character test", actorUserId: "owner", now })).toMatchObject({ result: "posted" });
}

describe("character progression", () => {
  it("keeps points, fees, gear, and cooldowns under races and class changes", async () => {
    for (const capability of ["economy_operations", "content_management", "event_management"] as const) {
      await grantCapability(db, { guildId, roleId: "staff", capability, actorUserId: "owner", reason: "test" });
    }
    expect(await recordActivityXp("event")).toMatchObject({ result: "module_not_built", xpGained: 0 });
    expect(await grantCharacterXp(db, { guildId, userId: "late", amount: 100, source: "contract", idempotencyKey: "late-xp", now })).toMatchObject({ result: "pending" });
    expect(await chooseClass(db, { guildId, userId: "late", classSlug: "fixer", now })).toMatchObject({ result: "chosen", level: 2, unspentPoints: 3 });

    expect(await chooseClass(db, { guildId, userId: "hero", classSlug: "hitman", now })).toMatchObject({ result: "chosen", level: 1, unspentPoints: 0 });
    const beforeChat = await readCharacter(db, guildId, "hero", now);
    expect(beforeChat.status).toBe("ready");
    await recordChatActivity(db, { guildId, userId: "hero", channelId: "lounge", content: "A long enough lounge message for community XP.", now });
    const afterChat = await readCharacter(db, guildId, "hero", now);
    expect(afterChat).toMatchObject({ status: "ready", level: 1, xp: 0, unspentPoints: 0, conservation: "conserved" });
    expect((await db.memberProgression.findUnique({ where: { guildId_userId: { guildId, userId: "hero" } } }))?.xp).toBeGreaterThan(0);

    const objective = await saveContractObjective(db, {
      guildId,
      actorUserId: "owner",
      actorRoleIds: staff,
      title: "Field note",
      prompt: "Send one message.",
      kind: "chat_messages",
      target: 1,
      rewardMarks: 0,
      characterXp: 1200,
      now,
    });
    expect(objective.result).toBe("saved");
    if (objective.result !== "saved") {
      return;
    }
    expect(await assignContract(db, { guildId, actorUserId: "owner", actorRoleIds: staff, userId: "hero", definitionId: objective.objectiveId, now })).toMatchObject({ result: "assigned" });
    await noteContractSignal(db, { guildId, userId: "hero", kind: "chat_messages", amount: 1, content: "The field note is complete and unique.", channelId: "lounge", now });
    await noteContractSignal(db, { guildId, userId: "hero", kind: "chat_messages", amount: 1, content: "A second field note does not pay again.", channelId: "lounge", now: new Date(now.getTime() + 60_000) });
    const progressed = await readCharacter(db, guildId, "hero", now);
    expect(progressed).toMatchObject({ status: "ready", level: 5, unspentPoints: 12, conservation: "conserved" });
    expect(await db.characterXpEvent.count({ where: { guildId, userId: "hero", source: "contract" } })).toBe(1);
    expect(await grantCharacterXp(db, { guildId, userId: "hero", amount: 1200, source: "contract", idempotencyKey: `${(await db.contractAssignment.findFirst({ where: { guildId, userId: "hero" } }))?.rewardKey}:character-xp`, now })).toMatchObject({ result: "already_recorded" });

    expect(await allocateStats(db, { guildId, userId: "hero", stat: "agility", points: 4, now })).toMatchObject({ result: "allocated", unspentPoints: 8 });
    expect(await setLoadout(db, { guildId, userId: "hero", slots: [{ kind: "class", slug: "headshot" }] })).toMatchObject({ result: "locked_ability" });
    expect(await setLoadout(db, { guildId, userId: "hero", slots: [{ kind: "class", slug: "precision-shot" }, { kind: "class", slug: "mark" }] })).toMatchObject({ result: "saved", slots: 2 });

    await fund("racer", 5_000, "respec-race");
    expect(await chooseClass(db, { guildId, userId: "racer", classSlug: "duelist", now })).toMatchObject({ result: "chosen" });
    expect(await grantCharacterXp(db, { guildId, userId: "racer", amount: 100, source: "contract", idempotencyKey: "racer-xp", now })).toMatchObject({ result: "granted" });
    expect(await allocateStats(db, { guildId, userId: "racer", stat: "strength", points: 2, now })).toMatchObject({ result: "allocated" });
    const race = await Promise.all([
      respecCharacter(db, { guildId, userId: "racer", now }),
      respecCharacter(db, { guildId, userId: "racer", now }),
    ]);
    expect(race.filter((item) => item.result === "respec")).toHaveLength(1);
    expect(race.filter((item) => item.result === "cooling" || item.result === "unaffordable")).toHaveLength(1);
    const reset = await readCharacter(db, guildId, "racer", new Date(now.getTime() + 86_400_000));
    expect(reset).toMatchObject({ status: "ready", level: 2, unspentPoints: 3, allocated: { strength: 0, agility: 0, endurance: 0, focus: 0 }, conservation: "conserved" });
    expect(reset.status === "ready" && reset.respecAvailableAt && reset.respecAvailableAt > now.toISOString()).toBe(true);
    expect(await respecCharacter(db, { guildId, userId: "racer", now: new Date(now.getTime() + 86_400_000) })).toMatchObject({ result: "cooling" });
    expect(await db.ledgerEntry.count({ where: { guildId, userId: "racer", source: "character.respec" } })).toBe(1);

    await fund("poor", 4_999, "poor");
    expect(await chooseClass(db, { guildId, userId: "poor", classSlug: "saboteur", now })).toMatchObject({ result: "chosen" });
    expect(await grantCharacterXp(db, { guildId, userId: "poor", amount: 100, source: "contract", idempotencyKey: "poor-xp", now })).toMatchObject({ result: "granted" });
    expect(await allocateStats(db, { guildId, userId: "poor", stat: "focus", points: 1, now })).toMatchObject({ result: "allocated" });
    expect(await respecCharacter(db, { guildId, userId: "poor", now })).toMatchObject({ result: "unaffordable" });
    expect(await readCharacter(db, guildId, "poor", now)).toMatchObject({ allocated: { focus: 1 }, respecAvailableAt: null, conservation: "conserved" });

    await fund("locked", 5_000, "locked");
    expect(await chooseClass(db, { guildId, userId: "locked", classSlug: "gunslinger", now })).toMatchObject({ result: "chosen" });
    expect(await lockGameplay(db, { guildId, userId: "locked", lock: "combat" })).toMatchObject({ result: "locked" });
    expect(await respecCharacter(db, { guildId, userId: "locked", now })).toMatchObject({ result: "locked" });
    expect(await db.ledgerEntry.count({ where: { guildId, userId: "locked", source: "character.respec" } })).toBe(0);
    expect(await unlockGameplay(db, { guildId, userId: "locked" })).toMatchObject({ result: "open" });

    await fund("switcher", 15_000, "class-race");
    expect(await chooseClass(db, { guildId, userId: "switcher", classSlug: "hitman", now })).toMatchObject({ result: "chosen" });
    expect(await grantCharacterXp(db, { guildId, userId: "switcher", amount: 4_500, source: "contract", idempotencyKey: "switcher-xp", now })).toMatchObject({ result: "granted", level: 10 });
    const rifle = await retainHeldItem(db, { guildId, userId: "switcher", name: "Suppressed rifle", classSlug: "hitman", abilitySlug: "suppressed-shot" });
    const knife = await retainHeldItem(db, { guildId, userId: "switcher", name: "Utility knife" });
    const switched = await Promise.all([
      changeClass(db, { guildId, userId: "switcher", classSlug: "bruiser", now }),
      changeClass(db, { guildId, userId: "switcher", classSlug: "fixer", now }),
    ]);
    expect(switched.filter((item) => item.result === "changed")).toHaveLength(1);
    expect(switched.filter((item) => item.result === "cooling")).toHaveLength(1);
    const moved = await readCharacter(db, guildId, "switcher", now);
    expect(moved.status).toBe("ready");
    if (moved.status !== "ready") {
      return;
    }
    expect(["bruiser", "fixer"]).toContain(moved.classSlug);
    expect(moved).toMatchObject({ level: 10, xp: 0, unspentPoints: 27, conservation: "conserved" });
    expect(await db.characterHeldItem.findUnique({ where: { id: rifle.itemId } })).toMatchObject({ equipped: false, destroyed: false });
    expect(await db.characterHeldItem.findUnique({ where: { id: knife.itemId } })).toMatchObject({ equipped: true, destroyed: false });
    expect(await db.characterReward.count({ where: { rewardKey: starterRewardKey(guildId, "switcher", "hitman") } })).toBe(1);
    await fund("switcher", 15_000, "class-return");
    expect(await clearCharacterCooldown(db, { guildId, actorUserId: "owner", actorRoleIds: staff, userId: "switcher", reason: "Correct the cooldown" })).toMatchObject({ result: "cleared" });
    expect(await db.auditRecord.count({ where: { guildId, action: "character.cooldown" } })).toBe(1);
    expect(await changeClass(db, { guildId, userId: "switcher", classSlug: "hitman", now: new Date(now.getTime() + 1_000) })).toMatchObject({ result: "changed", level: 10 });
    expect(await db.characterReward.count({ where: { rewardKey: starterRewardKey(guildId, "switcher", "hitman") } })).toBe(1);
    expect(await db.ledgerEntry.count({ where: { guildId, userId: "switcher", source: "character.class_change" } })).toBe(2);
    expect((await db.issuanceBudget.findMany({ where: { guildId, scope: "member_routine" } })).every((row) => row.spentMinor === 0n)).toBe(true);

    expect(await chooseClass(db, { guildId, userId: "intro", classSlug: "fixer", now })).toMatchObject({ result: "chosen" });
    expect(await introReset(db, { guildId, userId: "intro", classSlug: "duelist", now })).toMatchObject({ result: "reset", classSlug: "duelist" });
    expect(await introReset(db, { guildId, userId: "intro", now })).toMatchObject({ result: "used" });
    expect(await readCharacter(db, guildId, "intro", now)).toMatchObject({ respecAvailableAt: null, classChangeAvailableAt: null });
    expect(await chooseClass(db, { guildId, userId: "ranked", classSlug: "gunslinger", now })).toMatchObject({ result: "chosen" });
    expect(await noteRankedDebut(db, { guildId, userId: "ranked", now })).toMatchObject({ result: "noted" });
    expect(await introReset(db, { guildId, userId: "ranked", now })).toMatchObject({ result: "ranked" });
    expect(await chooseClass(db, { guildId, userId: "veteran", classSlug: "bruiser", now })).toMatchObject({ result: "chosen" });
    expect(await grantCharacterXp(db, { guildId, userId: "veteran", amount: 4_500, source: "contract", idempotencyKey: "veteran-xp", now })).toMatchObject({ result: "granted", level: 10 });
    expect(await introReset(db, { guildId, userId: "veteran", now })).toMatchObject({ result: "level" });

    const beforeCurve = await readCharacter(db, guildId, "hero", now);
    const defaults = await readCharacterStaff(db, guildId, now);
    expect(defaults.classes).toHaveLength(6);
    expect(defaults.simulation.level).toBe(50);
    expect(defaults.simulation.requiredXp).toBe(122_500);
    expect(await saveCharacterCurve(db, { guildId, actorUserId: "owner", actorRoleIds: staff, xpFactor: 200, sessionXp: 1200, sessionsPerWeek: 4 })).toMatchObject({ result: "saved", version: 2 });
    const staffView = await readCharacterStaff(db, guildId, now);
    expect(staffView.simulation.level).toBeLessThan(50);
    expect(staffView.simulation.requiredXp).toBe(245_000);
    expect(staffView.simulation.assumptions.join(" ")).toContain("Community chat awards no character XP");
    const afterCurve = await readCharacter(db, guildId, "hero", now);
    expect(afterCurve).toMatchObject({ level: beforeCurve.status === "ready" ? beforeCurve.level : 0, conservation: "conserved" });

    const opened = await rollSeason(db, { guildId, now, actorUserId: "owner", reason: "Open the season" });
    expect(opened.result).toBe("not_due");
    if (opened.result !== "not_due") {
      return;
    }
    const rolled = await rollSeason(db, { guildId, now: opened.endsAt, actorUserId: "owner", reason: "Close the season" });
    expect(rolled.result).toBe("rolled");
    expect(rolled.preservation.character).toEqual({ status: "retained", retained: true });
    expect(await db.playerCharacter.findUnique({ where: { guildId_userId: { guildId, userId: "hero" } } })).toMatchObject({ classSlug: "hitman" });
  });
});
