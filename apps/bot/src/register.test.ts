import { describe, expect, it, vi } from "vitest";

import { registerCommands } from "./register.js";

const testGuildId = "123456789012345678";
const productionGuildId = "999999999999999999";
const applicationId = "223456789012345678";

describe("test-guild command registration", () => {
  it("does not call Discord for a dry run or for missing credentials", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const dryRun = await registerCommands({
      apply: false,
      testGuildId,
      fetchImpl,
      write: () => undefined,
    });
    expect(dryRun).toMatchObject({ action: "dry_run", sent: false, count: 36 });

    const missing = await registerCommands({
      apply: true,
      testGuildId,
      fetchImpl,
      write: () => undefined,
    });
    expect(missing.action).toBe("setup_required");
    expect(missing.sent).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses the production guild and only puts commands on the test guild", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const refused = await registerCommands({
      apply: true,
      guildId: productionGuildId,
      testGuildId,
      productionGuildId,
      token: "bot-token",
      applicationId,
      fetchImpl,
      write: () => undefined,
    });
    expect(refused.action).toBe("refused");
    expect(fetchImpl).not.toHaveBeenCalled();

    fetchImpl.mockResolvedValue(new Response("[]", { status: 200 }));
    const applied = await registerCommands({
      apply: true,
      testGuildId,
      token: "bot-token",
      applicationId,
      fetchImpl,
      write: () => undefined,
    });
    expect(applied).toMatchObject({ action: "apply", sent: true, count: 36 });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(
      `https://discord.com/api/v10/applications/${applicationId}/guilds/${testGuildId}/commands`,
    );
    expect(init?.method).toBe("PUT");
    expect(String(url)).not.toContain(productionGuildId);
  });
});
