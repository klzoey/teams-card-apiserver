import fs from "fs/promises";
import path from "path";
import { CAPTURE_DIR } from "./config";

export interface CaptureAttachment {
  fieldName: string;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
}

export interface CaptureInput {
  service: string;
  eventType: string;
  contentType?: string;
  headers: Record<string, unknown>;
  body: unknown;
  attachments?: CaptureAttachment[];
}

export interface CaptureResult {
  /** Path of the capture JSON file, relative to the capture dir. */
  file: string;
  /** Paths of any saved attachments, relative to the capture dir. */
  attachments: string[];
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "unknown"
  );
}

/**
 * Persist one incoming webhook event to disk:
 *   captures/<service>/<timestamp>_<eventType>.json
 * plus any multipart attachments (e.g. Plex poster thumbs) alongside it.
 */
export async function saveCapture(input: CaptureInput): Promise<CaptureResult> {
  const service = slug(input.service);
  const dir = path.join(CAPTURE_DIR, service);
  await fs.mkdir(dir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${timestamp}_${slug(input.eventType)}`;

  const attachments: string[] = [];
  for (const att of input.attachments ?? []) {
    const ext = path.extname(att.originalName) || guessExt(att.mimeType);
    const name = `${base}_${slug(att.fieldName)}${ext}`;
    await fs.writeFile(path.join(dir, name), att.buffer);
    attachments.push(path.join(service, name));
  }

  const record = {
    receivedAt: new Date().toISOString(),
    service: input.service,
    eventType: input.eventType,
    contentType: input.contentType ?? null,
    headers: input.headers,
    attachments,
    body: input.body,
  };

  const file = path.join(service, `${base}.json`);
  await fs.writeFile(
    path.join(dir, `${base}.json`),
    JSON.stringify(record, null, 2),
    "utf8"
  );

  return { file, attachments };
}

/**
 * Save the translated Adaptive Card next to its capture file
 * (<capture>_card.json) so cards can be inspected without sending to Teams.
 */
export async function saveCardJson(
  captureFile: string,
  card: unknown
): Promise<string> {
  const cardFile = captureFile.replace(/\.json$/, "_card.json");
  await fs.writeFile(
    path.join(CAPTURE_DIR, cardFile),
    JSON.stringify(card, null, 2),
    "utf8"
  );
  return cardFile;
}

function guessExt(mimeType: string): string {
  if (mimeType.includes("jpeg")) return ".jpg";
  if (mimeType.includes("png")) return ".png";
  if (mimeType.includes("webp")) return ".webp";
  return ".bin";
}

/** List captured event files for a service, newest first. */
export async function listCaptures(
  service?: string
): Promise<{ service: string; file: string; size: number; modified: string }[]> {
  const services: string[] = [];
  try {
    const entries = await fs.readdir(CAPTURE_DIR, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && (!service || e.name === service)) {
        services.push(e.name);
      }
    }
  } catch {
    return []; // capture dir doesn't exist yet — nothing captured
  }

  const results: { service: string; file: string; size: number; modified: string }[] = [];
  for (const svc of services) {
    const dir = path.join(CAPTURE_DIR, svc);
    for (const name of await fs.readdir(dir)) {
      // list captured events only, not the derived _card.json previews
      if (!name.endsWith(".json") || name.endsWith("_card.json")) continue;
      const stat = await fs.stat(path.join(dir, name));
      results.push({
        service: svc,
        file: name,
        size: stat.size,
        modified: stat.mtime.toISOString(),
      });
    }
  }
  return results.sort((a, b) => b.file.localeCompare(a.file));
}

/** Read a single capture file back (for inspection / replay). */
export async function readCapture(
  service: string,
  file: string
): Promise<unknown | null> {
  // basename() guards against path traversal in URL params
  const safePath = path.join(
    CAPTURE_DIR,
    path.basename(service),
    path.basename(file)
  );
  try {
    return JSON.parse(await fs.readFile(safePath, "utf8"));
  } catch {
    return null;
  }
}
