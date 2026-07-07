/**
 * Adaptive Card construction for Teams.
 *
 * Constraints (delivery via Teams Workflows webhooks, mid-2026):
 *  - Target schema version 1.4 — 1.5 renders incorrectly through Workflows.
 *  - Actions are limited to Action.OpenUrl (Submit/Execute need a bot).
 *  - Images must be publicly reachable HTTPS URLs; no binary attachments.
 *  - Bot icon/name can't be customized; branding must live inside the card.
 *  - Keep total message under ~28 KB.
 */

export type AdaptiveCardElement = Record<string, unknown>;

export interface AdaptiveCard {
  $schema: string;
  type: "AdaptiveCard";
  version: "1.4";
  msteams: Record<string, unknown>;
  body: AdaptiveCardElement[];
  actions?: AdaptiveCardElement[];
}

export type CardColor = "default" | "good" | "attention" | "warning" | "accent";

export type FactValue = string | number | boolean | null | undefined;

export interface CardAction {
  title: string;
  url: string;
}

export interface CardSpec {
  /** Header line, e.g. "🎬 Movie grabbed". */
  title: string;
  /** Second line, e.g. "Dune: Part Two (2024)". */
  subtitle?: string;
  /** Free-text paragraph below the header (supports Teams' markdown subset). */
  text?: string;
  /** Header accent color. */
  color?: CardColor;
  /** Label/value pairs; empty values are dropped automatically. */
  facts?: [string, FactValue][];
  /** HTTPS poster/thumbnail shown beside the facts. */
  imageUrl?: string;
  /** Rendered as Action.OpenUrl buttons; falsy URLs are dropped. */
  actions?: (CardAction | null | undefined)[];
  /** Monospace block for raw/debug output (e.g. generic fallback JSON). */
  monospaceText?: string;
}

const COLOR_MAP: Record<CardColor, string> = {
  default: "Default",
  good: "Good",
  attention: "Attention",
  warning: "Warning",
  accent: "Accent",
};

export function buildCard(spec: CardSpec): AdaptiveCard {
  // The event color goes on the subtitle (the event line) when present;
  // otherwise the title carries it (e.g. health alerts with no media name).
  const body: AdaptiveCardElement[] = [
    {
      type: "TextBlock",
      text: spec.title,
      size: "Large",
      weight: "Bolder",
      color: spec.subtitle ? "Default" : COLOR_MAP[spec.color ?? "default"],
      wrap: true,
    },
  ];

  if (spec.subtitle) {
    body.push({
      type: "TextBlock",
      text: spec.subtitle,
      size: "Medium",
      weight: "Bolder",
      color: COLOR_MAP[spec.color ?? "default"],
      spacing: "None",
      wrap: true,
    });
  }

  const textBlock: AdaptiveCardElement | null = spec.text
    ? { type: "TextBlock", text: spec.text, wrap: true, spacing: "Small" }
    : null;

  const facts = (spec.facts ?? [])
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([title, value]) => ({ title, value: String(value) }));
  const factSet: AdaptiveCardElement | null = facts.length
    ? { type: "FactSet", facts, spacing: "Medium" }
    : null;

  if (spec.imageUrl && spec.imageUrl.startsWith("https://")) {
    // Poster left; overview text and facts share the right column.
    const rightColumn: AdaptiveCardElement[] = [];
    if (textBlock) rightColumn.push({ ...textBlock, spacing: "None" });
    if (factSet) rightColumn.push({ ...factSet, spacing: "Small" });
    body.push({
      type: "ColumnSet",
      spacing: "Medium",
      columns: [
        {
          type: "Column",
          width: "auto",
          items: [{ type: "Image", url: spec.imageUrl, width: "92px" }],
        },
        { type: "Column", width: "stretch", items: rightColumn },
      ],
    });
  } else {
    if (textBlock) body.push(textBlock);
    if (factSet) body.push(factSet);
  }

  if (spec.monospaceText) {
    body.push({
      type: "TextBlock",
      text: spec.monospaceText,
      fontType: "Monospace",
      size: "Small",
      wrap: true,
      spacing: "Medium",
    });
  }

  const actions = (spec.actions ?? [])
    .filter((a): a is CardAction => Boolean(a && a.url))
    .map((a) => ({ type: "Action.OpenUrl", title: a.title, url: a.url }));

  return {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard",
    version: "1.4",
    msteams: { width: "Full" },
    body,
    ...(actions.length ? { actions } : {}),
  };
}

/** Trim long overview text so cards stay compact (and under the 28 KB cap). */
export function truncate(text: unknown, max = 450): string | undefined {
  if (typeof text !== "string" || !text.trim()) return undefined;
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export function formatBytes(bytes: unknown): string | undefined {
  const n = typeof bytes === "number" ? bytes : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}
