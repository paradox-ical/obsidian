/** Shared D20 combat and gear rules. Queues and ratings are a later package. */

import { attackPreview } from "./characters.js";

export const ACCURACY_CAP = 8;
export const DEFENCE_CAP = 8;
export const GEAR_HEALTH_CAP = 10;
export const HEAL_CAP = 8;
export const BLEED_CAP = 2;
export const DEFEND_BONUS = 2;
export const REACTION_REDUCTION = 2;
export const QUICK_ROUND_LIMIT = 8;
export const TACTICAL_TURN_MS = 2 * 60 * 1000;
export const ABILITY_COOLDOWN = 2;

export const COMBAT_RULES = [
  "An attack is a d20 plus accuracy against 10 plus defence. A natural 1 misses. A natural 20 is a critical hit.",
  "A critical hit doubles the weapon dice only. Stat flats, gear flats, and ability flats are not doubled.",
  "Allocated stats and gear bonuses stay in separate fields. The d20 check uses min(8, stats + gear + effects).",
  "Resolution order is stun, main action, one reaction, item, end-of-round bleed, then cooldown ticks.",
  "Defend grants defence +2 against the next attack and does not stack. A second defend refreshes it.",
  "Healing cannot pass the combat health maximum, and one consumable restores at most 8.",
  "Bleed is capped at 2 and is applied at the end of the round. It does not cause another reaction.",
  "One reaction can reduce a hit by 2. A reaction cannot trigger another reaction.",
  "Each stored roll is kept. A retry reads that roll and does not roll again.",
  "Equipped gear locks when a battle starts. Defeat does not destroy it. The next battle starts at full health.",
  "A missed tactical turn defends. Ranked queues, equal Marks wagers, and rating settlement use the PvP service.",
] as const;

export type AffixStat = "accuracy" | "defence" | "health" | "damage";
export type MainAction = "strike" | "defend" | "ability" | "item";

export interface AffixRule {
  slug: string;
  stat: AffixStat;
  min: number;
  max: number;
}

export interface AffixRoll {
  slug: string;
  stat: AffixStat;
  amount: number;
}

export interface Effect {
  kind: "defend" | "bleed" | "stun";
  magnitude: number;
  remaining: number;
}

export interface Fighter {
  id: "member" | "opponent";
  name: string;
  health: number;
  maxHealth: number;
  accuracyStat: number;
  defenceStat: number;
  damageStat: number;
  accuracyGear: number;
  defenceGear: number;
  damageGear: number;
  healthGear: number;
  diceCount: number;
  diceSides: number;
  critMultiplier: number;
  effects: Effect[];
  abilityCooldown: number;
  itemUses: number;
  itemLimit: number;
  reactionReady: boolean;
}

export interface BattleState {
  round: number;
  side: 0 | 1;
  fighters: [Fighter, Fighter];
  reactionUsed: boolean;
  status: "active" | "resolved";
  winner: "" | "member" | "opponent";
  log: string[];
}

export interface RollPacket {
  attack: number;
  damage: number[];
}

export interface GearSeed {
  slug: string;
  name: string;
  slot: "weapon" | "armor" | "accessory" | "consumable";
  summary: string;
  classSlug: string;
  level: number;
  binding: "tradable" | "bound";
  diceCount: number;
  diceSides: number;
  critMultiplier: number;
  abilitySlug: string;
  affixMax: number;
  affixRules: readonly AffixRule[];
}

const weapon = (slug: string, name: string, classSlug: string, level: number, binding: "tradable" | "bound", diceSides: number, summary: string): GearSeed => ({
  slug,
  name,
  slot: "weapon",
  summary,
  classSlug,
  level,
  binding,
  diceCount: 1,
  diceSides,
  critMultiplier: 2,
  abilitySlug: "",
  affixMax: 1,
  affixRules: [
    { slug: "honed", stat: "damage", min: 1, max: 2 },
    { slug: "keen", stat: "accuracy", min: 1, max: 2 },
  ],
});

