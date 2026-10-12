import {
  browseShop,
  buyOffer,
  deliverPurchase,
  listCrates,
  openCrate,
  previewCrate,
  refundPurchase,
  revealPurchase,
  type PrismaClient,
} from "@collective/db";

type Options = Record<string, string | boolean | number>;

function text(options: Options, key: string): string {
  const value = options[key];
  return typeof value === "string" ? value : "";
}

export async function runSupplyCommand(
  db: PrismaClient,
  input: { options: Options; guildId: string; userId: string; roleIds?: readonly string[]; now: Date; shop: "supply" | "ingot" },
) {
  const action = text(input.options, "action") || "browse";
  if (action === "browse") {
    const listed = await browseShop(db, { guildId: input.guildId, shop: input.shop, userId: input.userId, now: input.now });
    if (listed.result !== "ready") {
      return { content: "The shop is not open." };
    }
    const lines = listed.offers.map((offer) => {
      const odds = offer.crate ? ` Odds version ${offer.crate.version}, pity ${offer.crate.pity} of ${offer.crate.threshold}.` : "";
      return `${offer.slug} costs ${offer.price} ${offer.currency}. Stock ${offer.stock}.${odds}`;
    });
    return { content: `${lines.join(" ") || "No offers are open."} Member listings stay on the marketplace. The notice is not posted.` };
  }
  if (action === "buy") {
    const bought = await buyOffer(db, { guildId: input.guildId, userId: input.userId, offerSlug: text(input.options, "offer"), idempotencyKey: `shop:${input.userId}:${text(input.options, "offer")}:${input.now.toISOString()}`, roleIds: input.roleIds ?? [], now: input.now });
    if (bought.result !== "ready" && bought.result !== "already_recorded") {
      if (bought.result === "insufficient") return { content: "That offer is out of stock or the price was not available. Nothing else was taken." };
      if (bought.result === "level") return { content: "Your level does not meet that offer." };
      if (bought.result === "denied") return { content: "You do not meet the role or class requirement." };
      if (bought.result === "limit") return { content: "You have reached the purchase limit." };
      if (bought.result === "closed") return { content: "That offer is not in rotation." };
      return { content: "That offer was not bought." };
    }
    if (bought.deliverable === "steam_key" && bought.status === "held") {
      const delivered = await deliverPurchase(db, { guildId: input.guildId, userId: input.userId, purchaseId: bought.purchaseId, now: input.now });
      if (delivered.result === "delivered" || delivered.result === "already_recorded") {
        return { content: `${bought.receipt} The private inbox is ready. Direct delivery is setup-required, and the key was not posted.` };
      }
      return { content: `${bought.receipt} The purchase stays in escrow until a key is delivered. No key was posted.` };
    }
    return { content: `${bought.receipt} The notice is not posted.` };
  }
  if (action === "reveal") {
    const revealed = await revealPurchase(db, { guildId: input.guildId, userId: input.userId, purchaseId: text(input.options, "purchase"), now: input.now });
    if (revealed.result === "ready") {
      return { content: `Private inbox ${revealed.purchaseId}. Key ${revealed.key}. It was not posted to the channel. Direct delivery is setup-required.` };
    }
    return { content: revealed.result === "setup_required" ? "The key cannot be opened until the shop secret is configured." : "That purchase cannot be revealed." };
  }
  if (action === "refund") {
    const refunded = await refundPurchase(db, { guildId: input.guildId, userId: input.userId, purchaseId: text(input.options, "purchase"), now: input.now });
    if (refunded.result === "refunded") {
      return { content: "The purchase was refunded and the stock was restored. The notice is not posted." };
    }
    return { content: refunded.result === "review" ? "That purchase needs staff review. A revealed key cannot be unrevealed." : "That purchase was not refunded." };
  }
  return { content: "That shop action is not open. Member listings stay on the marketplace." };
}

export async function runCrateCommand(
  db: PrismaClient,
  input: { options: Options; guildId: string; userId: string; now: Date },
) {
  const action = text(input.options, "action") || "list";
  const crate = text(input.options, "crate");
  if (action === "preview" && crate) {
    const preview = await previewCrate(db, { guildId: input.guildId, userId: input.userId, tableSlug: crate });
    if (preview.result !== "preview") {
      return { content: "That crate was not found." };
    }
    const odds = preview.odds.map((entry) => `${entry.slug} ${entry.basisPoints} of 10000`).join(", ");
    return { content: `${preview.name} version ${preview.version}. Policy ${preview.policy}. Pity ${preview.pity} of ${preview.threshold}, carried at version ${preview.versionSeen}. Guarantee ${preview.guarantee}. ${odds}. Opening does not roll again.` };
  }
  if (action === "open" && crate) {
    const opened = await openCrate(db, { guildId: input.guildId, userId: input.userId, grantId: crate });
    if (opened.result !== "ready" || !opened.outcome) {
      return { content: "That crate was not found." };
    }
    return { content: `${opened.outcome.name} ${opened.outcome.slug} ${opened.outcome.amount} from version ${opened.version}. The stored result was not rolled again. The notice is not posted.` };
  }
  const listed = await listCrates(db, { guildId: input.guildId, userId: input.userId });
  if (listed.result !== "ready") {
    return { content: "Crates are not open." };
  }
  const lines = listed.grants.map((grant) => `${grant.grantId} ${grant.tableSlug} version ${grant.version} ${grant.outcome?.slug ?? "stored"}`);
  return { content: `${lines.join(" ") || "You have no crates."} The result is stored before it is opened. The notice is not posted.` };
}
