# Deployment (Railway)

VS01 runs as **one game-server replica** (the bible: Railway does not provide sticky sessions, so a stateful match server
must not be replicated without a room allocator). No database or Redis is needed.

I could not deploy for you: it needs your Railway account/token. Everything below is ready to click through; the production
artifact has been built and exercised locally (see "What was verified" at the bottom).

## Option A — single service (recommended for the playtest): one URL

1. In Railway: **New Project → Deploy from GitHub repo →** `shaunnez/breach`.
2. Railway reads `railway.json` (Dockerfile build, `Dockerfile.server`, health check `/health`, 1 replica, restart on failure).
3. Service → **Settings → Networking → Generate Domain**. Railway injects `PORT`; the server binds `0.0.0.0:$PORT`.
4. Variables (all optional): `LOG_LEVEL=info`, `BUILD_SHA` (Railway also provides `RAILWAY_GIT_COMMIT_SHA`, which is used automatically).
5. Region: **Singapore first** (bible), then measure real Auckland/NZ RTT with the in-game RTT readout (`?dev=1` → F3).
   If competitive RTT is unacceptable, keep Railway for the web service and move only the game server to an AU/NZ-capable host.
6. Share `https://<your-domain>/play`. Rooms are created in-page; the invite link carries `?room=CODE`.

The image serves the built client from the same origin, so there is no CORS and no `VITE_SERVER_URL` to set. WebSocket
(`wss://`) goes to the same host.

## Option B — two services (the bible's topology)

* `game-server`: as Option A (it also serves the client, harmless), set `CLIENT_ORIGIN=https://<web-domain>`.
* `web`: a second service from the same repo with **Config file path** `deploy/railway.web.json` (builds `Dockerfile.web`, nginx),
  build variable `VITE_SERVER_URL=wss://<game-server-domain>`.

## Environment

| Variable | Where | Meaning |
|---|---|---|
| `PORT` | server | injected by Railway (default 2567 locally) |
| `NODE_ENV` | server | `production` |
| `CLIENT_ORIGIN` | server | comma-separated allowed origins for matchmaking CORS (two-service topology only) |
| `BUILD_SHA` | server | shown by `/health` |
| `LOG_LEVEL` | server | `debug` / `info` / `warn` / `error` / `silent` (structured JSON on stdout) |
| `STATIC_DIR` | server | built client dir (set by the Docker image) |
| `VITE_SERVER_URL` | client build | only for Option B |

## Operating it

* `GET /health` → `{ok, build, uptimeSec, rooms, ccu}`.
* `GET /debug/telemetry` → derived tuning metrics (accuracy, bites per kill, mean encounter TTK, kill ratio, Ripper surface time,
  reconciliations per minute), raw counters and the last 50 structured events. (Read-only; no secrets.)
* Logs are one JSON object per line. Fields follow bible section 28: `matchId, roomId, playerId, class, serverTick, rttMs,
  reconciliationErrorM, movementCorrectionReason, shotAccepted, shotRejectReason, biteAccepted, surfaceAttachState,
  surfaceDetachReason, serverTickDurationMs` (the last in the periodic `server-tick-stats` record).
* Redeploys drop active rooms (in-memory). Clients show "Reconnecting…", retry with backoff for 15 s, then return to the lobby with an explicit reason.

## Reconnect behaviour

Closing the socket without leaving holds the seat for 15 s (`allowReconnection`); the player's body is frozen and untouchable.
The client keeps the reconnect token in `sessionStorage`, so reloading the tab also resumes the same player.

## Local production check

```bash
pnpm install && pnpm build
PORT=2567 node apps/server/dist/index.js     # serves /play, /health and the WebSocket on one port
pnpm e2e                                     # two real Chromium contexts against that exact artifact
```

## What was verified

* `pnpm build` (server bundle + client bundle) and the built server serving the built client on one origin (Playwright `e2e/smoke.spec.ts`).
* Docker image: the Dockerfiles are written to the same build commands, but Docker is not available in the authoring sandbox, so the
  image itself has **not** been built here. First deploy on Railway is the real test; the build logs will say if anything is off.
