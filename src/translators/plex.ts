import { buildCard, truncate, CardColor } from "../teams/card";
import { Translator, Dict, asDict } from "./types";
import { genericTranslator } from "./generic";
import { friendlyName } from "../config";

const EVENT_LABELS: Record<string, { title: string; color: CardColor }> = {
  "media.play": { title: "▶️ Playback started", color: "accent" },
  "media.resume": { title: "▶️ Playback resumed", color: "accent" },
  "media.pause": { title: "⏸️ Playback paused", color: "default" },
  "media.stop": { title: "⏹️ Playback stopped", color: "default" },
  "media.scrobble": { title: "✅ Watched", color: "good" },
  "media.rate": { title: "⭐ Rated", color: "accent" },
  "library.new": { title: "🆕 Added to library", color: "good" },
  "admin.database.backup": { title: "💾 Plex database backup complete", color: "good" },
  "admin.database.corrupted": { title: "🛑 Plex database corrupted", color: "attention" },
  "device.new": { title: "📱 New device connected", color: "accent" },
  "playback.started": { title: "▶️ Shared-user playback started", color: "accent" },
};

/** "Show – S01E05 – Episode Title" for episodes, "Title (Year)" otherwise. */
function mediaLabel(md: Dict): string | undefined {
  if (!md.title && !md.grandparentTitle) return undefined;
  if (md.type === "episode") {
    const code =
      md.parentIndex != null && md.index != null
        ? ` – S${String(md.parentIndex).padStart(2, "0")}E${String(md.index).padStart(2, "0")}`
        : "";
    return `${md.grandparentTitle ?? "?"}${code}${md.title ? ` – ${md.title}` : ""}`;
  }
  if (md.type === "track") {
    return [md.grandparentTitle, md.title].filter(Boolean).join(" – ");
  }
  return `${md.title}${md.year ? ` (${md.year})` : ""}`;
}

export const plexTranslator: Translator = (body, ctx) => {
  // Plex posts multipart/form-data; our capture layer stores the parsed
  // "payload" field nested under body.payload.
  const outer = asDict(body);
  const p = asDict(outer.payload ?? outer);
  const event = String(p.event ?? ctx.eventType);

  const label = EVENT_LABELS[event];
  if (!label) return genericTranslator(p, { ...ctx, eventType: event });

  const account = asDict(p.Account);
  const player = asDict(p.Player);
  const server = asDict(p.Server);
  const md = asDict(p.Metadata);

  const isMediaEvent = event.startsWith("media.") || event.startsWith("playback.");
  const media = mediaLabel(md);
  const dest = friendlyName(server.title);
  const durationMin =
    typeof md.duration === "number" && md.duration > 0
      ? Math.round(md.duration / 60000)
      : undefined;

  // Title = media name when we have one, event message as colored subtitle.
  return buildCard({
    title: media ?? label.title,
    subtitle: media ? `${label.title}${dest ? ` on ${dest}` : ""}` : undefined,
    color: label.color,
    text:
      isMediaEvent && account.title
        ? `**${account.title}**${player.title ? ` on **${player.title}**` : ""}`
        : event === "library.new"
          ? truncate(md.summary)
          : undefined,
    facts: [
      ["Library", md.librarySectionTitle ?? md.librarySectionType],
      ["Content rating", event === "library.new" ? md.contentRating : undefined],
      [
        "Runtime",
        event === "library.new" && durationMin
          ? durationMin >= 60
            ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}m`
            : `${durationMin}m`
          : undefined,
      ],
      ["Rating", event === "media.rate" ? p.rating : undefined],
      ["Device", event === "device.new" ? player.title : undefined],
    ],
    // Plex thumbs arrive as binary attachments (unusable in cards — images
    // need public HTTPS URLs), so playback cards go without a poster for now.
  });
};
