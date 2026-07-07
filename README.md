# teams-card-apiserver

Universal Teams card API server. End goal: receive webhooks from services
(Radarr, Sonarr, Plex, ...) and re-post them to Microsoft Teams chats/channels
as proper Adaptive Cards.

**Current state: capture + translate.** Every webhook POST is captured to
disk first (never lost), then translated to an Adaptive Card and forwarded to
the Teams Workflows webhook configured for that service. Services without a
configured webhook are captured and translated (card saved beside the
capture) but not sent.

## Quick start (local dev)

```powershell
npm install
npm run dev        # dev server with reload, listens on port 4545
```

Or `npm run build && npm start`.

## Deployment: sidecar per docker stack

The intended production shape is one lightweight container inside each
isolated media stack, reachable only on that stack's internal docker
network (no published ports, no nginx exposure — only outbound HTTPS to
Teams leaves the stack).

The image is built and published by GitHub Actions on every push to main:
`ghcr.io/klzoey/teams-card-apiserver:latest` (see
[.github/workflows/docker.yml](.github/workflows/docker.yml)). Merge the
service from [docker-compose.example.yml](docker-compose.example.yml) into
each stack and docker pulls it automatically; update with
`docker compose pull && docker compose up -d`.

Inside the stack, apps reach it by service name:
`http://teams-cards:4545/webhook/radarr` (etc.). Configuration is pure env
vars — `TEAMS_WEBHOOK_DEFAULT` plus optional `TEAMS_WEBHOOK_<SERVICE>`
overrides — and `CAPTURE_ENABLED=false` turns off payload capture for a
translate-and-forward-only process. The image runs as the unprivileged
`node` user, answers docker healthchecks via `/health`, and exits cleanly
on `docker stop`.

### Composeman (Unraid) stacks

See **[HANDOFF.md](HANDOFF.md)** for the operator-facing runbook. Template
fragments matching the existing composeman conventions are tracked in
[deploy/composeman/](deploy/composeman/):

- `baseline.compose.teams-cards.yml`
- `production.compose.teams-cards.yml` — resets host ports,
  `user: 99:100`, wget healthcheck (the alpine image has no curl), Unraid
  labels, capture off by default via `TEAMS_CARDS_CAPTURE` (default false)

Per-stack rollout:

1. Build the image on each host:
   `docker build -t teams-card-apiserver:latest <repo>` (or push once to a
   registry and change `image:` in the baseline template).
2. Copy both template fragments into the host's composeman templates and
   include `teams-cards` in the stack's generated docker-compose.yml.
3. Add that stack's Workflows URL to the project `.env`:
   `TEAMS_WEBHOOK_URL="https://..."` (this is what keeps each stack talking
   only to its own Teams channel).
4. Point the apps at the sidecar over the stack network:
   Radarr/Sonarr → Settings → Connect → Webhook →
   `http://teams-cards:4545/webhook/radarr` / `.../sonarr`;
   Plex → Settings → Webhooks → `http://teams-cards:4545/webhook/plex`.

Networking note: the sidecar needs two things — reachability from the *arr
containers (join the same stack network they're on; with no `networks:` key
it lands on the project default network alongside them) and **outbound
HTTPS egress** to Teams. Do not attach it *only* to the internal
`proxy_backend` network (`--internal` blocks egress), and it never needs to
be published through nginx.

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4545` | Listen port |
| `CAPTURE_ENABLED` | `true` | Write payloads/cards to disk (`false`/`0`/`off` disables) |
| `CAPTURE_DIR` | `./captures` | Capture location |
| `FRIENDLY_NAME` | — | Destination name in card subtitles ("Movie added to {name}") |
| `SHOW_FRIENDLY_NAME` | `true` | Set `false` to suppress the friendly name |
| `TMDB_API_KEY` | — | Optional TMDB key: adds trailer button, runtime, genre fallback |
| `TEAMS_WEBHOOK_<SERVICE>` | — | Teams webhook URL for one service (e.g. `TEAMS_WEBHOOK_RADARR`) |
| `TEAMS_WEBHOOK_DEFAULT` | — | Fallback Teams webhook URL |
| `TEAMS_WEBHOOKS_FILE` | `./teams-webhooks.json` | Optional JSON mapping file (local-dev alternative to env vars; re-read per event) |

Resolution order: env `TEAMS_WEBHOOK_<SERVICE>` → file entry → env
`TEAMS_WEBHOOK_DEFAULT` → file `default`.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/webhook/:service` | Capture a webhook, translate, forward to Teams |
| GET | `/captures` | List all captured events (newest first) |
| GET | `/captures/:service` | List captured events for one service |
| GET | `/captures/:service/:file` | Read one captured event back |
| GET | `/card/:service/:file` | Translate a stored capture to a card (preview, no send) |
| POST | `/replay/:service/:file` | Translate a stored capture and send it to Teams |
| GET | `/health` | Liveness check |

