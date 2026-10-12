import { createHash, randomInt } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";

import { hashesEqual } from "./secrets.js";

export const CAPTCHA_LENGTH = 6;
export const CAPTCHA_TTL_MS = 5 * 60 * 1000;
export const CAPTCHA_FAILURE_LIMIT = 3;
export const CAPTCHA_COOLDOWN_MS = 10 * 60 * 1000;
export const CAPTCHA_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Discord guild member flags. Membership screening stays Discord's pending flag. */
export const MEMBER_FLAG_COMPLETED_ONBOARDING = 1 << 1;
export const MEMBER_FLAG_STARTED_ONBOARDING = 1 << 3;

const PRIVILEGED_PERMISSIONS = [
  1n << 1n,
  1n << 2n,
  1n << 3n,
  1n << 4n,
  1n << 5n,
  1n << 17n,
  1n << 28n,
  1n << 29n,
  1n << 40n,
];

export interface NativeMemberState {
  pending: boolean | null;
  flags: number | null;
}

export interface NativeGuildMode {
  screeningEnabled: boolean;
  onboardingEnabled: boolean;
}

export type EligibilityReason = "missing_eligibility" | "native_pending" | "onboarding_incomplete";

export function nativeEligibility(
  member: NativeMemberState,
  mode: NativeGuildMode,
): { eligible: true } | { eligible: false; reason: EligibilityReason } {
  if (mode.screeningEnabled) {
    if (member.pending === null) {
      return { eligible: false, reason: "missing_eligibility" };
    }
    if (member.pending) {
      return { eligible: false, reason: "native_pending" };
    }
  }
  if (mode.onboardingEnabled) {
    if (member.flags === null) {
      return { eligible: false, reason: "missing_eligibility" };
    }
    if ((member.flags & MEMBER_FLAG_COMPLETED_ONBOARDING) === 0) {
      return { eligible: false, reason: "onboarding_incomplete" };
    }
  }
  return { eligible: true };
}

export interface ChannelAccess {
  channelId: string;
  label: string;
  audiences: Array<"pending" | "onboarding" | "verified">;
}

export interface RoleDescriptor {
  id: string;
  name: string;
  position: number;
  permissions: string;
  managed: boolean;
}

export interface CommunitySettingsInput {
  verifiedRoleId: string;
  assistanceChannelId: string;
  screeningEnabled: boolean;
  onboardingEnabled: boolean;
  pauseEntitlementsWhileAbsent: boolean;
  channels: ChannelAccess[];
  progressionRoleIds: string[];
  onboardingRoleIds: string[];
}

export function validateAccessPlan(
  settings: CommunitySettingsInput,
  roles: readonly RoleDescriptor[],
): string[] {
  const errors: string[] = [];
  const verified = roles.find((role) => role.id === settings.verifiedRoleId);
  if (!settings.verifiedRoleId || !verified) {
    errors.push("The separate Verified role is missing.");
  } else if (isPrivileged(verified) || verified.managed) {
    errors.push("The Verified role cannot be privileged or managed.");
  }
  if (!settings.assistanceChannelId) {
    errors.push("Staff assistance needs a channel.");
  }
  if (settings.channels.length === 0) {
    errors.push("The combined channel map is empty.");
  }
  if (settings.channels.length > 0 && !settings.channels.some((channel) => channel.audiences.includes("onboarding"))) {
    errors.push("Onboarding members need at least one visible channel.");
  }
  if (settings.channels.some((channel) => channel.audiences.length === 0)) {
    errors.push("Every mapped channel needs an audience.");
  }
  return errors;
}

export function generateCaptchaCode(): string {
  let code = "";
  for (let index = 0; index < CAPTCHA_LENGTH; index += 1) {
    code += CAPTCHA_ALPHABET[randomInt(CAPTCHA_ALPHABET.length)] ?? "";
  }
  return code;
}

