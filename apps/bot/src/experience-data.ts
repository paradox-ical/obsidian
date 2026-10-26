import {
  browseListings, browseShop, inspectListing, inspectTrade, listCases, listCrates, listRecipes, listRolePanels, listTickets,
  previewCraft, previewReroll, previewSalvage, previewUpgrade, readBlackjack, readCharacter, readGatherings, readGear, readTicketSettings,
  type PrismaClient,
} from "@collective/db";
import { LISTING_FEE_MARKS, type CommandParameter } from "@collective/domain";

import type { DiscordInteractionEvent } from "./discord.js";
import { type Route } from "./experience-catalog.js";
import { spokenAmount } from "./present.js";

type Actor = Pick<DiscordInteractionEvent, "guildId" | "userId" | "roleIds">;

export async function suggestValues(db: PrismaClient, route: Route, field: CommandParameter, actor: Actor): Promise<Array<{ name: string; value: string | number }>> {
  const guildId = actor.guildId!;
  if (field.name === "item" && ["inventory", "shop", "explore"].includes(route.parent)) {
    return (await readGear(db, guildId, actor.userId)).filter((item) => !item.destroyed).slice(0, 25).map((item) => ({ name: `${item.name} · tier ${item.upgradeTier}${item.equipped ? " · equipped" : ""}${item.lock ? " · locked" : ""} · ${item.id.slice(-6)}`, value: item.id }));
  }
  if (route.parent === "character" && field.name === "ability") {
    const sheet = await readCharacter(db, guildId, actor.userId, new Date());
    return sheet.status === "ready" ? sheet.abilities.map((a) => ({ name: `${a.name} · level ${a.unlockLevel}`, value: a.slug })) : [];
  }
  if (field.name === "offer" && (route.subcommand === "supply" || route.subcommand === "ingot")) {
    const shop = await browseShop(db, { guildId, userId: actor.userId, shop: route.subcommand, now: new Date() });
    return shop.result === "ready" ? shop.offers.slice(0, 25).map((o) => ({ name: `${o.slug} · ${o.price} ${o.currency} · stock ${o.stock}`, value: o.slug })) : [];
  }
  if (field.name === "recipe") return (await listRecipes(db, guildId)).slice(0, 25).map((r) => ({ name: `${r.slug} · ${r.inputAmount} ${r.inputSlug}`, value: r.slug }));
  if (field.name === "crate") {
    const crates = await listCrates(db, { guildId, userId: actor.userId });
    return crates.result === "ready" ? crates.grants.slice(0, 25).map((g) => ({ name: `${g.tableSlug} · ${g.grantId.slice(-6)}`, value: route.options["action"] === "preview" ? g.tableSlug : g.grantId })) : [];
  }
  if (route.parent === "roles" && field.name === "name") return (await listRolePanels(db, guildId)).slice(0, 25).map((p) => ({ name: p.name, value: p.name }));
  if (route.parent === "support" && field.name === "category") {
    const settings = await readTicketSettings(db, guildId);
    return settings.settings.categories.slice(0, 25).map((c) => ({ name: c.label, value: c.id }));
  }
  if (field.name === "affix" && route.options["item"]) {
    const item = (await readGear(db, guildId, actor.userId)).find((g) => g.id === route.options["item"]);
    return item?.affixes.map((a) => ({ name: `${a.slug} · ${a.amount}`, value: a.slug })) ?? [];
  }
  if (field.name === "ticket") {
    const tickets = await listTickets(db, { guildId, actorUserId: actor.userId, actorRoleIds: actor.roleIds });
    return tickets.tickets.slice(0, 25).map((t) => ({ name: `#${t.number} · ${t.status}`, value: t.id }));
  }
  if (field.name === "case") {
    const cases = await listCases(db, { guildId, actorRoleIds: actor.roleIds });
    return cases.result === "denied" ? [] : cases.cases.slice(0, 25).map((c) => ({ name: `${c.id.slice(-8)} · ${c.outcome}`, value: c.id }));
  }
  if (field.name === "listing") return (await browseListings(db, { guildId })).slice(0, 25).map((l) => ({ name: `${l.listingId.slice(-8)} · ${l.priceMarks} Marks`, value: l.listingId }));
  if (["occurrence", "crew", "session"].includes(field.name) && ["crew", "events", "schedule", "explore"].includes(route.parent)) {
    const gatherings = await readGatherings(db, { guildId, actorRoleIds: actor.roleIds });
    if (gatherings.result !== "ok") return [];
    if (field.name === "occurrence") return gatherings.occurrences.slice(0, 25).map((o) => ({ name: `${o.name} · ${o.startsAt.toISOString()}`, value: o.id }));
    if (field.name === "crew") return gatherings.crews.slice(0, 25).map((c) => ({ name: c.name, value: c.id }));
    return gatherings.sessions.slice(0, 25).map((s) => ({ name: `${s.name} · ${s.status}`, value: s.id }));
  }
  return [];
}

