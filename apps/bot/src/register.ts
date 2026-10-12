import {
  COMMAND_PARENTS,
  decideRegistration,
  loadEnv,
  testGuildCommandsUrl,
  toDiscordCommandBody,
  validateCommandManifest,
} from "@collective/domain";

export interface RegistrationResult {
  action: "setup_required" | "refused" | "dry_run" | "apply";
  sent: boolean;
  count: number;
  reason?: string;
}

export async function registerCommands(input: {
  apply: boolean;
  guildId?: string;
  testGuildId?: string;
  productionGuildId?: string;
  token?: string;
  applicationId?: string;
  fetchImpl?: typeof fetch;
  write?: (line: string) => void;
}): Promise<RegistrationResult> {
  const write = input.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const errors = validateCommandManifest();
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  const bodies = COMMAND_PARENTS.map((parent) => toDiscordCommandBody(parent));
  const decision = decideRegistration({
    apply: input.apply,
    ...(input.guildId ? { guildId: input.guildId } : {}),
    ...(input.testGuildId ? { testGuildId: input.testGuildId } : {}),
    ...(input.productionGuildId ? { productionGuildId: input.productionGuildId } : {}),
    hasToken: Boolean(input.token),
    hasApplicationId: Boolean(input.applicationId),
  });
  if (decision.action !== "apply") {
    const reason = decision.action === "dry_run" ? "Dry run: commands were not sent." : decision.reason;
    write(`${reason} Parent count: ${bodies.length}.`);
    return {
      action: decision.action,
      sent: false,
      count: bodies.length,
      ...(decision.action === "dry_run" ? {} : { reason }),
    };
  }
  const url = testGuildCommandsUrl(input.applicationId ?? "", decision.guildId);
  if (!url.includes(`/guilds/${decision.guildId}/commands`)) {
    throw new Error("Refusing a command URL that is not limited to the test guild.");
  }
  const response = await (input.fetchImpl ?? fetch)(url, {
    method: "PUT",
    headers: {
      authorization: `Bot ${input.token ?? ""}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(bodies),
  });
  if (!response.ok) {
    write(`Discord rejected the test-guild command update with status ${response.status}.`);
    return { action: "apply", sent: true, count: bodies.length, reason: `discord_status_${response.status}` };
  }
  write(`Updated ${bodies.length} commands on the test guild. Production was not targeted.`);
  return { action: "apply", sent: true, count: bodies.length };
}

function flagValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

const invokedDirectly = process.argv[1]?.replaceAll("\\", "/").endsWith("/register.js") === true;

if (invokedDirectly) {
  const env = loadEnv();
  const guildId = flagValue("--guild");
  registerCommands({
    apply: process.argv.includes("--apply"),
    ...(guildId ? { guildId } : {}),
    ...(env.discord.testGuildId ? { testGuildId: env.discord.testGuildId } : {}),
    ...(env.discord.productionGuildId ? { productionGuildId: env.discord.productionGuildId } : {}),
    ...(env.discord.token ? { token: env.discord.token } : {}),
    ...(env.discord.applicationId ? { applicationId: env.discord.applicationId } : {}),
  })
    .then((result) => {
      if (result.action === "setup_required" || result.action === "refused" || result.reason?.startsWith("discord_status_")) {
        process.exitCode = 1;
      }
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : "Command registration failed."}\n`);
      process.exitCode = 1;
    });
}
