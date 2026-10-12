import type { MessageReaction, PartialMessageReaction, PartialUser, User } from "discord.js";

import { scrubSecrets } from "./redact.js";

export interface DiscordComponentRow {
  type: 1;
  components: Array<Record<string, unknown>>;
}

export interface DiscordInteractionEvent {
  interactionId: string;
  kind: "command" | "component";
  name: string;
  subcommand?: string;
  options: Record<string, string | boolean | number>;
  values?: string[];
  userId: string;
  guildId: string | null;
  roleIds: string[];
  native: { pending: boolean | null; flags: number | null };
  roles: Array<{ id: string; name: string; position: number; permissions: string; managed: boolean }>;
  botHighestPosition: number;
  actorPosition: number;
  targetPosition: number | null;
  targetIsOwner: boolean;
  botPermissions: string;
  targetRoleIds: string[];
  reply: (
    content: string,
    extras?: { filename: string; bytes: Uint8Array } | {
      file?: { filename: string; bytes: Uint8Array };
      components?: DiscordComponentRow[];
      reactions?: string[];
      bindPanelId?: string;
    },
  ) => Promise<void>;
}

export interface DiscordConnection {
  state: "setup_required" | "connecting" | "ready" | "login_failed";
  detail: string | null;
  stop: () => Promise<void>;
}

