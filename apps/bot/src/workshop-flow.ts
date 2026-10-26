import {
  applyReroll,
  applyUpgrade,
  browseListings,
  buyListing,
  cancelListing,
  cancelTrade,
  confirmSalvage,
  confirmTrade,
  craftItem,
  editTrade,
  inspectListing,
  inspectTrade,
  listItem,
  listRecipes,
  offerTrade,
  previewCraft,
  previewReroll,
  previewSalvage,
  previewUpgrade,
  readMaterials,
  type PrismaClient,
} from "@collective/db";

import { runSupplyCommand } from "./shop-flow.js";

type Options = Record<string, string | boolean | number>;

function text(options: Options, key: string): string {
  const value = options[key];
  return typeof value === "string" ? value : "";
}

function amount(options: Options, key: string): number {
  const value = options[key];
  return typeof value === "number" ? value : 0;
}

export async function runWorkshopCommand(
  db: PrismaClient,
  input: { subcommand?: string; options: Options; guildId: string; userId: string; now: Date },
) {
  const action = text(input.options, "action");
  const itemId = text(input.options, "item");
  if (input.subcommand === "materials") {
    const rows = await readMaterials(db, { guildId: input.guildId, userId: input.userId });
    const shown = rows.length > 0 ? rows.map((row) => `${row.slug} ${row.quantity}`).join(", ") : "No materials yet.";
    return { content: `${shown}\n\nCrates are \`/inventory crates\`. The notice is not posted.` };
  }
  if (input.subcommand === "trade") {
    return { content: await tradeText(db, input, action, itemId) };
  }
  if (input.subcommand === "craft") {
    return { content: await craftText(db, input, action) };
  }
  if (input.subcommand === "salvage" && itemId) {
    if (action === "confirm") {
      const salvaged = await confirmSalvage(db, { guildId: input.guildId, userId: input.userId, itemId, now: input.now });
      if (salvaged.result === "destroyed" && "amount" in salvaged) {
        return { content: `Salvage confirmed. The item is destroyed and pays ${salvaged.amount} ${salvaged.material}. The notice is not posted.` };
      }
      return { content: salvageRefusal(salvaged.result) };
    }
    const preview = await previewSalvage(db, { guildId: input.guildId, userId: input.userId, itemId });
    if (preview.result !== "preview") {
      return { content: "That item was not found." };
    }
    return { content: `Salvage would destroy this item and pay ${preview.amount} ${preview.material}. Confirm before anything is destroyed.` };
  }
  if (input.subcommand === "upgrade" && itemId) {
    if (action === "apply") {
      const upgraded = await applyUpgrade(db, { guildId: input.guildId, userId: input.userId, itemId, now: input.now });
      if (upgraded.result === "ready") {
        return { content: `Upgrade ${upgraded.tier} applied. The item was not destroyed. The notice is not posted.` };
      }
      return { content: upgraded.result === "capped" ? "That item is at the upgrade cap." : upgraded.result === "insufficient" ? "The upgrade cost was not available. Nothing was spent." : "That upgrade was not applied." };
    }
    const preview = await previewUpgrade(db, { guildId: input.guildId, userId: input.userId, itemId });
    if (preview.result === "capped") {
      return { content: "That item is at the upgrade cap." };
    }
    if (preview.result !== "preview") {
      return { content: "That item was not found." };
    }
    return { content: `The next upgrade costs ${preview.marks} Marks and ${preview.amount} ${preview.material}. It is guaranteed.` };
  }
  if (input.subcommand === "reroll" && itemId) {
    const affix = text(input.options, "affix");
    if (action === "apply") {
      const rolled = await applyReroll(db, { guildId: input.guildId, userId: input.userId, itemId, affix, now: input.now });
      if (rolled.result === "ready") {
        return { content: `${rolled.affix} is now ${rolled.amount}, inside ${rolled.min} to ${rolled.max}. Reroll count ${rolled.rerollCount}. The notice is not posted.` };
      }
      return { content: rolled.result === "insufficient" ? "The reroll cost was not available. The affix was not changed." : "That reroll was not applied." };
    }
    const preview = await previewReroll(db, { guildId: input.guildId, userId: input.userId, itemId, affix });
    if (preview.result !== "preview") {
      return { content: "That affix cannot be rerolled." };
    }
    return { content: `${preview.slug} can roll ${preview.min} to ${preview.max}. This reroll costs ${preview.marks} Marks.` };
  }
  return { content: "Name the item, or pick the action. Crates are `/inventory crates`." };
}

