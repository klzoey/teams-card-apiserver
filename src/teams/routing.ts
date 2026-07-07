import fs from "fs";
import path from "path";

/**
 * Maps a service name to a Teams Workflows webhook URL.
 *
 * Resolution order (most specific wins):
 *  1. env  TEAMS_WEBHOOK_<SERVICE>      (e.g. TEAMS_WEBHOOK_RADARR)
 *  2. file teams-webhooks.json  →  { "radarr": "https://..." }
 *  3. env  TEAMS_WEBHOOK_DEFAULT
 *  4. file teams-webhooks.json  →  { "default": "https://..." }
 *
 * Env vars are the primary mechanism in docker; the JSON file suits local
 * dev (it's re-read on every lookup, so edits apply without a restart).
 * TEAMS_WEBHOOKS_FILE overrides the file location.
 */
const CONFIG_FILE =
  process.env.TEAMS_WEBHOOKS_FILE ??
  path.resolve(__dirname, "..", "..", "teams-webhooks.json");

function readConfigFile(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

export function getTeamsWebhookUrl(service: string): string | undefined {
  const envKey = `TEAMS_WEBHOOK_${service.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  const cfg = readConfigFile();
  return (
    process.env[envKey] ??
    cfg[service] ??
    process.env.TEAMS_WEBHOOK_DEFAULT ??
    cfg.default
  );
}
