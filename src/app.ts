import express from "express";
import webhooksRouter from "./routes/webhooks";
import { listCaptures, readCapture } from "./capture";
import { getTranslator } from "./translators";
import { getTeamsWebhookUrl } from "./teams/routing";
import { deliverCard } from "./teams/deliver";

interface CaptureRecord {
  service: string;
  eventType: string;
  body: unknown;
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");

  app.get("/", (_req, res) => {
    res.json({
      name: "teams-card-apiserver",
      status: "capture mode",
      endpoints: {
        "POST /webhook/:service": "capture a webhook (radarr, sonarr, plex, ...)",
        "GET /captures": "list captured events",
        "GET /captures/:service": "list captured events for one service",
        "GET /captures/:service/:file": "read one captured event",
        "GET /card/:service/:file": "translate a stored capture to a card (preview, no send)",
        "POST /replay/:service/:file": "translate a stored capture and send it to Teams",
        "GET /health": "liveness check",
      },
    });
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  app.use("/webhook", webhooksRouter);

  app.get("/captures", async (_req, res) => {
    res.json(await listCaptures());
  });

  app.get("/captures/:service", async (req, res) => {
    res.json(await listCaptures(req.params.service));
  });

  app.get("/captures/:service/:file", async (req, res) => {
    const capture = await readCapture(req.params.service, req.params.file);
    if (capture === null) {
      res.status(404).json({ ok: false, error: "capture not found" });
      return;
    }
    res.json(capture);
  });

  // Preview: translate a stored capture into a card without sending it.
  app.get("/card/:service/:file", async (req, res) => {
    const rec = (await readCapture(req.params.service, req.params.file)) as
      | CaptureRecord
      | null;
    if (!rec) {
      res.status(404).json({ ok: false, error: "capture not found" });
      return;
    }
    const card = await getTranslator(rec.service)(rec.body, {
      service: rec.service,
      eventType: rec.eventType,
    });
    if (!card) {
      res.json({ ok: false, error: "translator produced no card for this event" });
      return;
    }
    res.json(card);
  });

  // Replay: translate a stored capture and deliver it to Teams for real.
  app.post("/replay/:service/:file", async (req, res) => {
    const rec = (await readCapture(req.params.service, req.params.file)) as
      | CaptureRecord
      | null;
    if (!rec) {
      res.status(404).json({ ok: false, error: "capture not found" });
      return;
    }
    const card = await getTranslator(rec.service)(rec.body, {
      service: rec.service,
      eventType: rec.eventType,
    });
    if (!card) {
      res.json({ ok: false, error: "translator produced no card for this event" });
      return;
    }
    const url = getTeamsWebhookUrl(rec.service);
    if (!url) {
      res.status(400).json({
        ok: false,
        error: `no Teams webhook configured for '${rec.service}'`,
      });
      return;
    }
    const delivery = await deliverCard(url, card);
    res.status(delivery.attempted && delivery.delivered ? 200 : 502).json({
      ok: delivery.attempted && delivery.delivered,
      delivery,
    });
  });

  return app;
}
