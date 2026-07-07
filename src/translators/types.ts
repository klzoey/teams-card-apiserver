import { AdaptiveCard } from "../teams/card";

export interface TranslatorContext {
  service: string;
  eventType: string;
}

/**
 * Turns a captured webhook body into an Adaptive Card.
 * Return null to intentionally skip delivery for an event.
 * May be async (e.g. TMDB enrichment).
 */
export type Translator = (
  body: unknown,
  ctx: TranslatorContext
) => AdaptiveCard | null | Promise<AdaptiveCard | null>;

/** Loose view over untyped webhook payloads. */
export type Dict = Record<string, any>;

export function asDict(value: unknown): Dict {
  return value && typeof value === "object" ? (value as Dict) : {};
}