export function normalizeCaptchaAnswer(value: string): string {
  return value.trim().toUpperCase();
}

export function captchaAnswerHash(challengeId: string, answer: string): string {
  return createHash("sha256").update(`${challengeId}:${normalizeCaptchaAnswer(answer)}`).digest("hex");
}

export type CaptchaSubmitResult =
  | { result: "cooldown" }
  | { result: "expired" }
  | { result: "invalidated" }
  | { result: "incorrect"; failureCount: number; cooldownUntil: Date | null }
  | { result: "correct" };

export function assessCaptchaSubmit(input: {
  now: Date;
  expiresAt: Date;
  invalidated: boolean;
  expectedHash: string;
  challengeId: string;
  answer: string;
  failureCount: number;
  cooldownUntil: Date | null;
}): CaptchaSubmitResult {
  if (input.cooldownUntil && input.cooldownUntil.getTime() > input.now.getTime()) {
    return { result: "cooldown" };
  }
  if (input.invalidated) {
    return { result: "invalidated" };
  }
  if (input.expiresAt.getTime() <= input.now.getTime()) {
    return { result: "expired" };
  }
  const actual = captchaAnswerHash(input.challengeId, input.answer);
  if (!hashesEqual(input.expectedHash, actual)) {
    const failureCount = input.failureCount + 1;
    const cooldownUntil =
      failureCount >= CAPTCHA_FAILURE_LIMIT ? new Date(input.now.getTime() + CAPTCHA_COOLDOWN_MS) : null;
    return { result: "incorrect", failureCount, cooldownUntil };
  }
  return { result: "correct" };
}

export function isPrivileged(role: RoleDescriptor): boolean {
  let permissions: bigint;
  try {
    permissions = BigInt(role.permissions);
  } catch {
    return true;
  }
  return PRIVILEGED_PERMISSIONS.some((bit) => (permissions & bit) !== 0n);
}

export function selfSelectDecision(input: {
  role: RoleDescriptor;
  verifiedRoleId: string;
  staffRoleIds: readonly string[];
  progressionRoleIds: readonly string[];
  botHighestPosition: number;
}): { ok: true } | { ok: false; reason: "verified" | "staff" | "progression" | "privileged" | "managed" | "hierarchy" } {
  if (input.role.id === input.verifiedRoleId) {
    return { ok: false, reason: "verified" };
  }
  if (input.staffRoleIds.includes(input.role.id)) {
    return { ok: false, reason: "staff" };
  }
  if (input.progressionRoleIds.includes(input.role.id)) {
    return { ok: false, reason: "progression" };
  }
  if (input.role.managed) {
    return { ok: false, reason: "managed" };
  }
  if (isPrivileged(input.role)) {
    return { ok: false, reason: "privileged" };
  }
  if (input.role.position >= input.botHighestPosition) {
    return { ok: false, reason: "hierarchy" };
  }
  return { ok: true };
}

export interface PanelOptionRule {
  roleId: string;
  exclusiveGroup: string | null;
  prerequisiteRoleIds: string[];
}

export function nextPanelSelection(input: {
  selection: "single" | "multiple";
  options: readonly PanelOptionRule[];
  heldRoleIds: readonly string[];
  selectedRoleIds: readonly string[];
  roleId: string;
  clear: boolean;
}): { ok: true; next: string[] } | { ok: false; reason: "unknown_role" | "prerequisite" | "retired" } {
  const option = input.options.find((item) => item.roleId === input.roleId);
  if (!option) {
    return { ok: false, reason: "unknown_role" };
  }
  if (input.clear) {
    return { ok: true, next: input.selectedRoleIds.filter((roleId) => roleId !== input.roleId) };
  }
  const missing = option.prerequisiteRoleIds.filter((roleId) => !input.heldRoleIds.includes(roleId));
  if (missing.length > 0) {
    return { ok: false, reason: "prerequisite" };
  }
  if (input.selection === "single") {
    return { ok: true, next: [input.roleId] };
  }
  const group = option.exclusiveGroup;
  const withoutGroup = input.selectedRoleIds.filter((roleId) => {
    if (roleId === input.roleId) {
      return false;
    }
    if (!group) {
      return true;
    }
    const other = input.options.find((item) => item.roleId === roleId);
    return other?.exclusiveGroup !== group;
  });
  return { ok: true, next: [...withoutGroup, input.roleId] };
}

