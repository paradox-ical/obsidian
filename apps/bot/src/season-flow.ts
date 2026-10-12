import {
  cancelPoll,
  claimRoom,
  closeRoom,
  controlRoom,
  createPoll,
  createRoom,
  noteRoomPresence,
  readLeaderboard,
  readPollResults,
  readSeasonArchive,
  setRoomHold,
  votePoll,
  type PrismaClient,
} from "@collective/db";

export interface SeasonCommand {
  name: string;
  subcommand?: string;
  options: Record<string, string | boolean | number>;
  guildId: string;
  userId: string;
  roleIds: string[];
  now: Date;
}

export async function runLeaderboardCommand(db: PrismaClient, command: SeasonCommand): Promise<{ content: string }> {
  const category = stringOption(command, "category") || "community_xp";
  if (command.subcommand === "archive") {
    const seasonId = stringOption(command, "season");
    if (!seasonId) {
      return { content: "Name the archived season." };
    }
    const archive = await readSeasonArchive(db, { guildId: command.guildId, seasonId, category, viewerId: command.userId });
    return { content: renderBoard(archive) };
  }
  const page = numberOption(command, "page") ?? 1;
  const board = await readLeaderboard(db, { guildId: command.guildId, category, page, viewerId: command.userId, now: command.now });
  return { content: renderBoard(board) };
}

export async function runPollCommand(db: PrismaClient, command: SeasonCommand): Promise<{ content: string }> {
  if (command.subcommand !== "polls") {
    return { content: "Game updates and community management are not built yet." };
  }
  const action = stringOption(command, "action");
  if (action === "create") {
    const created = await createPoll(db, {
      guildId: command.guildId,
      actorUserId: command.userId,
      actorRoleIds: command.roleIds,
      question: stringOption(command, "question"),
      choices: stringOption(command, "choice").split("|").map((choice) => choice.trim()),
      mode: stringOption(command, "kind") === "multiple" ? "multiple" : "single",
      kind: stringOption(command, "kind") === "suggestion" ? "suggestion" : "poll",
      anonymous: command.options["anonymous"] === true,
      eligibleRoleIds: stringOption(command, "role") ? [stringOption(command, "role")] : [],
      opensAt: command.now,
      closesAt: new Date(command.now.getTime() + 7 * 24 * 60 * 60 * 1000),
      now: command.now,
      reason: "Create a staff poll",
    });
    if (created.result === "created") {
      return { content: `Poll ${created.pollId} is ${created.status}. Suggestions are excluded. Voter eligibility is checked by the bot.` };
    }
    if (created.result === "excluded") {
      return { content: "Suggestions are excluded. No suggestion board or poll was created." };
    }
    if (created.result === "denied") {
      return { content: "Only staff can create polls. Nothing was saved." };
    }
    return { content: `Poll was not created: ${created.result}.` };
  }
  const pollId = stringOption(command, "poll");
  if (!pollId) {
    return { content: "Name the poll." };
  }
  if (action === "vote") {
    const voted = await votePoll(db, { guildId: command.guildId, pollId, userId: command.userId, roleIds: command.roleIds, choiceId: stringOption(command, "choice"), now: command.now });
    if (voted.result === "voted") {
      return { content: "Your vote was recorded." };
    }
    if (voted.result === "ineligible") {
      return { content: "You do not have a role that can vote in that poll." };
    }
    return { content: `Vote was not recorded: ${voted.result}.` };
  }
  if (action === "results") {
    const results = await readPollResults(db, { guildId: command.guildId, pollId, audience: "member" });
    if (results.result !== "ready") {
      return { content: "That poll was not found." };
    }
    const counts = results.counts.map((choice) => `${choice.label}: ${choice.count}`).join(", ");
    return { content: `${results.question} — ${counts}. ${results.retention}` };
  }
  if (action === "close") {
    const closed = await cancelPoll(db, { guildId: command.guildId, pollId, actorUserId: command.userId, actorRoleIds: command.roleIds, reason: "Cancel a staff poll", now: command.now });
    return { content: closed.result === "denied" ? "Only staff can cancel a poll." : `Poll status: ${closed.result}.` };
  }
  return { content: "That poll action is not available." };
}

