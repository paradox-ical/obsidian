import { describe, expect, it } from "vitest";

import {
  addEffect,
  affixDecision,
  blankFighter,
  combatModifiers,
  equipDecision,
  freshBattle,
  healAmount,
  presentBattle,
  resolveAction,
  resolveQuick,
  strikeDamage,
  transferDecision,
} from "./combat.js";

describe("combat rules", () => {
  it("doubles weapon dice on a critical and still misses a natural 1", () => {
    const critical = strikeDamage({ roll: 20, accuracy: 0, defence: 8, dice: [6], critMultiplier: 2, flat: 4, reaction: false });
    expect(critical).toEqual({ outcome: "critical", damage: 16, diceTotal: 6 });
    expect(strikeDamage({ roll: 1, accuracy: 8, defence: 0, dice: [6], critMultiplier: 2, flat: 4, reaction: false }).outcome).toBe("miss");
    expect(strikeDamage({ roll: 12, accuracy: 6, defence: 8, dice: [4], critMultiplier: 2, flat: 1, reaction: true })).toMatchObject({ outcome: "hit", damage: 3 });
  });

  it("keeps gear bonuses distinct and caps the combined check", () => {
    const mods = combatModifiers({ statAccuracy: 6, gearAccuracy: 2, effectAccuracy: 2, statDefence: 6, gearDefence: 3, effectDefence: 2 });
    expect(mods.accuracyFromStats).toBe(6);
    expect(mods.accuracyFromGear).toBe(2);
    expect(mods.accuracy).toBe(8);
    expect(mods.defence).toBe(8);
    expect(healAmount(18, 20, 8)).toBe(2);
    expect(healAmount(20, 20, 8)).toBe(0);
    expect(healAmount(1, 40, 12)).toBe(8);
  });

  it("does not stack defend, caps bleed, and spends one reaction", () => {
    expect(addEffect(addEffect([], { kind: "defend", magnitude: 2, remaining: 1 }), { kind: "defend", magnitude: 2, remaining: 1 })).toEqual([{ kind: "defend", magnitude: 2, remaining: 1 }]);
    expect(addEffect([{ kind: "bleed", magnitude: 2, remaining: 2 }], { kind: "bleed", magnitude: 1, remaining: 2 })[0]?.magnitude).toBe(2);
    const member = { ...blankFighter("member", "Member"), health: 30, maxHealth: 30 };
    const opponent = { ...blankFighter("opponent", "Dummy"), health: 30, maxHealth: 30, reactionReady: true };
    const first = resolveAction(freshBattle(member, opponent), "strike", { attack: 15, damage: [4] });
    expect(first.state.log.some((line) => line.includes("hit for 2."))).toBe(true);
    const second = resolveAction(first.state, "strike", { attack: 15, damage: [4] });
    expect(second.state.fighters[0].health).toBe(26);
    expect(second.state.reactionUsed).toBe(false);
  });

  it("auto-resolves a short duel and hides an unrevealed roll from the member", () => {
    const member = { ...blankFighter("member", "Member"), health: 12, maxHealth: 12, damageStat: 6 };
    const opponent = { ...blankFighter("opponent", "Dummy"), health: 8, maxHealth: 8 };
    const quick = resolveQuick(freshBattle(member, opponent), [{ attack: 18, damage: [6] }, { attack: 2, damage: [1] }], ["strike", "strike"]);
    expect(quick.state.status).toBe("resolved");
    expect(quick.state.winner).toBe("member");
    expect(quick.used).toBe(1);
    const view = presentBattle(quick.state, [{ sequence: 1, result: 19, revealed: false, purpose: "opponent-attack" }], "member");
    expect(view.rolls).toEqual([]);
    expect(presentBattle(quick.state, [{ sequence: 1, result: 19, revealed: false, purpose: "opponent-attack" }], "staff").rolls).toHaveLength(1);
    expect(equipDecision({ classSlug: "hitman", itemClass: "gunslinger", level: 20, itemLevel: 10, locked: false, destroyed: false })).toBe("class");
    expect(equipDecision({ classSlug: "hitman", itemClass: "hitman", level: 4, itemLevel: 10, locked: false, destroyed: false })).toBe("level");
    expect(transferDecision({ binding: "bound", locked: false, equipped: false, inventoryLocked: false })).toBe("bound");
    expect(transferDecision({ binding: "tradable", locked: true, equipped: false, inventoryLocked: false })).toBe("locked");
    expect(affixDecision([{ slug: "keen", stat: "accuracy", min: 1, max: 2 }], [{ slug: "keen", stat: "accuracy", amount: 3 }], 1)).toBe("out_of_range");
  });
});