export function normalisePanelSelection(input: {
  selection: "single" | "multiple";
  options: readonly PanelOptionRule[];
  heldRoleIds: readonly string[];
  roleIds: readonly string[];
}): { ok: true; next: string[] } | { ok: false; reason: "unknown_role" | "prerequisite" | "exclusive" | "single" } {
  const unique = [...new Set(input.roleIds)];
  if (input.selection === "single" && unique.length > 1) {
    return { ok: false, reason: "single" };
  }
  const chosen = [];
  for (const roleId of unique) {
    const option = input.options.find((item) => item.roleId === roleId);
    if (!option) {
      return { ok: false, reason: "unknown_role" };
    }
    const missing = option.prerequisiteRoleIds.filter((required) => !input.heldRoleIds.includes(required));
    if (missing.length > 0) {
      return { ok: false, reason: "prerequisite" };
    }
    chosen.push(option);
  }
  if (input.selection === "multiple") {
    const groups = chosen.map((option) => option.exclusiveGroup).filter((group): group is string => Boolean(group));
    if (new Set(groups).size !== groups.length) {
      return { ok: false, reason: "exclusive" };
    }
  }
  return { ok: true, next: chosen.map((option) => option.roleId) };
}

export interface DiscordComponentRow {
  type: 1;
  components: Array<
    | { type: 2; style: 1; custom_id: string; label: string }
    | {
        type: 3;
        custom_id: string;
        placeholder: string;
        min_values: number;
        max_values: number;
        options: Array<{ label: string; value: string }>;
      }
  >;
}

export function captchaAnswerRow(): DiscordComponentRow {
  return {
    type: 1,
    components: [{ type: 2, style: 1, custom_id: "community:captcha-modal", label: "Enter the CAPTCHA" }],
  };
}

export function panelPresentation(input: {
  panelId: string;
  name: string;
  mode: "reaction" | "button" | "select";
  selection: "single" | "multiple";
  options: readonly { roleId: string; label: string; emoji: string | null }[];
}):
  | { ok: false; reason: "empty" | "missing_emoji" | "duplicate_emoji" | "too_many" }
  | { ok: true; content: string; components: DiscordComponentRow[]; reactions: string[] } {
  if (input.options.length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (input.options.length > 25) {
    return { ok: false, reason: "too_many" };
  }
  const labels = input.options.map((option) => ({ ...option, label: option.label.slice(0, 80) }));
  if (input.mode === "reaction") {
    if (labels.some((option) => !option.emoji)) {
      return { ok: false, reason: "missing_emoji" };
    }
    const emojis = labels.map((option) => option.emoji ?? "");
    if (new Set(emojis).size !== emojis.length) {
      return { ok: false, reason: "duplicate_emoji" };
    }
    return {
      ok: true,
      content: `${input.name}: react to choose. ${labels.map((option) => `${option.emoji} ${option.label}`).join(", ")}`,
      components: [],
      reactions: emojis,
    };
  }
  if (input.mode === "select") {
    return {
      ok: true,
      content: `${input.name}: choose from the menu.`,
      reactions: [],
      components: [
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: `community:select:${input.panelId}`,
              placeholder: input.name.slice(0, 150),
              min_values: 0,
              max_values: input.selection === "single" ? 1 : labels.length,
              options: labels.map((option) => ({ label: option.label, value: option.roleId })),
            },
          ],
        },
      ],
    };
  }
  const rows: DiscordComponentRow[] = [];
  for (let index = 0; index < labels.length; index += 5) {
    rows.push({
      type: 1,
      components: labels.slice(index, index + 5).map((option) => ({
        type: 2 as const,
        style: 1 as const,
        custom_id: `community:role:${option.roleId}`,
        label: option.label,
      })),
    });
  }
  return { ok: true, content: `${input.name}: use the buttons to change your selection.`, components: rows, reactions: [] };
}

