export interface DiscordDirectory {
  exchange(code: string): Promise<{ userId: string } | null>;
  member(guildId: string, userId: string): Promise<{ userId: string; roleIds: string[] } | null>;
}

export function createLiveDirectory(input: {
  applicationId: string;
  clientSecret: string;
  botToken: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): DiscordDirectory {
  const fetchImpl = input.fetchImpl ?? fetch;
  return {
    async exchange(code) {
      const body = new URLSearchParams({
        client_id: input.applicationId,
        client_secret: input.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: input.redirectUri,
      });
      const tokenResponse = await fetchImpl("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!tokenResponse.ok) {
        return null;
      }
      const tokenJson = (await tokenResponse.json()) as { access_token?: string };
      if (!tokenJson.access_token) {
        return null;
      }
      const userResponse = await fetchImpl("https://discord.com/api/users/@me", {
        headers: { authorization: `Bearer ${tokenJson.access_token}` },
      });
      if (!userResponse.ok) {
        return null;
      }
      const user = (await userResponse.json()) as { id?: string };
      return user.id ? { userId: user.id } : null;
    },
    async member(guildId, userId) {
      const response = await fetchImpl(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, {
        headers: { authorization: `Bot ${input.botToken}` },
      });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error("Discord member lookup failed.");
      }
      const member = (await response.json()) as { roles?: string[] };
      return { userId, roleIds: member.roles ?? [] };
    },
  };
}
