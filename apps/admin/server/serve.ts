import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { createPrismaClient, openModulesForTesting } from "@collective/db";
import { loadEnv, oauthReadiness } from "@collective/domain";
import { config as loadDotenv } from "dotenv";

import { createLiveDirectory } from "./directory.js";
import { handleAdminRequest } from "./handler.js";

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envFile)) {
  loadDotenv({ path: envFile });
}

const env = loadEnv();
const port = env.adminPort;
const host = process.env["ADMIN_HOST"]?.trim() || "0.0.0.0";
const staticRoot = fileURLToPath(new URL("../dist", import.meta.url));
const prisma = createPrismaClient(env.databaseUrl);
void openModulesForTesting(prisma).catch(() => undefined);
const redirectUri = `${env.adminOrigin}/auth/discord/callback`;
const directory =
  oauthReadiness(env) === "oauth_ready" && env.discord.token && env.discord.applicationId && env.discord.clientSecret
    ? createLiveDirectory({
        applicationId: env.discord.applicationId,
        clientSecret: env.discord.clientSecret,
        botToken: env.discord.token,
        redirectUri,
      })
    : {
        async exchange(): Promise<null> {
          return null;
        },
        async member(): Promise<null> {
          return null;
        },
      };

function contentType(filePath: string): string {
  switch (extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function resolveStaticPath(urlPath: string): string | null {
  const relativePath = urlPath.replace(/^\/+/, "");
  const requested = normalize(join(staticRoot, relativePath));
  const rootWithSep = staticRoot.endsWith(sep) ? staticRoot : `${staticRoot}${sep}`;
  if (requested !== staticRoot && !requested.startsWith(rootWithSep)) {
    return null;
  }
  return requested;
}

const server = createServer((request, response) => {
  void handleAdminRequest(request, response, {
    env,
    db: prisma,
    directory,
    ...(env.discord.testGuildId ? { guildId: env.discord.testGuildId } : {}),
  }).then((handled) => {
    if (handled || response.writableEnded) {
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "method_not_allowed", access: "denied" }));
      return;
    }

    const pathname = request.url?.split("?")[0] ?? "/";
    const candidate = pathname === "/" ? "/index.html" : pathname;
    const filePath = resolveStaticPath(candidate);
    const indexPath = join(staticRoot, "index.html");
    const selected = filePath && existsSync(filePath) && statSync(filePath).isFile() ? filePath : indexPath;

    if (!existsSync(selected)) {
      response.writeHead(503, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "admin_assets_missing", access: "denied" }));
      return;
    }

    response.writeHead(200, {
      "content-type": contentType(selected),
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(selected).pipe(response);
  }).catch(() => {
    if (!response.writableEnded) {
      response.writeHead(503, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify({ error: "unavailable", access: "denied" }));
    }
  });
});

server.listen(port, host, () => {
  const oauth = oauthReadiness(env);
  process.stdout.write(
    `Admin dashboard listening on ${host}:${port}. OAuth is ${oauth}. Unauthenticated access stays denied.\n`,
  );
});
