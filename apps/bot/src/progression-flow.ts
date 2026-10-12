import {
  correctInvite,
  listInviteHistory,
  readPrivatePreferences,
  readPublicDossier,
  removeBirthday,
  setBirthday,
  updateDossierPreferences,
  type PrismaClient,
} from "@collective/db";

export interface ProgressionCommand {
  name: string;
  subcommand?: string;
  options: Record<string, string | boolean | number>;
  guildId: string;
  userId: string;
  roleIds: string[];
  now: Date;
}

export async function runProgressionCommand(db: PrismaClient, command: ProgressionCommand): Promise<{ content: string }> {
  if (command.name === "rank") {
    const dossier = await readPublicDossier(db, command.guildId, command.userId);
    return { content: `Level ${dossier.level}, ${dossier.rankName ?? "unranked"}. ${marksLine(dossier.wallet)}` };
  }
  if (command.name === "profile" && command.subcommand === "dossier") {
    const member = stringOption(command, "member") || command.userId;
    const dossier = await readPublicDossier(db, command.guildId, member);
    const character = dossier.character.status === "ready" ? `${dossier.character.className} level ${dossier.character.level}.` : "No character yet.";
    return { content: `${dossier.rankName ?? "Unranked"} level ${dossier.level}. ${marksLine(dossier.wallet)} ${character}` };
  }
  if (command.name === "profile" && command.subcommand === "privacy") {
    const visibility = stringOption(command, "visibility");
    await updateDossierPreferences(db, { guildId: command.guildId, userId: command.userId, bioPublic: visibility === "public" });
    return { content: visibility === "public" ? "Your bio is public." : "Your bio is private. Marks balances stay public." };
  }
  if (command.name === "profile" && command.subcommand === "preferences") {
    await updateDossierPreferences(db, { guildId: command.guildId, userId: command.userId, bio: stringOption(command, "bio") });
    return { content: "Private preferences saved." };
  }
  if (command.name === "profile" && command.subcommand === "cosmetics") {
    await updateDossierPreferences(db, {
      guildId: command.guildId,
      userId: command.userId,
      frame: stringOption(command, "frame") || null,
      background: stringOption(command, "background") || null,
    });
    return { content: "Cosmetic labels saved. Equip character abilities with /character loadout." };
  }
  if (command.name === "birthday" && command.subcommand === "set") {
    const saved = await setBirthday(db, {
      guildId: command.guildId,
      userId: command.userId,
      month: numberOption(command, "month"),
      day: numberOption(command, "day"),
      year: command.options["year"] === undefined ? null : numberOption(command, "year"),
      timeZone: stringOption(command, "timezone") || "Australia/Perth",
      announce: command.options["announce"] === true,
      now: command.now,
    });
    return { content: saved.result === "cooldown" ? "That birthday edit is inside the cooldown." : `Birthday result: ${saved.result}.` };
  }
  if (command.name === "birthday" && command.subcommand === "privacy") {
    const current = await readPrivatePreferences(db, command.guildId, command.userId);
    if (!current.birthday?.month || !current.birthday.day) {
      return { content: "Set a birthday before changing its announcement." };
    }
    const saved = await setBirthday(db, {
      guildId: command.guildId,
      userId: command.userId,
      month: current.birthday.month,
      day: current.birthday.day,
      year: current.birthday.year,
      timeZone: "Australia/Perth",
      announce: command.options["announce"] === true,
      now: command.now,
    });
    return { content: saved.result === "cooldown" ? "That birthday edit is inside the cooldown." : "Birthday announcement updated." };
  }
  if (command.name === "birthday" && command.subcommand === "remove") {
    await removeBirthday(db, { guildId: command.guildId, userId: command.userId, now: command.now });
    return { content: "Birthday data removed." };
  }
  if (command.name === "birthday" && command.subcommand === "reminders") {
    return { content: "The annual gift is recorded for the ledger and is not paid until that ledger exists." };
  }
  if (command.name === "invites" && command.subcommand === "progress") {
    const history = await listInviteHistory(db, { guildId: command.guildId, actorUserId: command.userId, actorRoleIds: command.roleIds });
    if (history.result === "denied") {
      return { content: "Recruitment rewards are recorded once the seven-day check passes. Staff can inspect attribution." };
    }
    return { content: history.events.length === 0 ? "No invite events." : history.events.map((event) => `${event.confidence}${event.rejoin ? " rejoin" : ""}${event.suspicious ? " suspicious" : ""}`).join("\n") };
  }
  if (command.name === "invites" && command.subcommand === "attribution") {
    const confidence = stringOption(command, "confidence");
    if (confidence !== "known" && confidence !== "unknown" && confidence !== "vanity" && confidence !== "ambiguous") {
      return { content: "Confidence must be known, unknown, vanity, or ambiguous." };
    }
    const corrected = await correctInvite(db, {
      guildId: command.guildId,
      actorUserId: command.userId,
      actorRoleIds: command.roleIds,
      userId: stringOption(command, "member"),
      inviterUserId: confidence === "known" ? undefined : null,
      confidence,
      reason: stringOption(command, "reason"),
      now: command.now,
    });
    return { content: corrected.result === "denied" ? "You cannot correct invite attribution." : `Attribution result: ${corrected.result}.` };
  }
  return { content: "That progression control is not available on this command." };
}

function marksLine(wallet: { marks: { status: string; available?: string }; ingots: { status: string; available?: string } }): string {
  const marks = wallet.marks.status === "available" && wallet.marks.available ? `${wallet.marks.available} Marks` : wallet.marks.status;
  const ingots = wallet.ingots.status === "available" && wallet.ingots.available ? wallet.ingots.available : wallet.ingots.status;
  return `Marks ${marks}. Ingots ${ingots}.`;
}

function stringOption(command: ProgressionCommand, name: string): string {
  const value = command.options[name];
  return typeof value === "string" ? value : "";
}

function numberOption(command: ProgressionCommand, name: string): number {
  const value = command.options[name];
  return typeof value === "number" ? value : 0;
}