export async function startDiscordGateway(input: {
  configured: boolean;
  token?: string;
  log: (message: string) => void;
  onInteraction?: (event: DiscordInteractionEvent) => Promise<void>;
  onPanelPosted?: (post: { messageId: string; channelId: string; guildId: string; panelId: string }) => Promise<void>;
  onReaction?: (event: {
    messageId: string;
    guildId: string;
    userId: string;
    emoji: string;
    added: boolean;
    roleIds: string[];
    native: { pending: boolean | null; flags: number | null };
    roles: DiscordInteractionEvent["roles"];
    botHighestPosition: number;
  }) => Promise<void>;
}): Promise<DiscordConnection> {
  if (!input.configured || !input.token) {
    input.log("Discord gateway setup required. No application token is configured.");
    return {
      state: "setup_required",
      detail: null,
      stop: async () => undefined,
    };
  }

  const connection: DiscordConnection = {
    state: "connecting",
    detail: null,
    stop: async () => undefined,
  };

  try {
    const { Client, Events, GatewayIntentBits, MessageFlags, Partials } = await import("discord.js");
    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessageReactions],
      partials: [Partials.Message, Partials.Reaction, Partials.User],
    });
    connection.stop = async () => {
      await client.destroy();
    };
    client.once(Events.ClientReady, (readyClient) => {
      connection.state = "ready";
      input.log(`Discord gateway connected as ${readyClient.user.tag}. Commands were not registered.`);
    });
    client.on(Events.InteractionCreate, (interaction) => {
      if (interaction.isButton() && (interaction.customId.startsWith("publish:approve:") || interaction.customId.startsWith("publish:changes:"))) {
        const reviewId = interaction.customId.startsWith("publish:approve:")
          ? interaction.customId.slice("publish:approve:".length)
          : interaction.customId.slice("publish:changes:".length);
        const approving = interaction.customId.startsWith("publish:approve:");
        void interaction.showModal(approving ? {
          custom_id: `publish:approve-submit:${reviewId}`,
          title: "Approve publication",
          components: [
            { type: 1, components: [{ type: 4, custom_id: "destination", label: "Destination channel", style: 1, required: true, max_length: 32 }] },
            { type: 1, components: [{ type: 4, custom_id: "when", label: "now or an ISO time", style: 1, required: true, max_length: 40 }] },
          ],
        } : {
          custom_id: `publish:changes-submit:${reviewId}`,
          title: "Request changes",
          components: [
            { type: 1, components: [{ type: 4, custom_id: "feedback", label: "What should change", style: 2, required: true, max_length: 400 }] },
          ],
        }).catch((error: unknown) => {
          input.log(scrubSecrets(error instanceof Error ? error.message : "Publication modal failed.", [input.token]));
        });
        return;
      }
      if (interaction.isButton() && interaction.customId === "community:captcha-modal") {
        void interaction
          .showModal({
            custom_id: "community:captcha-submit",
            title: "Verification",
            components: [
              {
                type: 1,
                components: [
                  {
                    type: 4,
                    custom_id: "answer",
                    label: "Characters in the image",
                    style: 1,
                    required: true,
                    min_length: 6,
                    max_length: 6,
                  },
                ],
              },
            ],
          })
          .catch((error: unknown) => {
            input.log(scrubSecrets(error instanceof Error ? error.message : "CAPTCHA modal failed.", [input.token]));
          });
        return;
      }
      const publishModal = interaction.isModalSubmit() && interaction.customId.startsWith("publish:") ? interaction : null;
      const modal = publishModal ?? (interaction.isModalSubmit() && interaction.customId === "community:captcha-submit" ? interaction : null);
      const command = interaction.isChatInputCommand() ? interaction : null;
      const component = interaction.isMessageComponent() ? interaction : null;
      const communityCommand =
        command !== null && ["verify", "roles", "accounts", "temproles", "mod", "report", "logs", "support", "rank", "profile", "birthday", "invites", "leaderboard", "community"].includes(command.commandName);
      const relevant =
        modal !== null ||
        (command && (command.commandName === "stats" || command.commandName === "economy" || command.commandName === "market" || command.commandName === "publish" || communityCommand)) ||
        (component && (component.customId.startsWith("market:") || component.customId.startsWith("publish:"))) ||
        (component && (component.customId.startsWith("session:") || component.customId.startsWith("community:") || component.customId.startsWith("ticket:")));
      if (!relevant || !input.onInteraction) {
        return;
      }
      void (async () => {
        if (modal) {
          await modal.deferReply({ flags: MessageFlags.Ephemeral });
        } else if (component) {
          await component.deferUpdate();
        } else if (command) {
          await command.deferReply({ flags: MessageFlags.Ephemeral });
        }
        const rawRoles = interaction.inGuild() && interaction.member ? interaction.member.roles : [];
        const roleIds = Array.isArray(rawRoles) ? [...rawRoles] : [...rawRoles.cache.keys()];
        const guild = interaction.guild;
        const member = interaction.inGuild() ? interaction.member : null;
        const pending = member && "pending" in member && typeof member.pending === "boolean" ? member.pending : null;
        const flags =
          member && "flags" in member && member.flags && typeof member.flags === "object" && "bitfield" in member.flags
            ? Number(member.flags.bitfield)
            : null;
        const options: Record<string, string | boolean | number> = {};
        if (modal && modal.customId === "community:captcha-submit") {
          options["answer"] = modal.fields.getTextInputValue("answer");
        }
        if (publishModal?.customId.startsWith("publish:approve-submit:")) {
          options["destination"] = publishModal.fields.getTextInputValue("destination");
          options["when"] = publishModal.fields.getTextInputValue("when");
        }
        if (publishModal?.customId.startsWith("publish:changes-submit:")) {
          options["feedback"] = publishModal.fields.getTextInputValue("feedback");
        }
        if (command) {
          const subcommand = command.options.getSubcommand(false);
          if (subcommand) {
            options["subcommand"] = subcommand;
          }
          const user = command.options.getUser("member");
          const role = command.options.getRole("role");
          const answer = command.options.getString("answer");
          const note = command.options.getString("note");
          const reason = command.options.getString("reason");
          const provider = command.options.getString("provider");
          const handle = command.options.getString("handle");
          const visibility = command.options.getString("visibility");
          const days = command.options.getInteger("days");
          const clear = command.options.getBoolean("clear");
          const revoke = command.options.getBoolean("revoke");
          const action = command.options.getString("action");
          const caseId = command.options.getString("case");
          const query = command.options.getString("query");
          const points = command.options.getInteger("points");
          const panelName = command.options.getString("name");
          const category = command.options.getString("category");
          const ticket = command.options.getString("ticket");
          const reference = command.options.getString("reference");
          const kind = command.options.getString("kind");
          const month = command.options.getInteger("month");
          const day = command.options.getInteger("day");
          const year = command.options.getInteger("year");
          const timezone = command.options.getString("timezone");
          const announce = command.options.getBoolean("announce");
          const confidence = command.options.getString("confidence");
          const bio = command.options.getString("bio");
          const frame = command.options.getString("frame");
          const background = command.options.getString("background");
          const season = command.options.getString("season");
          const question = command.options.getString("question");
          const choice = command.options.getString("choice");
          const poll = command.options.getString("poll");
          const page = command.options.getInteger("page");
          const amount = command.options.getInteger("amount");
          const side = command.options.getString("side");
          const anonymous = command.options.getBoolean("anonymous");
          if (user) options["member"] = user.id;
          if (role) options["role"] = role.id;
          if (answer) options["answer"] = answer;
          if (note) options["note"] = note;
          if (reason) options["reason"] = reason;
          if (provider) options["provider"] = provider;
          if (handle) options["handle"] = handle;
          if (visibility) options["visibility"] = visibility;
          if (days !== null) options["days"] = days;
          if (clear !== null) options["clear"] = clear;
          if (revoke !== null) options["revoke"] = revoke;
          if (panelName) options["name"] = panelName;
          if (action) options["action"] = action;
          if (caseId) options["case"] = caseId;
          if (query) options["query"] = query;
          if (points !== null) options["points"] = points;
          if (category) options["category"] = category;
          if (ticket) options["ticket"] = ticket;
          if (reference) options["reference"] = reference;
          if (kind) options["kind"] = kind;
          if (month !== null) options["month"] = month;
          if (day !== null) options["day"] = day;
          if (year !== null) options["year"] = year;
          if (timezone) options["timezone"] = timezone;
          if (announce !== null) options["announce"] = announce;
          if (confidence) options["confidence"] = confidence;
          if (bio) options["bio"] = bio;
          if (frame) options["frame"] = frame;
          if (background) options["background"] = background;
          if (season) options["season"] = season;
          if (question) options["question"] = question;
          if (choice) options["choice"] = choice;
          if (poll) options["poll"] = poll;
          if (page !== null) options["page"] = page;
          if (amount !== null) options["amount"] = amount;
          if (side) options["side"] = side;
          if (anonymous !== null) options["anonymous"] = anonymous;
          const cycle = command.options.getString("cycle");
          const assignment = command.options.getString("assignment");
          const pings = command.options.getBoolean("pings");
          const delivery = command.options.getString("delivery");
          const channel = command.options.getString("channel");
          const daily = command.options.getBoolean("daily");
          const weekly = command.options.getBoolean("weekly");
          const monthly = command.options.getBoolean("monthly");
          const title = command.options.getString("title");
          const objective = command.options.getString("objective");
          const policy = command.options.getString("policy");
          const target = command.options.getInteger("target");
          const reward = command.options.getInteger("reward");
          const board = command.options.getString("board");
          if (cycle) options["cycle"] = cycle;
          if (assignment) options["assignment"] = assignment;
          if (pings !== null) options["pings"] = pings;
          if (delivery) options["delivery"] = delivery;
          if (channel) options["channel"] = channel;
          if (daily !== null) options["daily"] = daily;
          if (weekly !== null) options["weekly"] = weekly;
          if (monthly !== null) options["monthly"] = monthly;
          if (title) options["title"] = title;
          if (objective) options["objective"] = objective;
          if (policy) options["policy"] = policy;
          if (target !== null) options["target"] = target;
          if (reward !== null) options["reward"] = reward;
          if (board) options["board"] = board;
          const classSlug = command.options.getString("class");
          const stat = command.options.getString("stat");
          const slot = command.options.getInteger("slot");
          const ability = command.options.getString("ability");
          if (classSlug) options["class"] = classSlug;
          if (stat) options["stat"] = stat;
          if (slot !== null) options["slot"] = slot;
          if (ability) options["ability"] = ability;
          const stake = command.options.getInteger("stake");
          const member = command.options.getString("member");
          const match = command.options.getString("match");
          const style = command.options.getString("style");
          const mode = command.options.getString("mode");
          const opponent = command.options.getString("opponent");
          const battle = command.options.getString("battle");
          const move = command.options.getString("move");
          const item = command.options.getString("item");
          const request = command.options.getString("request");
          const recipe = command.options.getString("recipe");
          const listing = command.options.getString("listing");
          const trade = command.options.getString("trade");
          const affix = command.options.getString("affix");
          const marks = command.options.getInteger("marks");
          const price = command.options.getInteger("price");
          const offer = command.options.getString("offer");
          const crate = command.options.getString("crate");
          const purchase = command.options.getString("purchase");
          const quote = command.options.getString("quote");
          const quantity = command.options.getInteger("quantity");
          if (stake !== null) options["stake"] = stake;
          if (member) options["member"] = member;
          if (match) options["match"] = match;
          if (style) options["style"] = style;
          if (mode) options["mode"] = mode;
          if (opponent) options["opponent"] = opponent;
          if (battle) options["battle"] = battle;
          if (move) options["move"] = move;
          if (item) options["item"] = item;
          if (request) options["request"] = request;
          if (recipe) options["recipe"] = recipe;
          if (listing) options["listing"] = listing;
          if (trade) options["trade"] = trade;
          if (affix) options["affix"] = affix;
          if (marks !== null) options["marks"] = marks;
          if (price !== null) options["price"] = price;
          if (offer) options["offer"] = offer;
          if (crate) options["crate"] = crate;
          if (purchase) options["purchase"] = purchase;
          if (quote) options["quote"] = quote;
          if (quantity !== null) options["quantity"] = quantity;
          const coordinate = command.options.getString("coordinate");
          const charge = command.options.getString("charge");
          const payload = command.options.getString("payload");
          const enabled = command.options.getBoolean("enabled");
          if (coordinate) options["coordinate"] = coordinate;
          if (charge) options["charge"] = charge;
          if (payload) options["payload"] = payload;
          if (enabled !== null) options["enabled"] = enabled;
          const table = command.options.getString("table");
          if (table) options["table"] = table;
          const region = command.options.getString("region");
          const difficulty = command.options.getString("difficulty");
          const notify = command.options.getBoolean("notify");
          if (region) options["region"] = region;
          if (difficulty) options["difficulty"] = difficulty;
          if (notify !== null) options["notify"] = notify;
        }
        const targetMember = command?.options.getMember("member") ?? null;
        const targetRoleIds =
          targetMember && "roles" in targetMember
            ? Array.isArray(targetMember.roles)
              ? [...targetMember.roles]
              : [...targetMember.roles.cache.keys()]
            : [];
        const targetPosition = targetMember
          ? targetRoleIds.reduce((highest, roleId) => Math.max(highest, guild?.roles.cache.get(roleId)?.position ?? 0), 0)
          : null;
        const actorPosition = roleIds.reduce((highest, roleId) => Math.max(highest, guild?.roles.cache.get(roleId)?.position ?? 0), 0);
        const values = interaction.isStringSelectMenu() ? [...interaction.values] : undefined;
        await input.onInteraction?.({
          interactionId: interaction.id,
          kind: component ? "component" : "command",
          name: publishModal ? publishModal.customId : modal ? "verify" : component ? component.customId : (command?.commandName ?? ""),
          ...(publishModal ? {} : modal ? { subcommand: "captcha" } : command ? { subcommand: command.options.getSubcommand(false) ?? undefined } : {}),
          options,
          ...(values ? { values } : {}),
          userId: interaction.user.id,
          guildId: interaction.guildId,
          roleIds,
          native: { pending, flags },
          roles: guild
            ? [...guild.roles.cache.values()].map((role) => ({
                id: role.id,
                name: role.name,
                position: role.position,
                permissions: role.permissions.bitfield.toString(),
                managed: role.managed,
              }))
            : [],
          botHighestPosition: guild?.members.me?.roles.highest.position ?? 0,
          actorPosition,
          targetPosition,
          targetIsOwner: Boolean(targetMember && guild?.ownerId === ("id" in targetMember ? targetMember.id : interaction.user.id)),
          botPermissions: guild?.members.me?.permissions.bitfield.toString() ?? "0",
          targetRoleIds,
          reply: async (content, extras) => {
            const file = extras && "bytes" in extras ? extras : extras?.file;
            const attachment = file ? [{ attachment: Buffer.from(file.bytes), name: file.filename }] : undefined;
            const payload = {
              content,
              ...(attachment ? { files: attachment } : {}),
              ...(extras && "components" in extras && extras.components ? { components: extras.components } : {}),
            };
            if (component && !modal) {
              await component.followUp({ ...payload, flags: MessageFlags.Ephemeral });
              return;
            }
            const message = await (modal ?? command)?.editReply(payload);
            if (!message || !("react" in message)) {
              return;
            }
            if (extras && "bindPanelId" in extras && extras.bindPanelId && interaction.guildId) {
              await input.onPanelPosted?.({
                messageId: message.id,
                channelId: message.channelId,
                guildId: interaction.guildId,
                panelId: extras.bindPanelId,
              });
            }
            for (const emoji of extras && "reactions" in extras ? (extras.reactions ?? []) : []) {
              await message.react(emoji);
            }
          },
        });
      })().catch((error: unknown) => {
        input.log(scrubSecrets(error instanceof Error ? error.message : "Interaction failed.", [input.token]));
      });
    });
    const onReaction = async (
      reaction: MessageReaction | PartialMessageReaction,
      user: User | PartialUser,
      added: boolean,
    ) => {
      if (!input.onReaction || user.bot) {
        return;
      }
      try {
        if (user.partial) {
          await user.fetch();
        }
        const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
        if (!message.guildId || !reaction.emoji.name) {
          return;
        }
        const guild = "guild" in message && message.guild ? message.guild : await client.guilds.fetch(message.guildId);
        const member = await guild.members.fetch(user.id);
        await input.onReaction({
          messageId: message.id,
          guildId: message.guildId,
          userId: user.id,
          emoji: reaction.emoji.name,
          added,
          roleIds: [...member.roles.cache.keys()],
          native: {
            pending: typeof member.pending === "boolean" ? member.pending : null,
            flags: Number(member.flags.bitfield),
          },
          roles: [...guild.roles.cache.values()].map((role) => ({
            id: role.id,
            name: role.name,
            position: role.position,
            permissions: role.permissions.bitfield.toString(),
            managed: role.managed,
          })),
          botHighestPosition: guild.members.me?.roles.highest.position ?? 0,
        });
      } catch (error: unknown) {
        input.log(scrubSecrets(error instanceof Error ? error.message : "Reaction role update failed.", [input.token]));
      }
    };
    client.on(Events.MessageReactionAdd, (reaction, user) => {
      void onReaction(reaction, user, true);
    });
    client.on(Events.MessageReactionRemove, (reaction, user) => {
      void onReaction(reaction, user, false);
    });
    await client.login(input.token);
  } catch (error) {
    connection.state = "login_failed";
    connection.detail = scrubSecrets(error instanceof Error ? error.message : "Discord login failed", [
      input.token,
    ]);
    input.log(`Discord login failed: ${connection.detail}`);
  }

  return connection;
}
