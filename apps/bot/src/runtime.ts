import {
  bindPanelPost,
  ensureGuild,
  deliverDuePublication,
  createPrismaClient,
  deliverRoleUpdate,
  expireDueGrant,
  panelPostForMessage,
  readCommunitySettings,
  openModulesForTesting,
  readFoundationRevision,
  routeInteraction,
  runJobOnce,
  runOutboxOnce,
  startWorkLoop,
  sweepExpiredGrants,
  sweepExpiredWarnings,
  sweepLogRetention,
  deliverModeration,
  expireSanction,
  expireWarning,
  retainLog,
  advanceTicketInactivity,
  deliverTicketChannel,
  retainTicket,
  sweepTicketInactivity,
  sweepTicketRetention,
  qualifyRecruitment,
  sweepBirthdays,
  sweepVoiceAccrual,
  cleanupRoom,
  closePoll,
  deliverRoomChannel,
  rollSeason,
  sweepPollClose,
  sweepRoomCleanup,
  sweepSeasonRollover,
  runAnnouncementSeries,
  sweepAnnouncementExpiry,
  sweepAnnouncements,
  sweepPins,
  deliverEventReminder,
  sweepEventSeries,
  closeDueContest,
  closeDueGiveaway,
  expireGiveawayClaim,
  lockDuePrediction,
  sweepActivities,
  sweepContractNotices,
  expireBattleTurns,
  completeDueExpeditions,
  sweepCrewMissions,
  sweepPvp,
  sweepWorkshop,
  sweepLottery,
  settleDraw,
  closeDeadDrop,
  deliverDeadDropReminder,
  sweepDeadDrop,
  closeBlackjackJoin,
  expireBlackjackTurn,
  sweepBlackjack,
} from "@collective/db";
import {
  createServiceHealthReport,
  loadEnv,
  publicEnvSummary,
  type DiscordHealth,
  type JobHealth,
} from "@collective/domain";
import pino from "pino";

import { runCommunityCommand, runCommunityComponent, runPanelReaction } from "./community-flow.js";
import { runModerationCommand } from "./moderation-flow.js";
import { runSupportCommand } from "./ticket-flow.js";
import { runProgressionCommand } from "./progression-flow.js";
import { runEconomyCommand, runStatsCommand } from "./economy-flow.js";
import { runMarketCommand } from "./market-flow.js";
import { runPublishCommand } from "./publish-flow.js";
import { runGatheringCommand } from "./gathering-flow.js";
import { runActivityCommand } from "./activity-flow.js";
import { characterPress, runCharacterCommand } from "./character-flow.js";
import { combatPress, runCombatCommand, runInventoryCommand } from "./combat-flow.js";
import { runHelpCommand, runReplyCommand, runSetupCommand } from "./desk-flow.js";
import { runShopCommand } from "./workshop-flow.js";
import { runLotteryCommand } from "./lottery-flow.js";
import { runDeadDropCommand } from "./dead-drop-flow.js";
import { runBlackjackCommand } from "./blackjack-flow.js";
import { runExploreCommand } from "./explore-flow.js";
import { runContractCommand } from "./contract-flow.js";
import { runLeaderboardCommand, runPollCommand } from "./season-flow.js";
import { startDiscordGateway, type DiscordConnection, type DiscordComponentRow } from "./discord.js";
import { startHealthServer } from "./http.js";
import { scrubSecrets } from "./redact.js";
import { customizeRow, followupRows, paginateReply, prepareExperience, type FollowupAction } from "./experience.js";
import { guideReply } from "./guide.js";
import { notificationPayload } from "./notifications.js";