export interface EntitlementView {
  kind: "temporary" | "permanent";
  expiresAt: Date | null;
  pausedRemainingMs: number | null;
  endedAt: Date | null;
}

export function grantHoldsRole(grant: EntitlementView, now: Date): boolean {
  if (grant.endedAt) {
    return false;
  }
  if (grant.kind === "permanent") {
    return true;
  }
  if (grant.pausedRemainingMs !== null) {
    return true;
  }
  return grant.expiresAt !== null && grant.expiresAt.getTime() > now.getTime();
}

export function roleStillHeld(grants: readonly EntitlementView[], now: Date): boolean {
  return grants.some((grant) => grantHoldsRole(grant, now));
}

export function stackExpiry(currentExpiresAt: Date, now: Date, addMs: number): Date {
  const base = Math.max(currentExpiresAt.getTime(), now.getTime());
  return new Date(base + addMs);
}

export function pauseRemaining(expiresAt: Date, now: Date): number {
  return Math.max(0, expiresAt.getTime() - now.getTime());
}

export const ACCOUNT_PROVIDERS = [
  "steam",
  "riot",
  "battlenet",
  "epic",
  "ea",
  "ubisoft",
  "xbox",
  "playstation",
  "minecraft",
  "twitch",
  "youtube",
  "bungie",
  "roblox",
] as const;

export type AccountProvider = (typeof ACCOUNT_PROVIDERS)[number];

export function isAccountProvider(value: string): value is AccountProvider {
  return (ACCOUNT_PROVIDERS as readonly string[]).includes(value);
}

const PROVIDER_KEYS: Record<AccountProvider, { proof: "oauth" | "api_key" | "unavailable"; keys: string[] }> = {
  steam: { proof: "api_key", keys: ["STEAM_WEB_API_KEY"] },
  riot: { proof: "api_key", keys: ["RIOT_API_KEY"] },
  battlenet: { proof: "oauth", keys: ["BATTLENET_CLIENT_ID", "BATTLENET_CLIENT_SECRET"] },
  epic: { proof: "oauth", keys: ["EPIC_CLIENT_ID", "EPIC_CLIENT_SECRET"] },
  ea: { proof: "oauth", keys: ["EA_CLIENT_ID", "EA_CLIENT_SECRET"] },
  ubisoft: { proof: "oauth", keys: ["UBISOFT_CLIENT_ID", "UBISOFT_CLIENT_SECRET"] },
  xbox: { proof: "oauth", keys: ["XBOX_CLIENT_ID", "XBOX_CLIENT_SECRET"] },
  playstation: { proof: "oauth", keys: ["PSN_CLIENT_ID", "PSN_CLIENT_SECRET"] },
  minecraft: { proof: "unavailable", keys: [] },
  twitch: { proof: "oauth", keys: ["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET"] },
  youtube: { proof: "oauth", keys: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"] },
  bungie: { proof: "oauth", keys: ["BUNGIE_CLIENT_ID", "BUNGIE_CLIENT_SECRET"] },
  roblox: { proof: "unavailable", keys: [] },
};

export interface ProviderCredentialStatus {
  provider: AccountProvider;
  ownershipProof: "oauth" | "api_key" | "unavailable";
  status: "ready" | "setup_required";
  missing: string[];
}

export function providerStatuses(source: Record<string, string | undefined>): ProviderCredentialStatus[] {
  return ACCOUNT_PROVIDERS.map((provider) => {
    const spec = PROVIDER_KEYS[provider];
    const missing = spec.keys.filter((key) => !source[key]?.trim());
    const unavailable = spec.proof === "unavailable";
    return {
      provider,
      ownershipProof: spec.proof,
      status: unavailable || missing.length > 0 ? "setup_required" : "ready",
      missing: unavailable ? [] : missing,
    };
  });
}

export function beginOwnershipProof(status: ProviderCredentialStatus): {
  status: "setup_required";
  reason: "ownership_proof_unavailable" | "setup_required" | "live_exchange_unavailable";
} {
  if (status.ownershipProof === "unavailable") {
    return { status: "setup_required", reason: "ownership_proof_unavailable" };
  }
  if (status.status !== "ready") {
    return { status: "setup_required", reason: "setup_required" };
  }
  return { status: "setup_required", reason: "live_exchange_unavailable" };
}

const GLYPHS: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "11110", "10001", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "11110", "10000", "10000", "10000", "11111"],
  F: ["11111", "10000", "11110", "10000", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "11111", "10001", "10001", "10001", "10001"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "11100", "10010", "10001", "10001", "10001"],
  M: ["10001", "11011", "10101", "10001", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10010", "10001", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
};

