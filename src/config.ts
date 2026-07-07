import path from "path";

/** Port the server listens on. Radarr/Sonarr/Plex webhook URLs point here. */
export const PORT = parseInt(process.env.PORT ?? "4545", 10);

/** Where captured webhook payloads are written (one JSON file per event). */
export const CAPTURE_DIR =
  process.env.CAPTURE_DIR ?? path.resolve(__dirname, "..", "captures");

/** Max accepted body size — Plex can attach poster thumbnails. */
export const BODY_LIMIT = "25mb";

/**
 * Payload capture to disk. Defaults on (the capture-first workflow); set
 * CAPTURE_ENABLED=false in production sidecars to translate+forward only.
 */
export const CAPTURE_ENABLED = !/^(0|false|off|no)$/i.test(
  process.env.CAPTURE_ENABLED ?? ""
);

/**
 * Friendly destination name shown in card subtitles, e.g.
 * "Movie added to My Plex Server". SHOW_FRIENDLY_NAME=false hides it.
 */
export const FRIENDLY_NAME = process.env.FRIENDLY_NAME ?? "";
export const SHOW_FRIENDLY_NAME = !/^(0|false|off|no)$/i.test(
  process.env.SHOW_FRIENDLY_NAME ?? ""
);

/** Returns the friendly name if configured and enabled, else the fallback. */
export function friendlyName(fallback?: string): string | undefined {
  if (FRIENDLY_NAME && SHOW_FRIENDLY_NAME) return FRIENDLY_NAME;
  return fallback || undefined;
}

/**
 * Optional TMDB API key (v3 key or v4 read token) for card enrichment:
 * trailer links, runtime, genre fallback. Free at themoviedb.org.
 */
export const TMDB_API_KEY = process.env.TMDB_API_KEY ?? "";
