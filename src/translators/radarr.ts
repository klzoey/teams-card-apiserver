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

const MEDIA_EVENTS = ["Grab", "Download", "MovieAdded"];

export const radarrTranslator: Translator = async (body, ctx) => {
  const p = asDict(body);
  const eventType = String(p.eventType ?? ctx.eventType);
  const movie = asDict(p.movie);

  const movieLabel = movie.title
    ? `${movie.title}${movie.year ? ` (${movie.year})` : ""}`
    : undefined;
  const poster = findPoster(movie.images);
  const overview = truncate(movie.overview);
  const payloadGenres =
    Array.isArray(movie.genres) && movie.genres.length
      ? movie.genres.join(", ")
      : undefined;

  const extras: TmdbExtras = MEDIA_EVENTS.includes(eventType)
    ? await getTmdbExtras("movie", movie.tmdbId)
    : {};
  const genre = payloadGenres ?? extras.genres?.join(", ");

  const links: CardAction[] = [];
  if (extras.trailerUrl) links.push({ title: "▶ Trailer", url: extras.trailerUrl });
  if (movie.tmdbId)
    links.push({ title: "TMDB", url: `https://www.themoviedb.org/movie/${movie.tmdbId}` });
  if (movie.imdbId)
    links.push({ title: "IMDb", url: `https://www.imdb.com/title/${movie.imdbId}/` });
  if (p.applicationUrl) links.push({ title: "Open Radarr", url: p.applicationUrl });

  const dest = ctx.friendlyName ?? friendlyName();

  // Title = movie name, subtitle = event message, poster + overview + facts.
  const mediaCard = (subtitle: string, color: CardColor) =>
    buildCard({
      title: movieLabel ?? subtitle,
      subtitle: movieLabel ? subtitle : undefined,
      color,
      text: overview,
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
        title: "✅ Radarr connection test",
        color: "good",
        text: `Webhook from **${p.instanceName ?? "Radarr"}** is working.`,
      });

    case "Grab":
      return mediaCard(dest ? `Movie grabbed for ${dest}` : "Movie grabbed", "accent");

    case "Download":
      return mediaCard(
        p.isUpgrade
          ? dest
            ? `Movie upgraded on ${dest}`
            : "Movie upgraded"
          : dest
            ? `Movie added to ${dest}`
            : "Movie added",
        "good"
      );

    case "MovieAdded":
      // added to Radarr for monitoring — not downloaded yet
      return mediaCard(`Movie added to ${p.instanceName ?? "Radarr"}`, "accent");

    case "MovieDelete":
      return buildCard({
        title: movieLabel ?? "Movie deleted",
        subtitle: movieLabel ? "Movie deleted" : undefined,
        color: "warning",
        facts: [["Path", movie.folderPath]],
        actions: links,
      });

    case "ManualInteractionRequired":
      return buildCard({
        title: "🖐️ Manual interaction required",
        subtitle: movieLabel,
        color: "attention",
        text: p.message,
        actions: links,
      });

    case "Health":
      return buildCard({
        title: "⚠️ Radarr health issue",
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
        title: "💚 Radarr health restored",
        color: "good",
        text: p.message,
        facts: [["Instance", p.instanceName]],
        actions: links,
      });

    case "ApplicationUpdate":
      return buildCard({
        title: "🔄 Radarr updated",
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