export function renderCaptchaPng(code: string): Uint8Array {
  const scale = 4;
  const glyphWidth = 5 * scale;
  const gap = scale;
  const width = code.length * (glyphWidth + gap) + gap;
  const height = 7 * scale + gap * 2;
  const pixels = new Uint8Array(width * height * 3);
  pixels.fill(12);
  const normalized = normalizeCaptchaAnswer(code);
  for (let charIndex = 0; charIndex < normalized.length; charIndex += 1) {
    const glyph = GLYPHS[normalized[charIndex] ?? ""];
    if (!glyph) {
      throw new Error("CAPTCHA image could not be drawn.");
    }
    const originX = gap + charIndex * (glyphWidth + gap);
    for (let row = 0; row < glyph.length; row += 1) {
      const bits = glyph[row] ?? "";
      for (let column = 0; column < bits.length; column += 1) {
        if (bits[column] !== "1") {
          continue;
        }
        for (let y = 0; y < scale; y += 1) {
          for (let x = 0; x < scale; x += 1) {
            const pixel = ((gap + row * scale + y) * width + originX + column * scale + x) * 3;
            pixels[pixel] = 230;
            pixels[pixel + 1] = 230;
            pixels[pixel + 2] = 220;
          }
        }
      }
    }
  }
  return encodePng(width, height, pixels);
}

export function decodeCaptchaPng(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes);
  let offset = 8;
  let width = 0;
  const compressed: Buffer[] = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
    }
    if (type === "IDAT") {
      compressed.push(data);
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(compressed));
  const scale = 4;
  const gap = scale;
  const glyphWidth = 5 * scale;
  const charCount = Math.round((width - gap) / (glyphWidth + gap));
  let code = "";
  for (let charIndex = 0; charIndex < charCount; charIndex += 1) {
    const rows: string[] = [];
    for (let row = 0; row < 7; row += 1) {
      let bits = "";
      for (let column = 0; column < 5; column += 1) {
        const x = gap + charIndex * (glyphWidth + gap) + column * scale;
        const y = gap + row * scale;
        const pixelIndex = y * (width * 3 + 1) + 1 + x * 3;
        bits += (raw[pixelIndex] ?? 0) > 100 ? "1" : "0";
      }
      rows.push(bits);
    }
    const match = Object.entries(GLYPHS).find(([, glyph]) => glyph.join() === rows.join());
    if (!match) {
      throw new Error("CAPTCHA image could not be read.");
    }
    code += match[0];
  }
  return code;
}

function encodePng(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, rowStart + 1);
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])) >>> 0, 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const value of buffer) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return crc ^ 0xffffffff;
}
