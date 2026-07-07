import { TMDB_API_KEY } from "../config";

export interface TmdbExtras {
  runtime?: string;
  trailerUrl?: string;
  genres?: string[];
}

const CACHE_TTL_MS = 6 * 3600 * 1000;
const cache = new Map<string, { at: number; extras: TmdbExtras }>();

function formatMinutes(min: unknown): string | undefined {
  if (typeof min !== "number" || min <= 0) return undefined;
  return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`;
}

/**
 * Best-effort enrichment from TMDB (one call: details + videos). Returns {}
 * when no API key is configured, the id is missing, or TMDB is unreachable —
 * cards simply render without runtime/trailer.
 */
export async function getTmdbExtras(
  kind: "movie" | "tv",
  tmdbId: unknown
): Promise<TmdbExtras> {
  const id = typeof tmdbId === "number" && tmdbId > 0 ? tmdbId : undefined;
  if (!TMDB_API_KEY || !id) return {};

  const cacheKey = `${kind}/${id}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.extras;

  try {
    // v4 read tokens are JWTs ("eyJ..."), v3 keys go in the query string
    const bearer = TMDB_API_KEY.startsWith("eyJ");
    const url =
      `https://api.themoviedb.org/3/${kind}/${id}?append_to_response=videos` +
      (bearer ? "" : `&api_key=${TMDB_API_KEY}`);
    const res = await fetch(url, {
      headers: bearer ? { Authorization: `Bearer ${TMDB_API_KEY}` } : {},
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return {};
    const data = (await res.json()) as Record<string, any>;

    const trailer = (data.videos?.results ?? [])
      .filter((v: any) => v.site === "YouTube" && v.type === "Trailer" && v.key)
      .sort((a: any, b: any) => (b.official ? 1 : 0) - (a.official ? 1 : 0))[0];

    const extras: TmdbExtras = {
      runtime: formatMinutes(
        kind === "movie" ? data.runtime : data.episode_run_time?.[0]
      ),
      trailerUrl: trailer
        ? `https://www.youtube.com/watch?v=${trailer.key}`
        : undefined,
      genres: Array.isArray(data.genres)
        ? data.genres.map((g: any) => g.name).filter(Boolean)
        : undefined,
    };
    cache.set(cacheKey, { at: Date.now(), extras });
    return extras;
  } catch {
    return {};
  }
}