function marks(minor: bigint): string {
  const sign = minor < 0n ? "-" : "";
  const positive = minor < 0n ? -minor : minor;
  return `${sign}${(positive / 100n).toLocaleString("en-AU")}.${String(positive % 100n).padStart(2, "0")} Marks`;
}

export async function previewEffects(db: PrismaClient, route: Route, actor: Actor): Promise<string> {
  const guildId = actor.guildId!;
  const userId = actor.userId;
  const action = String(route.options["action"] ?? "");
  const itemId = String(route.options["item"] ?? "");
  const key = `${route.parent}.${route.subcommand}`;
  if (key === "economy.transfer") return `Send **${spokenAmount(String(route.options["amount"]))} Marks** to <@${route.options["member"]}>. The transfer uses your available balance.`;
  if (key === "economy.adjust") return `${action === "set" ? "Set the available balance to" : action === "remove" ? "Remove" : "Grant"} **${spokenAmount(String(route.options["amount"]))} Marks** for <@${route.options["member"]}>. Your reason will be recorded. Existing budgets and permissions apply.`;
  if (key === "character.respec") {
    return action === "class" ? "**Cost: 15,000 Marks.** Change class and reset allocated stats. Class changes have a 30-day cooldown."
      : action === "intro" ? "Use your one introductory reset. Eligibility and gameplay locks are checked before applying it."
        : "**Cost: 5,000 Marks.** Return allocated stats to unspent points. Respecs have a seven-day cooldown.";
  }
  if (route.parent === "inventory" && ["salvage", "upgrade", "reroll", "craft"].includes(route.subcommand)) {
    if (route.subcommand === "salvage") {
      const p = await previewSalvage(db, { guildId, userId, itemId });
      return p.result === "preview" ? `**Destroy the selected item permanently.** Receive ${p.amount} ${p.material}.` : "This item cannot currently be salvaged. The service will check ownership and locks again.";
    }
    if (route.subcommand === "upgrade") {
      const p = await previewUpgrade(db, { guildId, userId, itemId });
      return p.result === "preview" ? `**Cost: ${p.marks} Marks + ${p.amount} ${p.material}.** Apply the guaranteed next upgrade.` : "This upgrade is currently unavailable. Check the item's ownership, locks and upgrade cap.";
    }
    if (route.subcommand === "reroll") {
      const p = await previewReroll(db, { guildId, userId, itemId, affix: String(route.options["affix"] ?? "") });
      return p.result === "preview" ? `**Cost: ${p.marks} Marks.** Replace ${p.slug} with a roll from ${p.min} to ${p.max}.` : "This affix cannot currently be rerolled.";
    }
    const p = await previewCraft(db, { guildId, recipeSlug: String(route.options["recipe"] ?? "") });
    return p.result === "preview" ? `**Spend ${p.inputAmount} ${p.inputSlug}.** Craft ${p.outputSlug}.` : "This recipe is currently unavailable.";
  }
  if (route.parent === "shop" && action === "buy") {
    if (route.subcommand === "marketplace") {
      const p = await inspectListing(db, { guildId, listingId: String(route.options["listing"] ?? "") });
      return p.result === "ready" ? `**Cost: ${p.priceMarks} Marks.** Purchase the listed item. Stock and balance are checked again on confirmation.` : "This listing is no longer available.";
    }
    if (route.subcommand === "supply" || route.subcommand === "ingot") {
      const p = await browseShop(db, { guildId, userId, shop: route.subcommand, now: new Date() });
      const offer = p.result === "ready" ? p.offers.find((o) => o.slug === route.options["offer"]) : null;
      return offer ? `**Cost: ${offer.price} ${offer.currency}.** Stock: ${offer.stock}. Purchase one offer. Any Steam key remains in your private inbox.` : "This offer is currently unavailable.";
    }
  }
  if (key === "inventory.trade" && action === "confirm") {
    const p = await inspectTrade(db, { guildId, userId, tradeId: String(route.options["trade"] ?? "") });
    return p.result === "ready" ? `Confirm **version ${p.version}** of trade ${p.tradeId}.\n<@${p.fromUserId}> offers **${p.offerMarks} Marks** and item ${p.offerItemId || "none"}.\n<@${p.toUserId}> offers **${p.requestMarks} Marks** and item ${p.requestItemId || "none"}.\nBoth parties must confirm the same version.` : "This trade is no longer available to you.";
  }
  if (["lottery.tickets", "deaddrop.pick", "blackjack.solo", "blackjack.social"].includes(key) && ["buy", "open", "join"].includes(action)) {
    const where = { id: String(route.options["quote"] ?? ""), guildId, userId };
    if (route.parent === "lottery") {
      const q = await db.lotteryQuote.findFirst({ where });
      return q ? `**Cost: ${marks(q.priceMinor)}.** Buy ${q.quantity} tickets for draw ${q.drawId}. Quote expires ${q.expiresAt.toISOString()}.` : "This quote is unavailable or belongs to another member. Request a new quote.";
    }
    if (route.parent === "deaddrop") {
      const q = await db.deadDropQuote.findFirst({ where });
      return q ? `**Cost: ${marks(q.priceMinor)}.** Reveal cell ${q.coordinate}. Quote expires ${q.expiresAt.toISOString()}.` : "This quote is unavailable or belongs to another member. Request a new quote.";
    }
    const q = await db.blackjackQuote.findFirst({ where });
    return q ? `**Initial stake: ${marks(q.stakeMinor)}.** Splits and doubles can increase the total stake to **${marks(q.stakeMinor * 4n)}**. Quote expires ${q.expiresAt.toISOString()}.` : "This quote is unavailable or belongs to another member. Request a new quote.";
  }
  if (route.parent === "combat" && ["queue", "challenge"].includes(route.subcommand)) {
    if (action === "accept") {
      const match = await db.pvpMatch.findFirst({ where: { id: String(route.options["match"] ?? ""), guildId, OR: [{ leftUserId: userId }, { rightUserId: userId }] } });
      return match ? `Accept a **${match.mode} ${match.style}** match against <@${match.leftUserId === userId ? match.rightUserId : match.leftUserId}>.\n**Stake: ${match.stake} Marks per fighter.**\n${match.rules}` : "This match is unavailable or you are not a participant.";
    }
    return `Equal stake: **${route.options["stake"] ?? 0} Marks per fighter** when offered. The existing eligibility and escrow checks apply.`;
  }
  if (key === "shop.marketplace" && action === "list") {
    const settings = await db.workshopSettings.findUnique({ where: { guildId } });
    return `List your selected item for **${route.options["price"]} Marks**.\n**Listing fee: ${settings?.listingFeeMarks ?? LISTING_FEE_MARKS} Marks.** The item is locked while the listing remains open.`;
  }
  if (route.parent === "blackjack" && ["double", "split"].includes(action)) {
    const current = await readBlackjack(db, { guildId, userId });
    const table = current.result === "ready" ? current.tables.find((t) => "tableId" in t && t.tableId === route.options["table"]) : null;
    const seat = table && "seats" in table ? table.seats?.find((s) => s.userId === userId) : null;
    const hand = seat?.hands.find((h) => h.status === "playing");
    return hand ? `**Additional stake: ${hand.stake} Marks.** ${action === "double" ? "Double this hand's stake, take one card and stand." : "Split this pair into two hands."} The service checks your turn, balance and eligibility again.` : "No playable hand was found for you at this table.";
  }
  if (key === "birthday.remove") return "Delete your saved birthday and announcement preference.";
  if (key === "profile.preferences") return "Save the supplied bio. An empty bio clears your existing bio.";
  if (key === "profile.cosmetics") return "Save the selected cosmetic labels. A blank frame or background clears that existing label.";
  if (key === "accounts.unlink") return "Remove the selected linked account. Ordinary server access is unaffected.";
  if (key === "shop.ingot" && action === "reveal") return "Reveal this purchase's key privately. A revealed key cannot be made unseen, and a refund may require staff review.";
  if (key === "inventory.crates" && action === "open") return "Open this owned crate and show its stored outcome. It will not roll again.";
  if (key === "mod.sanctions") return `Apply **${action}** to the selected member with the stated reason. Discord permissions and role hierarchy remain authoritative.`;
  if (key === "events.manage" && action === "create") return `Create an event with capacity **25**, duration **60 minutes**, waitlist enabled and no attendance reward. ${route.options["when"] ? "Use the selected start time for a one-off event." : "With no start time supplied, the existing default is daily at 09:00 Australia/Perth."} Discord event sync has its own delivery status.`;
  if (key === "crew.session" && action === "create") return `Create a session for **${route.options["size"] ?? 4}** people, with **${route.options["mode"] ?? "open"}** joining. ${route.options["when"] ? "Use the selected start time." : "Default start: one hour after confirmation."}`;
  return "Submit the details shown above. Your permissions, current state and all existing costs or eligibility rules are checked again when the action runs.";
}
