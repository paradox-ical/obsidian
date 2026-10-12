export const CAPABILITIES = [
  "moderation",
  "verification_override",
  "tickets",
  "event_management",
  "economy_operations",
  "publications",
  "content_management",
  "statistics",
  "full_administration",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const PROTECTED_MODULES = ["verification", "moderation"] as const;

export const MODULE_KEYS = [
  "verification",
  "moderation",
  "tickets",
  "economy",
  "publications",
  "events",
  "contracts",
  "rpg",
  "shops",
  "games",
  "polls",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

export function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(value);
}

export function decideCapability(input: {
  roleIds: readonly string[];
  grants: readonly { roleId: string; capability: string }[];
  capability: Capability;
}): "allowed" | "denied" {
  const roles = new Set(input.roleIds);
  for (const grant of input.grants) {
    if (!roles.has(grant.roleId)) {
      continue;
    }
    if (grant.capability === "full_administration" || grant.capability === input.capability) {
      return "allowed";
    }
  }
  return "denied";
}

export function decideDashboardAccess(input: {
  userId: string;
  roleIds: readonly string[];
  ownerUserId: string | null;
  userGrantIds: readonly string[];
  roleGrantIds: readonly string[];
}): "allowed" | "denied" {
  if (input.ownerUserId && input.userId === input.ownerUserId) {
    return "allowed";
  }
  if (input.userGrantIds.includes(input.userId)) {
    return "allowed";
  }
  const grantedRoles = new Set(input.roleGrantIds);
  if (input.roleIds.some((roleId) => grantedRoles.has(roleId))) {
    return "allowed";
  }
  return "denied";
}

export function moduleAvailable(moduleKey: ModuleKey, maintenance: boolean): boolean {
  if ((PROTECTED_MODULES as readonly string[]).includes(moduleKey)) {
    return true;
  }
  return !maintenance;
}
