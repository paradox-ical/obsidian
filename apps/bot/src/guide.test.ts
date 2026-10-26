import { describe, expect, it } from "vitest";

import { combatPress } from "./combat-flow.js";
import { guideReply, polish, spokenCode } from "./guide.js";
import { buttonRow } from "./present.js";

describe("the reply guide", () => {
  it("says what was not posted, and points at the command that was actually used", () => {
    const guided = guideReply("go:economy:wallet", "The pocket is open. The notice is not posted.");
    expect(polish("Nothing was charged.")).toContain("Nothing was charged");
    expect(guided.body).toContain("Nothing was posted in a channel");
    expect(guided.body).toContain("**Next**");
    expect(guided.rows?.[0]?.components[0]?.["custom_id"]).toBe("go:economy:history");
  });

  it("keeps a card that already chose its buttons", () => {
    const existing = [buttonRow([{ id: "character:class:hitman", label: "Hitman" }])];
    const guided = guideReply("character", "Press one.", existing);
    expect(guided.body).not.toContain("**Next**");
    expect(guided.rows).toEqual(existing);
  });

  it("opens the floor instead of starting a fight", () => {
    expect(combatPress("combat:menu")).toEqual({ subcommand: "action", options: {} });
    expect(combatPress("combat:queue:join:ranked").options).toEqual({ action: "join", mode: "ranked" });
    expect(spokenCode("denied")).toBe("You are not allowed to do that.");
  });
});
