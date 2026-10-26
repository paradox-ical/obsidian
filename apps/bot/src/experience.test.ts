import { beforeEach, describe, expect, it, vi } from "vitest";
import { COMMAND_PARENTS, toDiscordCommandBody, validateCommandManifest } from "@collective/domain";
import type { PrismaClient } from "@collective/db";
import type * as Database from "@collective/db";
import type { DiscordInteractionEvent } from "./discord.js";
import { ACTION_FIELDS, MODULE_COPY, SECTIONS, needsConfirmation, routeFields } from "./experience-catalog.js";
import { catalogProblems, moduleRows, paginateReply, parseField, prepareExperience, searchActions, splitPages } from "./experience.js";
import { guideReply } from "./guide.js";
import { notificationPayload } from "./notifications.js";
import { presentOutcome, spokenAmount } from "./present.js";
import { blackjackTableReply } from "./blackjack-flow.js";

const store = vi.hoisted(() => new Map<string, Record<string, unknown>>());
vi.mock("@collective/db", async (original) => ({
  ...await original<typeof Database>(),
  activeConfig: vi.fn(async () => null),
  openSession: vi.fn(async (_db, input) => {
    const session = { ...input, id: crypto.randomUUID(), revision: 0, consumedAt: null };
    store.set(session.id, session);
    return session;
  }),
  executeSession: vi.fn(async (_db, input) => {
    const session = store.get(input.sessionId);
    if (!session || session.consumedAt) return { ok: false, reason: "consumed" };
    session.consumedAt = new Date();
    return { ok: true, session };
  }),
}));

function event(name: string, extras: Partial<DiscordInteractionEvent> = {}): DiscordInteractionEvent {
  return { interactionId: "interaction", kind: "command", name, options: {}, userId: "member", guildId: "guild", roleIds: [], native: { pending: false, flags: 0 }, roles: [], botHighestPosition: 5, actorPosition: 1, targetPosition: null, targetIsOwner: false, botPermissions: "0", targetRoleIds: [], reply: vi.fn(async () => undefined), showModal: vi.fn(async () => undefined), ...extras };
}
const db = { interactionSession: { findUnique: async ({ where }: { where: { id: string } }) => store.get(where.id) ?? null } } as unknown as PrismaClient;
function lastId() { return [...store.keys()].at(-1)!; }

