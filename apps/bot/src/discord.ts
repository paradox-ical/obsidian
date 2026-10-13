import type { MessageReaction, PartialMessageReaction, PartialUser, User } from "discord.js";

import { scrubSecrets } from "./redact.js";
import { readSlashOptions } from "./slash-options.js";

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
  onGuilds?: (guilds: Array<{ guildId: string; ownerUserId: string }>) => Promise<void>;
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
      const guilds = [...readyClient.guilds.cache.values()].map((guild) => ({
        guildId: guild.id,
        ownerUserId: guild.ownerId,
      }));
      void input.onGuilds?.(guilds).catch((error: unknown) => {
        input.log(scrubSecrets(error instanceof Error ? error.message : "Guild owner sync failed.", [input.token]));
      });
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
      const relevant =
        modal !== null ||
        command !== null ||
        (component !== null &&
          (component.customId.startsWith("market:") ||
            component.customId.startsWith("publish:") ||
            component.customId.startsWith("session:") ||
            component.customId.startsWith("community:") ||
            component.customId.startsWith("ticket:")));
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
          Object.assign(options, readSlashOptions(command.options.data));
          const subcommand = command.options.getSubcommand(false);
          if (subcommand) {
            options["subcommand"] = subcommand;
          }
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
            const text = content.length > 1900 ? `${content.slice(0, 1890)}\nThe rest was cut so Discord could show this.` : content;
            const payload = {
              content: text,
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
            try {
              for (const emoji of extras && "reactions" in extras ? (extras.reactions ?? []) : []) {
                await message.react(emoji);
              }
            } catch (error: unknown) {
              input.log(scrubSecrets(error instanceof Error ? error.message : "Reaction failed.", [input.token]));
            }
          },
        });
      })().catch((error: unknown) => {
        input.log(scrubSecrets(error instanceof Error ? error.message : "Interaction failed.", [input.token]));
        const notice = "That command did not finish. Nothing new was confirmed.";
        const failed = command
          ? command.editReply({ content: notice })
          : modal
            ? modal.editReply({ content: notice })
            : component?.followUp({ content: notice, flags: MessageFlags.Ephemeral });
        void failed?.catch(() => undefined);
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
