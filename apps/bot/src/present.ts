import {
  ComponentType,
  SeparatorSpacingSize,
  type APIActionRowComponent,
  type APIComponentInContainer,
  type APIComponentInMessageActionRow,
  type APIContainerComponent,
  type APIMessageTopLevelComponent,
} from "discord-api-types/v10";
import { MODULE_COPY } from "./experience-catalog.js";

export const COMPONENTS_V2 = 32768;

const ACCENT = 0xc4b59a;
const WARNING = 0xc47a6a;

export interface OutcomeRow {
  type: 1;
  components: Array<Record<string, unknown>>;
}

export function presentOutcome(input: {
  heading: string;
  detail?: string;
  body: string;
  warning?: boolean;
  rows?: readonly OutcomeRow[];
  fileName?: string;
}): { flags: number; components: APIMessageTopLevelComponent[] } {
  const heading = clean(input.heading, 80) || "The Collective";
  const detail = input.detail ? clean(input.detail, 80) : "";
  const body = input.body.trim() || "No details were returned.";
  if (body.length > 4000) throw new Error("Paginate long outcomes before presenting them.");
  const componentCount = 6 + (input.fileName ? 1 : 0) + (input.rows ?? []).reduce((sum, row) => sum + 1 + row.components.length, 0);
  if (componentCount > 40) throw new Error("Paginate controls before presenting more than 40 components.");
  const inner: APIComponentInContainer[] = [
    { type: ComponentType.TextDisplay, content: detail ? `## ${heading}\n-# ${detail}` : `## ${heading}` },
    { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
    { type: ComponentType.TextDisplay, content: body },
  ];
  for (const row of input.rows ?? []) {
    inner.push(row as unknown as APIActionRowComponent<APIComponentInMessageActionRow>);
  }
  if (input.fileName) {
    if (/\.(png|jpe?g|webp|gif)$/i.test(input.fileName)) inner.push({ type: ComponentType.MediaGallery, items: [{ media: { url: `attachment://${input.fileName}` } }] });
    else inner.push({ type: ComponentType.File, file: { url: `attachment://${input.fileName}` } });
  }
  inner.push(
    { type: ComponentType.Separator, divider: false, spacing: SeparatorSpacingSize.Small },
    { type: ComponentType.TextDisplay, content: "-# ◆ The Collective" },
  );
  const container: APIContainerComponent = {
    type: ComponentType.Container,
    accent_color: input.warning ? WARNING : ACCENT,
    components: inner,
  };
  return { flags: COMPONENTS_V2, components: [container] };
}

export function spokenAmount(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  const whole = BigInt(match[2]!).toLocaleString("en-AU");
  const fraction = match[3];
  return `${match[1]}${whole}${fraction && /[1-9]/.test(fraction) ? `.${fraction.padEnd(2, "0")}` : ""}`;
}

export function buttonRow(buttons: ReadonlyArray<{ id: string; label: string; style?: number }>): OutcomeRow {
  return {
    type: 1,
    components: buttons.slice(0, 5).map((button) => ({
      type: 2,
      style: button.style ?? 2,
      custom_id: button.id,
      label: button.label.slice(0, 80),
    })),
  };
}

export function outcomeHeading(name: string): string {
  if (name.startsWith("ux:")) return "The Collective";
  if (name.startsWith("community:role:") || name.startsWith("community:select:")) return "Choose your roles";
  if (name.startsWith("session:")) return "Action result";
  const parts = name.split(":");
  if (parts[0] === "go") return outcomeHeading(parts.slice(1, 3).join("/"));
  if (parts.length > 1) return outcomeHeading(parts.slice(0, 2).join("/"));
  if (MODULE_COPY[name]) return MODULE_COPY[name]!.title;
  return name
    .split(/[:/]/)
    .filter(Boolean)
    .map((part) => part.replaceAll("-", " ").replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()))
    .join(" · ");
}

function clean(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}