const CLASS_LABELS: Record<string, string> = {
  hitman: "Hitman",
  bruiser: "Bruiser",
  saboteur: "Saboteur",
  fixer: "Fixer",
  duelist: "Duelist",
  gunslinger: "Gunslinger",
};

function armor(slug: string, name: string, classSlug: string, level: number, summary: string): GearSeed {
  return {
    slug,
    name,
    slot: "armor",
    summary,
    classSlug,
    level,
    binding: level >= 35 ? "bound" : "tradable",
    diceCount: 0,
    diceSides: 0,
    critMultiplier: 2,
    abilitySlug: "",
    affixMax: 1,
    affixRules: [{ slug: "plated", stat: "defence", min: 1, max: level >= 30 ? 3 : 2 }],
  };
}

function accessory(slug: string, name: string, classSlug: string, level: number, stat: "accuracy" | "health", summary: string): GearSeed {
  return {
    slug,
    name,
    slot: "accessory",
    summary,
    classSlug,
    level,
    binding: level >= 35 ? "bound" : "tradable",
    diceCount: 0,
    diceSides: 0,
    critMultiplier: 2,
    abilitySlug: "",
    affixMax: 1,
    affixRules: [{ slug: stat === "health" ? "vital" : "keen", stat, min: 1, max: stat === "health" ? 4 : 2 }],
  };
}

function consumable(slug: string, name: string, level: number, abilitySlug: string, summary: string): GearSeed {
  return {
    slug,
    name,
    slot: "consumable",
    summary,
    classSlug: "",
    level,
    binding: "tradable",
    diceCount: 0,
    diceSides: 0,
    critMultiplier: 2,
    abilitySlug,
    affixMax: 0,
    affixRules: [],
  };
}

function launchGear(): GearSeed[] {
  const classes = ["hitman", "bruiser", "saboteur", "fixer", "duelist", "gunslinger"] as const;
  const sides: Record<(typeof classes)[number], [number, number]> = {
    hitman: [8, 10],
    bruiser: [10, 12],
    saboteur: [6, 8],
    fixer: [6, 6],
    duelist: [8, 8],
    gunslinger: [6, 8],
  };
  const rows: GearSeed[] = [
    weapon("alley-shiv", "Alley Shiv", "", 5, "tradable", 4, "Backstreets weapon. 1d4. Honed damage and keen accuracy stay inside 1 to 2."),
    weapon("dock-hook", "Dock Hook", "", 15, "tradable", 6, "Black Docks weapon. 1d6. Honed damage and keen accuracy stay inside 1 to 2."),
    weapon("sanctum-cane", "Sanctum Cane", "", 35, "bound", 6, "Inner Sanctum weapon. 1d6. Bound. Honed damage and keen accuracy stay inside 1 to 2."),
    armor("street-jacket", "Street Jacket", "", 1, "Shared Backstreets armour. Plated defence is 1 to 2 and is not an Endurance point."),
    armor("dock-vest", "Dock Vest", "", 15, "Shared Black Docks armour. Plated defence is 1 to 2 and is not an Endurance point."),
    armor("sanctum-mail", "Sanctum Mail", "", 35, "Shared Inner Sanctum armour. Plated defence is 1 to 3 and is not an Endurance point."),
    accessory("lucky-charm", "Lucky Charm", "", 5, "accuracy", "Shared accuracy charm. Keen accuracy is 1 to 2 and is not an Agility point."),
    accessory("dock-lens", "Dock Lens", "", 15, "accuracy", "Black Docks lens. Keen accuracy is 1 to 2 and is not an Agility point."),
    accessory("sanctum-seal", "Sanctum Seal", "", 35, "accuracy", "Inner Sanctum seal. Keen accuracy is 1 to 2 and is not an Agility point."),
    consumable("bandage", "Bandage", 1, "bandage", "Expedition consumable. Reserving it adds one item use. Healing still caps at 8."),
    consumable("smoke-vial", "Smoke Vial", 8, "smoke", "Expedition consumable. Reserving it adds 1 accuracy, still inside the accuracy cap."),
    consumable("antitoxin", "Antitoxin", 12, "antitoxin", "Expedition consumable. Reserving it adds 1 defence, still inside the defence cap."),
    accessory("prior-signet", "Prior's Signet", "", 45, "health", "Inner Sanctum boss trophy. Bound. Vital health is 1 to 4 and is not an Endurance point."),
    consumable("recovery-medkit", "Recovery Medkit", 1, "recover", "Shortens a recovery timer by 15 minutes, once, and never below 10 minutes. It does not heal inside a fight."),
  ];
  for (const classSlug of classes) {
    const label = CLASS_LABELS[classSlug] ?? classSlug;
    const [low, high] = sides[classSlug];
    rows.push(weapon(`${classSlug}-arm-20`, `${label} Arm`, classSlug, 20, "tradable", low, `${label} weapon for level 20. 1d${low}. Other classes cannot equip it.`));
    rows.push(weapon(`${classSlug}-arm-35`, `${label} Relic`, classSlug, 35, "bound", high, `${label} weapon for level 35. 1d${high}. Bound to that class.`));
    rows.push(armor(`${classSlug}-coat-15`, `${label} Coat`, classSlug, 15, `${label} armour for level 15. Plated defence is 1 to 2.`));
    rows.push(accessory(`${classSlug}-charm-25`, `${label} Charm`, classSlug, 25, classSlug === "fixer" ? "health" : "accuracy", classSlug === "fixer" ? `${label} charm. Vital health is 1 to 4.` : `${label} charm. Keen accuracy is 1 to 2.`));
  }
  return rows;
}