export async function startRuntime(role: "bot" | "worker"): Promise<void> {
  const env = loadEnv();
  const logger = pino({ level: env.logLevel });
  logger.info({ role, env: publicEnvSummary(env) }, "starting process");

  const prisma = createPrismaClient(env.databaseUrl);
  let database: "ok" | "unavailable" = "unavailable";
  let foundationRevision: string | null = null;
  try {
    foundationRevision = await readFoundationRevision(prisma);
    database = "ok";
    const opened = await openModulesForTesting(prisma);
    logger.info({ foundationRevision, modulesOpened: opened, ownerStaff: env.ownerStaff }, "database foundation revision verified");
  } catch (error) {
    const message = scrubSecrets(error instanceof Error ? error.message : "database unavailable", [
      env.databaseUrl,
      env.discord.token,
      env.discord.clientSecret,
    ]);
    logger.error({ err: message }, "database check failed");
  }

  const secrets = [env.databaseUrl, env.discord.token, env.discord.clientSecret];
  let discord: DiscordConnection | null = null;
  let jobs: JobHealth = role === "bot" ? "not_applicable" : "unavailable";
  let stopWork: (() => void) | null = null;

  if (role === "bot") {
    discord = await startDiscordGateway({
      configured: env.discord.configured,
      ...(env.discord.token ? { token: env.discord.token } : {}),
      log: (message) => logger.info(scrubSecrets(message, secrets)),
      onPanelPosted: async (post) => {
        await bindPanelPost(prisma, post);
      },
      onGuilds: async (guilds) => {
        for (const guild of guilds) {
          if (!guild.ownerUserId) {
            continue;
          }
          const existing = await prisma.guild.findUnique({ where: { guildId: guild.guildId } });
          if (existing?.ownerUserId) {
            continue;
          }
          await ensureGuild(prisma, { guildId: guild.guildId, ownerUserId: guild.ownerUserId });
        }
      },
      onReaction: async (reaction) => {
        if (database !== "ok") {
          return;
        }
        const post = await panelPostForMessage(prisma, reaction.messageId);
        if (!post || post.guildId !== reaction.guildId) {
          return;
        }
        await runPanelReaction(prisma, {
          name: "roles",
          options: {},
          panelId: post.panelId,
          emoji: reaction.emoji,
          added: reaction.added,
          guildId: reaction.guildId,
          userId: reaction.userId,
          roleIds: reaction.roleIds,
          native: reaction.native,
          roles: reaction.roles,
          botHighestPosition: reaction.botHighestPosition,
          credentials: process.env,
          now: new Date(),
        });
      },
      onInteraction: async (event) => {
        if (!event.guildId || database !== "ok") {
          await event.reply("That action is unavailable.");
          return;
        }
        if (event.kind === "component" && event.name.startsWith("go:")) {
          const parts = event.name.split(":");
          event.kind = "command";
          event.name = parts[1] || "help";
          if (parts[2]) {
            event.subcommand = parts[2];
          }
          event.options = {};
        }
        if (event.kind === "component" && (event.name.startsWith("character:") || event.name.startsWith("combat:"))) {
          const parent = event.name.startsWith("character:") ? "character" : "combat";
          const pressed = parent === "character" ? characterPress(event.name) : combatPress(event.name);
          event.kind = "command"; event.name = parent; event.subcommand = pressed.subcommand;
          event.options = { ...event.options, ...pressed.options };
        }
        if (event.kind === "component" && event.name.startsWith("ticket:open:")) {
          event.options = { action: "open", category: event.name.slice("ticket:open:".length) };
          event.name = "support"; event.subcommand = "tickets"; event.kind = "command";
        }
        // Every response path shares navigation and pagination. Existing files,
        // role-panel bindings and reactions continue through untouched.
        const reply = event.reply;
        event.reply = async (content, extras) => {
          const normalized = extras && "bytes" in extras ? { file: extras } : extras;
          const guided = guideReply(event.name, content, normalized?.components);
          const customize = customizeRow(event.name, event.subcommand ?? "", event.options);
          const rows = [...(guided.rows ?? []), ...(customize ? [customize] : [])];
          const paged = await paginateReply(prisma, event, guided.body, rows);
          await reply(paged.content, { ...normalized, components: paged.rows });
        };
        event.setPresentation?.(event.name, event.subcommand);
        if (!await prepareExperience(prisma, event)) return;
        event.kind = event.name.includes(":") ? "component" : "command";
        event.setPresentation?.(event.name, event.subcommand);
        const selectedMember = event.options["member"];
        if (typeof selectedMember === "string" && event.resolveTarget) Object.assign(event, await event.resolveTarget(selectedMember));
        if (event.kind === "command" && event.name === "stats") {
          const stats = await runStatsCommand(prisma, {
            name: event.name,
            ...(event.subcommand ? { subcommand: event.subcommand } : {}),
            interactionId: event.interactionId,
            options: event.options,
            guildId: event.guildId,
            userId: event.userId,
            roleIds: event.roleIds,
            now: new Date(),
          });
          await event.reply(stats.content, await flowExtras(prisma, event, stats));
          return;
        }
        if (event.kind === "command" && event.name === "contracts") {
          const contracts = await runContractCommand(prisma, {
            ...(event.subcommand ? { subcommand: event.subcommand } : {}),
            options: event.options,
            guildId: event.guildId,
            userId: event.userId,
            roleIds: event.roleIds,
            now: new Date(),
          });
          await event.reply(contracts.content, await flowExtras(prisma, event, contracts));
          return;
        }
        if ((event.kind === "command" && event.name === "character") || (event.kind === "component" && event.name.startsWith("character:"))) {
          const pressed = event.kind === "component" ? characterPress(event.name) : null;
          const character = await runCharacterCommand(prisma, {
            ...((pressed?.subcommand ?? event.subcommand) ? { subcommand: pressed?.subcommand ?? event.subcommand } : {}),
            options: pressed ? { ...event.options, ...pressed.options } : event.options,
            guildId: event.guildId,
            userId: event.userId,
            now: new Date(),
          });
          await event.reply(character.content, character.components ? { components: character.components } : undefined);
          return;
        }
        if ((event.kind === "command" && event.name === "combat") || (event.kind === "component" && event.name.startsWith("combat:"))) {
          const pressed = event.kind === "component" ? combatPress(event.name) : null;
          const combat = await runCombatCommand(prisma, {
            ...((pressed?.subcommand ?? event.subcommand) ? { subcommand: pressed?.subcommand ?? event.subcommand } : {}),
            options: pressed ? { ...event.options, ...pressed.options } : event.options,
            guildId: event.guildId,
            userId: event.userId,
            now: new Date(),
          });
          await event.reply(combat.content, combat.components ? { components: combat.components } : undefined);
          return;
        }
        if (event.kind === "command" && event.name === "help") {
          const help = await runHelpCommand(prisma, {
            ...(event.subcommand ? { subcommand: event.subcommand } : {}),
            options: event.options,
            guildId: event.guildId,
            userId: event.userId,
            now: new Date(),
          });
          await event.reply(help.content, await flowExtras(prisma, event, help));
          return;
        }
        if (event.kind === "command" && event.name === "setup") {
          const setup = await runSetupCommand(prisma, {
            ...(event.subcommand ? { subcommand: event.subcommand } : {}),
            options: event.options,
            guildId: event.guildId,
            userId: event.userId,
            roleIds: event.roleIds,
            now: new Date(),
          });
          await event.reply(setup.content, await flowExtras(prisma, event, setup));
          return;
        }
        if (event.kind === "command" && event.name === "reply") {
          const reply = await runReplyCommand(prisma, {
            ...(event.subcommand ? { subcommand: event.subcommand } : {}),
            options: event.options,
            guildId: event.guildId,
            userId: event.userId,
            roleIds: event.roleIds,
          });
          await event.reply(reply.content, await flowExtras(prisma, event, reply));
          return;
        }
        if (event.kind === "command" && event.name === "inventory") {
          const inventory = await runInventoryCommand(prisma, {
            ...(event.subcommand ? { subcommand: event.subcommand } : {}),
            options: event.options,
            guildId: event.guildId,
            userId: event.userId,
            now: new Date(),
          });
          await event.reply(inventory.content, await flowExtras(prisma, event, inventory));
          return;
        }
        if (event.kind === "command" && event.name === "lottery") {
          const lottery = await runLotteryCommand(prisma, {
            ...(event.subcommand ? { subcommand: event.subcommand } : {}),
            options: event.options,
            guildId: event.guildId,
            userId: event.userId,
            now: new Date(),
          });
          await event.reply(lottery.content, await flowExtras(prisma, event, lottery));
          return;
        }
        if (event.kind === "command" && event.name === "deaddrop") {
          const deadDrop = await runDeadDropCommand(prisma, {
            ...(event.subcommand ? { subcommand: event.subcommand } : {}),
            options: event.options,
            guildId: event.guildId,
            userId: event.userId,
            roleIds: event.roleIds,
            now: new Date(),
          });
          await event.reply(deadDrop.content, await flowExtras(prisma, event, deadDrop));
          return;
        }
        if (event.kind === "command" && event.name === "blackjack") {
          const blackjack = await runBlackjackCommand(prisma, {
            ...(event.subcommand ? { subcommand: event.subcommand } : {}),
            options: event.options,
            guildId: event.guildId,
            userId: event.userId,
            now: new Date(),
          });
          await event.reply(blackjack.content, await flowExtras(prisma, event, blackjack));
          return;
        }
        if (event.kind === "command" && event.name === "shop") {
          const shop = await runShopCommand(prisma, {
            ...(event.subcommand ? { subcommand: event.subcommand } : {}),
            options: event.options,
            guildId: event.guildId,
            userId: event.userId,
            roleIds: event.roleIds,
            now: new Date(),
          });
          await event.reply(shop.content, await flowExtras(prisma, event, shop));
          return;
        }
        if (event.kind === "command" && (["prediction", "contest", "giveaway"].includes(event.name))) {
          const activity = await runActivityCommand(prisma, {
            name: event.name,
            ...(event.subcommand ? { subcommand: event.subcommand } : {}),
            options: event.options,
            guildId: event.guildId,
            userId: event.userId,
            roleIds: event.roleIds,
            now: new Date(),
          });
          await event.reply(activity.content, await flowExtras(prisma, event, activity));
          return;
        }
        if (event.kind === "command" && event.name === "explore" && event.subcommand !== "crew") {
          const explore = await runExploreCommand(prisma, {
            ...(event.subcommand ? { subcommand: event.subcommand } : {}),
            options: event.options,
            guildId: event.guildId,
            userId: event.userId,
            now: new Date(),
          });
          await event.reply(explore.content, await flowExtras(prisma, event, explore));
          return;
        }
        if (event.kind === "command" && (["events", "schedule", "crew"].includes(event.name) || (event.name === "explore" && event.subcommand === "crew"))) {
          const gathering = await runGatheringCommand(prisma, {
            name: event.name,
            ...(event.subcommand ? { subcommand: event.subcommand } : {}),
            options: event.options,
            guildId: event.guildId,
            userId: event.userId,
            roleIds: event.roleIds,
            now: new Date(),
          });
          await event.reply(gathering.content, await flowExtras(prisma, event, gathering));
          return;
        }
        if ((event.kind === "command" && event.name === "publish") || event.name.startsWith("publish:")) {
          const publication = await runPublishCommand(prisma, {
            name: event.name,
            ...(event.subcommand ? { subcommand: event.subcommand } : {}),
            options: event.options,
            guildId: event.guildId,
            userId: event.userId,
            roleIds: event.roleIds,
            now: new Date(),
          });
          await event.reply(publication.content, await flowExtras(prisma, event, publication));
          return;
        }
        if ((event.kind === "command" && event.name === "market") || (event.kind === "component" && event.name.startsWith("market:"))) {
          const market = await runMarketCommand(prisma, {
            name: event.name,
            ...(event.subcommand ? { subcommand: event.subcommand } : {}),
            interactionId: event.interactionId,
            options: event.options,
            guildId: event.guildId,
            userId: event.userId,
            roleIds: event.roleIds,
            now: new Date(),
          });
          await event.reply(market.content, market.components ? { components: market.components } : undefined);
          return;
        }
        if (event.kind === "command" && event.name === "economy") {
          const economy = await runEconomyCommand(prisma, {
            name: event.name,
            ...(event.subcommand ? { subcommand: event.subcommand } : {}),
            interactionId: event.interactionId,
            options: event.options,
            guildId: event.guildId,
            userId: event.userId,
            roleIds: event.roleIds,
            now: new Date(),
          });
          await event.reply(economy.content, await flowExtras(prisma, event, economy));
          return;
        }
        if (event.kind === "component" && event.name.startsWith("community:")) {
          const result = await runCommunityComponent(prisma, {
            name: event.name,
            options: event.options,
            ...(event.values ? { values: event.values } : {}),
            guildId: event.guildId,
            userId: event.userId,
            roleIds: event.roleIds,
            native: event.native,
            roles: event.roles,
            botHighestPosition: event.botHighestPosition,
            credentials: process.env,
            now: new Date(),
          });
          await event.reply(result.content, await flowExtras(prisma, event, result));
          return;
        }
        if (event.kind === "command" && ["rank", "profile", "birthday", "invites"].includes(event.name)) {
          const result = await runProgressionCommand(prisma, {
            name: event.name,
            ...(event.subcommand ? { subcommand: event.subcommand } : {}),
            options: event.options,
            guildId: event.guildId,
            userId: event.userId,
            roleIds: event.roleIds,
            now: new Date(),
          });
          await event.reply(result.content, result.components ? { components: result.components } : undefined);
          return;
        }
        if (event.kind === "command" && event.name === "leaderboard") {
          const result = await runLeaderboardCommand(prisma, {
            name: event.name,
            ...(event.subcommand ? { subcommand: event.subcommand } : {}),
            options: event.options,
            guildId: event.guildId,
            userId: event.userId,
            roleIds: event.roleIds,
            now: new Date(),
          });
          await event.reply(result.content, await flowExtras(prisma, event, result));
          return;
        }
        if (event.kind === "command" && event.name === "community") {
          const result = await runPollCommand(prisma, {
            name: event.name,
            ...(event.subcommand ? { subcommand: event.subcommand } : {}),
            options: event.options,
            guildId: event.guildId,
            userId: event.userId,
            roleIds: event.roleIds,
            now: new Date(),
          });
          await event.reply(result.content, await flowExtras(prisma, event, result));
          return;
        }
        if (event.kind === "command" && event.name === "support") {
          const result = await runSupportCommand(prisma, {
            name: event.name,
            ...(event.subcommand ? { subcommand: event.subcommand } : {}),
            options: event.options,
            guildId: event.guildId,
            userId: event.userId,
            roleIds: event.roleIds,
            targetRoleIds: event.targetRoleIds,
            now: new Date(),
          });
          await event.reply(result.content, result.components ? { components: result.components } : undefined);
          return;
        }
        if (event.kind === "component" && event.name.startsWith("ticket:open:")) {
          const result = await runSupportCommand(prisma, {
            name: "support",
            subcommand: "tickets",
            options: { ...event.options, action: "open", category: event.name.slice("ticket:open:".length) },
            guildId: event.guildId,
            userId: event.userId,
            roleIds: event.roleIds,
            targetRoleIds: event.targetRoleIds,
            now: new Date(),
          });
          await event.reply(result.content, await flowExtras(prisma, event, result));
          return;
        }
        if (event.kind === "command" && ["mod", "report", "logs"].includes(event.name)) {
          const result = await runModerationCommand(prisma, {
            name: event.name,
            ...(event.subcommand ? { subcommand: event.subcommand } : {}),
            options: event.options,
            guildId: event.guildId,
            userId: event.userId,
            roleIds: event.roleIds,
            actorPosition: event.actorPosition,
            targetPosition: event.targetPosition,
            targetIsOwner: event.targetIsOwner,
            botPosition: event.botHighestPosition,
            botPermissions: event.botPermissions,
            now: new Date(),
          });
          await event.reply(result.content, await flowExtras(prisma, event, result));
          return;
        }
        if (event.kind === "command" && ["verify", "roles", "accounts", "temproles"].includes(event.name)) {
          const result = await runCommunityCommand(prisma, {
            name: event.name,
            ...(event.subcommand ? { subcommand: event.subcommand } : {}),
            options: event.options,
            guildId: event.guildId,
            userId: event.userId,
            roleIds: event.roleIds,
            native: event.native,
            roles: event.roles,
            botHighestPosition: event.botHighestPosition,
            credentials: process.env,
            now: new Date(),
          });
          await event.reply(result.content, {
            ...(result.file ? { file: result.file } : {}),
            ...(result.components ? { components: result.components } : {}),
            ...(result.reactions ? { reactions: result.reactions } : {}),
            ...(result.bindPanelId ? { bindPanelId: result.bindPanelId } : {}),
          });
          return;
        }
        const routed = await routeInteraction(prisma, {
          customId: event.name,
          actorUserId: event.userId,
          roleIds: event.roleIds,
          now: new Date(),
        });
        if (!routed.handled || routed.access === "denied") {
          await event.reply("This control is unavailable, expired or not permitted for your account. Open `/help open` to choose a current action.");
          return;
        }
        await event.reply(
          "body" in routed && routed.body?.status === "ready" && routed.body.report
            ? `Issued ${routed.body.report.marksIssued}, reversed ${routed.body.report.marksReversed}, spent ${routed.body.report.marksSpent}.`
            : "The control was acknowledged, but no feature result was returned. Check the current record before retrying.",
        );
      },
    });
  } else if (database === "ok") {
    const loop = startWorkLoop({
      intervalMs: 1_000,
      log: (message) => logger.error(scrubSecrets(message, secrets)),
      run: async () => {
        const now = new Date();
        const options = { owner: `worker-${process.pid}`, now, leaseMs: 30_000 };
        await sweepExpiredGrants(prisma, now);
        await sweepExpiredWarnings(prisma, now);
        await sweepLogRetention(prisma, now);
        await sweepTicketInactivity(prisma, now);
        await sweepTicketRetention(prisma, now);
        await sweepBirthdays(prisma, now);
        await sweepVoiceAccrual(prisma, now);
        await sweepSeasonRollover(prisma, now);
        await sweepRoomCleanup(prisma, now);
        await sweepPollClose(prisma, now);
        await sweepAnnouncements(prisma, now);
        await sweepAnnouncementExpiry(prisma, now);
        await sweepPins(prisma, now);
        await sweepEventSeries(prisma, now);
        await sweepActivities(prisma, now);
        await sweepContractNotices(prisma, now);
        await expireBattleTurns(prisma, now);
        await completeDueExpeditions(prisma, now);
        await sweepCrewMissions(prisma, now);
        await sweepPvp(prisma, now);
        await sweepWorkshop(prisma, now);
        await sweepLottery(prisma, now);
        await sweepDeadDrop(prisma, now);
        await sweepBlackjack(prisma, now);
        await runJobOnce(
          prisma,
          new Map([
            ["community.role.expire", async (work) => {
              const grantId =
                work.payload && typeof work.payload === "object" && "grantId" in work.payload
                  ? String(work.payload.grantId)
                  : "";
              await expireDueGrant(prisma, grantId, new Date());
            }],
            ["moderation.warning.expire", async (work) => {
              const warningId = payloadId(work.payload, "warningId");
              await expireWarning(prisma, warningId, new Date());
            }],
            ["moderation.sanction.expire", async (work) => {
              await expireSanction(prisma, payloadId(work.payload, "caseId"), new Date());
            }],
            ["moderation.log.retain", async (work) => {
              await retainLog(prisma, payloadId(work.payload, "logId"), new Date());
            }],
            ["ticket.inactivity", async (work) => {
              await advanceTicketInactivity(prisma, payloadId(work.payload, "ticketId"), new Date());
            }],
            ["ticket.retain", async (work) => {
              await retainTicket(prisma, payloadId(work.payload, "ticketId"), new Date());
            }],
            ["progression.invite.qualify", async (work) => {
              const payload = work.payload as { guildId?: string; userId?: string };
              if (payload.guildId && payload.userId) {
                await qualifyRecruitment(prisma, payload.guildId, payload.userId, new Date());
              }
            }],
            ["season.rollover", async (work) => {
              const guildId = payloadId(work.payload, "guildId");
              if (guildId) {
                await rollSeason(prisma, { guildId, now: new Date(), actorUserId: "system", reason: "Scheduled season rollover" });
              }
            }],
            ["room.voice.cleanup", async (work) => {
              await cleanupRoom(prisma, payloadId(work.payload, "roomId"), new Date());
            }],
            ["room.text.cleanup", async (work) => {
              await cleanupRoom(prisma, payloadId(work.payload, "roomId"), new Date());
            }],
            ["poll.close", async (work) => {
              await closePoll(prisma, payloadId(work.payload, "pollId"), new Date());
            }],
            ["publication.deliver", async (work) => {
              const messageId = payloadId(work.payload, "messageId");
              if (messageId) {
                await deliverDuePublication(prisma, { messageId, now: new Date() });
              }
            }],
            ["announcement.run", async (work) => {
              const seriesId = payloadId(work.payload, "seriesId");
              if (seriesId) {
                await runAnnouncementSeries(prisma, { seriesId, now: new Date() });
              }
            }],
            ["announcement.expire", async () => {
              await sweepAnnouncementExpiry(prisma, new Date());
            }],
            ["pin.expire", async () => {
              await sweepPins(prisma, new Date());
            }],
            ["event.remind", async (work) => {
              const occurrenceId = payloadId(work.payload, "occurrenceId");
              const offset = work.payload && typeof work.payload === "object" && "offsetMinutes" in work.payload ? Number(work.payload.offsetMinutes) : 0;
              if (occurrenceId && Number.isFinite(offset)) {
                await deliverEventReminder(prisma, { occurrenceId, offsetMinutes: offset, now: new Date() });
              }
            }],
            ["prediction.lock", async (work) => {
              const predictionId = payloadId(work.payload, "predictionId");
              if (predictionId) {
                await lockDuePrediction(prisma, predictionId, new Date());
              }
            }],
            ["contest.close", async (work) => {
              const contestId = payloadId(work.payload, "contestId");
              if (contestId) {
                await closeDueContest(prisma, contestId, new Date());
              }
            }],
            ["giveaway.close", async (work) => {
              const giveawayId = payloadId(work.payload, "giveawayId");
              if (giveawayId) {
                await closeDueGiveaway(prisma, giveawayId, new Date());
              }
            }],
            ["giveaway.claim", async (work) => {
              const drawId = payloadId(work.payload, "drawId");
              if (drawId) {
                await expireGiveawayClaim(prisma, drawId, new Date());
              }
            }],
            ["contract.notify", async () => {
              await sweepContractNotices(prisma, new Date());
            }],
            ["combat.timeout", async () => {
              await expireBattleTurns(prisma, new Date());
            }],
            ["expedition.complete", async () => {
              await completeDueExpeditions(prisma, new Date());
            }],
            ["mission.turn", async () => {
              await sweepCrewMissions(prisma, new Date());
            }],
            ["mission.abandon", async () => {
              await sweepCrewMissions(prisma, new Date());
            }],
            ["pvp.turn", async () => {
              await sweepPvp(prisma, new Date());
            }],
            ["pvp.disconnect", async () => {
              await sweepPvp(prisma, new Date());
            }],
            ["trade.expire", async () => {
              await sweepWorkshop(prisma, new Date());
            }],
            ["listing.expire", async () => {
              await sweepWorkshop(prisma, new Date());
            }],
            ["lottery.close", async (work) => {
              const drawId = payloadId(work.payload, "drawId");
              if (drawId) {
                await settleDraw(prisma, { drawId, now: new Date() });
              }
            }],
            ["lottery.stall", async (work) => {
              const drawId = payloadId(work.payload, "drawId");
              if (drawId) {
                await settleDraw(prisma, { drawId, now: new Date() });
              }
            }],
            ["dead_drop.close", async (work) => {
              const boardId = payloadId(work.payload, "boardId");
              if (boardId) {
                await closeDeadDrop(prisma, { boardId, now: new Date() });
              }
            }],
            ["dead_drop.remind", async (work) => {
              const boardId = payloadId(work.payload, "boardId");
              if (boardId) {
                await deliverDeadDropReminder(prisma, { boardId, now: new Date() });
              }
            }],
            ["blackjack.join", async (work) => {
              const tableId = payloadId(work.payload, "tableId");
              if (tableId) {
                await closeBlackjackJoin(prisma, { tableId, now: new Date() });
              }
            }],
            ["blackjack.turn", async (work) => {
              const tableId = payloadId(work.payload, "tableId");
              const handId = payloadId(work.payload, "handId");
              const deadline = payloadId(work.payload, "deadline");
              if (tableId) {
                await expireBlackjackTurn(prisma, {
                  tableId,
                  ...(handId ? { handId } : {}),
                  ...(deadline ? { deadline } : {}),
                  now: new Date(),
                });
              }
            }],
          ]),
          options,
        );
        await runOutboxOnce(
          prisma,
          new Map([
            [
              "discord.role.update",
              async (work) => {
                await deliverRoleUpdate(work.payload, async (change) => applyDiscordRole(env.discord.token, change));
              },
            ],
            [
              "discord.moderation",
              async (work) => {
                await deliverModeration(prisma, work.payload, async (change) => applyDiscordModeration(env.discord.token, change));
              },
            ],
            [
              "moderation.alert",
              async (work) => {
                if (!env.discord.token) {
                  throw new Error("Discord moderation alert delivery is setup_required.");
                }
                const payload = work.payload as { guildId?: string; channelId?: string; caseId?: string };
                if (!payload.channelId || !payload.caseId) {
                  throw new Error("Moderation alert is missing its channel or case.");
                }
                const response = await fetch(`https://discord.com/api/v10/channels/${payload.channelId}/messages`, {
                  method: "POST",
                  headers: {
                    authorization: `Bot ${env.discord.token}`,
                    "content-type": "application/json",
                  },
                  body: JSON.stringify(notificationPayload("moderation", `Case: **${payload.caseId}**`)),
                });
                if (!response.ok) {
                  throw new Error(`Discord moderation alert failed with status ${response.status}.`);
                }
              },
            ],
            [
              "discord.ticket.open",
              async (work) => {
                const payload = work.payload as {
                  guildId?: string;
                  ticketId?: string;
                  number?: number;
                  privacy?: "channel" | "thread";
                  parentChannelId?: string | null;
                  openerUserId?: string;
                  staffRoleIds?: string[];
                };
                if (!payload.guildId || !payload.ticketId || !payload.openerUserId || !payload.privacy) {
                  throw new Error("Ticket channel delivery is missing its ticket.");
                }
                await deliverTicketChannel(
                  prisma,
                  {
                    guildId: payload.guildId,
                    ticketId: payload.ticketId,
                    number: payload.number ?? 0,
                    privacy: payload.privacy,
                    parentChannelId: payload.parentChannelId ?? null,
                    openerUserId: payload.openerUserId,
                    staffRoleIds: payload.staffRoleIds ?? [],
                  },
                  async (request) => applyDiscordTicket(env.discord.token, request),
                );
              },
            ],
            [
              "progression.birthday.announce",
              async (work) => {
                if (!env.discord.token) {
                  throw new Error("Discord birthday announcement delivery is setup_required.");
                }
                const payload = work.payload as { guildId?: string; greeting?: string; channelId?: string };
                if (!payload.channelId || !payload.greeting) {
                  throw new Error("Birthday announcement is missing its channel.");
                }
                const response = await fetch(`https://discord.com/api/v10/channels/${payload.channelId}/messages`, {
                  method: "POST",
                  headers: { authorization: `Bot ${env.discord.token}`, "content-type": "application/json" },
                  body: JSON.stringify(notificationPayload("birthday", payload.greeting)),
                });
                if (!response.ok) {
                  throw new Error(`Discord birthday announcement failed with status ${response.status}.`);
                }
              },
            ],
            [
              "ticket.reminder",
              async (work) => {
                if (!env.discord.token) {
                  throw new Error("Discord ticket reminder delivery is setup_required.");
                }
                const payload = work.payload as { channelId?: string | null; number?: number };
                if (!payload.channelId || !payload.number) {
                  throw new Error("Ticket reminder is missing its channel.");
                }
                const response = await fetch(`https://discord.com/api/v10/channels/${payload.channelId}/messages`, {
                  method: "POST",
                  headers: { authorization: `Bot ${env.discord.token}`, "content-type": "application/json" },
                  body: JSON.stringify(notificationPayload("ticket", `Ticket **#${payload.number}** has been inactive.`)),
                });
                if (!response.ok) {
                  throw new Error(`Discord ticket reminder failed with status ${response.status}.`);
                }
              },
            ],
            [
              "discord.room.open",
              async (work) => {
                const payload = work.payload as { roomId?: string };
                if (!payload.roomId) {
                  throw new Error("Room delivery is missing its room.");
                }
                await deliverRoomChannel(prisma, { roomId: payload.roomId, action: "open" }, async () => applyDiscordRoom(env.discord.token, work.payload, "open"));
              },
            ],
            [
              "discord.room.close",
              async (work) => {
                const payload = work.payload as { roomId?: string };
                if (!payload.roomId) {
                  throw new Error("Room delivery is missing its room.");
                }
                await deliverRoomChannel(prisma, { roomId: payload.roomId, action: "close" }, async () => applyDiscordRoom(env.discord.token, work.payload, "close"));
              },
            ],
            [
              "discord.room.warn",
              async (work) => {
                const payload = work.payload as { channelId?: string | null; roomId?: string };
                if (!payload.channelId) {
                  return;
                }
                if (!env.discord.token) {
                  throw new Error("Discord room warning delivery is setup_required.");
                }
                const response = await fetch(`https://discord.com/api/v10/channels/${payload.channelId}/messages`, {
                  method: "POST",
                  headers: { authorization: `Bot ${env.discord.token}`, "content-type": "application/json" },
                  body: JSON.stringify(notificationPayload("room", "This voice room is closing. Occupants will be disconnected.")),
                });
                if (!response.ok) {
                  throw new Error(`Discord room warning failed with status ${response.status}.`);
                }
              },
            ],
            [
              "community.assistance",
              async (work) => {
                if (!env.discord.token) {
                  throw new Error("Discord assistance delivery is setup_required.");
                }
                const payload = work.payload as { guildId?: string; requestId?: string };
                const settings = payload.guildId ? await readCommunitySettings(prisma, payload.guildId) : null;
                const request = payload.requestId
                  ? await prisma.assistanceRequest.findUnique({ where: { id: payload.requestId } })
                  : null;
                if (!settings?.assistanceChannelId || !request) {
                  throw new Error("Assistance delivery is missing its channel or request.");
                }
                const response = await fetch(`https://discord.com/api/v10/channels/${settings.assistanceChannelId}/messages`, {
                  method: "POST",
                  headers: {
                    authorization: `Bot ${env.discord.token}`,
                    "content-type": "application/json",
                  },
                  body: JSON.stringify(notificationPayload("verification", `Member: <@${request.userId}>\n\n${request.note}`)),
                });
                if (!response.ok) {
                  throw new Error(`Discord assistance delivery failed with status ${response.status}.`);
                }
              },
            ],
          ]),
          options,
        );
      },
    });
    stopWork = loop.stop;
    jobs = "ok";
    logger.info("Durable job and outbox loop is running.");
  } else {
    logger.error("Durable job loop did not start because the database is unavailable.");
  }

  const port = role === "bot" ? env.botHealthPort : env.workerHealthPort;
  const server = await startHealthServer({
    port,
    host: env.botHealthHost,
    allowOrigin: env.adminOrigin,
    getReport: () =>
      createServiceHealthReport({
        service: role,
        database,
        foundationRevision,
        discord: discordState(discord),
        jobs,
      }),
  });
  logger.info({ port, host: env.botHealthHost }, "health server listening");
  if (database !== "ok") {
    logger.error("Database is unavailable. /health reports the failure and does not claim the process is ready.");
  }

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    stopWork?.();
    server.close();
    await discord?.stop();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

async function applyDiscordRoom(
  token: string | undefined,
  payload: unknown,
  action: "open" | "close",
): Promise<{ outcome: "setup_required" } | { outcome: "applied"; channelId?: string } | { outcome: "permission" } | { outcome: "missing" }> {
  if (!token) {
    return { outcome: "setup_required" };
  }
  const body = payload && typeof payload === "object" ? payload as { guildId?: string; name?: string; channelId?: string | null; kind?: string } : {};
  const headers = { authorization: `Bot ${token}`, "content-type": "application/json" };
  if (action === "close") {
    if (!body.channelId) {
      return { outcome: "missing" };
    }
    const response = await fetch(`https://discord.com/api/v10/channels/${body.channelId}`, { method: "DELETE", headers });
    if (response.status === 404) {
      return { outcome: "missing" };
    }
    if (response.status === 403) {
      return { outcome: "permission" };
    }
    if (!response.ok) {
      throw new Error(`Discord room delete failed with status ${response.status}.`);
    }
    return { outcome: "applied" };
  }
  if (!body.guildId || !body.name) {
    throw new Error("Room delivery is missing its guild.");
  }
  const response = await fetch(`https://discord.com/api/v10/guilds/${body.guildId}/channels`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: body.name, type: body.kind === "voice" ? 2 : 0 }),
  });
  if (response.status === 403) {
    return { outcome: "permission" };
  }
  if (!response.ok) {
    throw new Error(`Discord room create failed with status ${response.status}.`);
  }
  const created = (await response.json()) as { id?: unknown };
  if (typeof created.id !== "string" || !created.id) {
    throw new Error("Discord room response had no id.");
  }
  return { outcome: "applied", channelId: created.id };
}

