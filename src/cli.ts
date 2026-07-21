import fs from "fs/promises";
import path from "path";
import { CAPTURE_DIR } from "./config";
import { getTranslator } from "./translators";
import { translateAndDeliver, buildTranslatorContext } from "./pipeline";
import { extractOverrides } from "./util";

const USAGE = `usage:
  teams-cards --replay <capture.json> [--dry-run]

Re-runs a previously captured webhook through translation and delivery.
The path may be absolute, relative to the working dir, or relative to the
capture dir (e.g. "radarr/2026-07-06T22-43-55-245Z_download.json").
--dry-run prints the translated card instead of sending it to Teams.`;

async function resolveCaptureFile(fileArg: string): Promise<string | null> {
  const candidates = [
    path.resolve(fileArg),
    path.join(CAPTURE_DIR, fileArg),
    // tolerate a leading "captures/" (tab-completion from the repo root)
    path.join(CAPTURE_DIR, fileArg.replace(/^captures[\\/]/, "")),
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Returns a process exit code. */
export async function runCli(args: string[]): Promise<number> {
  const dryRun = args.includes("--dry-run");
  const replayIdx = args.indexOf("--replay");
  const fileArg = replayIdx !== -1 ? args[replayIdx + 1] : undefined;
  if (!fileArg) {
    console.error(USAGE);
    return 2;
  }

  const file = await resolveCaptureFile(fileArg);
  if (!file) {
    console.error(`capture file not found: ${fileArg}`);
    return 1;
  }

  const record = JSON.parse(await fs.readFile(file, "utf8")) as {
    service?: string;
    eventType?: string;
    body?: unknown;
    headers?: Record<string, unknown>;
    query?: Record<string, unknown>;
  };
  if (!record.service || record.body === undefined) {
    console.error(
      `${file} doesn't look like a capture file (missing service/body fields)`
    );
    return 1;
  }
  const service = record.service;
  const eventType = record.eventType ?? "unknown";
  const overrides = extractOverrides(record.headers, record.query);

  if (dryRun) {
    const card = await getTranslator(service)(
      record.body,
      buildTranslatorContext(service, eventType, overrides)
    );
    if (!card) {
      console.error(`translator produced no card for ${service}/${eventType}`);
      return 1;
    }
    console.log(JSON.stringify(card, null, 2));
    console.error(`\n[dry-run] card built for ${service}/${eventType}, not sent`);
    return 0;
  }

  const result = await translateAndDeliver(
    service,
    eventType,
    record.body,
    undefined,
    overrides
  );
  if (!result.card) {
    console.error(`translator produced no card for ${service}/${eventType}`);
    return 1;
  }
  if (result.delivery.attempted && result.delivery.delivered) {
    console.log(
      `replayed ${service}/${eventType} -> delivered (HTTP ${result.delivery.status})`
    );
    return 0;
  }
  console.error(`replay failed: ${JSON.stringify(result.delivery)}`);
  return 1;
}
