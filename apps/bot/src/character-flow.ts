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
        return { content: `Choose a class: ${sheet.classes.map((item) => item.slug).join(", ")}. Community chat does not grant character points.` };
      }
      return { content: `${sheet.className}, level ${sheet.level}. ${sheet.xpToNext} XP to the next level.` };
    }
    if (sheet.status === "ready") {
      return { content: "A class is already chosen. A class change costs 15,000 Marks." };
    }
    const chosen = await chooseClass(db, { guildId: input.guildId, userId: input.userId, classSlug: slug, now: input.now });
    if (chosen.result === "chosen") {
      return { content: `${slug} is level ${chosen.level} with ${chosen.unspentPoints} unspent points.` };
    }
    return { content: chosen.result === "missing_class" ? "That class is not available." : "A class is already chosen." };
  }
  if (sheet.status === "uncreated") {
    return { content: "Choose a class with /character class before spending points." };
  }
  if (input.subcommand === "stats") {
    const stat = text(input.options, "stat");
    const points = integer(input.options, "points");
    if (!stat || points === null) {
      return { content: `Level ${sheet.level}. Earned ${sheet.earnedPoints}, unspent ${sheet.unspentPoints}. Strength ${sheet.effects.strength.bonus}, Agility ${sheet.effects.agility.bonus}, Endurance ${sheet.effects.endurance.bonus}, Focus ${sheet.effects.focus.bonus}. ${sheet.effects.strength.formula}` };
    }
    const allocated = await allocateStats(db, { guildId: input.guildId, userId: input.userId, stat, points, now: input.now });
    if (allocated.result === "allocated") {
      return { content: `${points} ${stat} allocated. ${allocated.unspentPoints} points remain.` };
    }
    if (allocated.result === "locked") {
      return { content: "Stat changes wait until combat, a queue, a mission, or an expedition ends." };
    }
    return { content: allocated.result === "overspent" ? "Those points are not available." : "Name strength, agility, endurance, or focus." };
  }
  if (input.subcommand === "abilities") {
    const lines = sheet.abilities.map((ability) => `${ability.name} (${ability.kind}, unlock ${ability.unlockLevel}, cooldown ${ability.cooldownTurns}): ${ability.formula}`);
    return { content: lines.join(" ") };
  }
  if (input.subcommand === "respec") {
    const action = text(input.options, "action");
    if (action === "class") {
      const changed = await changeClass(db, { guildId: input.guildId, userId: input.userId, classSlug: text(input.options, "class"), now: input.now });
      if (changed.result === "changed") {
        return { content: `${changed.classSlug} is level ${changed.level}. The respec is included. The next class change waits 30 days.` };
      }
      if (changed.result === "unaffordable") {
        return { content: "A class change costs 15,000 Marks." };
      }
      if (changed.result === "cooling") {
        return { content: `Class change is cooling until ${changed.availableAt}.` };
      }
      if (changed.result === "locked") {
        return { content: "Character changes wait until combat, a queue, a mission, or an expedition ends." };
      }
      return { content: changed.result === "same_class" ? "That is already your class." : "That class is not available." };
    }
    if (action === "intro") {
      const reset = await introReset(db, { guildId: input.guildId, userId: input.userId, ...(text(input.options, "class") ? { classSlug: text(input.options, "class") } : {}), now: input.now });
      if (reset.result === "reset") {
        return { content: `Introductory reset used. ${reset.classSlug} keeps level and earned points.` };
      }
      if (reset.result === "level") {
        return { content: "The introductory reset is only below level 10." };
      }
      if (reset.result === "ranked") {
        return { content: "The introductory reset closes after a ranked match." };
      }
      if (reset.result === "used") {
        return { content: "The introductory reset is already used." };
      }
      return { content: "Character changes wait until combat, a queue, a mission, or an expedition ends." };
    }
    const respec = await respecCharacter(db, { guildId: input.guildId, userId: input.userId, now: input.now });
    if (respec.result === "respec") {
      return { content: `Stats reset. ${respec.unspentPoints} points are unspent. The next respec waits until ${respec.availableAt}.` };
    }
    if (respec.result === "unaffordable") {
      return { content: "A stat respec costs 5,000 Marks." };
    }
    if (respec.result === "cooling") {
      return { content: `Respec is cooling until ${respec.availableAt}.` };
    }
    return { content: "Character changes wait until combat, a queue, a mission, or an expedition ends." };
  }
  if (input.subcommand === "loadout") {
    const ability = text(input.options, "ability");
    const slot = integer(input.options, "slot");
    if (!ability || slot === null) {
      return { content: sheet.loadout.length === 0 ? "No abilities are equipped. The class passive stays active." : `Equipped slots: ${sheet.loadout.map((item) => item.slot).join(", ")}.` };
    }
    const next = sheet.abilities.find((item) => item.slug === ability);
    if (!next) {
      return { content: "That ability is not on this class." };
    }
    const classSlots = sheet.loadout.filter((item) => item.kind === "class" && item.abilitySlug).map((item) => ({ kind: "class" as const, slug: item.abilitySlug }));
    const gearSlots = sheet.loadout.filter((item) => item.kind === "gear" && item.itemId).map((item) => ({ kind: "gear" as const, itemId: item.itemId }));
    const replaced = classSlots.filter((item) => item.slug !== ability);
    replaced.splice(Math.max(0, Math.min(slot, replaced.length + 1) - 1), 0, { kind: "class", slug: ability });
    const saved = await setLoadout(db, { guildId: input.guildId, userId: input.userId, slots: [...replaced, ...gearSlots].slice(0, 4) });
    if (saved.result === "saved") {
      return { content: `${ability} is equipped. Gear abilities use the same four slots.` };
    }
    if (saved.result === "locked_ability") {
      return { content: "That ability is still locked." };
    }
    return { content: saved.result === "locked" ? "Loadout changes wait until combat, a queue, a mission, or an expedition ends." : "That loadout is not available." };
  }
  return { content: `${sheet.className}, level ${sheet.level}.` };
}

function text(options: Record<string, string | boolean | number>, key: string): string {
  const value = options[key];
  return typeof value === "string" ? value : "";
}

function integer(options: Record<string, string | boolean | number>, key: string): number | null {
  const value = options[key];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}
