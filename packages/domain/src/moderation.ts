export const MODERATION_ACTIONS = [
  "delete",
  "warn",
  "timeout",
  "containment",
  "escalate",
  "alert",
  "kick",
  "ban",
  "note",
] as const;

export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export type RuleKind = "flood" | "repeat" | "mention" | "link" | "join_spike";

export interface ModerationRule {
  id: string;
  name: string;
  kind: RuleKind;
  threshold: number;
  windowSeconds: number;
  severityPoints: number;
  actions: ModerationAction[];
  excludedChannelIds: string[];
  excludedRoleIds: string[];
}

export interface EscalationStep {
  points: number;
  action: "timeout" | "containment" | "escalate";
}

export interface ModerationPolicyInput {
  label: string;
  retentionDays: number;
  alertChannelId: string | null;
  timeoutMinutes: number;
  containmentMinutes: number;
  logExcludedChannelIds: string[];
  rules: ModerationRule[];
  escalation: EscalationStep[];
}

const KICK = 1n << 1n;
const BAN = 1n << 2n;
const MANAGE_MESSAGES = 1n << 13n;
const MODERATE_MEMBERS = 1n << 40n;

export function examplePolicy(): ModerationPolicyInput {
  return {
    label: "example",
    retentionDays: 14,
    alertChannelId: null,
    timeoutMinutes: 10,
    containmentMinutes: 60,
    logExcludedChannelIds: [],
    escalation: [
      { points: 3, action: "timeout" },
      { points: 6, action: "containment" },
    ],
    rules: [
      rule("example-flood", "Example flood", "flood", 5, 10, 1, ["delete", "warn"]),
      rule("example-repeat", "Example repeat", "repeat", 3, 30, 1, ["delete", "warn"]),
      rule("example-mention", "Example mention", "mention", 5, 20, 1, ["warn", "alert"]),
      rule("example-link", "Example link or invite", "link", 1, 60, 2, ["delete", "warn", "alert"]),
      rule("example-join", "Example join spike", "join_spike", 8, 30, 0, ["alert", "escalate"]),
    ],
  };
}

function rule(
  id: string,
  name: string,
  kind: RuleKind,
  threshold: number,
  windowSeconds: number,
  severityPoints: number,
  actions: ModerationAction[],
): ModerationRule {
  return {
    id,
    name,
    kind,
    threshold,
    windowSeconds,
    severityPoints,
    actions,
    excludedChannelIds: [],
    excludedRoleIds: [],
  };
}

export function preparePolicy(input: ModerationPolicyInput): { policy: ModerationPolicyInput; banRemoved: boolean } {
  let banRemoved = false;
  const rules = input.rules.map((item) => {
    const actions = item.actions.filter((action) => action !== "ban");
    if (actions.length !== item.actions.length) {
      banRemoved = true;
    }
    return { ...item, actions };
  });
  const escalation = input.escalation;
  return {
    banRemoved,
    policy: {
      ...input,
      label: input.label.trim() || "custom",
      retentionDays: Math.max(1, Math.floor(input.retentionDays)),
      timeoutMinutes: Math.max(1, Math.floor(input.timeoutMinutes)),
      containmentMinutes: Math.max(1, Math.floor(input.containmentMinutes)),
      rules,
      escalation,
    },
  };
}

export interface MessageSignal {
  kind: "message";
  channelId: string;
  roleIds: readonly string[];
  content: string | null;
  mentionCount: number;
  recentCount: number;
  repeatedCount: number;
}

export interface JoinSignal {
  kind: "join";
  roleIds: readonly string[];
  joinCount: number;
}

export interface RuleMatch {
  ruleId: string;
  kind: RuleKind;
  actions: ModerationAction[];
  severityPoints: number;
}

export function evaluateRules(
  policy: ModerationPolicyInput,
  signal: MessageSignal | JoinSignal,
  activePoints = 0,
): { matches: RuleMatch[]; actions: ModerationAction[]; pointsAdded: number; ban: { applied: false; reason: "automatic_ban_disabled" } } {
  const matches: RuleMatch[] = [];
  for (const item of policy.rules) {
    if (excluded(item, signal)) {
      continue;
    }
    if (!matchesKind(item, signal)) {
      continue;
    }
    matches.push({
      ruleId: item.id,
      kind: item.kind,
      actions: item.actions.filter((action) => action !== "ban"),
      severityPoints: item.severityPoints,
    });
  }
  const pointsAdded = matches.reduce((sum, match) => sum + match.severityPoints, 0);
  const projected = activePoints + pointsAdded;
  const actions = new Set<ModerationAction>();
  for (const match of matches) {
    for (const action of match.actions) {
      if (action !== "ban") {
        actions.add(action);
      }
    }
  }
  for (const step of policy.escalation) {
    if (projected >= step.points && step.action !== ("ban" as EscalationStep["action"])) {
      actions.add(step.action);
    }
  }
  return {
    matches,
    actions: [...actions],
    pointsAdded,
    ban: { applied: false, reason: "automatic_ban_disabled" },
  };
}