export const GEAR_SEEDS: readonly GearSeed[] = [
  weapon("field-knife", "Field Knife", "", 1, "tradable", 6, "A shared basic blade every class can use."),
  weapon("service-baton", "Service Baton", "", 1, "tradable", 6, "A shared basic club every class can use."),
  {
    slug: "reinforced-coat",
    name: "Reinforced Coat",
    slot: "armor",
    summary: "Shared armour. Its defence bonus is separate from Endurance.",
    classSlug: "",
    level: 1,
    binding: "tradable",
    diceCount: 0,
    diceSides: 0,
    critMultiplier: 2,
    abilitySlug: "",
    affixMax: 1,
    affixRules: [{ slug: "plated", stat: "defence", min: 1, max: 2 }],
  },
  {
    slug: "focus-band",
    name: "Focus Band",
    slot: "accessory",
    summary: "Shared accuracy accessory. It does not add Agility points.",
    classSlug: "",
    level: 5,
    binding: "tradable",
    diceCount: 0,
    diceSides: 0,
    critMultiplier: 2,
    abilitySlug: "",
    affixMax: 1,
    affixRules: [{ slug: "keen", stat: "accuracy", min: 1, max: 2 }],
  },
  {
    slug: "medkit",
    name: "Medkit",
    slot: "consumable",
    summary: "One use in a battle. Healing stops at maximum health and at 8.",
    classSlug: "",
    level: 1,
    binding: "tradable",
    diceCount: 0,
    diceSides: 0,
    critMultiplier: 2,
    abilitySlug: "patch",
    affixMax: 0,
    affixRules: [],
  },
  weapon("suppressed-rifle", "Suppressed Rifle", "hitman", 10, "bound", 8, "A Hitman rifle. Other classes cannot equip it."),
  weapon("maul", "Maul", "bruiser", 10, "bound", 8, "A Bruiser weapon."),
  weapon("shaped-charge", "Shaped Charge", "saboteur", 10, "bound", 6, "A Saboteur weapon."),
  weapon("estoc", "Estoc", "duelist", 10, "bound", 8, "A Duelist weapon."),
  weapon("custom-revolver", "Custom Revolver", "gunslinger", 10, "bound", 6, "A Gunslinger weapon."),
  {
    slug: "trauma-kit",
    name: "Trauma Kit",
    slot: "accessory",
    summary: "Fixer kit. Bound to the Fixer who carries it.",
    classSlug: "fixer",
    level: 10,
    binding: "bound",
    diceCount: 0,
    diceSides: 0,
    critMultiplier: 2,
    abilitySlug: "patch",
    affixMax: 1,
    affixRules: [{ slug: "vital", stat: "health", min: 4, max: 8 }],
  },
  ...launchGear(),
];

