# BREACH//HIVE — VS01 Combat Truth Slice + VS02 Strategy Truth Slice

Browser-based authoritative multiplayer combat lab: 2–4 players join a room and fight as the **Expedition** (Marine, one of whom can take
the Command Core) or the **Bloom** (Ripper, Weaver) in one small refinery map (Test Cell A). VS01 asked *is Marine vs Ripper fun?* (signed
off for now). VS02 adds one active resource well, the Commander, the Extractor, the Weaver and the Harvester, and asks *does winning
fights to control the room matter to players?* See `docs/VS02_STATUS.md`. VS03 is not started.

| | |
|---|---|
| Source of truth | `docs/BREACH_HIVE_IMPLEMENTATION_BIBLE.md`, tuning baseline `config/balance.example.ts` (copied verbatim into `packages/shared/src/balance.ts`) |
| Deviations & interpretations | `docs/DECISIONS.md` |
| Status vs Definition of Done | `docs/VS01_STATUS.md`, `docs/VS02_STATUS.md` |
| Feel notes / playtest plan | `docs/PLAYTEST_NOTES.md` |
| Deploying | `docs/DEPLOYMENT.md` |
| Handoffs | `docs/handoff/ASTRA_VS01_EXECUTION_PROMPT.md`, `docs/handoff/VS02_EXECUTION_PROMPT.md`, `assets/asset-manifest.example.json` |

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

| | Commander (a Marine at the console) | Weaver (Bloom) |
|---|---|---|
| Enter / leave | **E** at the Command Core console (Marine spawn, north wall) | pick Weaver in the lobby, press **3** while dead, or press **3** (Weaver) / **2** (Ripper) while standing in the Hive |
| Controls | WASD pan · wheel or Q/Z zoom · LMB select Marines (shift adds) · RMB move order (selected) or ping · **B** place Extractor (10) on the well · **E** leave | WASD (slow, no climbing) · LMB claw · RMB heal pulse (40 energy) · **E** at the well grows a Harvester (10) |

Economy (bible 32): both sides start with 20. A finished Extractor or Harvester on the well pays its side 0.6/s. Building takes 6 s.
Structures have 600 HP and can be destroyed by the other side, which frees the well.

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
pnpm soak                                     # 10 real minutes, Commander + Marine vs Ripper + Weaver bots, 100 ms RTT +/-20 ms
pnpm --filter @breach/gameplay-tests feel     # measured movement / TTK baselines
```

## Authority model (short)

Clients send **inputs only** (`seq`, `epoch`, move axes, yaw/pitch, buttons) at 30 Hz as batches of 60 Hz frames. The server
simulates exactly one frame per fixed tick per player (so displacement and fire cadence are bounded by construction),
owns health/armour/ammo/damage/death/respawn, resolves the rifle (hitscan) and bite (swept sphere) against hurt volumes rewound
up to 250 ms, and replicates state at 20 Hz. Clients predict locally at 60 Hz, reconcile against `lastProcessedInputSeq`, and
interpolate remotes 100 ms behind. The same deterministic step function runs on both sides; nothing authoritative lives in it.
