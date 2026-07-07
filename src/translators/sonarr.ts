import { buildCard, truncate, CardAction, CardColor } from "../teams/card";
import { Translator, Dict, asDict } from "./types";
import { genericTranslator } from "./generic";
import { friendlyName } from "../config";
import { getTmdbExtras, TmdbExtras } from "../enrich/tmdb";

function findPoster(images: unknown): string | undefined {
  if (!Array.isArray(images)) return undefined;
  const poster = images.find(
    (i: Dict) => i?.coverType === "poster" && typeof i.remoteUrl === "string"
  ) as Dict | undefined;
  return poster?.remoteUrl;
}

function pad(n: unknown): string {
  return String(typeof n === "number" ? n : 0).padStart(2, "0");
}

/** "S01E05 – Episode Title", one line per episode. */
function formatEpisodes(episodes: unknown): string | undefined {
  if (!Array.isArray(episodes) || episodes.length === 0) return undefined;
  return episodes
    .map((e: Dict) => {
      const code = `S${pad(e?.seasonNumber)}E${pad(e?.episodeNumber)}`;
      return e?.title ? `**${code}** – ${e.title}` : `**${code}**`;
    })
    .join("\n\n");
}

const MEDIA_EVENTS = ["Grab", "Download", "SeriesAdd"];

export const sonarrTranslator: Translator = async (body, ctx) => {
  const p = asDict(body);
  const eventType = String(p.eventType ?? ctx.eventType);
  const series = asDict(p.series);
  const episodes = Array.isArray(p.episodes) ? (p.episodes as Dict[]) : [];

  const seriesLabel = series.title
    ? `${series.title}${series.year ? ` (${series.year})` : ""}`
    : undefined;
  const poster = findPoster(series.images);
  const payloadGenres =
    Array.isArray(series.genres) && series.genres.length
      ? series.genres.join(", ")
      : undefined;
  // single-episode events get the episode synopsis under the episode line
  const episodeOverview =
    episodes.length === 1 ? truncate(episodes[0]?.overview, 300) : undefined;
  const episodeText = [formatEpisodes(episodes), episodeOverview]
    .filter(Boolean)
    .join("\n\n");

  const extras: TmdbExtras = MEDIA_EVENTS.includes(eventType)
    ? await getTmdbExtras("tv", series.tmdbId)
    : {};
  const genre = payloadGenres ?? extras.genres?.join(", ");

  const links: CardAction[] = [];
  if (extras.trailerUrl) links.push({ title: "▶ Trailer", url: extras.trailerUrl });
  if (series.tvdbId)
    links.push({
      title: "TVDB",
      url: `https://www.thetvdb.com/?tab=series&id=${series.tvdbId}`,
    });
  if (series.imdbId)
    links.push({ title: "IMDb", url: `https://www.imdb.com/title/${series.imdbId}/` });
  if (p.applicationUrl) links.push({ title: "Open Sonarr", url: p.applicationUrl });

  const dest = friendlyName();

  const mediaCard = (subtitle: string, color: CardColor, text?: string) =>
    buildCard({
      title: seriesLabel ?? subtitle,
      subtitle: seriesLabel ? subtitle : undefined,
      color,
      text,
      imageUrl: poster,
      facts: [
        ["Genre", genre],
        ["Runtime", extras.runtime],
      ],
      actions: links,
    });

  switch (eventType) {
    case "Test":
      return buildCard({
        title: "✅ Sonarr connection test",
        color: "good",
        text: `Webhook from **${p.instanceName ?? "Sonarr"}** is working.`,
      });

    case "Grab":
      return mediaCard(
        dest ? `Episode grabbed for ${dest}` : "Episode grabbed",
        "accent",
        episodeText
      );

    case "Download":
      return mediaCard(
        p.isUpgrade
          ? dest
            ? `Episode upgraded on ${dest}`
            : "Episode upgraded"
          : dest
            ? `Episode added to ${dest}`
            : "Episode added",
        "good",
        episodeText
      );

    case "SeriesAdd":
      return mediaCard(`Series added to ${p.instanceName ?? "Sonarr"}`, "accent");

    case "SeriesDelete":
      return buildCard({
        title: seriesLabel ?? "Series deleted",
        subtitle: seriesLabel ? "Series deleted" : undefined,
        color: "warning",
        facts: [["Path", series.path]],
        actions: links,
      });

    case "EpisodeFileDelete":
      return buildCard({
        title: seriesLabel ?? "Episode file deleted",
        subtitle: seriesLabel ? "Episode file deleted" : undefined,
        color: "warning",
        text: episodeText,
        facts: [["Reason", p.deleteReason]],
        actions: links,
      });

    case "ManualInteractionRequired":
      return buildCard({
        title: "🖐️ Manual interaction required",
        subtitle: seriesLabel,
        color: "attention",
        text: p.message,
        actions: links,
      });

    case "Health":
      return buildCard({
        title: "⚠️ Sonarr health issue",
        color: "attention",
        text: p.message,
        facts: [
          ["Level", p.level],
          ["Type", p.type],
          ["Instance", p.instanceName],
        ],
        actions: p.wikiUrl ? [{ title: "Wiki", url: p.wikiUrl }, ...links] : links,
      });

    case "HealthRestored":
      return buildCard({
        title: "💚 Sonarr health restored",
        color: "good",
        text: p.message,
        facts: [["Instance", p.instanceName]],
        actions: links,
      });

    case "ApplicationUpdate":
      return buildCard({
        title: "🔄 Sonarr updated",
        color: "accent",
        text: p.message,
        facts: [
          ["Previous version", p.previousVersion],
          ["New version", p.newVersion],
        ],
        actions: links,
      });

    default:
      return genericTranslator(body, { ...ctx, eventType });
  }
};