export const OPPONENT_SEEDS = [
  { slug: "training-dummy", name: "Training Dummy", tactic: "strike" as const, accuracy: 0, defence: 0, health: 16, diceCount: 1, diceSides: 6 },
  { slug: "range-marker", name: "Range Marker", tactic: "defend" as const, accuracy: 1, defence: 2, health: 20, diceCount: 1, diceSides: 6 },
] as const;

export function affixDecision(rules: readonly AffixRule[], rolls: readonly AffixRoll[], affixMax: number): "allowed" | "out_of_range" | "unknown" {
  if (rolls.length > affixMax) {
    return "out_of_range";
  }
  for (const roll of rolls) {
    const rule = rules.find((candidate) => candidate.slug === roll.slug && candidate.stat === roll.stat);
    if (!rule) {
      return "unknown";
    }
    if (!Number.isInteger(roll.amount) || roll.amount < rule.min || roll.amount > rule.max) {
      return "out_of_range";
    }
  }
  return "allowed";
}

export function gearBonus(affixes: readonly AffixRoll[], stat: AffixStat): number {
  return affixes.filter((affix) => affix.stat === stat).reduce((sum, affix) => sum + affix.amount, 0);
}

export function combatModifiers(input: { statAccuracy: number; gearAccuracy: number; effectAccuracy: number; statDefence: number; gearDefence: number; effectDefence: number }) {
  return {
    accuracyFromStats: input.statAccuracy,
    accuracyFromGear: input.gearAccuracy,
    defenceFromStats: input.statDefence,
    defenceFromGear: input.gearDefence,
    accuracy: Math.min(ACCURACY_CAP, Math.max(0, input.statAccuracy) + Math.max(0, input.gearAccuracy) + Math.max(0, input.effectAccuracy)),
    defence: Math.min(DEFENCE_CAP, Math.max(0, input.statDefence) + Math.max(0, input.gearDefence) + Math.max(0, input.effectDefence)),
  };
}

export function strikeDamage(input: { roll: number; accuracy: number; defence: number; dice: readonly number[]; critMultiplier: number; flat: number; reaction: boolean }) {
  const outcome = attackPreview({ roll: input.roll, accuracy: input.accuracy, defence: input.defence });
  const diceTotal = input.dice.reduce((sum, face) => sum + face, 0);
  if (outcome === "miss") {
    return { outcome, damage: 0, diceTotal };
  }
  const weapon = outcome === "critical" ? diceTotal * input.critMultiplier : diceTotal;
  const total = weapon + input.flat;
  return { outcome, damage: input.reaction ? Math.max(0, total - REACTION_REDUCTION) : total, diceTotal };
}

export function healAmount(current: number, max: number, requested: number): number {
  return Math.max(0, Math.min(HEAL_CAP, Math.trunc(requested), max - current));
}

export function equipDecision(input: { classSlug: string; itemClass: string; level: number; itemLevel: number; locked: boolean; destroyed: boolean }): "allowed" | "class" | "level" | "locked" | "destroyed" {
  if (input.destroyed) {
    return "destroyed";
  }
  if (input.locked) {
    return "locked";
  }
  if (input.itemClass && input.itemClass !== input.classSlug) {
    return "class";
  }
  if (input.level < input.itemLevel) {
    return "level";
  }
  return "allowed";
}

export function transferDecision(input: { binding: string; locked: boolean; equipped: boolean; inventoryLocked: boolean }): "allowed" | "bound" | "locked" | "equipped" {
  if (input.inventoryLocked || input.locked) {
    return "locked";
  }
  if (input.equipped) {
    return "equipped";
  }
  if (input.binding === "bound") {
    return "bound";
  }
  return "allowed";
}

