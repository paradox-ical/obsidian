import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as DiscordJs from "discord.js";
import { startDiscordGateway, type DiscordInteractionEvent } from "./discord.js";

const gateway = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => void>() }));
vi.mock("discord.js", async (original) => ({
  ...await original<typeof DiscordJs>(),
  Client: class {
    guilds = { cache: new Map() };
    on(name: string, handler: (...args: unknown[]) => void) { gateway.handlers.set(name, handler); }
    once() {}
    async login() { return "fixture"; }
    async destroy() {}
  },
}));

function fixture(kind: "command" | "button" | "select" | "modal" | "autocomplete", customId = "go:economy:wallet", privateMessage = true) {
  const message = { id: "message", channelId: "channel", react: vi.fn(), flags: { has: () => privateMessage } };
  const interaction = {
    id: "interaction", guildId: "guild", guild: null, member: null, user: { id: "member" }, customId, commandName: "help", message,
    values: ["123456789012345678"], deferred: false, replied: false,
    isAutocomplete: () => kind === "autocomplete", isButton: () => kind === "button", isModalSubmit: () => kind === "modal",
    isChatInputCommand: () => kind === "command", isMessageComponent: () => kind === "button" || kind === "select",
    isAnySelectMenu: () => kind === "select", inGuild: () => false,
    options: { data: [], getSubcommand: () => "search", getMember: () => null, getFocused: () => ({ name: "query", value: "salvage" }) },
    fields: { getTextInputValue: () => "25" },
    deferReply: vi.fn(async () => { interaction.deferred = true; }),
    deferUpdate: vi.fn(async () => { interaction.deferred = true; }),
    editReply: vi.fn(async (payload: unknown) => { void payload; return message; }), followUp: vi.fn(async (payload: unknown) => { void payload; return message; }),
    reply: vi.fn(async () => { interaction.replied = true; }),
    showModal: vi.fn(async () => { interaction.replied = true; }), respond: vi.fn(async (payload: unknown) => { void payload; }),
  };
  return interaction;
}

async function send(interaction: ReturnType<typeof fixture>, handler: (event: DiscordInteractionEvent) => Promise<void>) {
  const onInteraction = vi.fn(handler);
  await startDiscordGateway({ configured: true, token: "fixture-token", log: () => undefined, onInteraction });
  gateway.handlers.get("interactionCreate")!(interaction);
  return onInteraction;
}

describe("Discord transport experience", () => {
  beforeEach(() => gateway.handlers.clear());

  it("acknowledges slash commands privately, renders a card and suppresses mentions", async () => {
    const interaction = fixture("command");
    await send(interaction, async (event) => { await event.reply("Saved for @everyone."); });
    await vi.waitFor(() => expect(interaction.editReply).toHaveBeenCalledOnce());
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: 32832 });
    const payload = interaction.editReply.mock.calls[0]?.[0] as unknown;
    expect(payload).toMatchObject({ allowedMentions: { parse: [] }, components: [{ type: 17 }] });
    expect(payload).not.toHaveProperty("content");
  });

  it("updates a private panel in place but keeps public controls intact", async () => {
    for (const privateMessage of [true, false]) {
      const interaction = fixture("button", "go:inventory:gear", privateMessage);
      await send(interaction, async (event) => { await event.reply("Your gear."); });
      await vi.waitFor(() => expect(privateMessage ? interaction.editReply : interaction.followUp).toHaveBeenCalledOnce());
      expect(privateMessage ? interaction.followUp : interaction.editReply).not.toHaveBeenCalled();
    }
  });

  it("passes native user, role and channel selection values to the form handler", async () => {
    const interaction = fixture("select", "ux:value:session");
    const handler = await send(interaction, async () => undefined);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    expect(handler.mock.calls[0]?.[0].values).toEqual(["123456789012345678"]);
  });

  it("opens a text-entry modal without acknowledging the button first", async () => {
    const interaction = fixture("button", "ux:input:session");
    await send(interaction, async (event) => { await event.showModal!({ custom_id: "ux:submit:session", title: "Amount", components: [] }); });
    await vi.waitFor(() => expect(interaction.showModal).toHaveBeenCalledOnce());
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
  });

  it("routes generic modal submissions with their typed value", async () => {
    const interaction = fixture("modal", "ux:submit:session");
    const handler = await send(interaction, async (event) => { await event.reply("Reviewed."); });
    await vi.waitFor(() => expect(interaction.editReply).toHaveBeenCalledOnce());
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ name: "ux:submit:session", options: { value: "25" } });
  });

  it("answers autocomplete without opening a session or executing a command", async () => {
    const interaction = fixture("autocomplete");
    const handler = await send(interaction, async () => undefined);
    await vi.waitFor(() => expect(interaction.respond).toHaveBeenCalledOnce());
    expect(handler).not.toHaveBeenCalled();
    expect(interaction.respond.mock.calls[0]?.[0]).toEqual(expect.arrayContaining([expect.objectContaining({ value: "inventory salvage" })]));
  });

  it("explains uncertain failures without claiming the service rolled back", async () => {
    const interaction = fixture("button", "ux:input:expired");
    await send(interaction, async () => { throw new Error("fixture failure"); });
    await vi.waitFor(() => expect(interaction.reply).toHaveBeenCalledOnce());
    expect(JSON.stringify(interaction.reply.mock.calls)).toContain("part of the action may already have completed");
  });
});