async function applyDiscordTicket(
  token: string | undefined,
  request: { guildId: string; number: number; privacy: "channel" | "thread"; parentChannelId: string | null; openerUserId: string; staffRoleIds: string[] },
): Promise<{ outcome: "setup_required" } | { outcome: "applied"; channelId: string } | { outcome: "permission" } | { outcome: "missing_parent" }> {
  if (!token) {
    return { outcome: "setup_required" };
  }
  if (!request.parentChannelId) {
    return { outcome: "missing_parent" };
  }
  const headers = { authorization: `Bot ${token}`, "content-type": "application/json" };
  const response = await fetch(
    request.privacy === "thread"
      ? `https://discord.com/api/v10/channels/${request.parentChannelId}/threads`
      : `https://discord.com/api/v10/guilds/${request.guildId}/channels`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(
        request.privacy === "thread"
          ? { name: `ticket-${request.number}`, type: 12, invitable: false }
          : {
              name: `ticket-${request.number}`,
              type: 0,
              parent_id: request.parentChannelId,
              permission_overwrites: [
                { id: request.guildId, type: 0, deny: "1024" },
                { id: request.openerUserId, type: 1, allow: "68608" },
                ...request.staffRoleIds.map((roleId) => ({ id: roleId, type: 0, allow: "68608" })),
              ],
            },
      ),
    },
  );
  if (response.status === 403) {
    return { outcome: "permission" };
  }
  if (!response.ok) {
    throw new Error(`Discord ticket channel failed with status ${response.status}.`);
  }
  const body = (await response.json()) as { id?: unknown };
  if (typeof body.id !== "string" || !body.id) {
    throw new Error("Discord ticket channel response had no id.");
  }
  return { outcome: "applied", channelId: body.id };
}

