import {
  allocateStats,
  changeClass,
  chooseClass,
  introReset,
  readCharacter,
  respecCharacter,
  setLoadout,
  type PrismaClient,
} from "@collective/db";

export async function runCharacterCommand(
  db: PrismaClient,
  input: { subcommand?: string; options: Record<string, string | boolean | number>; guildId: string; userId: string; now: Date },
) {
  const sheet = await readCharacter(db, input.guildId, input.userId, input.now);
  if (input.subcommand === "class") {
    const slug = text(input.options, "class");
    if (!slug) {
      if (sheet.status === "uncreated") {
        return { content: `Six lives are open. Pick one.\n${sheet.classes.map((item) => `**${item.name}** — ${item.summary}`).join("\n")}\n\n-# Community chat does not grant character points.` };
      }
      return { content: `**${sheet.className}**\nLevel ${sheet.level}\n${sheet.xpToNext} XP until the next level.` };
    }
    if (sheet.status === "ready") {
      return { content: "That life is already chosen. Changing it costs 15,000 Marks and includes a respec." };
    }
    const chosen = await chooseClass(db, { guildId: input.guildId, userId: input.userId, classSlug: slug, now: input.now });
    if (chosen.result === "chosen") {
      return { content: `You take up the **${sheet.classes.find((item) => item.slug === slug)?.name ?? slug}**.\nLevel ${chosen.level}. ${chosen.unspentPoints} points are still unspent.` };
    }
    return { content: chosen.result === "missing_class" ? "That life is not on the books." : "A class is already chosen. The street does not hand out a second one for free." };
  }
  if (sheet.status === "uncreated") {
    return { content: "Pick a class with `/character class` before the points will stick." };
  }
  if (input.subcommand === "stats") {
    const stat = text(input.options, "stat");
    const points = integer(input.options, "points");
    if (!stat || points === null) {
      return {
        content: [
          `**${sheet.className}** · level ${sheet.level}`,
          "",
          `**${sheet.unspentPoints}** points still unspent · **${sheet.earnedPoints}** earned`,
          "",
          `**Strength** ${sheet.effects.strength.bonus}`,
          `**Agility** ${sheet.effects.agility.bonus}`,
          `**Endurance** ${sheet.effects.endurance.bonus}`,
          `**Focus** ${sheet.effects.focus.bonus}`,
          "",
          `-# ${sheet.effects.strength.formula}`,
        ].join("\n"),
      };
    }
    const allocated = await allocateStats(db, { guildId: input.guildId, userId: input.userId, stat, points, now: input.now });
    const statName = stat.charAt(0).toUpperCase() + stat.slice(1);
    if (allocated.result === "allocated") {
      return { content: `**${statName}** takes ${points}. ${allocated.unspentPoints} points are still unspent.` };
    }
    if (allocated.result === "locked") {
      return { content: "The points wait. Combat, a queue, a mission, or an expedition has the sheet locked." };
    }
    return { content: allocated.result === "overspent" ? "Those points are not in the pocket." : "Pick strength, agility, endurance, or focus." };
  }
  if (input.subcommand === "abilities") {
    const lines = sheet.abilities.map((ability) => `**${ability.name}**\n${ability.kind} · unlocks at ${ability.unlockLevel} · cooldown ${ability.cooldownTurns}\n${ability.formula}`);
    return { content: lines.join("\n\n") || "This life has not written its abilities yet." };
  }
  if (input.subcommand === "respec") {
    const action = text(input.options, "action");
    if (action === "class") {
      const changed = await changeClass(db, { guildId: input.guildId, userId: input.userId, classSlug: text(input.options, "class"), now: input.now });
      if (changed.result === "changed") {
        return { content: `You take up the **${lifeName(sheet, changed.classSlug)}**.\nLevel ${changed.level}. The respec came with the change. The next class change waits 30 days.` };
      }
      if (changed.result === "unaffordable") {
        return { content: "A new life costs 15,000 Marks. The pocket does not cover it." };
      }
      if (changed.result === "cooling") {
        return { content: `That door stays shut until ${changed.availableAt}.` };
      }
      if (changed.result === "locked") {
        return { content: "The sheet is locked while combat, a queue, a mission, or an expedition is open." };
      }
      return { content: changed.result === "same_class" ? "That is already the life you are living." : "That life is not on the books." };
    }
    if (action === "intro") {
      const reset = await introReset(db, { guildId: input.guildId, userId: input.userId, ...(text(input.options, "class") ? { classSlug: text(input.options, "class") } : {}), now: input.now });
      if (reset.result === "reset") {
        return { content: `The introductory reset is spent.\n**${lifeName(sheet, reset.classSlug)}** keeps the level and the points already earned.` };
      }
      if (reset.result === "level") {
        return { content: "The introductory reset only answers below level 10." };
      }
      if (reset.result === "ranked") {
        return { content: "A ranked match closes the introductory reset." };
      }
      if (reset.result === "used") {
        return { content: "The introductory reset has already been spent." };
      }
      return { content: "The sheet is locked while combat, a queue, a mission, or an expedition is open." };
    }
    const respec = await respecCharacter(db, { guildId: input.guildId, userId: input.userId, now: input.now });
    if (respec.result === "respec") {
      return { content: `The points come off the sheet.\n**${respec.unspentPoints}** are unspent. The next respec waits until ${respec.availableAt}.` };
    }
    if (respec.result === "unaffordable") {
      return { content: "A stat respec costs 5,000 Marks. The pocket does not cover it." };
    }
    if (respec.result === "cooling") {
      return { content: `The respec stays shut until ${respec.availableAt}.` };
    }
    return { content: "The sheet is locked while combat, a queue, a mission, or an expedition is open." };
  }
  if (input.subcommand === "loadout") {
    const ability = text(input.options, "ability");
    const slot = integer(input.options, "slot");
    if (!ability || slot === null) {
      return {
        content: sheet.loadout.length === 0
          ? "The four slots are empty. The class passive still works."
          : `**Equipped**\n${sheet.loadout.map((item) => `Slot ${item.slot}`).join("\n")}`,
      };
    }
    const next = sheet.abilities.find((item) => item.slug === ability);
    if (!next) {
      return { content: "That ability does not belong to this life." };
    }
    const classSlots = sheet.loadout.filter((item) => item.kind === "class" && item.abilitySlug).map((item) => ({ kind: "class" as const, slug: item.abilitySlug }));
    const gearSlots = sheet.loadout.filter((item) => item.kind === "gear" && item.itemId).map((item) => ({ kind: "gear" as const, itemId: item.itemId }));
    const replaced = classSlots.filter((item) => item.slug !== ability);
    replaced.splice(Math.max(0, Math.min(slot, replaced.length + 1) - 1), 0, { kind: "class", slug: ability });
    const saved = await setLoadout(db, { guildId: input.guildId, userId: input.userId, slots: [...replaced, ...gearSlots].slice(0, 4) });
    if (saved.result === "saved") {
      return { content: `**${next.name}** takes slot ${slot}. Gear abilities share the same four slots.` };
    }
    if (saved.result === "locked_ability") {
      return { content: "That ability is still locked." };
    }
    return { content: saved.result === "locked" ? "The loadout waits until combat, a queue, a mission, or an expedition ends." : "That loadout is not on the sheet." };
  }
  return { content: `**${sheet.className}** · level ${sheet.level}.` };
}

function lifeName(sheet: { classes: ReadonlyArray<{ slug: string; name: string }> }, slug: string): string {
  return sheet.classes.find((item) => item.slug === slug)?.name ?? slug;
}

function text(options: Record<string, string | boolean | number>, key: string): string {
  const value = options[key];
  return typeof value === "string" ? value : "";
}

function integer(options: Record<string, string | boolean | number>, key: string): number | null {
  const value = options[key];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}
