# BREACH//HIVE — VS01 Combat Truth Slice

Browser-based authoritative multiplayer combat lab: 2–4 players join a room and fight as an **Expedition Marine** or a
**Bloom Ripper** in one small refinery map (Test Cell A). The only question VS01 asks: *is Marine vs Ripper genuinely fun?*
VS02 (Commander / economy / Weaver) is deliberately **not** started — see `docs/VS01_STATUS.md`.

| | |
|---|---|
| Source of truth | `docs/BREACH_HIVE_IMPLEMENTATION_BIBLE.md`, tuning baseline `config/balance.example.ts` (copied verbatim into `packages/shared/src/balance.ts`) |
| Deviations & interpretations | `docs/DECISIONS.md` |
| Status vs Definition of Done | `docs/VS01_STATUS.md` |
| Feel notes / playtest plan | `docs/PLAYTEST_NOTES.md` |
| Deploying | `docs/DEPLOYMENT.md` |
| Original handoff | `docs/handoff/ASTRA_VS01_EXECUTION_PROMPT.md`, `assets/asset-manifest.example.json` |

## Run it

```bash
pnpm install
pnpm dev            # game server :2567 + Vite client :5173 -> open http://localhost:5173/play
```

Open two browser windows, **Create room** in one, paste the 6-character code in the other, pick sides, **Start match**
(host). Click the canvas to capture the mouse.

| | Marine | Ripper |
|---|---|---|
| Move / look | WASD, mouse | WASD, mouse |
| Primary | LMB rifle (600 RPM, 30 / 90) | LMB bite (0.55 s) |
| Other | R reload · Shift sprint · Space jump | Space leap (25 energy) · RMB/C let go · hold **F** to cling to walls/ceilings (**T** switches hold/toggle) · **V** toggles the surface view assist |
| UI | Tab scoreboard · M mute | |

`?dev=1` (on the creator's URL) enables the debug room: **F3 / `** toggles the overlay (FPS, server tick/drift, RTT/jitter, input
seq/ack, prediction error, reconciliations/s, Ripper surface + normal, shot validation), visual toggles (colliders, hurt volumes,
hit rays, bite sweep, surface probes, traversal probes, spawn volumes, interpolation ghosts), simulated latency sliders, and dev
actions (teleport to rooms, switch class, refill, spawn/clear dummies, reset, drop connection). `?lag=100&jitter=20` starts with
simulated network conditions.

## Layout

```
apps/client      Vite + React shell/HUD, raw three.js runtime, prediction + reconciliation (game/network)
apps/server      Colyseus room, authoritative Simulation (pure TS), lag-compensated hit validation, telemetry
packages/shared  balance, protocol, Test Cell A, collision, and the deterministic player step used by both sides
packages/gameplay-tests  integration tests (real sockets), virtual-time netcode harness, soak tool, Playwright e2e
```

## Verify

```bash
pnpm typecheck && pnpm lint && pnpm test      # unit + simulation + Colyseus integration + 10-virtual-minute netcode soak
pnpm build && pnpm e2e                        # production bundle, two real Chromium contexts
pnpm soak                                     # 10 real minutes, 4 headless clients, 100 ms RTT +/-20 ms, real fights
pnpm --filter @breach/gameplay-tests feel     # measured movement / TTK baselines
```

## Authority model (short)

Clients send **inputs only** (`seq`, `epoch`, move axes, yaw/pitch, buttons) at 30 Hz as batches of 60 Hz frames. The server
simulates exactly one frame per fixed tick per player (so displacement and fire cadence are bounded by construction),
owns health/armour/ammo/damage/death/respawn, resolves the rifle (hitscan) and bite (swept sphere) against hurt volumes rewound
up to 250 ms, and replicates state at 20 Hz. Clients predict locally at 60 Hz, reconcile against `lastProcessedInputSeq`, and
interpolate remotes 100 ms behind. The same deterministic step function runs on both sides; nothing authoritative lives in it.