function excluded(item: ModerationRule, signal: MessageSignal | JoinSignal): boolean {
  if (signal.kind === "message" && item.excludedChannelIds.includes(signal.channelId)) {
    return true;
  }
  return signal.roleIds.some((roleId) => item.excludedRoleIds.includes(roleId));
}

function matchesKind(item: ModerationRule, signal: MessageSignal | JoinSignal): boolean {
  if (item.kind === "join_spike") {
    return signal.kind === "join" && signal.joinCount >= item.threshold;
  }
  if (signal.kind !== "message") {
    return false;
  }
  if (item.kind === "flood") {
    return signal.recentCount >= item.threshold;
  }
  if (item.kind === "repeat") {
    return signal.content !== null && signal.repeatedCount >= item.threshold;
  }
  if (item.kind === "mention") {
    return signal.mentionCount >= item.threshold;
  }
  if (item.kind === "link") {
    return signal.content !== null && linkCount(signal.content) >= item.threshold;
  }
  return false;
}

function linkCount(content: string): number {
  return content.match(/discord\.gg\/|discord\.com\/invite\/|https?:\/\//gi)?.length ?? 0;
}

export function previewRules(
  policy: ModerationPolicyInput,
  signal: MessageSignal | JoinSignal,
  activePoints = 0,
) {
  return { ...evaluateRules(policy, signal, activePoints), persisted: false as const };
}

export interface WarningView {
  points: number;
  status: "active" | "expired" | "reversed";
  expiresAt: Date | null;
}

export function activeWarningPoints(warnings: readonly WarningView[], now: Date): number {
  return warnings.reduce((sum, warning) => {
    if (warning.status !== "active") {
      return sum;
    }
    if (warning.expiresAt && warning.expiresAt.getTime() <= now.getTime()) {
      return sum;
    }
    return sum + warning.points;
  }, 0);
}

export function hierarchyDecision(input: {
  action: ModerationAction;
  actorPosition: number;
  targetPosition: number;
  botPosition: number;
  botPermissions: string;
  targetIsOwner: boolean;
  automated: boolean;
}): { ok: true } | { ok: false; reason: "hierarchy" | "permission" | "owner" } {
  if (input.action === "alert" || input.action === "escalate" || input.action === "note") {
    return { ok: true };
  }
  if (!input.automated && input.actorPosition <= input.targetPosition) {
    return { ok: false, reason: "hierarchy" };
  }
  if (input.action === "warn") {
    return { ok: true };
  }
  if (input.targetIsOwner && (input.action === "kick" || input.action === "ban" || input.action === "timeout" || input.action === "containment")) {
    return { ok: false, reason: "owner" };
  }
  if (input.targetPosition >= input.botPosition) {
    return { ok: false, reason: "hierarchy" };
  }
  const permissions = permissionBits(input.botPermissions);
  const required =
    input.action === "delete"
      ? MANAGE_MESSAGES
      : input.action === "kick"
        ? KICK
        : input.action === "ban"
          ? BAN
          : MODERATE_MEMBERS;
  if ((permissions & required) === 0n) {
    return { ok: false, reason: "permission" };
  }
  return { ok: true };
}

function permissionBits(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

export interface AuditCandidate {
  userId: string;
  action: string;
  targetId: string;
  at: Date;
}

export function attributeAuditActor(input: {
  candidates: readonly AuditCandidate[];
  action: string;
  targetId: string;
  occurredAt: Date;
  windowMs: number;
}): { actorUserId: string; confidence: "reliable" } | { actorUserId: null; confidence: "unknown" } {
  const matches = input.candidates.filter((candidate) => {
    return (
      candidate.action === input.action &&
      candidate.targetId === input.targetId &&
      Math.abs(candidate.at.getTime() - input.occurredAt.getTime()) <= input.windowMs
    );
  });
  const only = matches[0];
  if (matches.length === 1 && only) {
    return { actorUserId: only.userId, confidence: "reliable" };
  }
  return { actorUserId: null, confidence: "unknown" };
}

export function logContent(input: {
  content: string | null;
  channelId: string | null;
  excludedChannelIds: readonly string[];
}): { content: string | null; contentLabel: "available" | "unavailable" | "excluded" } {
  if (input.channelId && input.excludedChannelIds.includes(input.channelId)) {
    return { content: null, contentLabel: "excluded" };
  }
  if (!input.content) {
    return { content: null, contentLabel: "unavailable" };
  }
  return { content: input.content, contentLabel: "available" };
}
