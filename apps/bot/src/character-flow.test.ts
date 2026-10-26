import { describe, expect, it } from "vitest";

import { characterPress, classChoiceRows } from "./character-flow.js";
import { spokenAmount } from "./present.js";

describe("character choices", () => {
  it("puts the six lives on buttons instead of a typed slug", () => {
    const rows = classChoiceRows([
      { slug: "hitman", name: "Hitman" },
      { slug: "bruiser", name: "Bruiser" },
      { slug: "saboteur", name: "Saboteur" },
      { slug: "fixer", name: "Fixer" },
      { slug: "duelist", name: "Duelist" },
      { slug: "gunslinger", name: "Gunslinger" },
    ]);
    const ids = rows.flatMap((row) => row.components.map((button) => button["custom_id"]));
    expect(ids).toEqual([
      "character:class:hitman",
      "character:class:bruiser",
      "character:class:saboteur",
      "character:class:fixer",
      "character:class:duelist",
      "character:class:gunslinger",
    ]);
    expect(characterPress("character:class:hitman")).toEqual({ subcommand: "class", options: { class: "hitman" } });
    expect(characterPress("character:stats")).toEqual({ subcommand: "stats", options: {} });
  });

  it("does not repeat the currency name around a whole amount", () => {
    expect(spokenAmount("5000.00")).toBe("5,000");
    expect(spokenAmount("0")).toBe("0");
  });
});
