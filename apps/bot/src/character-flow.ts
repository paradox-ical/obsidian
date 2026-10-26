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

import { buttonRow, type OutcomeRow } from "./present.js";

export interface CharacterReply {
  content: string;
  components?: OutcomeRow[];
}

export function classChoiceRows(classes: ReadonlyArray<{ slug: string; name: string }>): OutcomeRow[] {
  const buttons = classes.slice(0, 6).map((item) => ({ id: `character:class:${item.slug}`, label: item.name }));
  return [buttonRow(buttons.slice(0, 3)), buttonRow(buttons.slice(3))].filter((row) => row.components.length > 0);
}

export function lifeNextRows(): OutcomeRow[] {
  return [buttonRow([
    { id: "character:stats", label: "Stat points" },
    { id: "character:abilities", label: "Abilities" },
  ])];
}

export function characterPress(customId: string): { subcommand: string; options: Record<string, string> } {
  const [, action, slug] = customId.split(":");
  if (action === "stats") {
    return { subcommand: "stats", options: {} };
  }
  if (action === "abilities") {
    return { subcommand: "abilities", options: {} };
  }
  return { subcommand: "class", options: slug ? { class: slug } : {} };
}

export async function runCharacterCommand(
  db: PrismaClient,
  input: { subcommand?: string; options: Record<string, string | boolean | number>; guildId: string; userId: string; now: Date },
): Promise<CharacterReply> {
  const sheet = await readCharacter(db, input.guildId, input.userId, input.now);
  if (input.subcommand === "class") {
    const slug = text(input.options, "class");
    if (!slug) {
      if (sheet.status === "uncreated") {
        return {
          content: `Choose one of six character classes below.\n\n${sheet.classes.map((item) => `**${item.name}** — ${item.summary}`).join("\n")}\n\n-# Community chat does not grant character points.`,
          components: classChoiceRows(sheet.classes),
        };
      }
      return {
        content: `**${sheet.className}**\nLevel ${sheet.level}. ${sheet.xpToNext} XP until the next level.\n\nUse the buttons below to view stats and abilities.`,
        components: lifeNextRows(),
      };
    }
    if (sheet.status === "ready") {
      return { content: "You already have a character class. Changing it costs 15,000 Marks and includes a respec." };
    }
    const chosen = await chooseClass(db, { guildId: input.guildId, userId: input.userId, classSlug: slug, now: input.now });
    if (chosen.result === "chosen") {
      return {
        content: `Your class is now **${lifeName(sheet, slug)}**.\nLevel ${chosen.level}. ${chosen.unspentPoints} points are still unspent.\n\nThe passive is already working. Review your stats and abilities below.`,
        components: lifeNextRows(),
      };
    }
    return { content: chosen.result === "missing_class" ? "That character class is unavailable." : "You already have a class. Use Change class to review the cost and cooldown." };
  }
  if (sheet.status === "uncreated") {
    return {
      content: "Your character has no class yet. Choose one below.\n\n-# Community chat does not grant character points.",
      components: classChoiceRows(sheet.classes),
    };
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
          "",
          "A practice fight is `/combat action`, against the Training Dummy.",
        ].join("\n"),
      };
    }
    const allocated = await allocateStats(db, { guildId: input.guildId, userId: input.userId, stat, points, now: input.now });
    const statName = stat.charAt(0).toUpperCase() + stat.slice(1);
    if (allocated.result === "allocated") {
      return { content: `**${statName}** takes ${points}. ${allocated.unspentPoints} points are still unspent.` };
    }
    if (allocated.result === "locked") {
      return { content: "Stat points wait. Combat, a queue, a mission, or an expedition has the sheet locked." };
    }
    return { content: allocated.result === "overspent" ? "You do not have that many unspent stat points." : "Pick strength, agility, endurance, or focus." };
  }
  if (input.subcommand === "abilities") {
    const lines = sheet.abilities.map((ability) => `**${ability.name}**\n${ability.kind} · unlocks at ${ability.unlockLevel} · cooldown ${ability.cooldownTurns}\n${ability.formula}`);
    return { content: `${lines.join("\n\n") || "No abilities are available for this class yet."}\n\nEquip one with \`/character loadout\` when you want it in a fight.` };
  }
  if (input.subcommand === "respec") {
    const action = text(input.options, "action");
    if (action === "class") {
      const changed = await changeClass(db, { guildId: input.guildId, userId: input.userId, classSlug: text(input.options, "class"), now: input.now });
      if (changed.result === "changed") {
        return { content: `Your class is now **${lifeName(sheet, changed.classSlug)}**.\nLevel ${changed.level}. The respec came with the change. The next class change waits 30 days.` };
      }
      if (changed.result === "unaffordable") {
        return { content: "Changing class costs 15,000 Marks. Your available balance does not cover it." };
      }
      if (changed.result === "cooling") {
        return { content: `Class change is available again at ${changed.availableAt}.` };
      }
      if (changed.result === "locked") {
        return { content: "The sheet is locked while combat, a queue, a mission, or an expedition is open." };
      }
      return { content: changed.result === "same_class" ? "That is already your current class." : "That character class is unavailable." };
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
      return { content: `Your allocated stats have been reset.\n**${respec.unspentPoints}** are unspent. The next respec waits until ${respec.availableAt}.` };
    }
    if (respec.result === "unaffordable") {
      return { content: "A stat respec costs 5,000 Marks. Your available balance does not cover it." };
    }
    if (respec.result === "cooling") {
      return { content: `Stat reset is available again at ${respec.availableAt}.` };
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
      return { content: "That ability is unavailable to your current class." };
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
