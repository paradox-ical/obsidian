export interface SlashOptionNode {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: readonly SlashOptionNode[];
  user?: { id: string } | null;
  role?: { id: string } | null;
  channel?: { id: string } | null;
}

const SUBCOMMAND = 1;
const SUBCOMMAND_GROUP = 2;
const USER = 6;
const CHANNEL = 7;
const ROLE = 8;

export function readSlashOptions(data: readonly SlashOptionNode[]): Record<string, string | boolean | number> {
  const options: Record<string, string | boolean | number> = {};
  const visit = (nodes: readonly SlashOptionNode[]) => {
    for (const node of nodes) {
      if (node.type === SUBCOMMAND || node.type === SUBCOMMAND_GROUP) {
        if (node.options) {
          visit(node.options);
        }
        continue;
      }
      if (node.type === USER) {
        const userId = node.user?.id ?? (typeof node.value === "string" ? node.value : "");
        if (userId) {
          options[node.name] = userId;
        }
        continue;
      }
      if (node.type === ROLE) {
        const roleId = node.role?.id ?? (typeof node.value === "string" ? node.value : "");
        if (roleId) {
          options[node.name] = roleId;
        }
        continue;
      }
      if (node.type === CHANNEL) {
        const channelId = node.channel?.id ?? (typeof node.value === "string" ? node.value : "");
        if (channelId) {
          options[node.name] = channelId;
        }
        continue;
      }
      if (typeof node.value === "string" || typeof node.value === "boolean" || typeof node.value === "number") {
        options[node.name] = node.value;
      }
    }
  };
  visit(data);
  return options;
}
