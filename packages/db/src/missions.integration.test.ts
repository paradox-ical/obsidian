import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { chooseClass, changeClass } from "./characters.js";
import { createPrismaClient } from "./client.js";
import { mintGear, startQuickDuel, unequipGear } from "./combat.js";
import { assignContract, saveContractObjective } from "./contracts.js";
import { appointOfficer, createCrew } from "./gatherings.js";
import {
  actCrewMission,
  chooseMission,
  openCrewMission,
  readyCrewMission,
  resolveMissionCheck,
  resolveMissionCombat,
  startMission,
  sweepCrewMissions,
  useRecoveryMedkit,
} from "./missions.js";
import { grantCapability } from "./platform.js";
import { closeRoom, rollSeason } from "./seasons.js";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.");
}

const db = createPrismaClient(databaseUrl);
const guildId = `guild-${randomUUID()}`;
const now = new Date("2026-10-12T02:00:00.000Z");
const staff = ["staff"];
const win = Array.from({ length: 10 }, (_, index) => index % 2 === 0 ? { attack: 18, damage: [6] } : { attack: 1, damage: [1] });
const loss = [{ attack: 1, damage: [1] }, { attack: 18, damage: [20] }];

afterAll(async () => {
  await db.crewMissionMember.deleteMany({ where: { guildId } });
  await db.crewMission.deleteMany({ where: { guildId } });
  await db.missionRun.deleteMany({ where: { guildId } });
  await db.recovery.deleteMany({ where: { guildId } });
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
  await db.tempRoom.deleteMany({ where: { guildId } });
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
  await db.crewHistory.deleteMany({ where: { guildId } });
  await db.crewMember.deleteMany({ where: { guildId } });
  await db.crew.deleteMany({ where: { guildId } });
  await db.seasonArchive.deleteMany({ where: { guildId } });
  await db.seasonState.deleteMany({ where: { guildId } });
  await db.seasonSettings.deleteMany({ where: { guildId } });
  await db.ledgerEntry.deleteMany({ where: { guildId } });
  await db.wallet.deleteMany({ where: { guildId } });
  await db.issuanceBudget.deleteMany({ where: { guildId } });
  await db.auditRecord.deleteMany({ where: { guildId } });
  await db.capabilityGrant.deleteMany({ where: { guildId } });
  await db.featureFlag.deleteMany({ where: { guildId } });
  await db.outboxMessage.deleteMany({ where: { guildId } });
  await db.guild.deleteMany({ where: { guildId } });
  await db.$disconnect();
});

