import { describe, expect, it } from "vitest";

import { readSlashOptions } from "./slash-options.js";

describe("slash option reading", () => {
  it("reads a user option without treating it as text", () => {
    expect(readSlashOptions([
      {
        name: "adjust",
        type: 1,
        options: [
          { name: "action", type: 3, value: "add" },
          { name: "member", type: 6, value: "100000000000000001", user: { id: "100000000000000001" } },
          { name: "amount", type: 4, value: 25 },
          { name: "reason", type: 3, value: "opening balance" },
        ],
      },
    ])).toEqual({
      action: "add",
      member: "100000000000000001",
      amount: 25,
      reason: "opening balance",
    });
  });

  it("keeps a string member id when that option is text", () => {
    expect(readSlashOptions([
      { name: "member", type: 3, value: "100000000000000002" },
      { name: "enabled", type: 5, value: false },
    ])).toEqual({
      member: "100000000000000002",
      enabled: false,
    });
  });
});