async function tradeText(db: PrismaClient, input: { options: Options; guildId: string; userId: string; now: Date }, action: string, itemId: string) {
  const tradeId = text(input.options, "trade");
  if (action === "inspect" && tradeId) {
    const inspected = await inspectTrade(db, { guildId: input.guildId, userId: input.userId, tradeId });
    if (inspected.result !== "ready") {
      return "That trade was not found.";
    }
    const items = "items" in inspected ? inspected.items.map((item) => `${item.name} tier ${item.upgradeTier} rerolls ${item.rerollCount}`).join("; ") : "";
    return `Trade ${inspected.tradeId} version ${inspected.version}. ${items} Confirmations reset when the offer changes. The notice is not posted.`;
  }
  if (action === "confirm" && tradeId) {
    const confirmed = await confirmTrade(db, { guildId: input.guildId, userId: input.userId, tradeId, now: input.now });
    if (confirmed.result === "waiting") {
      return "Your confirmation is stored. The other member still has to confirm this version. The notice is not posted.";
    }
    if ("status" in confirmed && confirmed.status === "settled") {
      return "The trade settled. Rolls, upgrades, and the reroll counter stayed on each item. The notice is not posted.";
    }
    return confirmed.result === "insufficient" ? "The Marks were not available. Nothing moved." : "That trade is not open.";
  }
  if (action === "cancel" && tradeId) {
    const cancelled = await cancelTrade(db, { guildId: input.guildId, userId: input.userId, tradeId, now: input.now });
    return cancelled.result === "cancelled" ? "The trade is cancelled. No items or Marks moved." : "That trade is already closed.";
  }
  if (action === "edit" && tradeId) {
    const edited = await editTrade(db, {
      guildId: input.guildId,
      userId: input.userId,
      tradeId,
      offerItemId: itemId,
      requestItemId: text(input.options, "request"),
      offerMarks: amount(input.options, "marks"),
      requestMarks: amount(input.options, "price"),
      now: input.now,
    });
    return edited.result === "ready" ? "The offer changed. Both confirmations are cleared. The notice is not posted." : "That offer was not changed.";
  }
  const offered = await offerTrade(db, {
    guildId: input.guildId,
    userId: input.userId,
    otherUserId: text(input.options, "member"),
    offerItemId: itemId,
    requestItemId: text(input.options, "request"),
    offerMarks: amount(input.options, "marks"),
    requestMarks: amount(input.options, "price"),
    now: input.now,
  });
  if (offered.result !== "ready") {
    return offered.result === "bound" ? "Bound gear cannot be traded." : offered.result === "equipped" ? "Unequip that item before trading it." : offered.result === "locked" ? "Locked gear cannot be traded." : "That trade was not opened.";
  }
  return `Trade ${offered.tradeId} is waiting for both confirmations. The notice is not posted.`;
}

async function craftText(db: PrismaClient, input: { options: Options; guildId: string; userId: string; now: Date }, action: string) {
  const recipe = text(input.options, "recipe");
  if (action === "list" || !recipe) {
    const recipes = await listRecipes(db, input.guildId);
    return recipes.map((row) => `${row.slug}: ${row.inputAmount} ${row.inputSlug} crafts ${row.outputSlug}.`).join(" ") || "No recipes are published.";
  }
  if (action === "make") {
    const made = await craftItem(db, { guildId: input.guildId, userId: input.userId, recipeSlug: recipe, idempotencyKey: `craft:${input.userId}:${recipe}:${input.now.toISOString()}`, now: input.now });
    if (made.result === "ready" || made.result === "already_recorded") {
      return `Crafted ${made.itemId}. The result was specified by the recipe. The notice is not posted.`;
    }
    return made.result === "insufficient" ? "Those materials were not available. Nothing was crafted." : "That recipe was not crafted.";
  }
  const preview = await previewCraft(db, { guildId: input.guildId, recipeSlug: recipe });
  if (preview.result !== "preview") {
    return "That recipe was not found.";
  }
  const affix = preview.affixes[0];
  return `${preview.name} spends ${preview.inputAmount} ${preview.inputSlug} and crafts ${preview.outputSlug}${affix ? ` with ${affix.slug} ${affix.amount}` : ""}.`;
}

function salvageRefusal(result: string) {
  if (result === "equipped") {
    return "Unequip that item before salvaging it.";
  }
  if (result === "locked") {
    return "Locked gear cannot be salvaged.";
  }
  return "That item was not salvaged.";
}

export async function runShopCommand(
  db: PrismaClient,
  input: { subcommand?: string; options: Options; guildId: string; userId: string; roleIds?: readonly string[]; now: Date },
) {
  if (input.subcommand === "supply" || input.subcommand === "ingot") {
    return runSupplyCommand(db, { ...input, shop: input.subcommand });
  }
  const action = text(input.options, "action");
  if (action === "browse") {
    const rows = await browseListings(db, { guildId: input.guildId });
    return { content: rows.length > 0 ? rows.map((row) => `${row.listingId} costs ${row.priceMarks} Marks.`).join(" ") : "No listings are open. The notice is not posted." };
  }
  if (action === "list") {
    const listed = await listItem(db, { guildId: input.guildId, userId: input.userId, itemId: text(input.options, "item"), priceMarks: amount(input.options, "price"), now: input.now });
    if (listed.result === "ready") {
      return { content: `Listing ${listed.listingId} holds that item for ${listed.priceMarks} Marks. Fee ${listed.feeMarks}. The notice is not posted.` };
    }
    return { content: listed.result === "equipped" ? "Unequip that item before listing it." : listed.result === "bound" ? "Bound gear cannot be listed." : "That listing was not opened." };
  }
  if (action === "buy") {
    const listingId = text(input.options, "listing");
    const inspected = await inspectListing(db, { guildId: input.guildId, listingId });
    const bought = await buyListing(db, { guildId: input.guildId, userId: input.userId, listingId, now: input.now });
    if (bought.result === "ready") {
      const affix = inspected.result === "ready" ? inspected.item?.affixes.map((row) => `${row.slug} ${row.amount}`).join(", ") : "";
      return { content: `Bought ${bought.itemId} for ${bought.priceMarks} Marks.${affix ? ` Rolls ${affix}.` : ""} The notice is not posted.` };
    }
    return { content: bought.result === "insufficient" ? "The price was not available. The listing stays open." : "That listing is not open." };
  }
  if (action === "cancel") {
    const cancelled = await cancelListing(db, { guildId: input.guildId, userId: input.userId, listingId: text(input.options, "listing"), now: input.now });
    return { content: cancelled.result === "cancelled" ? "The listing is cancelled and the item is back in your inventory." : "That listing is already closed." };
  }
  return { content: "Name browse, list, buy, or cancel. The notice is not posted." };
}