Replay also works as a one-shot CLI (handy inside the container):

```bash
node dist/index.js --replay radarr/<capture-file>.json [--dry-run]
```

Captures land in `captures/<service>/<timestamp>_<eventType>.json` and include
the headers, content type, and full body. Plex poster thumbnails are saved
alongside the JSON. The `captures/` folder is gitignored.

## Pointing the services here

Use this PC's LAN IP (or `localhost` if the service runs on the same box).

- **Radarr**: Settings → Connect → `+` → Webhook.
  URL `http://<this-pc>:4545/webhook/radarr`, method POST.
  The Test button sends an `eventType: "Test"` payload immediately.
- **Sonarr**: Settings → Connect → `+` → Webhook.
  URL `http://<this-pc>:4545/webhook/sonarr`, method POST.
- **Plex**: Settings → Webhooks (requires Plex Pass) → Add Webhook.
  URL `http://<this-pc>:4545/webhook/plex`.
  Plex sends `multipart/form-data` with the event JSON in a `payload` field
  and often a `thumb` image — both are captured.

Any other service can post to `/webhook/<name>` and will be captured the same
way — no code changes needed.

## Teams delivery setup

The legacy Office 365 connector webhooks are retired (hard cutoff
2026-05-18); delivery goes through **Teams Workflows** (Power Automate):

1. In Teams: channel/chat → **⋯** → **Workflows** → template
   *"Post to a channel when a webhook request is received"*.
2. Copy the generated HTTP POST URL.
3. `cp teams-webhooks.example.json teams-webhooks.json` and paste the URL for
   each service (`default` is the fallback). Env var `TEAMS_WEBHOOK_<SERVICE>`
   overrides the file. The file is re-read per event — no restart needed.

Translators live in `src/translators/` — one per service (`radarr`, `sonarr`,
`plex`) plus a generic fallback that renders any unknown service/event as a
fact-list card. Every translated card is also written next to its capture as
`*_card.json` for inspection, and `/card/...` + `/replay/...` let you iterate
on card design against previously captured real events.

## Teams card limitations (Workflows webhook path)

These bound how "robust" our cards can get without moving to a full bot:

- **Adaptive Card schema 1.4 max** — 1.5 features (e.g. `Action.Execute`
  refresh, captions) render incorrectly via Workflows. `buildCard()` pins 1.4.
- **Buttons = `Action.OpenUrl` only.** `Action.Submit` / input forms need a
  bot to receive the response; via webhook they do nothing.
- **Images must be public HTTPS URLs** — no binary uploads. Radarr/Sonarr
  poster URLs (TMDB/TVDB) work; Plex's binary thumb attachments do not.
- **~28 KB max message size.**
- **No custom bot name/icon** — cards post as the Workflows/Power Automate
  bot; branding must live inside the card body.
- **Markdown subset only** in TextBlocks (bold/italic/lists/links); tables,
  code fences, and arbitrary colors/fonts aren't supported. Available knobs:
  container styles, `FactSet`s, `ColumnSet` layouts, text colors
  (good/warning/attention/accent), `msteams: { width: "Full" }`.
- **Mentions are possible** (`msteams.entities` with AAD user IDs) — not
  implemented yet, but the door is open for e.g. pinging you on failures.

## Roadmap

1. ~~Capture server for raw webhook payloads~~
2. ~~Translation endpoints per service/event → Adaptive Card JSON~~
3. ~~Delivery to Teams via Workflows webhook URLs~~
4. Plex translator polish once real Plex events are captured
5. Event-level routing/filtering (e.g. health alerts → ops channel, grabs →
   media channel; mute noisy events)
6. Retry/queue for failed deliveries