export function addEffect(effects: readonly Effect[], effect: Effect): Effect[] {
  const rest = effects.filter((row) => row.kind !== effect.kind);
  if (effect.kind === "defend") {
    return [...rest, { kind: "defend", magnitude: DEFEND_BONUS, remaining: 1 }];
  }
  if (effect.kind === "bleed") {
    const current = effects.find((row) => row.kind === "bleed")?.magnitude ?? 0;
    return [...rest, { kind: "bleed", magnitude: Math.min(BLEED_CAP, current + effect.magnitude), remaining: 2 }];
  }
  return [...rest, { kind: "stun", magnitude: 1, remaining: 1 }];
}

export function blankFighter(id: "member" | "opponent", name: string): Fighter {
  return {
    id,
    name,
    health: 20,
    maxHealth: 20,
    accuracyStat: 0,
    defenceStat: 0,
    damageStat: 0,
    accuracyGear: 0,
    defenceGear: 0,
    damageGear: 0,
    healthGear: 0,
    diceCount: 1,
    diceSides: 6,
    critMultiplier: 2,
    effects: [],
    abilityCooldown: 0,
    itemUses: 0,
    itemLimit: 0,
    reactionReady: true,
  };
}

export function freshBattle(member: Fighter, opponent: Fighter): BattleState {
  return { round: 1, side: 0, fighters: [{ ...member }, { ...opponent }], reactionUsed: false, status: "active", winner: "", log: [] };
}

function copyState(state: BattleState): BattleState {
  return {
    ...state,
    fighters: [{ ...state.fighters[0], effects: state.fighters[0].effects.map((effect) => ({ ...effect })) }, { ...state.fighters[1], effects: state.fighters[1].effects.map((effect) => ({ ...effect })) }],
    log: [...state.log],
  };
}

function finishIfDown(state: BattleState): BattleState {
  const fallen = state.fighters.find((fighter) => fighter.health <= 0);
  if (!fallen) {
    return state;
  }
  const winner = state.fighters.find((fighter) => fighter.id !== fallen.id);
  return { ...state, status: "resolved", winner: winner?.id ?? "", log: [...state.log, `${fallen.name} is incapacitated.`] };
}

function endRound(state: BattleState): BattleState {
  const next = copyState(state);
  for (const fighter of next.fighters) {
    const bleed = fighter.effects.find((effect) => effect.kind === "bleed");
    if (bleed) {
      fighter.health = Math.max(0, fighter.health - bleed.magnitude);
      next.log.push(`${fighter.name} takes ${bleed.magnitude} bleed.`);
    }
    fighter.effects = fighter.effects.flatMap((effect) => {
      if (effect.kind === "defend") {
        return [effect];
      }
      return effect.remaining - 1 > 0 ? [{ ...effect, remaining: effect.remaining - 1 }] : [];
    });
    if (fighter.abilityCooldown > 0) {
      fighter.abilityCooldown -= 1;
    }
  }
  next.reactionUsed = false;
  next.round += 1;
  next.side = 0;
  return finishIfDown(next);
}

