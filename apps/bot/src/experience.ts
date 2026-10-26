import { activeConfig, executeSession, openSession, type PrismaClient } from "@collective/db";
import { COMMAND_PARENTS, evaluateSession, type CommandParameter } from "@collective/domain";

import type { DiscordInteractionEvent } from "./discord.js";
import { ACTION_FIELDS, MODULE_COPY, SECTIONS, fieldChoices, needsConfirmation, readable, routeDefinition, routeFields, routeTitle, type Route } from "./experience-catalog.js";
import { previewEffects, suggestValues } from "./experience-data.js";
import { buttonRow, type OutcomeRow } from "./present.js";

type State = { route: Route; done: string[]; phase: "fields" | "review"; effects?: string; customize?: boolean };
const PURPOSE = "discord.experience";
const TTL = 15 * 60 * 1000;

export interface FollowupAction { label: string; parent?: string; subcommand: string; options: Record<string, string | boolean | number> }

export async function followupRows(db: PrismaClient, event: DiscordInteractionEvent, action: FollowupAction): Promise<OutcomeRow[]> {
  const route = { parent: action.parent ?? event.name, subcommand: action.subcommand, options: action.options };
  const session = await save(db, event, { route, done: [], phase: "fields" });
  return [buttonRow([{ id: `ux:resume:${session.id}`, label: action.label, style: 1 }, { id: `go:${route.parent}:open`, label: "More actions" }])];
}

function menu(id: string, placeholder: string, options: Array<{ label: string; value: string; description?: string }>): OutcomeRow {
  const unique = options.filter((o, i) => options.findIndex((candidate) => candidate.value === o.value) === i);
  return { type: 1, components: [{ type: 3, custom_id: id, placeholder, min_values: 1, max_values: 1, options: unique.slice(0, 25).map((o) => ({ ...o, label: o.label.slice(0, 100), ...(o.description ? { description: o.description.slice(0, 100) } : {}) })) }] };
}

export function homeRows(): OutcomeRow[] {
  return [menu("ux:section", "Choose a section", SECTIONS.map((s, i) => ({ label: s.name, value: String(i) })))];
}

export function moduleRows(parent: string): OutcomeRow[] {
  const command = COMMAND_PARENTS.find((p) => p.name === parent);
  if (!command) return homeRows();
  return [menu(`ux:route:${parent}`, "Choose what to do", command.options.filter((s) => s.name !== "open").map((s) => ({ label: readable(s.name), value: s.name, description: s.description }))), buttonRow([{ id: "ux:home", label: "All sections" }])];
}

