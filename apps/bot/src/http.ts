import { createServer, type Server } from "node:http";

import type { HealthReport } from "@collective/domain";

export function startHealthServer(options: {
  port: number;
  host: string;
  allowOrigin?: string;
  getReport: () => HealthReport;
}): Promise<Server> {
  const server = createServer((request, response) => {
    const cors = corsHeaders(request.headers.origin, options.allowOrigin);
    if (request.method === "OPTIONS" && request.url?.split("?")[0] === "/health") {
      response.writeHead(204, cors);
      response.end();
      return;
    }
    if (request.method !== "GET" || request.url?.split("?")[0] !== "/health") {
      response.writeHead(404, { "content-type": "application/json; charset=utf-8", ...cors });
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    const report = options.getReport();
    const statusCode = report.database === "ok" ? 200 : 503;
    response.writeHead(statusCode, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...cors,
    });
    response.end(JSON.stringify(report));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => resolve(server));
  });
}

function corsHeaders(requestOrigin: string | undefined, adminOrigin: string | undefined): Record<string, string> {
  const allowed = allowedOrigin(requestOrigin, adminOrigin);
  if (!allowed) {
    return {};
  }
  return {
    "access-control-allow-origin": allowed,
    "access-control-allow-methods": "GET, OPTIONS",
    vary: "Origin",
  };
}

function allowedOrigin(requestOrigin: string | undefined, adminOrigin: string | undefined): string | null {
  if (!requestOrigin || !adminOrigin || requestOrigin === "null") {
    return null;
  }
  if (requestOrigin === adminOrigin) {
    return requestOrigin;
  }
  try {
    const requested = new URL(requestOrigin);
    const allowed = new URL(adminOrigin);
    const localHosts = new Set(["localhost", "127.0.0.1"]);
    if (
      requested.protocol === allowed.protocol &&
      requested.port === allowed.port &&
      localHosts.has(requested.hostname) &&
      localHosts.has(allowed.hostname)
    ) {
      return requestOrigin;
    }
  } catch {
    return null;
  }
  return null;
}
