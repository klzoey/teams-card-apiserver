import express, { Router, Request } from "express";
import multer from "multer";
import { saveCapture, CaptureAttachment } from "../capture";
import { BODY_LIMIT, CAPTURE_ENABLED } from "../config";
import { translateAndDeliver } from "../pipeline";
import { extractOverrides } from "../util";

const router = Router();

// Plex posts multipart/form-data (a "payload" JSON field + optional "thumb"
// image). Multer only engages on multipart requests and passes everything
// else through untouched.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// Everything non-multipart (Radarr/Sonarr JSON, form posts, anything else)
// is read as a raw buffer so we never reject a payload we haven't seen yet.
const rawBody = express.raw({
  type: (req) => !(req.headers["content-type"] ?? "").includes("multipart/form-data"),
  limit: BODY_LIMIT,
});

interface ParsedBody {
  body: unknown;
  attachments: CaptureAttachment[];
}

function parseIncoming(req: Request): ParsedBody {
  const attachments: CaptureAttachment[] = [];

  // Multipart path (Plex): multer left text fields on req.body as an object
  // and files on req.files.
  const files = (req as Request & { files?: Express.Multer.File[] }).files;
  if (Array.isArray(files)) {
    for (const f of files) {
      attachments.push({
        fieldName: f.fieldname,
        originalName: f.originalname,
        mimeType: f.mimetype,
        buffer: f.buffer,
      });
    }
  }

  if (Buffer.isBuffer(req.body)) {
    const text = req.body.toString("utf8");
    if (!text) return { body: null, attachments };
    try {
      return { body: JSON.parse(text), attachments };
    } catch {
      return { body: text, attachments }; // keep unparseable bodies verbatim
    }
  }

  if (req.body && typeof req.body === "object") {
    const fields: Record<string, unknown> = { ...req.body };
    // Plex nests the real event JSON as a string in the "payload" field.
    if (typeof fields.payload === "string") {
      try {
        fields.payload = JSON.parse(fields.payload);
      } catch {
        /* leave as string */
      }
    }
    return { body: fields, attachments };
  }

  return { body: null, attachments };
}

function detectEventType(body: unknown): string {
  if (!body || typeof body !== "object") return "unknown";
  const b = body as Record<string, unknown>;
  if (typeof b.eventType === "string") return b.eventType; // Radarr / Sonarr
  const payload = b.payload as Record<string, unknown> | undefined;
  if (payload && typeof payload.event === "string") return payload.event; // Plex
  if (typeof b.event === "string") return b.event;
  return "unknown";
}

// POST /webhook/:service — radarr, sonarr, plex, or any future service.
router.post("/:service", upload.any(), rawBody, async (req, res) => {
  const service = String(req.params.service);
  const { body, attachments } = parseIncoming(req);
  const eventType = detectEventType(body);
  const overrides = extractOverrides(
    req.headers as Record<string, unknown>,
    req.query as Record<string, unknown>
  );

  let capturedFile: string | undefined;
  let captureError: string | undefined;
  if (CAPTURE_ENABLED) {
    // Capture is best-effort: a full disk or unwritable capture dir must
    // never block translation + delivery to Teams.
    try {
      const result = await saveCapture({
        service,
        eventType,
        contentType: req.get("content-type"),
        headers: req.headers as Record<string, unknown>,
        query: req.query as Record<string, unknown>,
        body,
        attachments,
      });
      capturedFile = result.file;
      console.log(
        `[${service}] ${eventType} -> captures/${result.file.replace(/\\/g, "/")}` +
          (result.attachments.length ? ` (+${result.attachments.length} attachment(s))` : "")
      );
    } catch (err) {
      captureError = String(err);
      console.warn(
        `[${service}] capture failed, continuing with delivery: ${captureError}`
      );
    }
  } else {
    console.log(`[${service}] ${eventType} (capture disabled)`);
  }

  const pipeline = await translateAndDeliver(
    service,
    eventType,
    body,
    capturedFile,
    overrides
  );
  if (pipeline.delivery.attempted) {
    console.log(
      pipeline.delivery.delivered
        ? `[${service}] card delivered to Teams (HTTP ${pipeline.delivery.status})`
        : `[${service}] card delivery FAILED: ${pipeline.delivery.error ?? pipeline.delivery.status}`
    );
  } else {
    console.log(`[${service}] card not sent: ${pipeline.delivery.reason}`);
  }

  res.json({
    ok: true,
    service,
    eventType,
    captured: capturedFile ?? null,
    ...(captureError ? { captureError } : {}),
    card: pipeline.cardFile ?? null,
    delivery: pipeline.delivery,
  });
});

export default router;