describe("complete Discord surface", () => {
  beforeEach(() => store.clear());

  it("covers all 36 parents, every existing subcommand and every action union", () => {
    expect(validateCommandManifest()).toEqual([]);
    expect(catalogProblems()).toEqual([]);
    expect([...SECTIONS.flatMap((s) => [...s.commands])].sort()).toEqual(COMMAND_PARENTS.map((p) => p.name).sort());
    for (const parent of COMMAND_PARENTS) {
      expect(parent.options.filter((s) => s.name === "open")).toHaveLength(1);
      const rows = moduleRows(parent.name);
      const options = rows[0]!.components[0]!["options"] as Array<{ value: string }>;
      expect(options.map((o) => o.value)).toEqual(parent.options.filter((s) => s.name !== "open").map((s) => s.name));
      expect(MODULE_COPY[parent.name]).toBeDefined();
      for (const sub of parent.options) {
        const view = guideReply(`${parent.name}:${sub.name}`, "Result recorded.");
        expect(view.rows?.flatMap((r) => r.components).some((c) => c["custom_id"] === `go:${parent.name}:open`)).toBe(true);
      }
    }
    expect(Object.keys(ACTION_FIELDS).length).toBeGreaterThan(30);
  });

  it("shows only the fields relevant to the selected action", () => {
    expect(routeFields({ parent: "crew", subcommand: "session", options: { action: "join" } }).map((f) => f.name)).toEqual(["session"]);
    expect(routeFields({ parent: "lottery", subcommand: "tickets", options: { action: "buy" } }).map((f) => f.name)).toEqual(["quote"]);
    expect(routeFields({ parent: "inventory", subcommand: "trade", options: { action: "confirm" } }).map((f) => f.name)).toEqual(["trade"]);
    expect(needsConfirmation({ parent: "combat", subcommand: "action", options: { battle: "id", move: "strike" } })).toBe(false);
    expect(needsConfirmation({ parent: "economy", subcommand: "transfer", options: { amount: 50 } })).toBe(true);
  });

  it("offers help autocomplete with valid commands and no private records", () => {
    const matches = searchActions("salvage");
    expect(matches.some((m) => m.value === "inventory salvage")).toBe(true);
    expect(searchActions("").length).toBeLessThanOrEqual(25);
    const help = toDiscordCommandBody(COMMAND_PARENTS.find((p) => p.name === "help")!);
    const query = (help.options.find((s) => s["name"] === "search")!["options"] as Array<Record<string, unknown>>)[0];
    expect(query?.["autocomplete"]).toBe(true);
  });

  it("does not dispatch a transfer until explicit confirmation, then permits it once", async () => {
    const command = event("economy", { subcommand: "transfer", options: { member: "123456789012345678", amount: 125 } });
    expect(await prepareExperience(db, command)).toBe(false);
    expect(command.reply).toHaveBeenCalledWith(expect.stringContaining("125 Marks"), expect.anything());
    const id = lastId();
    const confirm = event(`ux:run:${id}`, { kind: "component" });
    expect(await prepareExperience(db, confirm)).toBe(true);
    expect(confirm.name).toBe("economy");
    expect(confirm.options).toEqual({ member: "123456789012345678", amount: 125 });
    expect(confirm.interactionId).toBe(id);
    expect(await prepareExperience(db, event(`ux:run:${id}`))).toBe(false);
  });

  it("opens read-only views immediately, including a selected union action", async () => {
    const wallet = event("ux:route:economy", { values: ["wallet"] });
    expect(await prepareExperience(db, wallet)).toBe(true);
    expect(wallet).toMatchObject({ name: "economy", subcommand: "wallet", options: {} });
    expect(store.size).toBe(0);
    await prepareExperience(db, event("ux:route:inventory", { values: ["gear"] }));
    const choice = event(`ux:value:${lastId()}`, { values: ["list"] });
    expect(await prepareExperience(db, choice)).toBe(true);
    expect(choice.options).toEqual({ action: "list" });
  });

  it("rejects controls belonging to another member, another guild, or an expired session", async () => {
    await prepareExperience(db, event("birthday", { subcommand: "remove" }));
    const id = lastId();
    expect(await prepareExperience(db, event(`ux:run:${id}`, { userId: "intruder" }))).toBe(false);
    expect(await prepareExperience(db, event(`ux:run:${id}`, { guildId: "other" }))).toBe(false);
    expect(store.get(id)?.consumedAt).toBeNull();
    store.get(id)!["expiresAt"] = new Date(0);
    expect(await prepareExperience(db, event(`ux:run:${id}`))).toBe(false);
  });

  it("cancels without dispatching and invalidates the confirmation", async () => {
    await prepareExperience(db, event("birthday", { subcommand: "remove" }));
    const id = lastId();
    const cancel = event(`ux:cancel:${id}`);
    expect(await prepareExperience(db, cancel)).toBe(false);
    expect(cancel.reply).toHaveBeenCalledWith(expect.stringContaining("not submitted"), expect.anything());
    expect(await prepareExperience(db, event(`ux:run:${id}`))).toBe(false);
  });

  it("opens a modal, rejects invalid integers without consuming the form, and accepts a correction", async () => {
    await prepareExperience(db, event("economy", { subcommand: "transfer", options: { member: "123456789012345678" } }));
    const id = lastId();
    const input = event(`ux:input:${id}`);
    expect(await prepareExperience(db, input)).toBe(false);
    expect(input.showModal).toHaveBeenCalledWith(expect.objectContaining({ custom_id: `ux:submit:${id}` }));
    const invalid = event(`ux:submit:${id}`, { options: { value: "1.5" } });
    expect(await prepareExperience(db, invalid)).toBe(false);
    expect(store.get(id)?.consumedAt).toBeNull();
    expect(invalid.reply).toHaveBeenCalledWith(expect.stringContaining("whole number"), expect.anything());
    await prepareExperience(db, event(`ux:submit:${id}`, { options: { value: "25" } }));
    const confirmation = event(`ux:run:${lastId()}`);
    expect(await prepareExperience(db, confirmation)).toBe(true);
    expect(confirmation.options["amount"]).toBe(25);
  });

  it("keeps long receipts complete and binds page navigation to the reader", async () => {
    const body = Array.from({ length: 400 }, (_, i) => `Receipt ${i}: amount 1.00\n`).join("");
    expect(splitPages(body).join("")).toBe(body);
    const paged = await paginateReply(db, event("economy"), body, []);
    expect(paged.content).toContain("Page 1 of");
    const next = paged.rows.at(-1)!.components[0]!["custom_id"] as string;
    const navigation = event(next);
    expect(await prepareExperience(db, navigation)).toBe(false);
    expect(navigation.reply).toHaveBeenCalledWith(expect.stringContaining("Page 2 of"), expect.anything());
    const intruder = event(next, { userId: "other" });
    await prepareExperience(db, intruder);
    expect(intruder.reply).toHaveBeenCalledWith(expect.stringContaining("another member"), expect.anything());
  });

  it("uses consistent notification cards without changing mention policy", () => {
    for (const kind of ["moderation", "birthday", "ticket", "room", "verification"] as const) {
      const notice = notificationPayload(kind, "Stored message @everyone");
      expect(notice.allowed_mentions).toEqual({ parse: [] });
      expect(JSON.stringify(notice)).toContain("Stored message @everyone");
      expect(JSON.stringify(notice)).toContain("**Next**");
      expect(notice).not.toHaveProperty("content");
    }
  });

  it("paginates large sets of controls without dropping any action", async () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ type: 1 as const, components: [{ type: 2, style: 2, custom_id: `original:${i}`, label: `Action ${i}` }] }));
    const first = await paginateReply(db, event("roles"), "Choose a role.", rows);
    expect(first.rows).toHaveLength(5);
    const next = first.rows.at(-1)!.components[0]!["custom_id"] as string;
    const second = event(next);
    await prepareExperience(db, second);
    expect(JSON.stringify(vi.mocked(second.reply).mock.calls)).toContain("original:6");
  });

  it("shows own blackjack hand and actionable controls while hiding dealer and other hands", () => {
    const result = blackjackTableReply({ tableId: "table", status: "playing", turnHandId: "hand", dealer: [{ card: "AS" }, { hidden: true }], seats: [{ userId: "member", hands: [{ handId: "hand", cards: ["7S", "8H"], total: 15, stake: "10.00", status: "playing", outcome: "" }] }, { userId: "other", hands: [{ handId: "other-hand", cards: ["SECRET"], total: 20, stake: "10.00", status: "playing", outcome: "" }] }] }, "member");
    expect(result.content).toContain("**15**");
    expect(result.content).toContain("[hidden]");
    expect(result.content).not.toContain("SECRET");
    expect(result.components?.[0]?.components.map((c) => c["label"])).toEqual(["Hit", "Stand", "Review double", "Review split"]);
  });

  it("never silently cuts result text, role controls or precise currency amounts", () => {
    expect(spokenAmount("9007199254740993.25")).toBe("9,007,199,254,740,993.25");
    expect(() => presentOutcome({ heading: "History", body: "x".repeat(4001) })).toThrow(/Paginate/);
    const rows = Array.from({ length: 5 }, (_, i) => ({ type: 1 as const, components: [{ type: 2, style: 2, custom_id: `role:${i}`, label: "Role" }] }));
    expect(JSON.stringify(presentOutcome({ heading: "Roles", body: "Choose", rows }))).toContain("role:4");
    expect(() => parseField({ name: "amount", type: "integer", description: "Amount", required: true }, "9007199254740993", { parent: "economy", subcommand: "transfer", options: {} })).toThrow(/whole number/);
  });
});
