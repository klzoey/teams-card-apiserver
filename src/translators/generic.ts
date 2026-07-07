import { buildCard, FactValue } from "../teams/card";
import { Translator, asDict } from "./types";

/**
 * Fallback for services/events we don't have a dedicated translator for.
 * Surfaces top-level scalar fields as facts plus a truncated JSON dump, so
 * unknown events still show up in Teams with enough detail to design a
 * proper card later.
 */
export const genericTranslator: Translator = (body, ctx) => {
  const p = asDict(body);

  const facts: [string, FactValue][] = Object.entries(p)
    .filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))
    .slice(0, 12)
    .map(([k, v]) => [k, v as FactValue]);

  let json = "";
  try {
    json = JSON.stringify(body, null, 2) ?? "";
  } catch {
    json = String(body);
  }
  if (json.length > 1200) json = json.slice(0, 1200) + "\n…";

  return buildCard({
    title: `📨 ${ctx.service}: ${ctx.eventType}`,
    color: "accent",
    facts,
    monospaceText: json && json !== "{}" ? json : undefined,
  });
};
