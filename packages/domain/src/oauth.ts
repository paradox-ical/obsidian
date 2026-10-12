import type { AppEnv } from "./env.js";

export function oauthReadiness(env: Pick<AppEnv, "discord">): "setup_required" | "oauth_ready" {
  if (!env.discord.token || !env.discord.applicationId || !env.discord.clientSecret) {
    return "setup_required";
  }
  return "oauth_ready";
}

export function discordAuthorizeUrl(input: {
  applicationId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", input.applicationId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("prompt", "consent");
  return url.toString();
}