export async function runRoomCommand(db: PrismaClient, command: SeasonCommand): Promise<{ content: string }> {
  const action = stringOption(command, "action");
  const roomId = stringOption(command, "room");
  if (action === "create") {
    const created = await createRoom(db, {
      guildId: command.guildId,
      userId: command.userId,
      kind: stringOption(command, "kind"),
      name: stringOption(command, "name"),
      privacy: "private",
      now: command.now,
    });
    if (created.result === "created") {
      return { content: `Room ${created.roomId} is ${created.privacy}. Channel delivery is ${created.channelState}. Creating a room has no reward.` };
    }
    return { content: `Room was not created: ${created.result}.` };
  }
  if (!roomId) {
    return { content: "Name the room." };
  }
  if (action === "join" || action === "leave") {
    const presence = await noteRoomPresence(db, { guildId: command.guildId, roomId, userId: command.userId, roleIds: command.roleIds, action, now: command.now });
    if (presence.result === "joined" || presence.result === "left") {
      return { content: `Room owner is ${presence.ownerUserId}.` };
    }
    return { content: `Room was not updated: ${presence.result}.` };
  }
  if (action === "close") {
    const closed = await closeRoom(db, { guildId: command.guildId, roomId, actorUserId: command.userId, actorRoleIds: command.roleIds, now: command.now });
    if (closed.result !== "closed") {
      return { content: `Room was not closed: ${closed.result}.` };
    }
    return { content: closed.warnDisconnect ? "The occupied voice room is closed. Disconnect delivery is setup_required until a bot token exists." : "The room is closed." };
  }
  if (action === "claim") {
    const claimed = await claimRoom(db, { guildId: command.guildId, roomId, actorUserId: command.userId, actorRoleIds: command.roleIds });
    return { content: claimed.result === "claimed" ? "You claimed the room." : `Claim was not applied: ${claimed.result}.` };
  }
  if (action === "hold") {
    const held = await setRoomHold(db, { guildId: command.guildId, roomId, reason: stringOption(command, "name") || "event", actorRoleIds: command.roleIds });
    return { content: held.result === "deferred" ? "Cleanup is deferred for an active mission." : "Ordinary events do not exempt a room from cleanup." };
  }
  if (action === "transfer" || action === "invite" || action === "lock" || action === "rename") {
    const updated = await controlRoom(db, {
      guildId: command.guildId,
      roomId,
      actorUserId: command.userId,
      actorRoleIds: command.roleIds,
      ...(action === "rename" ? { name: stringOption(command, "name") } : {}),
      ...(action === "lock" ? { locked: true } : {}),
      ...(action === "invite" ? { inviteUserId: stringOption(command, "member") } : {}),
      ...(action === "transfer" ? { transferUserId: stringOption(command, "member") } : {}),
    });
    return { content: updated.result === "updated" ? `Room owner is ${updated.ownerUserId}.` : `Room was not updated: ${updated.result}.` };
  }
  return { content: "That room action is not available." };
}

function renderBoard(board: { result: string; category?: string; availability?: string; label?: string | null; priceSensitive?: boolean; rows?: Array<{ position: number; userId: string; score: number }>; ownPosition?: number | null; retention?: string }): string {
  if (board.result === "invalid") {
    return "That leaderboard category is not available.";
  }
  if (board.result === "missing") {
    return "That season archive was not found.";
  }
  if (board.availability === "module_not_built") {
    if (board.label === "estimated") {
      return "Estimated wealth is not built yet. It would be labelled estimated and price-sensitive. No balance is shown.";
    }
    return `${board.category ?? "That"} rankings are not built yet. No balance is shown.`;
  }
  const lines = (board.rows ?? []).map((row) => `${row.position}. ${row.userId}: ${row.score}`);
  const own = board.ownPosition ? ` Your position is ${board.ownPosition}.` : "";
  return `${lines.join(" ") || "No standings yet."}${own}`;
}

function stringOption(command: SeasonCommand, name: string): string {
  const value = command.options[name];
  return typeof value === "string" ? value : "";
}

function numberOption(command: SeasonCommand, name: string): number | null {
  const value = command.options[name];
  return typeof value === "number" ? value : null;
}
