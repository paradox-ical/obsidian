import type { AddressInfo } from "node:net";

import { createServiceHealthReport } from "@collective/domain";
import { afterEach, describe, expect, it } from "vitest";

import { startHealthServer } from "./http.js";

const servers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("health server", () => {
  it("returns the database report and a 503 when the database is unavailable", async () => {
    const server = await startHealthServer({
      port: 0,
      host: "127.0.0.1",
      allowOrigin: "http://localhost:5173",
      getReport: () =>
        createServiceHealthReport({
          service: "bot",
          database: "unavailable",
          foundationRevision: null,
          discord: "setup_required",
          jobs: "not_applicable",
        }),
    });
    servers.push({
      close: () =>
        new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    });

    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    const body = (await response.json()) as { database: string; token?: string };
    expect(response.status).toBe(503);
    expect(body.database).toBe("unavailable");
    expect(body.token).toBeUndefined();

    const allowed = await fetch(`http://127.0.0.1:${address.port}/health`, {
      headers: { origin: "http://127.0.0.1:5173" },
    });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5173");
    const foreign = await fetch(`http://127.0.0.1:${address.port}/health`, {
      headers: { origin: "https://example.test" },
    });
    expect(foreign.headers.get("access-control-allow-origin")).toBeNull();
  });
});
