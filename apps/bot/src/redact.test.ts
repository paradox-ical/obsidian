import { describe, expect, it } from "vitest";

import { scrubSecrets } from "./redact.js";

describe("scrubSecrets", () => {
  it("removes configured secret values from error text", () => {
    expect(scrubSecrets("login failed for token-value", ["token-value"])).toBe(
      "login failed for [redacted]",
    );
  });
});