export function resolveAction(state: BattleState, action: MainAction, roll: RollPacket | null): { state: BattleState; result: "active" | "resolved" | "cooling" | "spent" } {
  if (state.status === "resolved") {
    return { state, result: "resolved" };
  }
  const next = copyState(state);
  const actor = next.fighters[next.side];
  const otherIndex = next.side === 0 ? 1 : 0;
  const defender = next.fighters[otherIndex];
  if (!actor || !defender) {
    return { state, result: "spent" };
  }
  const stunned = actor.effects.some((effect) => effect.kind === "stun");
  if (stunned && action !== "item") {
    actor.effects = actor.effects.filter((effect) => effect.kind !== "stun");
    next.log.push(`${actor.name} is stunned and loses the main action.`);
  } else if (action === "ability" && actor.abilityCooldown > 0) {
    return { state, result: "cooling" };
  } else if (action === "item") {
    if (actor.itemUses >= actor.itemLimit) {
      return { state, result: "spent" };
    }
    actor.effects = addEffect(actor.effects, { kind: "defend", magnitude: DEFEND_BONUS, remaining: 1 });
    const healed = healAmount(actor.health, actor.maxHealth, HEAL_CAP);
    actor.health += healed;
    actor.itemUses += 1;
    next.log.push(`${actor.name} uses a medkit and restores ${healed}.`);
  } else if (action === "defend") {
    actor.effects = addEffect(actor.effects, { kind: "defend", magnitude: DEFEND_BONUS, remaining: 1 });
    next.log.push(`${actor.name} defends.`);
  } else {
    if (!roll) {
      return { state, result: "spent" };
    }
    const defendBonus = defender.effects.find((effect) => effect.kind === "defend")?.magnitude ?? 0;
    const mods = combatModifiers({
      statAccuracy: actor.accuracyStat,
      gearAccuracy: actor.accuracyGear,
      effectAccuracy: 0,
      statDefence: defender.defenceStat,
      gearDefence: defender.defenceGear,
      effectDefence: defendBonus,
    });
    const reaction = !next.reactionUsed && defender.reactionReady && attackPreview({ roll: roll.attack, accuracy: mods.accuracy, defence: mods.defence }) !== "miss";
    const damage = strikeDamage({
      roll: roll.attack,
      accuracy: mods.accuracy,
      defence: mods.defence,
      dice: roll.damage,
      critMultiplier: actor.critMultiplier,
      flat: actor.damageStat + actor.damageGear,
      reaction,
    });
    defender.effects = defender.effects.filter((effect) => effect.kind !== "defend");
    if (reaction && damage.outcome !== "miss") {
      next.reactionUsed = true;
    }
    defender.health = Math.max(0, defender.health - damage.damage);
    if (action === "ability") {
      actor.abilityCooldown = ABILITY_COOLDOWN;
      if (damage.outcome !== "miss") {
        defender.effects = addEffect(defender.effects, { kind: "bleed", magnitude: 1, remaining: 2 });
      }
    }
    next.log.push(`${actor.name} rolls ${roll.attack}. Stats ${mods.accuracyFromStats}, gear ${mods.accuracyFromGear}, defence stats ${mods.defenceFromStats}, defence gear ${mods.defenceFromGear}. ${damage.outcome} for ${damage.damage}.`);
  }
  const wrapped = next.side === 1;
  next.side = wrapped ? 0 : 1;
  const finished = finishIfDown(next);
  if (finished.status === "resolved") {
    return { state: finished, result: "resolved" };
  }
  if (wrapped) {
    const ended = endRound(finished);
    return { state: ended, result: ended.status === "resolved" ? "resolved" : "active" };
  }
  return { state: finished, result: "active" };
}

export function resolveQuick(state: BattleState, packets: readonly RollPacket[], tactics: readonly [MainAction, MainAction]): { state: BattleState; used: number } {
  let current = state;
  let used = 0;
  for (let step = 0; step < QUICK_ROUND_LIMIT * 2 && current.status === "active"; step += 1) {
    const action = tactics[current.side];
    const needsRoll = action === "strike" || action === "ability";
    const packet = needsRoll ? packets[used] ?? null : null;
    const outcome = resolveAction(current, needsRoll && !packet ? "defend" : action, packet);
    if ((outcome.result === "cooling" || outcome.result === "spent") && outcome.state === current) {
      current = resolveAction(current, "defend", null).state;
      continue;
    }
    current = outcome.state;
    if (needsRoll && packet) {
      used += 1;
    }
  }
  if (current.status === "active") {
    const winner = current.fighters[0].health >= current.fighters[1].health ? "member" : "opponent";
    current = { ...current, status: "resolved", winner, log: [...current.log, "The duel reached the round limit."] };
  }
  return { state: current, used };
}

export function presentBattle(state: BattleState, rolls: readonly { sequence: number; result: number; revealed: boolean; purpose: string }[], audience: "member" | "staff") {
  const visibleRolls = audience === "staff" ? rolls : rolls.filter((roll) => roll.revealed);
  const fighters = state.fighters.map((fighter, index) => {
    if (audience === "member" && index === 1) {
      return { id: fighter.id, name: fighter.name, health: fighter.health, maxHealth: fighter.maxHealth };
    }
    return fighter;
  });
  return { status: state.status, winner: state.winner, round: state.round, side: state.side, log: state.log, fighters, rolls: visibleRolls, rules: COMBAT_RULES };
}
