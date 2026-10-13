import {
  ComponentType,
  SeparatorSpacingSize,
  type APIActionRowComponent,
  type APIComponentInContainer,
  type APIComponentInMessageActionRow,
  type APIContainerComponent,
  type APIMessageTopLevelComponent,
} from "discord-api-types/v10";

export const COMPONENTS_V2 = 32768;

const ACCENT = 0xc4b59a;
const WARNING = 0xc47a6a;

export interface OutcomeRow {
  type: 1;
  components: ReadonlyArray<Record<string, unknown>>;
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
  const body = input.body.trim().length > 3500 ? `${input.body.trim().slice(0, 3480)}\n…` : input.body.trim() || "No details were returned.";
  const inner: APIComponentInContainer[] = [
    { type: ComponentType.TextDisplay, content: detail ? `## ${heading}\n-# ${detail}` : `## ${heading}` },
    { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
    { type: ComponentType.TextDisplay, content: body },
  ];
  for (const row of (input.rows ?? []).slice(0, 3)) {
    inner.push(row as unknown as APIActionRowComponent<APIComponentInMessageActionRow>);
  }
  if (input.fileName) {
    inner.push({ type: ComponentType.File, file: { url: `attachment://${input.fileName}` } });
  }
  inner.push(
    { type: ComponentType.Separator, divider: false, spacing: SeparatorSpacingSize.Small },
    { type: ComponentType.TextDisplay, content: "-# The Collective" },
  );
  const container: APIContainerComponent = {
    type: ComponentType.Container,
    accent_color: input.warning ? WARNING : ACCENT,
    components: inner.slice(0, 10),
  };
  return { flags: COMPONENTS_V2, components: [container] };
}

export function outcomeHeading(name: string): string {
  return name
    .split(/[:/]/)
    .filter(Boolean)
    .map((part) => part.replaceAll("-", " ").replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()))
    .join(" · ");
}

function clean(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}
