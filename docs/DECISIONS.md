# DECISIONS — material deviations from, and interpretations of, the Implementation Bible

Format: **ID — decision** · why · consequence. Newest decisions at the bottom of each group. The bible
stays the source of truth; anything below is either a deviation (marked **DEVIATION**) or a gap-filler.

## Stack and architecture

**D-01 — Colyseus 0.16 line (`@colyseus/core` 0.16, `@colyseus/schema` 3, `colyseus.js` 0.16), not the newer 0.18 packages.**
0.16 is the line `colyseus.js` 0.16.22 (the latest browser SDK of that line) matches, and its Room/schema/reconnection API
is the one I could verify against the installed typings. Upgrading later is mechanical (the net layer is isolated in
`GameNetClient` and `BreachRoom`).

**D-02 — DEVIATION: no Rapier in VS01. Collision is a small shared pure-TypeScript module over axis-aligned boxes.**
The bible says "Rapier 3D WASM on client and server *as needed*". Test Cell A is built entirely from boxes (bible section 13:
"simple primitives first"), prediction needs client and server to run *bit-identical* collision, and a deterministic
JS module (same V8 maths on both sides, no WASM boot, trivially unit-testable headlessly) gave that for free. The
Marine is an AABB with step-up; the Ripper is a sphere (r = 0.28 m) adhered to the closest box surface. The `CollisionWorld`
interface (`rayCast`, `surfacesNear`, `pushOutSphere`, `aabbBlocked`) is the seam where Rapier can be substituted when
non-box geometry or dynamic bodies arrive (VS02+). `MARINE.maxSlopeDeg` is therefore unused in VS01 (no ramps).

**D-03 — The deterministic *player step* (kinematics + weapon cadence/ammo/reload/spread) lives in `@breach/shared`; all game rules stay server-only.**
The bible warns against putting authority logic into shared code merely to ease prediction, and allows prediction to
"mirror" server logic. Mirroring a function means *sharing* it, otherwise the two copies drift. The shared step has no
notion of health, armour, damage, hits, death, respawn, rewind, scoring or validation; the server runs the same step on
its own validated input stream and remains canonical. Clients never send transforms or hit results.

**D-04 — Wire format additions to `InputFrame`: `reload: boolean` and `epoch: number`.**
`reload` is the smallest prerequisite for a Marine reload key (the bible's frame has no reload bit). `epoch` is a uint16
the server bumps on every spawn / teleport / reconnect; the client stamps each frame with the epoch it believes it is in
and the server drops frames from an older epoch. Found by the soak harness: without it, frames already in flight when
the server moved a player (respawn, dev teleport, reconnect) were simulated against the new position and caused a burst of
corrections. `moveZ: +1` is forward and `moveX: +1` is right.

**D-05 — Per-input simulation with a credit bucket (one frame = one fixed tick of that player).**
Instead of simulating "client time" the server consumes exactly one queued input per tick per player (bucket cap 4 for
burst catch-up, queue cap 12, 90 frames/s intake limit, monotonic `seq`, sanitising clamp). Legal displacement is therefore
bounded *by construction* (a client that floods frames only fills its own queue; tests prove it cannot out-run or
out-fire an honest client). The server also checks `moved <= 0.6 m/tick` as a defensive invariant and logs
`movement-envelope` if it ever fires. Dead players' frames are acknowledged but not simulated.

**D-06 — The client predicts from exactly what the server will simulate** (`sanitizeInput` runs inside
`PredictionController.predict`). Early soak runs showed ~230 corrections/min purely because the server normalised diagonal
movement and wrapped yaw while the client predicted from the raw values.

## Hit validation

**D-07 — Lag compensation window.** `rewind = input age on the server + server-measured RTT/2 + 100 ms interpolation buffer`,
clamped to 250 ms, applied to *target hurt volumes only* (history ring of 48 ticks, linear interpolation, never across an
epoch change). RTT is measured by the server (its own ping/pong) and replicated to the scoreboard. Shooter origin and
direction come from the server's own simulation of the shooter.

**D-08 — Spread is deterministic per `(player seed, shot index, spread)`** so the client's cosmetic tracer follows exactly the
ray the server resolves. The seed is replicated; this is not an anti-cheat surface the bible asks for in VS01.

**D-09 — Hurt volumes** (server-only): Marine = vertical capsule r 0.36 m from 0.36 to 1.46 m; Ripper = capsule r 0.40 m,
half-segment 0.20 m along its surface-forward axis (body length ≈ 1.2 m). Slightly larger than colliders on purpose.

**D-10 — Bite interpretation.** "Effective reach 1.35 m" is measured to the *target surface*: the swept sphere (r 0.38 m)
travels `reach - sweepRadius` from the Ripper's eye, must touch the target capsule, the target must lie within ±35°
(= 70° total) of the aim direction horizontally, and a line of sight to the closest point must exist. No `targetId` is
ever accepted from clients. Three bites kill a full Marine (armour 50 absorbs first, then health).

**D-11 — Spawn protection** ignores damage for 1 s and is cancelled by any attack input. A seat-held (disconnected) player
is frozen and untouchable for the 15 s hold (otherwise a flaky connection is a free kill).

**D-12 — No player-vs-player collision** in VS01 (not specified; avoids prediction fights between two predicted bodies).
Recoil is presentation-only (view-model kick + ≤0.25° camera kick) and never changes the aim the server uses.

## Ripper traversal (highest priority system)

**D-13 — Surface model.** The sphere adheres to the *closest reachable box surface within 0.38 m*; the normal comes from the
closest-point contact, so convex edges are wrapped smoothly (rounded) and concave corners are explicit transitions.
Concave transitions (floor→wall, wall→ceiling, …) require: speed ≥ 3.5 m/s *and* the player pressing into the new
surface (intent) — except landing on ground-like surfaces and stepping onto ≤0.36 m risers, which are always allowed.
At a transition the into-surface speed is converted into travel along the old normal's projection (floor→wall = up,
wall→ceiling = away from the wall), preserving speed. Detach: leap, "let go" (RMB/C), 120 ms with no surface
(gaps up to ~1 m are bridged at speed), or tangent speed < 2.0 m/s on a wall/ceiling.

