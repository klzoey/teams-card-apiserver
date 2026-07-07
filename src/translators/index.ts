import { Translator } from "./types";
import { genericTranslator } from "./generic";
import { radarrTranslator } from "./radarr";
import { sonarrTranslator } from "./sonarr";
import { plexTranslator } from "./plex";

const registry: Record<string, Translator> = {
  radarr: radarrTranslator,
  sonarr: sonarrTranslator,
  plex: plexTranslator,
};

/** Every service gets a translator — unknown ones fall back to the generic card. */
export function getTranslator(service: string): Translator {
  return registry[service.toLowerCase()] ?? genericTranslator;
}
