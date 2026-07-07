# Handoff: teams-cards sidecar for the media stacks

**What this is:** a tiny webhook proxy (Node/Express, ~40 MB RAM). Radarr,
Sonarr, and Plex POST their webhooks to it over the stack's internal docker
network; it turns them into Teams Adaptive Cards and POSTs them to that
stack's Teams channel. Nothing inbound crosses stack boundaries — the only
outbound traffic is HTTPS to Microsoft.

No nginx changes, no published ports, no cross-stack networking.

## One-time, per Unraid host

**1. Build the image** — docker can build straight from the public repo,
no clone needed:

```bash
docker build -t teams-card-apiserver:latest https://github.com/klzoey/teams-card-apiserver.git
```

(To update later: re-run the same command — it fetches the latest main —
then `compose up` the stack again.)

**2. Install the composeman templates** — copy from this repo:

| Repo file (deploy/composeman/) | Goes to |
| --- | --- |
| `baseline.compose.teams-cards.yml` | `templates/baseline/compose.teams-cards.yml` |
| `production.compose.teams-cards.yml` | `templates/production/compose.teams-cards.yml` |

They follow the same conventions as the radarr/sonarr fragments
(`container_name: !reset`, `ports: !reset`, unraid labels, `user: 99:100`).
Include `teams-cards` in the stack's generated docker-compose.yml the same
way the other apps are included.

**3. Add the stack's Teams webhook URL** to the project `.env`
(same file as `HOST_IP`, `PLEX_PORT`, etc.):

```
TEAMS_WEBHOOK_URL="https://<that-stack's-teams-workflows-url>"
TEAMS_CARDS_FRIENDLY_NAME="<name shown in cards, e.g. Media Server One>"
TMDB_API_KEY="<optional - adds trailer button + runtime to cards>"
```

Each stack gets its own URL → its own Teams channel. (Created in Teams by
whoever owns the target channel: channel → ⋯ → Workflows → "Post to a
channel when a webhook request is received" → copy the URL.)

**4. `compose up`, then repoint the apps** at the sidecar (stack-internal
DNS name, no IPs):

- Radarr: Settings → Connect → + Webhook → URL `http://teams-cards:4545/webhook/radarr`, method POST
- Sonarr: same → `http://teams-cards:4545/webhook/sonarr`
- Plex: Settings → Webhooks → Add → `http://teams-cards:4545/webhook/plex`

Hit Test in Radarr/Sonarr — a green "connection test" card should appear in
that stack's Teams channel within a couple of seconds.

## Networking notes

- The container must be able to reach the internet outbound (HTTPS to
  Microsoft). The project default network is fine. Do **not** put it only
  on `proxy_backend` — that network is `--internal` and blocks egress.
- The *arrs and Plex must share a network with it so `teams-cards` resolves.
  With no `networks:` key in the fragment it joins the project default
  network, same as the other services.

## Knobs (all env vars, set in the fragment or stack .env)

| Var | Default | What it does |
| --- | --- | --- |
| `TEAMS_WEBHOOK_DEFAULT` | — | Where cards go (wired to `${TEAMS_WEBHOOK_URL}`) |
| `TEAMS_WEBHOOK_RADARR` / `_SONARR` / `_PLEX` | — | Optional per-app channel override |
| `TEAMS_CARDS_CAPTURE` | `false` | `true` = also write every raw payload to `/app/captures` (mount a volume + `chown -R 99:100` the host dir first). Useful when tweaking card layouts; leave off normally. |
| `TEAMS_CARDS_FRIENDLY_NAME` | — | Shown in card subtitles, e.g. "Movie added to **{name}**" |
| `TMDB_API_KEY` | — | Optional; enables ▶ Trailer button, runtime, and genre fallback on movie/series cards. Free key: themoviedb.org → Settings → API (v3 key or v4 read token both work) |
| `PORT` | `4545` | Listen port |

## Replaying captures (troubleshooting / card design)

Any previously captured webhook can be re-run through translation and
delivery without touching Radarr/Sonarr/Plex:

```bash
# from inside the stack, one-shot CLI (add --dry-run to print the card
# instead of sending it):
docker exec <stack>-teams-cards-1 node dist/index.js \
  --replay radarr/2026-07-06T22-43-55-245Z_download.json

# or over HTTP from any container on the stack network:
curl -X POST http://teams-cards:4545/replay/radarr/<capture-file.json>
```

`GET http://teams-cards:4545/captures` lists what's available to replay
(requires capture to have been enabled when the event arrived).

## Troubleshooting

- **`EACCES: permission denied, mkdir '/app/captures/...'`** — capture is
  enabled but the capture dir isn't writable by the uid the container runs
  as. The **image default is `node` (1000:1000)**; the production fragment
  overrides this with `user: '99:100'` (nobody:users) — check what a
  container actually got with `docker exec <container> id`. On images built
  after 2026-07-06 this error is non-fatal (cards still deliver; the error
  is logged) and the in-image dir is world-writable. For a bind-mounted
  captures dir, create it first and chown it on the host to match the
  container's uid. Or set `TEAMS_CARDS_CAPTURE=false` if you don't need
  payload capture.
- **Cards not arriving in Teams** — check `docker logs` for the delivery
  line; `attempted: false` means no webhook URL is configured for that
  service (check `TEAMS_WEBHOOK_URL` in the stack `.env`), an HTTP status
  means Teams rejected the card.

## Updating later

Card layouts live in `src/translators/` in this repo. After changes:
rebuild the image on the host and `compose up` the stack again. Payloads
are never lost by a bad card — if translation or delivery fails, the
incoming webhook is still answered with 200 and the error is in the
container logs (`docker logs <stack>-teams-cards-1`).