**D-14 — Extra constants** (in `RIPPER_EXTRA`, everything else is `config/balance.example.ts` verbatim): air gravity 12 m/s²
(the Marine's 18 made the 9.5 m/s leap travel only ~3–4 m; with 12 it is 5–9 m depending on aim, ~7 m with a
slight upward aim, the bible's 7–9 m target), wall sustain speed 2.0 m/s, idle deceleration (ground 40, wall/ceiling 12 m/s²),
overspeed decel 25, air speed cap 14 m/s, leap lockout 90 ms, landing conversion 0.65.

**D-15 — Camera: horizon-biased as specified, plus an addition (surface *view assist*).** With world yaw/pitch, going
wall→ceiling leaves the camera facing the way you came from, so W would reverse you. The assist parallel-transports the
view across normal changes (floor→wall pitches the view up the wall, wall→ceiling swings it over) with a 70 ms ease. It is
purely client presentation (the server only ever receives yaw/pitch), default ON, toggle with `V`, persisted in
localStorage. Roll cue is limited to ±28° and derived from the wall side. **This is the first thing to A/B in playtests.**

**D-16 — Ripper "let go"** (secondary button) is an explicit detach, mapped to the bible's otherwise unused `secondary`.

## Map and content

**D-17 — Test Cell A footprint is ≈ 36 × 34 m, not 48 × 34 m.** Every named space matches its specified size
(spawn 10×8×4, junction 8×8×4.2, resource room 12×10×5, hive 12×10×6, maintenance 4 m wide ~20 m path with a bend,
vent 1.05 m × 1.05 m, 19.4 m long with two 90° bends and three legs). I shortened connecting passages rather than
pad them with featureless boxes. The geometry lives in one file (`shared/src/map/testCellA.ts`) and is cheap to stretch.

## Art, audio, assets

**D-18 — DEVIATION (needs your accounts): E8 is a procedural stand-in pass, not Meshy/Blender/ElevenLabs output.**
Generating those assets needs external services I cannot call from here. What shipped instead: palette-true procedural
Marine / Ripper / pulse-rifle models with simple procedural animation (same origin and forward conventions as the manifest's
GLB targets), a pooled VFX set (muzzle flash, tracers, sparks, organic hit puffs, bite swipe, death + spawn cues),
and a fully synthesised WebAudio sound set with HRTF positional audio and an ambient bed (no binary audio assets).
`assets/asset-manifest.example.json` is untouched and remains the contract: replacing an avatar means providing a function
with the same `AvatarLike` interface (`entities/RemotePlayers.ts`); audio method names in `AudioEngine` are the integration points.

## Operations

**D-19 — Railway: configuration is in the repo; the deployment itself needs your Railway account** (see `docs/DEPLOYMENT.md`).
The default topology is one service (`Dockerfile.server`: game server + the built client on one origin, one replica),
which is the simplest shareable URL. The bible's two-service topology is also provided (`Dockerfile.web`).

**D-20 — Dev tools** (teleport, class switch, dummies, refill, reset) are enabled only in rooms created with `?dev=1`;
the overlay itself also needs `?dev=1`. They are not authority leaks: they run through the same server `Simulation`.

**D-21 — Lobby rules.** Max two humans per side (the bible's "simple team-size guard"); host may start with ≥2 players
of any composition (1v1 and 2v2 are the recommended configs). Class change during a match is queued until your next respawn.

**D-22 — Tooling.** Vitest runs the Colyseus integration tests on the `threads` pool (Colyseus' pm2 hook calls `process.send`,
which breaks the `forks` pool). Headless netcode tests use a *virtual-time* link around the **real** `Simulation` and the
**real** `PredictionController`, so ten minutes of play at 100 ms RTT run in about a second; `pnpm soak` runs the same
clients over real sockets in real time.