describe("interactive missions, crew missions, and recovery", () => {
  it("keeps unbanked loot, recovery, missed turns, and crew qualification", async () => {
    await grantCapability(db, { guildId, roleId: "staff", capability: "event_management", actorUserId: "owner", reason: "test" });
    expect(await chooseClass(db, { guildId, userId: "leader", classSlug: "hitman", now })).toMatchObject({ result: "chosen" });
    expect(await chooseClass(db, { guildId, userId: "mate", classSlug: "hitman", now })).toMatchObject({ result: "chosen" });
    const knife = await mintGear(db, { guildId, userId: "leader", templateSlug: "field-knife", idempotencyKey: "mission-knife" });
    const recoveryKit = await mintGear(db, { guildId, userId: "leader", templateSlug: "recovery-medkit", idempotencyKey: "recovery-kit" });
    const battleKit = await mintGear(db, { guildId, userId: "leader", templateSlug: "medkit", idempotencyKey: "battle-kit" });
    expect(knife.result).toBe("minted");
    expect(recoveryKit.result).toBe("minted");
    expect(battleKit.result).toBe("minted");
    if (knife.result !== "minted" || recoveryKit.result !== "minted" || battleKit.result !== "minted") {
      return;
    }
    const exploration = await saveContractObjective(db, { guildId, actorUserId: "owner", actorRoleIds: staff, title: "Walk a mission", prompt: "Finish one mission.", kind: "rpg_exploration", target: 1, rewardMarks: 10, now });
    const defeat = await saveContractObjective(db, { guildId, actorUserId: "owner", actorRoleIds: staff, title: "Win a mission", prompt: "Win one mission.", kind: "rpg_pve", target: 1, rewardMarks: 10, now });
    const crewObjective = await saveContractObjective(db, { guildId, actorUserId: "owner", actorRoleIds: staff, title: "Finish a crew mission", prompt: "Be eligible for one crew mission.", kind: "crew_session", target: 1, rewardMarks: 10, now });
    if (exploration.result !== "saved" || defeat.result !== "saved" || crewObjective.result !== "saved") {
      throw new Error("objective");
    }
    const exploreAssignment = await assignContract(db, { guildId, actorUserId: "owner", actorRoleIds: staff, userId: "leader", definitionId: exploration.objectiveId, board: "daily", now });
    const defeatAssignment = await assignContract(db, { guildId, actorUserId: "owner", actorRoleIds: staff, userId: "leader", definitionId: defeat.objectiveId, board: "daily", now });
    const crewAssignment = await assignContract(db, { guildId, actorUserId: "owner", actorRoleIds: staff, userId: "leader", definitionId: crewObjective.objectiveId, board: "daily", now });
    if (exploreAssignment.result !== "assigned" || defeatAssignment.result !== "assigned" || crewAssignment.result !== "assigned") {
      throw new Error("assign");
    }

    expect(await startMission(db, { guildId, userId: "leader", slug: "dock-signal", idempotencyKey: "too-low", now })).toMatchObject({ result: "level" });
    const opened = await startMission(db, { guildId, userId: "leader", slug: "yard-run", itemIds: [knife.itemId], notify: true, idempotencyKey: "yard-1", now });
    expect(opened.result).toBe("ready");
    if (opened.result !== "ready") {
      return;
    }
    expect(opened.nodeId).toBe("gate");
    expect(await unequipGear(db, { guildId, userId: "leader", itemId: knife.itemId })).toMatchObject({ result: "locked" });
    expect(await changeClass(db, { guildId, userId: "leader", classSlug: "bruiser", now })).toMatchObject({ result: "locked" });
    expect(await startQuickDuel(db, { guildId, userId: "leader", opponentSlug: "training-dummy", idempotencyKey: "during-mission", now })).toMatchObject({ result: "locked" });
    expect(await db.gearInstance.findUnique({ where: { id: knife.itemId } })).toMatchObject({ lock: "mission", destroyed: false });
    const again = await db.missionRun.findUnique({ where: { id: opened.missionId } });
    expect(again?.nodeId).toBe("gate");

    expect(await chooseMission(db, { guildId, userId: "leader", choiceId: "alley", now })).toMatchObject({ result: "ready", waiting: "check" });
    expect(await resolveMissionCheck(db, { guildId, userId: "leader", roll: 1, now })).toMatchObject({ result: "ready", waiting: "combat" });
    const failed = await resolveMissionCombat(db, { guildId, userId: "leader", packets: loss, now });
    expect(failed.result).toBe("ready");
    if (failed.result !== "ready") {
      return;
    }
    expect(failed.status).toBe("failed");
    expect(await db.gearInstance.count({ where: { guildId, provenance: "mission" } })).toBe(0);
    expect(await db.gearInstance.findUnique({ where: { id: knife.itemId } })).toMatchObject({ lock: "", destroyed: false });
    expect(await db.ledgerEntry.count({ where: { guildId, userId: "leader", source: "mission" } })).toBe(0);
    const recovery = await db.recovery.findUnique({ where: { guildId_userId: { guildId, userId: "leader" } } });
    expect(recovery?.until.getTime()).toBe(now.getTime() + 30 * 60 * 1000);
    expect(await useRecoveryMedkit(db, { guildId, userId: "leader", now })).toMatchObject({ result: "shortened" });
    expect(await useRecoveryMedkit(db, { guildId, userId: "leader", now })).toMatchObject({ result: "used" });
    expect(await db.gearInstance.findUnique({ where: { id: recoveryKit.itemId } })).toMatchObject({ destroyed: true });
    expect(await db.gearInstance.findUnique({ where: { id: battleKit.itemId } })).toMatchObject({ destroyed: false, abilitySlug: "patch" });
    expect((await db.recovery.findUnique({ where: { guildId_userId: { guildId, userId: "leader" } } }))?.until.getTime()).toBe(now.getTime() + 15 * 60 * 1000);

    const later = new Date(now.getTime() + 16 * 60 * 1000);
    const second = await startMission(db, { guildId, userId: "leader", slug: "yard-run", idempotencyKey: "yard-2", now: later });
    expect(second.result).toBe("ready");
    if (second.result !== "ready") {
      return;
    }
    expect(await chooseMission(db, { guildId, userId: "leader", choiceId: "alley", now: later })).toMatchObject({ waiting: "check" });
    expect(await resolveMissionCheck(db, { guildId, userId: "leader", roll: 20, now: later })).toMatchObject({ waiting: "choice", nodeId: "press" });
    expect(await chooseMission(db, { guildId, userId: "leader", choiceId: "captain", now: later })).toMatchObject({ waiting: "combat" });
    const won = await resolveMissionCombat(db, { guildId, userId: "leader", packets: win, now: later });
    expect(won).toMatchObject({ result: "ready", status: "won" });
    expect(await resolveMissionCombat(db, { guildId, userId: "leader", packets: win, now: later })).toMatchObject({ result: "missing" });
    expect(await db.gearInstance.count({ where: { guildId, userId: "leader", provenance: "mission", name: "Bandage" } })).toBe(1);
    expect(await db.characterXpEvent.count({ where: { idempotencyKey: `mission-xp:${second.missionId}` } })).toBe(1);
    expect(await db.ledgerEntry.count({ where: { idempotencyKey: `mission-marks:${second.missionId}` } })).toBe(1);
    expect(await db.contractAssignment.findUnique({ where: { id: exploreAssignment.assignment.id } })).toMatchObject({ status: "completed", payoutMarks: 10 });
    expect(await db.contractAssignment.findUnique({ where: { id: defeatAssignment.assignment.id } })).toMatchObject({ status: "completed", payoutMarks: 10 });

    const roofAt = new Date(later.getTime() + 60 * 1000);
    const roof = await startMission(db, { guildId, userId: "leader", slug: "yard-run", idempotencyKey: "yard-3", now: roofAt });
    expect(roof.result).toBe("ready");
    if (roof.result !== "ready") {
      return;
    }
    const loft = await chooseMission(db, { guildId, userId: "leader", choiceId: "roof", now: roofAt });
    expect(loft).toMatchObject({ waiting: "combat", nodeId: "captain" });
    if (loft.result === "ready") {
      expect(loft.log.join(" ")).toContain("does not raise the level gate");
    }
    expect(await db.missionRun.findUnique({ where: { id: roof.missionId } })).toMatchObject({ unbanked: ["maul"] });
    expect(await resolveMissionCombat(db, { guildId, userId: "leader", packets: win, now: roofAt })).toMatchObject({ status: "won" });
    expect(await db.gearInstance.count({ where: { guildId, userId: "leader", name: "Maul" } })).toBe(0);
    expect(await db.gearInstance.count({ where: { guildId, userId: "leader", provenance: "mission", name: "Bandage" } })).toBe(1);
    expect(await db.ledgerEntry.count({ where: { idempotencyKey: exploreAssignment.assignment.rewardKey } })).toBe(1);

    const retreatAt = new Date(roofAt.getTime() + 60 * 1000);
    expect(await startMission(db, { guildId, userId: "leader", slug: "yard-run", idempotencyKey: "yard-4", now: retreatAt })).toMatchObject({ result: "ready" });
    expect(await chooseMission(db, { guildId, userId: "leader", choiceId: "leave", now: retreatAt })).toMatchObject({ status: "retreated" });
    expect(await db.recovery.findUnique({ where: { guildId_userId: { guildId, userId: "leader" } } })).toMatchObject({ source: "mission" });

    const crew = await createCrew(db, { guildId, name: "Lamp", game: "", platform: "", region: "", rewardMarks: 0, actorUserId: "leader", now });
    if (crew.result !== "created") {
      throw new Error(crew.result);
    }
    expect(await appointOfficer(db, { guildId, crewId: crew.crew.id, userId: "mate", actorUserId: "leader", actorRoleIds: [], now })).toMatchObject({ result: "appointed" });
    const docks = await openCrewMission(db, { guildId, crewId: crew.crew.id, userId: "leader", regionSlug: "black-docks", difficulty: "routine", mode: "async", now: retreatAt });
    expect(docks.result).toBe("ready");
    if (docks.result !== "ready") {
      return;
    }
    expect(docks.rules).toContain("No energy");
    expect(await readyCrewMission(db, { guildId, missionId: docks.missionId, userId: "leader", now: retreatAt })).toMatchObject({ result: "level" });
    const crewAt = new Date(retreatAt.getTime() + 6 * 60 * 60 * 1000);
    await sweepCrewMissions(db, crewAt);
    expect(await db.crewMission.findUnique({ where: { id: docks.missionId } })).toMatchObject({ status: "abandoned" });

    const streets = await openCrewMission(db, { guildId, crewId: crew.crew.id, userId: "leader", regionSlug: "backstreets", difficulty: "routine", mode: "async", now: crewAt });
    expect(streets.result).toBe("ready");
    if (streets.result !== "ready") {
      return;
    }
    expect(await readyCrewMission(db, { guildId, missionId: streets.missionId, userId: "leader", now: crewAt })).toMatchObject({ result: "ready", status: "forming" });
    const started = await readyCrewMission(db, { guildId, missionId: streets.missionId, userId: "mate", now: crewAt });
    expect(started).toMatchObject({ result: "ready", status: "active" });
    if (started.result !== "ready" || started.status !== "active") {
      return;
    }
    expect(started.roomId).not.toBe("");
    let turn = "leader";
    let crewStatus = "active";
    for (let step = 0; step < 6 && crewStatus !== "won"; step += 1) {
      const acted = await actCrewMission(db, { guildId, missionId: streets.missionId, userId: turn, action: "strike", packet: { attack: 18, damage: [6] }, enemyPacket: { attack: 1, damage: [1] }, lootRoll: 1, now: new Date(crewAt.getTime() + step * 1000) });
      if ("status" in acted && acted.status === "won") {
        crewStatus = "won";
      }
      turn = turn === "leader" ? "mate" : "leader";
    }
    expect(crewStatus).toBe("won");
    expect(await actCrewMission(db, { guildId, missionId: streets.missionId, userId: "leader", action: "strike", lootRoll: 1, now: crewAt })).toMatchObject({ result: "missing" });
    expect(await db.gearInstance.count({ where: { guildId, provenance: "mission", name: "Field Knife" } })).toBe(2);
    expect(await db.ledgerEntry.count({ where: { idempotencyKey: `crew-marks:${streets.missionId}:leader` } })).toBe(1);
    expect(await db.contractAssignment.findUnique({ where: { id: crewAssignment.assignment.id } })).toMatchObject({ status: "completed", payoutMarks: 10 });
    expect(await db.tempRoom.findUnique({ where: { id: started.roomId } })).toMatchObject({ status: "open", channelState: "pending" });
    expect(await closeRoom(db, { guildId, roomId: started.roomId, actorUserId: "leader", actorRoleIds: [], now: crewAt })).toMatchObject({ result: "closed" });

    const liveAt = new Date(crewAt.getTime() + 11 * 60 * 1000);
    const downed = await openCrewMission(db, { guildId, crewId: crew.crew.id, userId: "leader", regionSlug: "backstreets", difficulty: "routine", mode: "live", now: liveAt });
    if (downed.result !== "ready") {
      throw new Error(downed.result);
    }
    await readyCrewMission(db, { guildId, missionId: downed.missionId, userId: "leader", now: liveAt });
    await readyCrewMission(db, { guildId, missionId: downed.missionId, userId: "mate", now: liveAt });
    expect(await actCrewMission(db, { guildId, missionId: downed.missionId, userId: "leader", action: "strike", packet: { attack: 18, damage: [6] }, enemyPacket: { attack: 18, damage: [20] }, now: liveAt })).toMatchObject({ result: "ready" });
    expect(await actCrewMission(db, { guildId, missionId: downed.missionId, userId: "mate", action: "revive", targetUserId: "leader", now: liveAt })).toMatchObject({ result: "revived" });
    expect(await actCrewMission(db, { guildId, missionId: downed.missionId, userId: "leader", action: "revive", targetUserId: "mate", now: liveAt })).toMatchObject({ result: "missing" });
    expect(await db.crewMissionMember.findUnique({ where: { missionId_userId: { missionId: downed.missionId, userId: "leader" } } })).toMatchObject({ downed: false, revivesUsed: 1 });

    const quiet = await createCrew(db, { guildId, name: "Quiet", game: "", platform: "", region: "", rewardMarks: 0, actorUserId: "leader", now: liveAt });
    if (quiet.result !== "created") {
      throw new Error(quiet.result);
    }
    await appointOfficer(db, { guildId, crewId: quiet.crew.id, userId: "mate", actorUserId: "leader", actorRoleIds: [], now: liveAt });
    const stalled = await openCrewMission(db, { guildId, crewId: quiet.crew.id, userId: "leader", regionSlug: "backstreets", difficulty: "routine", mode: "async", now: liveAt });
    if (stalled.result !== "ready") {
      throw new Error(stalled.result);
    }
    const abandonedAt = new Date(liveAt.getTime() + 6 * 60 * 60 * 1000);
    expect(await sweepCrewMissions(db, abandonedAt)).toMatchObject({ advanced: expect.any(Number) });
    expect(await db.crewMission.findUnique({ where: { id: stalled.missionId } })).toMatchObject({ status: "abandoned" });
    expect(await db.gearInstance.count({ where: { guildId, provenance: "mission", name: "Field Knife" } })).toBe(2);

    const missedCrew = await createCrew(db, { guildId, name: "Late", game: "", platform: "", region: "", rewardMarks: 0, actorUserId: "leader", now: abandonedAt });
    if (missedCrew.result !== "created") {
      throw new Error(missedCrew.result);
    }
    await appointOfficer(db, { guildId, crewId: missedCrew.crew.id, userId: "mate", actorUserId: "leader", actorRoleIds: [], now: abandonedAt });
    const missed = await openCrewMission(db, { guildId, crewId: missedCrew.crew.id, userId: "leader", regionSlug: "backstreets", difficulty: "routine", mode: "async", now: abandonedAt });
    if (missed.result !== "ready") {
      throw new Error(missed.result);
    }
    await readyCrewMission(db, { guildId, missionId: missed.missionId, userId: "leader", now: abandonedAt });
    const missedStart = await readyCrewMission(db, { guildId, missionId: missed.missionId, userId: "mate", now: abandonedAt });
    expect(missedStart).toMatchObject({ status: "active" });
    if (missedStart.result !== "ready" || missedStart.status !== "active") {
      return;
    }
    for (let step = 1; step <= 4; step += 1) {
      await sweepCrewMissions(db, new Date(abandonedAt.getTime() + step * 30 * 60 * 1000));
    }
    expect(await db.crewMission.findUnique({ where: { id: missed.missionId } })).toMatchObject({ status: "failed" });
    expect(await db.crewMissionMember.findFirst({ where: { missionId: missed.missionId, userId: "leader" } })).toMatchObject({ eligible: false });
    expect(await db.ledgerEntry.count({ where: { idempotencyKey: `crew-marks:${missed.missionId}:leader` } })).toBe(0);
    expect(await db.tempRoom.findUnique({ where: { id: missedStart.roomId } })).toMatchObject({ status: "open" });
    const roomOwner = await db.tempRoom.findUnique({ where: { id: missedStart.roomId } });
    await db.crewMission.update({ where: { id: missed.missionId }, data: { status: "active", granted: false, abandonAt: abandonedAt } });
    expect(await sweepCrewMissions(db, abandonedAt)).toMatchObject({ advanced: expect.any(Number) });
    expect(await db.tempRoom.findUnique({ where: { id: missedStart.roomId } })).toMatchObject({ status: "closed" });
    expect(roomOwner?.ownerUserId).toBe("leader");

    const openedSeason = await rollSeason(db, { guildId, now: abandonedAt, actorUserId: "owner", reason: "Open the season" });
    expect(openedSeason.result).toBe("not_due");
    if (openedSeason.result !== "not_due") {
      return;
    }
    const rolled = await rollSeason(db, { guildId, now: openedSeason.endsAt, actorUserId: "owner", reason: "Close the season" });
    expect(rolled.result).toBe("rolled");
    if (rolled.result === "rolled") {
      expect(rolled.preservation.missionState).toEqual({ status: "retained", retained: true });
    }
    expect(await db.missionRun.findUnique({ where: { id: second.missionId } })).toMatchObject({ status: "won" });
  });
});