async function applyDiscordRole(
  token: string | undefined,
  change: { guildId: string; userId: string; roleId: string; action: "add" | "remove" },
): Promise<"applied" | "setup_required"> {
  if (!token) {
    return "setup_required";
  }
  const response = await fetch(
    `https://discord.com/api/v10/guilds/${change.guildId}/members/${change.userId}/roles/${change.roleId}`,
    { method: change.action === "add" ? "PUT" : "DELETE", headers: { authorization: `Bot ${token}` } },
  );
  if (response.status === 204 || response.ok) {
    return "applied";
  }
  throw new Error(`Discord role update failed with status ${response.status}.`);
}

function payloadId(payload: unknown, key: string): string {
  if (payload && typeof payload === "object" && key in payload) {
    return String(payload[key as keyof typeof payload]);
  }
  return "";
}

async function applyDiscordModeration(
  token: string | undefined,
  change: { guildId: string; action: string; targetUserId: string; channelId: string | null; messageId: string | null },
): Promise<"applied" | "setup_required" | "hierarchy" | "permission" | "missing_message"> {
  if (!token) {
    return "setup_required";
  }
  if (change.action === "delete" && (!change.channelId || !change.messageId)) {
    return "missing_message";
  }
  const headers = { authorization: `Bot ${token}`, "content-type": "application/json" };
  const response = await fetch(moderationUrl(change), {
    method: change.action === "timeout" || change.action === "containment" ? "PATCH" : change.action === "ban" ? "PUT" : "DELETE",
    headers,
    ...(change.action === "timeout" || change.action === "containment"
      ? { body: JSON.stringify({ communication_disabled_until: new Date(Date.now() + 10 * 60 * 1000).toISOString() }) }
      : {}),
  });
  if (response.status === 204 || response.ok) {
    return "applied";
  }
  if (response.status === 404) {
    return "missing_message";
  }
  if (response.status === 403) {
    return "permission";
  }
  throw new Error(`Discord moderation failed with status ${response.status}.`);
}

function moderationUrl(change: { guildId: string; action: string; targetUserId: string; channelId: string | null; messageId: string | null }): string {
  if (change.action === "delete") {
    return `https://discord.com/api/v10/channels/${change.channelId}/messages/${change.messageId}`;
  }
  if (change.action === "ban") {
    return `https://discord.com/api/v10/guilds/${change.guildId}/bans/${change.targetUserId}`;
  }
  return `https://discord.com/api/v10/guilds/${change.guildId}/members/${change.targetUserId}`;
}

function discordState(connection: DiscordConnection | null): DiscordHealth {
  return connection?.state ?? "not_applicable";
}

export function reportProcessError(error: unknown): void {
  const message = error instanceof Error ? error.message : "process failed";
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function flowExtras(db: Parameters<typeof followupRows>[0], event: Parameters<typeof followupRows>[1], result: { content: string }): Promise<{ components: DiscordComponentRow[] } | undefined> {
  if ("next" in result && result.next) return { components: await followupRows(db, event, result.next as FollowupAction) };
  if (!("components" in result) || !Array.isArray(result.components)) return undefined;
  return { components: result.components as DiscordComponentRow[] };
}
