# VS01 status against the Definition of Done

**VS01 is signed off for now (project owner, 2026-10-06), so VS02 may start.** Items 12–14 (Railway deploy, three external
playtesters, a full tuning report) are *deferred*, not met: the deployment and external playtests will happen later, and the
fun verdict below remains unproven by external testers. The tuning report has its first entries (cling key), see `docs/PLAYTEST_NOTES.md`.
What exists is a complete, tested, playable build and the tooling to find out.
This page is the honest checklist (bible section 31). "Automated" = proven by tests/tools in this repo; "Human" = needs people.

| # | Definition of Done item | Status | Evidence / what is missing |
|---|---|---|---|
| 1 | Two remote players open the game in normal desktop browsers and join the same room | **Not met (needs deploy)** | Works with two real Chromium contexts against the production bundle (`pnpm e2e`). I cannot deploy to Railway from here (no account/token). `docs/DEPLOYMENT.md` is a click-through. |
| 2 | 1v1 and 2v2 work | **Automated, locally** | 1v1: e2e. 2v2 over real sockets: integration test (4 clients, 2/2 class guard) and `pnpm soak` (2 Marines + 2 Rippers, real fights). Remote: pending deploy. |
| 3 | Marine movement feels immediate and stable | **Human** | Measured: 133 ms to 95 % speed, 133 ms to stop, zero corrections at 100 ms RTT. "Feels" needs testers. |
| 4 | Ripper can ground-run, wall-run, traverse corners/ceiling, leap and use the vent | **Automated** | `packages/shared/test/ripper.test.ts` (floor→wall→ceiling, leap, vent end-to-end, repeated loops), 72 000 fuzzed ticks with no tunnelling/penetration (`fuzz.test.ts`), browser e2e with real keys. |
| 5 | Ripper is fun enough that testers voluntarily keep moving after the fight | **Human — unproven** | See `docs/PLAYTEST_NOTES.md` for the plan and what to watch. |
| 6 | Rifle and bite damage are server-authoritative | **Automated** | `apps/server/test/combat.test.ts` (damage, armour, TTK, LOS, arc, reach, rewind, friendly fire, protection) + integration test. Clients send inputs only. |
| 7 | Death and 4-second respawn work repeatedly | **Automated** | Unit test (exactly 240 ticks), integration test over sockets, and dozens of deaths/respawns per soak run. |
| 8 | Ten consecutive minutes of combat produce no accumulating transform desync | **Automated** | Virtual 10-minute run (`prediction.test.ts`) and a real 10-minute 4-client socket soak: results below. |
| 9 | Under 100 ms RTT local prediction stays playable and Ripper attachment is not routinely broken | **Automated (metrics) / Human (feel)** | 0 reconciliations and 0 surface breaks at 100 ms ±20 ms RTT in both harnesses; also asserted in the browser (`e2e`). Fault injection proves the reconciler does correct real divergence. |
| 10 | Server maintains target cadence for a 4-player room | **Automated** | Soak: server tick duration ≈ 0.05 ms against a 16.67 ms budget, no input-queue drops. (Measured with the bots sharing the server process; a deployed server will be cleaner.) |
| 11 | Major corrections and shot rejections are observable through telemetry | **Met** | In-game overlay (`?dev=1`), structured JSON logs, `/debug/telemetry`. Reconciliations carry a reason (`position/surface/weapon/velocity/no-history/epoch`); shot results (`ok/empty/reloading/cooldown`, rewind ms) reach the overlay; input rejects are counted by reason. |
| 12 | Build is deployed and shareable | **Not met** | Production bundle + Dockerfiles + Railway config ready; not deployed (needs your Railway account). The Docker image itself was not built here (no Docker in the sandbox); the `pnpm deploy` layout it relies on was run and the server booted from it. |
| 13 | At least three external playtesters have played it | **Not met** | Needs a deployment and people. |
| 14 | A short tuning report records what felt good/bad and which constants changed | **Template only** | `docs/PLAYTEST_NOTES.md` has measured baselines and an empty log. No constants changed. |

## Automated test inventory (all green at the time of writing)

