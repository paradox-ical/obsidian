import {
  grantTemporaryRole,
  listOwnAccounts,
  listRolePanels,
  proveOwnership,
  reconcileMember,
  requestAssistance,
  reviewVerification,
  saveHandle,
  setAccountVisibility,
  setExactExpiry,
  setPanelSelection,
  startCaptcha,
  submitCaptcha,
  togglePanelRole,
  unlinkAccount,
  type PrismaClient,
} from "@collective/db";
import { captchaAnswerRow, panelPresentation, type DiscordComponentRow, type NativeMemberState, type RoleDescriptor } from "@collective/domain";

import { spokenCode } from "./guide.js";

export interface CommunityCommand {
  name: string;
  subcommand?: string;
  options: Record<string, string | boolean | number>;
  values?: string[];
  guildId: string;
  userId: string;
  roleIds: string[];
  native: NativeMemberState;
  roles: RoleDescriptor[];
  botHighestPosition: number;
  credentials: Record<string, string | undefined>;
  now: Date;
}

export interface CommunityReply {
  content: string;
  file?: { filename: string; bytes: Uint8Array };
  components?: DiscordComponentRow[];
  reactions?: string[];
  bindPanelId?: string;
}

export async function runCommunityCommand(
  db: PrismaClient,
  command: CommunityCommand,
): Promise<CommunityReply> {
  if (command.name === "verify" && command.subcommand === "captcha") {
    const answer = stringOption(command, "answer");
    if (!answer) {
      const started = await startCaptcha(db, {
        guildId: command.guildId,
        userId: command.userId,
        native: command.native,
        now: command.now,
      });
      if (started.result === "challenge") {
        return {
          content: "Enter the characters in the image. Staff can help through /verify assistance. This does not replace Discord's rules.",
          file: { filename: "captcha.png", bytes: started.image },
          components: [captchaAnswerRow()],
        };
      }
      return { content: captchaStartMessage(started.result, "reason" in started ? started.reason : undefined) };
    }
    const open = await db.captchaChallenge.findFirst({
      where: { guildId: command.guildId, userId: command.userId, invalidatedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!open) {
      return { content: "There is no active CAPTCHA. Start one with /verify captcha." };
    }
    const submitted = await submitCaptcha(db, {
      guildId: command.guildId,
      userId: command.userId,
      challengeId: open.id,
      answer,
      now: command.now,
    });
    return { content: submitted.result === "verified" ? "You are verified." : `That answer was not accepted. ${spokenCode(submitted.result)}` };
  }

  if (command.name === "verify" && command.subcommand === "assistance") {
    const requested = await requestAssistance(db, {
      guildId: command.guildId,
      userId: command.userId,
      note: stringOption(command, "note") || "I need help with verification.",
      now: command.now,
    });
    return { content: `Assistance request ${requested.requestId} is open. Your access is unchanged.` };
  }

  if (command.name === "verify" && command.subcommand === "review") {
    const reviewed = await reviewVerification(db, {
      guildId: command.guildId,
      actorUserId: command.userId,
      actorRoleIds: command.roleIds,
      userId: stringOption(command, "member"),
      reason: stringOption(command, "reason"),
      revoke: command.options["revoke"] === true,
      now: command.now,
    });
    return { content: `Verification review: ${reviewed.result}.` };
  }

  if (command.name === "roles" && command.subcommand === "optin") {
    const roleId = stringOption(command, "role");
    if (!command.roles.some((role) => role.id === roleId)) {
      return { content: "That role cannot be confirmed from Discord right now." };
    }
    const toggled = await togglePanelRole(db, {
      guildId: command.guildId,
      userId: command.userId,
      roleId,
      clear: command.options["clear"] === true,
      heldRoleIds: command.roleIds,
      now: command.now,
      assignment: { roles: command.roles, botHighestPosition: command.botHighestPosition },
    });
    return { content: toggled.ok ? "Role selection updated." : `Role selection was not changed: ${toggled.reason}.` };
  }

  if (command.name === "roles" && command.subcommand === "panel") {
    return showPanel(db, command);
  }

  if (command.name === "accounts" && command.subcommand === "link") {
    const saved = await saveHandle(db, {
      guildId: command.guildId,
      userId: command.userId,
      provider: stringOption(command, "provider"),
      handle: stringOption(command, "handle"),
    });
    if (saved.result !== "saved") {
      return { content: "That provider is not available." };
    }
    const proof = await proveOwnership(db, {
      guildId: command.guildId,
      userId: command.userId,
      provider: stringOption(command, "provider"),
      credentials: command.credentials,
    });
    return {
      content: `Handle saved as ${saved.ownership}. Ownership proof: ${proof.result}. Ordinary access is unchanged.`,
    };
  }

  if (command.name === "accounts" && command.subcommand === "inspect") {
    const accounts = await listOwnAccounts(db, { guildId: command.guildId, userId: command.userId });
    if (accounts.length === 0) {
      return { content: "You have no linked accounts. Ordinary access does not require one." };
    }
    return {
      content: accounts.map((account) => `${account.provider}: ${account.ownership}, ${account.visibility}`).join("\n"),
    };
  }

  if (command.name === "accounts" && command.subcommand === "privacy") {
    const updated = await setAccountVisibility(db, {
      guildId: command.guildId,
      userId: command.userId,
      provider: stringOption(command, "provider"),
      visibility: stringOption(command, "visibility"),
    });
    return { content: updated.result === "updated" ? "Who can see that handle has changed." : spokenCode(updated.result) };
  }

  if (command.name === "accounts" && command.subcommand === "unlink") {
    const removed = await unlinkAccount(db, {
      guildId: command.guildId,
      userId: command.userId,
      provider: stringOption(command, "provider"),
      now: command.now,
    });
    return { content: removed.result === "unlinked" ? "That handle is no longer linked." : spokenCode(removed.result) };
  }

  if (command.name === "temproles" && (command.subcommand === "grant" || command.subcommand === "renew")) {
    const granted = await grantTemporaryRole(db, {
      guildId: command.guildId,
      actorUserId: command.userId,
      actorRoleIds: command.roleIds,
      userId: stringOption(command, "member"),
      roleId: stringOption(command, "role"),
      days: Number(command.options["days"] ?? 0),
      reason: stringOption(command, "reason"),
      now: command.now,
    });
    return { content: granted.result === "granted" ? "Temporary role granted. It will expire automatically." : spokenCode(granted.result) };
  }

  if (command.name === "temproles" && command.subcommand === "expire") {
    const days = Number(command.options["days"] ?? 0);
    const updated = await setExactExpiry(db, {
      guildId: command.guildId,
      actorUserId: command.userId,
      actorRoleIds: command.roleIds,
      userId: stringOption(command, "member"),
      roleId: stringOption(command, "role"),
      expiresAt: new Date(command.now.getTime() + days * 24 * 60 * 60 * 1000),
      reason: stringOption(command, "reason"),
      now: command.now,
    });
    return { content: updated.result === "updated" ? "The expiry is set." : spokenCode(updated.result) };
  }

  if (command.name === "verify" && command.subcommand === "rejoin") {
    const restored = await reconcileMember(db, {
      guildId: command.guildId,
      userId: command.userId,
      native: command.native,
      now: command.now,
    });
    return { content: restored.result === "restored" ? "Your place on the street was checked again." : spokenCode(restored.result) };
  }

  return { content: "That community control is not available on this command." };
}

function stringOption(command: CommunityCommand, name: string): string {
  const value = command.options[name];
  return typeof value === "string" ? value : "";
}

export async function runCommunityComponent(db: PrismaClient, command: CommunityCommand): Promise<CommunityReply> {
  if (command.name.startsWith("community:role:")) {
    const roleId = command.name.slice("community:role:".length);
    const toggled = await togglePanelRole(db, {
      guildId: command.guildId,
      userId: command.userId,
      roleId,
      clear: false,
      toggle: true,
      heldRoleIds: command.roleIds,
      now: command.now,
      assignment: { roles: command.roles, botHighestPosition: command.botHighestPosition },
    });
    return { content: toggled.ok ? "Role selection updated." : `Role selection was not changed: ${toggled.reason}.` };
  }
  if (command.name.startsWith("community:select:")) {
    const panelId = command.name.slice("community:select:".length);
    const selected = await setPanelSelection(db, {
      guildId: command.guildId,
      userId: command.userId,
      panelId,
      roleIds: command.values ?? [],
      heldRoleIds: command.roleIds,
      now: command.now,
      assignment: { roles: command.roles, botHighestPosition: command.botHighestPosition },
    });
    return { content: selected.ok ? "Role selection updated." : `Role selection was not changed: ${selected.reason}.` };
  }
  return { content: "That panel control is not available." };
}

export async function runPanelReaction(
  db: PrismaClient,
  input: CommunityCommand & { panelId: string; emoji: string; added: boolean },
): Promise<CommunityReply> {
  const panels = await listRolePanels(db, input.guildId);
  const panel = panels.find((item) => item.id === input.panelId);
  const option = panel?.options.find((item) => item.emoji === input.emoji);
  if (!panel || !option) {
    return { content: "That reaction is not a role choice." };
  }
  const toggled = await togglePanelRole(db, {
    guildId: input.guildId,
    userId: input.userId,
    roleId: option.roleId,
    clear: !input.added,
    heldRoleIds: input.roleIds,
    now: input.now,
    assignment: { roles: input.roles, botHighestPosition: input.botHighestPosition },
  });
  return { content: toggled.ok ? "Role selection updated." : `Role selection was not changed: ${toggled.reason}.` };
}

async function showPanel(db: PrismaClient, command: CommunityCommand): Promise<CommunityReply> {
  const panels = await listRolePanels(db, command.guildId);
  const requested = stringOption(command, "name");
  const chosen = requested ? panels.filter((panel) => panel.name === requested || panel.id === requested) : panels;
  if (chosen.length !== 1) {
    const first = chosen[0];
    if (!first) {
      return { content: "No role panels are published." };
    }
    return { content: "Choose a role panel below.", components: [{ type: 1, components: [{ type: 3, custom_id: "ux:role-panel", placeholder: "Choose a role panel", min_values: 1, max_values: 1, options: chosen.slice(0, 25).map((panel) => ({ label: panel.name.slice(0, 100), value: panel.id })) }] }] };
  }
  const panel = chosen[0];
  if (!panel) {
    return { content: "No role panels are published." };
  }
  const presentation = panelPresentation({
    panelId: panel.id,
    name: panel.name,
    // Slash results are private. Discord cannot attach reactions to ephemeral
    // messages, so expose the same choices as a select here. Existing public
    // reaction panels and their stored bindings retain their original mode.
    mode: panel.mode === "reaction" ? "select" : panel.mode,
    selection: panel.selection,
    options: panel.options,
  });
  if (!presentation.ok) {
    return { content: `That panel cannot be shown: ${presentation.reason}.` };
  }
  return {
    content: presentation.content,
    components: presentation.components,
    reactions: presentation.reactions,
    ...(presentation.reactions.length > 0 ? { bindPanelId: panel.id } : {}),
  };
}

function captchaStartMessage(result: string, reason?: string): string {
  if (result === "ineligible") {
    return reason === "native_pending"
      ? "Discord still needs you to accept the community rules. This bot does not replace that step."
      : `Verification is not available yet: ${reason ?? "ineligible"}.`;
  }
  if (result === "already_verified") {
    return "You are already verified.";
  }
  if (result === "cooldown") {
    return "CAPTCHA is on cooldown after repeated failures.";
  }
  return "Verification is setup-required until the Verified role and channel map are published.";
}
