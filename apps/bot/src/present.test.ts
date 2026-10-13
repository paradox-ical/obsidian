import { describe, expect, it } from "vitest";

import { COMPONENTS_V2, presentOutcome } from "./present.js";

describe("Discord outcome presentation", () => {
  it("builds a Components V2 container and does not use message content", () => {
    const outcome = presentOutcome({
      heading: "Economy",
      detail: "Wallet",
      body: "**Marks** — 5000.00 available",
      rows: [{ type: 1, components: [{ type: 2, style: 1, custom_id: "market:confirm:1", label: "Confirm" }] }],
      fileName: "captcha.png",
    });
    expect(outcome.flags).toBe(COMPONENTS_V2);
    expect(outcome).not.toHaveProperty("content");
    const container = outcome.components[0] as { type: number; accent_color: number; components: Array<{ type: number; content?: string }> };
    expect(container.type).toBe(17);
    expect(container.accent_color).toBe(0xc4b59a);
    expect(container.components.map((part) => part.type)).toEqual([10, 14, 10, 1, 13, 14, 10]);
    expect(container.components[0]?.content).toContain("## Economy");
    expect(container.components[2]?.content).toContain("**Marks**");
  });

  it("uses the warning accent when the outcome failed", () => {
    const outcome = presentOutcome({ heading: "Economy", body: "Nothing was written.", warning: true });
    const container = outcome.components[0] as { accent_color: number };
    expect(container.accent_color).toBe(0xc47a6a);
  });
});