| Suite | Count | What it proves |
|---|---|---|
| `packages/shared` | 25 | Marine/Ripper kinematics, 600 RPM cadence, reload/ammo, spread determinism, bite cadence, surface classification, floor→wall→ceiling→leap→land→vent loops, 72 000 fuzzed ticks with no penetration/NaN/out-of-bounds |
| `apps/server` | 17 | Server-authoritative damage/armour/TTK, LOS, reach/arc, lag-comp rewind (and its 250 ms cap), friendly fire, spawn protection, 4 s respawn, input validation, flood/speed-hack resistance, stale-epoch drops, class guard, dev tools |
| `apps/client` | 7 | Clock sync, snapshot interpolation/extrapolation, FIFO network simulator (adversarial timer ordering), prediction replay + smoothing |
| `packages/gameplay-tests` unit/integration | 17 | Real Colyseus sockets: room codes, join/leave, seat limit, host start, movement replication, rifle kill + death + respawn timing, reconnect keeps the same player, 100 ms RTT measurement; 10-virtual-minute prediction soak at 0/50/100/150 ms RTT with fault injection |
| Playwright e2e (production bundle, real Chromium) | 5 | Two browsers join/start/see each other; Marine kills a dummy Ripper with real mouse input; Ripper climbs wall→ceiling with real WASD; reload resumes the seat; 100 ms simulated RTT with zero prediction breaks |

## Epics

| Epic | State |
|---|---|
| E0 monorepo / bootstrap / CI | Done (`pnpm install && pnpm dev`; `.github/workflows/ci.yml` — not yet run on GitHub). |
| E1 room / join / reconnect | Done: 6-char codes, 2–4 seats, reconnect token (15 s seat hold, survives a tab reload), synchronized entities. |
| E2 greybox Test Cell A | Done (see D-17: ≈36×34 m footprint, named spaces at spec size, 19.4 m vent). |
| E3 Marine controller + prediction | Done. |
| E4 Ripper traversal | Done and heavily tested; **feel unvalidated** (view assist is the biggest open question). |
| E5 rifle + bite + respawn | Done. |
| E6 HUD / lobby / scoreboard | Done. |
| E7 debug + telemetry | Done (all overlay metrics, 8 visual toggles, dev actions, simulated latency). |
| E8 art/audio replacement | **Partial by design (D-18):** procedural Marine/Ripper/rifle, environment dressing, VFX and synthesised audio; the Meshy/Blender/ElevenLabs pipeline needs your accounts. |
| E9 Railway + playtest gate | Config and docs done; deployment and playtests **pending**. |

## Soak results (this repo, this machine)

Filled in below from `pnpm soak -- --minutes 10 --lag 100 --jitter 20` (4 headless real-socket clients, real fights,
dev teleports every 20 s to force engagements).

**10-minute run, 4 real-socket clients (2 Marines + 2 Rippers), RTT 100 ms ± 20 ms, PASS:**

| Client | Ticks | Reconciliations | Max prediction error | Ripper surface breaks | Deaths / respawns | Hard snaps (respawn/teleport) |
|---|---|---|---|---|---|---|
| Marine M0 | 30 733 | **0** | 0.000 m | – | 22 / 22 | 52 |
| Ripper R1 | 31 609 | **0** | 0.001 m | **0** | 19 / 18 | 49 |
| Marine M2 | 30 843 | **0** | 0.000 m | – | 22 / 21 | 51 |
| Ripper R3 | 31 208 | **0** | 0.000 m | **0** | 20 / 20 | 51 |

* Server: 36 096 ticks in 10 min (no drift), **tick duration EMA 0.042 ms** vs the 16.67 ms budget, **0 inputs dropped** by the queue cap.
* 1 114 in-flight frames from before respawns/teleports were correctly dropped (`stale-epoch`), which is what keeps the numbers above at zero.
* Combat really happened: 83 deaths, 137 leaps; Ripper time on ground 49 % / wall 21 % / ceiling 7 % / air 24 %.
  (Bot rifle accuracy 10.8 %, bot kill ratio 0.89 and mean encounter TTK 9.2 s describe the *bots*, not human balance.)
* Virtual-time harness (`pnpm test`): 10 minutes at 100 ms ± 20 ms and at 150 ms ± 20 ms, Marine + Ripper fuzzers: 0 reconciliations, max error 2.6 µm,
  ~14 000 Ripper wall ticks / ~7 000 ceiling ticks / 268 leaps. Under injected 3 % input-batch loss (adversarial) the reconciler fires ~50 times/min and converges to 0 error.

## Not measured here (be skeptical of these until you have numbers)

* **Real-GPU frame time.** The sandbox only has software WebGL (SwiftShader, ~1–5 fps), so browser FPS could not be measured. The scene is
  ~62 draw calls (merged map meshes + a handful of avatars), no shadows, ≤1.5× pixel ratio, ~0.27 MB gzip of JS and no binary assets,
  so the 60 FPS target should be comfortable, but that is a prediction. Check the overlay's FPS / frame ms on a real laptop first.
* **Real network.** Latency was simulated (FIFO, jitter). Real packet bursts, Wi-Fi stalls and Singapore↔Auckland RTT are untested.
* **Cross-browser float determinism.** Prediction relies on identical float math on client and server. Chrome and Node share V8, so they
  agree exactly; Firefox/Safari may differ in `sin`/`cos` last bits and show occasional tiny corrections (under the 1 cm threshold they are ignored).