export function searchActions(query: string) {
  const needle = query.trim().toLowerCase().replace(/^\//, "");
  return COMMAND_PARENTS.flatMap((parent) => parent.options.filter((s) => s.name !== "open").map((s) => ({
    name: `/${parent.name} ${s.name} · ${s.description}`.slice(0, 100), value: `${parent.name} ${s.name}`,
  }))).filter((s) => !needle || `${s.name} ${MODULE_COPY[s.value.split(" ")[0] ?? ""]?.description ?? ""}`.toLowerCase().includes(needle)).slice(0, 25);
}

async function save(db: PrismaClient, event: DiscordInteractionEvent, payload: State) {
  return openSession(db, { guildId: event.guildId!, actorUserId: event.userId, purpose: PURPOSE, payload: { route: { parent: payload.route.parent, subcommand: payload.route.subcommand, options: payload.route.options }, done: payload.done, phase: payload.phase, ...(payload.effects !== undefined ? { effects: payload.effects } : {}), ...(payload.customize ? { customize: true } : {}) }, expiresAt: new Date(Date.now() + TTL) });
}

export function customizeRow(parent: string, subcommand: string, options: Record<string, string | boolean | number>): OutcomeRow | null {
  const route = { parent, subcommand, options };
  if (needsConfirmation(route) || !routeDefinition(route)?.options.length) return null;
  return buttonRow([{ id: `ux:details:${parent}:${subcommand}`, label: parent === "character" && subcommand === "stats" ? "Allocate stat points" : "Change options" }]);
}

function readyRead(event: DiscordInteractionEvent, state: State): boolean {
  if (state.customize || needsConfirmation(state.route) || routeFields(state.route).some((f) => f.required && state.route.options[f.name] === undefined)) return false;
  event.name = state.route.parent; event.subcommand = state.route.subcommand; event.options = state.route.options;
  return true;
}

async function load(db: PrismaClient, event: DiscordInteractionEvent, id: string) {
  const session = await db.interactionSession.findUnique({ where: { id } });
  if (!session || session.guildId !== event.guildId || ![PURPOSE, "discord.pages"].includes(session.purpose)) return null;
  const config = await activeConfig(db, session.guildId);
  if (evaluateSession(session, event.userId, config?.version ?? 0, new Date()) !== "ok") return null;
  return session;
}

function summary(route: Route): string {
  const fields = routeDefinition(route)?.options ?? [];
  return Object.entries(route.options).map(([key, value]) => {
    const field = fields.find((f) => f.name === key);
    const choice = field && fieldChoices(route, field)?.find((c) => c.value === value);
    const shown = choice?.name ?? (typeof value === "boolean" ? value ? "Yes" : "No" : String(value));
    return `**${readable(key)}:** ${shown.replaceAll("`", "ˋ").replace(/([*_~|<>])/g, "\\$1")}`;
  }).join("\n") || "Use the current defaults.";
}

async function showState(db: PrismaClient, event: DiscordInteractionEvent, state: State): Promise<void> {
  const fields = routeFields(state.route);
  const next = state.phase === "fields" ? fields.find((f) => !state.done.includes(f.name) && state.route.options[f.name] === undefined) : undefined;
  if (!next) state.effects = await previewEffects(db, state.route, event);
  const saved = await save(db, event, state);
  const id = saved.id;
  if (!next) {
    await event.reply(`**${routeTitle(state.route)}**\n\n${summary(state.route)}\n\n${state.effects}\n\nChoose **Confirm** to continue, **Edit details** to change the inputs, or **Cancel** to leave.`, { components: [buttonRow([
      { id: `ux:run:${id}`, label: "Confirm", style: 1 },
      { id: `ux:edit:${id}`, label: "Edit details" },
      { id: `ux:cancel:${id}`, label: "Cancel" },
    ])] });
    return;
  }
  const choices = fieldChoices(state.route, next);
  const suggestions = choices ?? (next.type === "boolean" ? [{ name: "Yes", value: "true" }, { name: "No", value: "false" }] : await suggestValues(db, state.route, next, event));
  const rows: OutcomeRow[] = [];
  if (["user", "role", "channel"].includes(next.type)) {
    rows.push({ type: 1, components: [{ type: next.type === "user" ? 5 : next.type === "role" ? 6 : 8, custom_id: `ux:value:${id}`, placeholder: next.description, min_values: 1, max_values: 1 }] });
  } else if (suggestions.length > 0) {
    rows.push(menu(`ux:value:${id}`, next.description.slice(0, 150), suggestions.map((c) => ({ label: c.name, value: String(c.value) }))));
  }
  const buttons = [];
  if (!choices && !["boolean", "user", "role", "channel"].includes(next.type)) buttons.push({ id: `ux:input:${id}`, label: suggestions.length ? "Enter another value" : "Enter details", style: 1 });
  if (!next.required) buttons.push({ id: `ux:skip:${id}`, label: "Use default / skip" });
  if (fields.filter((f) => !state.done.includes(f.name) && state.route.options[f.name] === undefined).every((f) => !f.required)) buttons.push({ id: `ux:review:${id}`, label: "Review now" });
  buttons.push({ id: `ux:edit:${id}`, label: "Start over" }, { id: `ux:cancel:${id}`, label: "Cancel" });
  rows.push(buttonRow(buttons));
  const completed = state.done.length + Object.keys(state.route.options).length;
  await event.reply(`**${routeTitle(state.route)}**\n\n${next.description}\n${next.required ? "Required" : "Optional, skip to keep the existing behaviour."}\n\n${completed ? summary(state.route) : "Your choices will appear here as you go."}`, { components: rows });
}

export function parseField(field: CommandParameter, value: string, route: Route): string | number | boolean {
  const choices = fieldChoices(route, field);
  if (choices && !choices.some((c) => String(c.value) === value)) throw new Error("Choose one of the listed options.");
  if (!value.trim() && field.required) throw new Error(`${field.description} is required.`);
  if (field.type === "integer") {
    if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("Enter a whole number within the supported range.");
    return Number(value);
  }
  if (field.type === "boolean") {
    if (value !== "true" && value !== "false") throw new Error("Choose Yes or No.");
    return value === "true";
  }
  if (["user", "role", "channel"].includes(field.type) && !/^\d{17,20}$/.test(value)) throw new Error("Select a member, role or channel from Discord.");
  if (field.name === "when" && value && value !== "now" && !Number.isFinite(Date.parse(value))) throw new Error("Enter an ISO date and time with a timezone, for example 2026-11-01T18:00:00+08:00.");
  if (value.length > 4000) throw new Error("Keep this field to 4,000 characters or fewer.");
  return value;
}

// Returns true only when the existing service dispatcher should execute the
// prepared route. No service mutation is performed by the menu/form layer.
export async function prepareExperience(db: PrismaClient, event: DiscordInteractionEvent): Promise<boolean> {
  if (event.name === "ux:home" || (event.name === "help" && event.subcommand === "open")) {
    await event.reply("**The Collective**\nYour next move starts here. Choose a section, then an action. Staff tools still require your existing permissions.", { components: homeRows() });
    return false;
  }
  if (event.name === "ux:section") {
    const section = SECTIONS[Number(event.values?.[0])];
    if (!section) { await event.reply("That section is unavailable. Open `/help open` to start again."); return false; }
    await event.reply(`**${section.name}**\nChoose a destination.`, { components: [menu("ux:module", "Choose a destination", section.commands.map((name) => ({ label: MODULE_COPY[name]!.title, value: name, description: MODULE_COPY[name]!.description }))), buttonRow([{ id: "ux:home", label: "All sections" }])] });
    return false;
  }
  if (event.name === "ux:module" || event.subcommand === "open") {
    const parent = event.name === "ux:module" ? event.values?.[0] ?? "help" : event.name;
    const copy = MODULE_COPY[parent];
    await event.reply(`**${copy?.title ?? "Choose an action"}**\n${copy?.description ?? "Open a section to continue."}`, { components: moduleRows(parent) });
    return false;
  }
  if (event.name.startsWith("ux:route:")) {
    const parent = event.name.slice("ux:route:".length);
    const route = { parent, subcommand: event.values?.[0] ?? "", options: {} };
    if (!routeDefinition(route)) { await event.reply("That action is unavailable. Open the menu again."); return false; }
    if (routeFields(route).every((f) => !f.required) && !needsConfirmation(route)) {
      event.name = route.parent; event.subcommand = route.subcommand; event.options = {}; return true;
    }
    await showState(db, event, { route, done: [], phase: "fields" });
    return false;
  }
  if (event.name.startsWith("ux:details:")) {
    const [, , parent, subcommand] = event.name.split(":");
    const route = { parent: parent ?? "", subcommand: subcommand ?? "", options: {} };
    if (!routeDefinition(route)) { await stale(event); return false; }
    await showState(db, event, { route, done: [], phase: "fields", customize: true });
    return false;
  }
  if (event.name.startsWith("ux:quote:")) {
    const [, , parent, subcommand, quote] = event.name.split(":");
    if (!["lottery", "deaddrop", "blackjack"].includes(parent ?? "")) { await stale(event); return false; }
    const route: Route = { parent: parent!, subcommand: subcommand ?? "", options: { quote: quote ?? "", action: parent === "blackjack" ? "open" : "buy" } };
    if (parent === "blackjack") {
      const saved = await db.blackjackQuote.findFirst({ where: { id: quote ?? "", guildId: event.guildId!, userId: event.userId } });
      if (saved?.tableId) { route.options["action"] = "join"; route.options["table"] = saved.tableId; }
    }
    if (!routeDefinition(route)) { await stale(event); return false; }
    await showState(db, event, { route, done: [], phase: "review" });
    return false;
  }
  if (event.name === "ux:role-panel") {
    event.name = "roles"; event.subcommand = "panel"; event.options = { name: event.values?.[0] ?? "" };
    return true;
  }
  if (event.name.startsWith("ux:bj:")) {
    const [, , table, action] = event.name.split(":");
    if (!["hit", "stand", "double", "split"].includes(action ?? "")) { await stale(event); return false; }
    event.name = "blackjack"; event.subcommand = "solo"; event.options = { table: table ?? "", action: action! };
    if (["double", "split"].includes(action!)) { await showState(db, event, { route: { parent: event.name, subcommand: event.subcommand, options: event.options }, done: [], phase: "review" }); return false; }
    return true;
  }
  if (event.name.startsWith("ux:page:")) {
    const [, , id, rawPage] = event.name.split(":");
    const session = await load(db, event, id ?? "");
    if (!session || session.purpose !== "discord.pages") { await stale(event); return false; }
    const payload = session.payload as unknown as { pages: string[]; rows: OutcomeRow[]; pageRows?: OutcomeRow[][] };
    const page = Number(rawPage);
    if (!Number.isInteger(page) || page < 0 || page >= payload.pages.length) { await stale(event); return false; }
    await event.reply(payload.pages[page]!, { components: pageRows(session.id, page, payload.pages.length, payload.pageRows?.[page] ?? payload.rows) });
    return false;
  }
  if (event.name.startsWith("ux:")) {
    const [, action, id] = event.name.split(":");
    const session = await load(db, event, id ?? "");
    if (!session || session.purpose !== PURPOSE) { await stale(event); return false; }
    const state = session.payload as unknown as State;
    const field = routeFields(state.route).find((f) => !state.done.includes(f.name) && state.route.options[f.name] === undefined);
    if (action === "input" && field) {
      await event.showModal?.({ custom_id: `ux:submit:${session.id}`, title: readable(field.name).slice(0, 45), components: [{ type: 1, components: [{ type: 4, custom_id: "value", label: field.description.slice(0, 45), placeholder: field.type === "integer" ? "Enter a whole number" : field.description.slice(0, 100), style: ["note", "reason", "bio", "body", "answer", "recap", "text"].includes(field.name) ? 2 : 1, required: field.required, max_length: field.type === "integer" ? 16 : 4000 }] }] });
      return false;
    }
    if (!["value", "submit", "skip", "review", "run", "cancel", "edit", "resume"].includes(action ?? "")) { await stale(event); return false; }
    // Validate before consuming, so a typo leaves the form available to retry.
    let value: string | number | boolean | undefined;
    if (action === "value" || action === "submit") {
      if (!field) { await stale(event); return false; }
      try { value = parseField(field, String(event.values?.[0] ?? event.options["value"] ?? ""), state.route); }
      catch (error) { await event.reply(`${error instanceof Error ? error.message : "Check that value."}\nUse the previous form to try again.`, { components: [buttonRow([{ id: `ux:input:${session.id}`, label: "Try again" }, { id: `ux:cancel:${session.id}`, label: "Cancel" }])] }); return false; }
    }
    if (action === "skip" && (!field || field.required)) { await stale(event); return false; }
    if (action === "review" && routeFields(state.route).some((f) => f.required && state.route.options[f.name] === undefined)) { await stale(event); return false; }
    if (action === "run" && routeFields(state.route).some((f) => f.required && state.route.options[f.name] === undefined)) { await stale(event); return false; }
    if (action === "run" && state.effects !== await previewEffects(db, state.route, event)) {
      await executeSession(db, { sessionId: session.id, actorUserId: event.userId, roleIds: event.roleIds, now: new Date() });
      await showState(db, event, { ...state, phase: "review" });
      return false;
    }
    const consumed = await executeSession(db, { sessionId: session.id, actorUserId: event.userId, roleIds: event.roleIds, now: new Date() });
    if (!consumed.ok) { await stale(event); return false; }
    if (action === "cancel") { await event.reply("Cancelled. This action was not submitted.", { components: moduleRows(state.route.parent) }); return false; }
    if (action === "run") {
      event.name = state.route.parent; event.subcommand = state.route.subcommand; event.options = state.route.options;
      // Keep the dispatch key stable for this one confirmation, including retries.
      event.interactionId = session.id;
      return true;
    }
    if (action === "edit") { await showState(db, event, { route: { ...state.route, options: {} }, done: [], phase: "fields" }); return false; }
    if (action === "resume") { if (readyRead(event, state)) return true; await showState(db, event, state); return false; }
    if (action === "review") { await showState(db, event, { ...state, phase: "review" }); return false; }
    if (field) {
      if (value !== undefined && value !== "") state.route.options[field.name] = value;
      state.done.push(field.name);
    }
    if (readyRead(event, state)) return true;
    await showState(db, event, state);
    return false;
  }
  const route: Route = { parent: event.name, subcommand: event.subcommand ?? "", options: { ...event.options } };
  delete route.options["subcommand"];
  if (!routeDefinition(route)) return true;
  const missing = routeFields(route).some((f) => f.required && route.options[f.name] === undefined);
  // Empty shortcuts open a real form instead of dispatching an invalid mutation.
  if (missing) { await showState(db, event, { route, done: [], phase: "fields" }); return false; }
  if (needsConfirmation(route)) { await showState(db, event, { route, done: [], phase: "review" }); return false; }
  return true;
}

async function stale(event: DiscordInteractionEvent) {
  await event.reply("This control has expired, was already used, or belongs to another member. Open a fresh menu to continue.", { components: homeRows() });
}

export function splitPages(body: string, limit = 2700): string[] {
  const pages: string[] = [];
  let remaining = body;
  while (remaining.length > limit) {
    const boundary = remaining.lastIndexOf("\n", limit);
    const end = boundary > limit / 2 ? boundary + 1 : limit;
    pages.push(remaining.slice(0, end)); remaining = remaining.slice(end);
  }
  if (remaining || pages.length === 0) pages.push(remaining);
  return pages;
}

function pageRows(id: string, page: number, total: number, rows: OutcomeRow[]): OutcomeRow[] {
  return [...rows, buttonRow([
    ...(page > 0 ? [{ id: `ux:page:${id}:${page - 1}`, label: "Previous page" }] : []),
    ...(page + 1 < total ? [{ id: `ux:page:${id}:${page + 1}`, label: "Next page" }] : []),
  ])].filter((r) => r.components.length > 0);
}

export async function paginateReply(db: PrismaClient, event: Pick<DiscordInteractionEvent, "guildId" | "userId">, content: string, rows: OutcomeRow[]) {
  const pages = splitPages(content);
  if ((pages.length === 1 && rows.length <= 5) || !event.guildId) return { content, rows };
  const count = Math.max(pages.length, Math.ceil(rows.length / 4));
  const controls = Array.from({ length: count }, (_, i) => rows.length > 4 ? rows.slice(i * 4, i * 4 + 4) : rows);
  const numbered = Array.from({ length: count }, (_, i) => `${pages[Math.min(i, pages.length - 1)]}\n\n-# Page ${i + 1} of ${count}`);
  const session = await openSession(db, { guildId: event.guildId, actorUserId: event.userId, purpose: "discord.pages", payload: { pages: numbered, rows: [], pageRows: JSON.parse(JSON.stringify(controls)) }, expiresAt: new Date(Date.now() + TTL) });
  return { content: numbered[0]!, rows: pageRows(session.id, 0, count, controls[0] ?? []) };
}

// Used by tests and the coverage report to ensure action unions never silently
// fall back to showing every unrelated slash option.
export function catalogProblems(): string[] {
  const errors: string[] = [];
  for (const parent of COMMAND_PARENTS) {
    if (!MODULE_COPY[parent.name]) errors.push(`Missing module copy: ${parent.name}`);
    for (const sub of parent.options) {
      const actions = fieldChoices({ parent: parent.name, subcommand: sub.name, options: {} }, { name: "action", type: "string", description: "", required: false });
      for (const choice of actions ?? []) {
        const route = `${parent.name}.${sub.name}`;
        const fields = ACTION_FIELDS[route]?.[String(choice.value)];
        if (fields === undefined) errors.push(`Missing action fields: ${route}.${choice.value}`);
        for (const token of fields?.split(" ").filter(Boolean) ?? []) if (!sub.options.some((f) => f.name === token.replace("!", ""))) errors.push(`Unknown field: ${route}.${token}`);
      }
    }
  }
  return errors;
}
