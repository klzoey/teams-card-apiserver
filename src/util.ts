/** First string value, trimmed, control chars stripped, length-capped. */
export function firstString(value: unknown, max = 80): string | undefined {
  const s = Array.isArray(value) ? value[0] : value;
  if (typeof s !== "string") return undefined;
  const t = s.trim().replace(/[\x00-\x1f\x7f]/g, "");
  return t ? t.slice(0, max) : undefined;
}

/**
 * Per-request overrides for shared multi-user instances. Sources, in
 * precedence order: request headers, then query params (Plex webhooks can't
 * send custom headers, so the query form works everywhere).
 */
export interface RequestOverrides {
  /** Display name for card subtitles (X-Friendly-Name / ?friendlyName=). */
  friendlyName?: string;
  /** Routing key for webhook + name lookup (X-Teams-Webhook-Key / ?dest=). */
  destKey?: string;
}

export function extractOverrides(
  headers: Record<string, unknown> | undefined,
  query: Record<string, unknown> | undefined
): RequestOverrides {
  const h = headers ?? {};
  const q = query ?? {};
  return {
    friendlyName:
      firstString(h["x-friendly-name"]) ??
      firstString(q["friendlyName"]) ??
      firstString(q["friendly_name"]),
    destKey: firstString(h["x-teams-webhook-key"], 40) ?? firstString(q["dest"], 40),
  };
}
