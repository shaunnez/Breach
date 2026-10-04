# BREACH//HIVE — Implementation Bible

**Status:** Build-ready handoff  
**Target:** Browser, desktop keyboard + mouse first  
**Primary stack:** TypeScript, React, Three.js, Rapier 3D WASM, Colyseus, Railway  
**Scope covered:** VS01 Combat Truth Slice, VS02 Strategy Truth Slice, VS03 3v3 Internal Alpha  
**Core design reference:** asymmetric FPS + RTS with human command infrastructure versus a physically embodied alien ecosystem. Inspiration is structural, not an IP clone. Do not copy Natural Selection names, maps, assets, UI, story, creatures, logos, or audiovisual identity.

---

## 1. Product thesis

BREACH//HIVE is a browser-native asymmetric multiplayer FPS/RTS.

The human faction, **Expedition**, wins through logistics, ranged firepower, information, infrastructure and one physically vulnerable Commander who can enter an RTS view.

The alien faction, **Bloom**, wins through speed, ambush, surface traversal, biological territory and player-controlled builder/support organisms. There is no alien RTS commander in the classic mode.

The core loop is:

`scout → fight → control territory → collect resources → unlock capability → crack enemy infrastructure`

Kills matter because they create timing windows. They are not the principal economic objective.

### Design pillars

1. **Asymmetry must be systemic, not cosmetic.**
2. **Movement is a weapon.** Ripper traversal is as important as gun feel.
3. **Territory is visible.** Human infrastructure and Bloom biomass materially alter the space.
4. **Commander decisions change first-person play.**
5. **Short readability beats visual excess.** Every silhouette, VFX cue and sound should help decision-making.
6. **Browser is a constraint, not an excuse.** Stable 60 FPS and fast iteration are worth more than cinematic fidelity.

---

## 2. Development doctrine

Do not build the whole game first.

Development proceeds through three vertical slices:

### VS01 — Combat Truth Slice

Prove that one Marine fighting one Ripper in one small refinery map is excellent.

**Deliverable:** 2–4 players can join one browser match and repeatedly fight as Marines and Rippers with authoritative networking, prediction, respawn, wall/ceiling traversal, rifle combat and bite combat.

### VS02 — Strategy Truth Slice

Add one active resource room, Commander mode, Extractor, Weaver and Harvester.

**Deliverable:** FPS combat changes who controls the resource node; Commander and Weaver can create infrastructure that changes the next fight.

### VS03 — 3v3 Internal Alpha

Add enough systems to produce a tiny but recognisable full match.

**Deliverable:** one Commander + two Marines versus three Bloom players, two resource wells, respawns, one Marine tech unlock, one alien evolution, base destruction win condition.

**Rule:** do not implement VS02 until VS01 acceptance criteria pass. Do not implement VS03 until VS02 is fun in repeated playtests.

---

## 3. Explicit non-goals for VS01

Do not implement:

- accounts
- persistent progression
- cosmetics
- battle pass or monetisation
- matchmaking ranking
- voice chat
- mobile controls
- controller support
- multiple maps
- five alien lifeforms
- full commander tech tree
- full resource economy
- final narrative
- extensive settings UI
- server browser
- bots
- anti-cheat beyond server authority and input validation
- procedural generation
- WebGPU-specific rendering

VS01 is a combat laboratory that happens to be multiplayer.

---

## 4. Technical baseline

### Client

- TypeScript
- Vite
- React for application shell, lobby, menus and HUD overlays
- Three.js `WebGLRenderer` for the shipping VS01 renderer
- Rapier 3D WASM for collision queries and world physics
- Colyseus web SDK
- Zustand or a minimal equivalent for non-authoritative UI state only

Do **not** use React Three Fiber in VS01. Own the render loop directly.

Three.js currently describes `WebGPURenderer` as its next-generation renderer with WebGL2 fallback, but also describes it as experimental and still recommends `WebGLRenderer` for pure WebGL2 applications. Isolate renderer creation behind a small adapter so migration remains possible later.

### Server

- Node.js current LTS
- TypeScript
- Colyseus authoritative Room
- Rapier 3D WASM
- fixed-step simulation
- structured JSON logging

Colyseus is used for Room lifecycle, state synchronization, seat reservation/joining and the prediction-ready networking stack. The server owns authoritative game state.

### Hosting

VS01 Railway topology:

- `web`: browser client
- `game-server`: one Node/Colyseus instance

No database is required for VS01.

Railway supports persistent WebSocket connections. Run **one game-server replica** for VS01. Railway currently distributes requests randomly across replicas and does not provide sticky sessions. Do not turn on generic replicas for stateful match servers without an explicit room allocator/routing design.

Use Railway Singapore first for the prototype and measure real Auckland/NZ latency. If competitive RTT is unacceptable, retain Railway for web/API but move authoritative game servers to an AU/NZ-capable host.

### Package management

Use `pnpm` workspaces.

---

## 5. Repository layout

```text
breach-hive/
  apps/
    client/
      src/
        app/
        game/
          bootstrap/
          render/
          input/
          audio/
          camera/
          entities/
          movement/
          combat/
          network/
          map/
          debug/
        ui/
        main.tsx
      public/
        assets/
    server/
      src/
        rooms/
        simulation/
        movement/
        combat/
        validation/
        maps/
        telemetry/
        index.ts
  packages/
    shared/
      src/
        protocol/
        balance/
        enums/
        math/
        map/
    gameplay-tests/
      src/
  tools/
    assets/
      blender/
      validate-gltf/
      compress/
  docs/
  pnpm-workspace.yaml
  package.json
  tsconfig.base.json
```

### Boundaries

`shared` contains values and message/state definitions that genuinely need to be shared. Do not put server authority logic into shared code simply to make client prediction convenient.

Prediction may mirror server logic, but the server remains canonical.

---

## 6. Runtime architecture

```text
Browser
  React UI
      │
      ├── Colyseus SDK ───────────────┐
      │                                │ WebSocket
      └── Game Runtime                 ▼
          Three.js                Colyseus Room
          Client prediction       Authoritative simulation
          Interpolation           Rapier world
          Local VFX/audio         Damage / ammo / respawn
                 ▲                Validation
                 └──── patches / events ─────┘
```

### Ownership

Server owns:

- canonical transform
- health
- armour
- ammo
- fire cadence
- damage
- death
- respawn
- faction
- Ripper energy
- legal movement envelope
- match phase
- future resources and structures

Client owns only presentation:

- local predicted transform
- camera
- animation
- muzzle flash
- immediate weapon audio
- cosmetic tracers
- particles
- UI transitions

Never trust a client-supplied hit, damage value, transform, health, ammo value, cooldown completion or resource mutation.

---

## 7. Simulation and network cadence

Use metres and seconds throughout.

```text
Client render                  display refresh, target 60–144 FPS
Client prediction             60 Hz fixed step
Client input send             30 Hz
Server simulation             60 Hz fixed step
Colyseus state patch          20 Hz target
Remote transform interpolation ~100 ms buffer initially
Server rewind history         250 ms
```

The server runs an accumulator-based fixed timestep and records tick drift.

Do not attempt deterministic lockstep. Prediction is reconciled against server snapshots.

### Input frame

Each client sends compact inputs, not positions.

```ts
type InputFrame = {
  seq: number;
  clientTimeMs: number;
  moveX: number;      // -1..1
  moveZ: number;      // -1..1
  yaw: number;
  pitch: number;
  jump: boolean;
  sprint: boolean;
  primary: boolean;
  secondary: boolean;
  interact: boolean;
};
```

Server validates range, sequence progression and rate.

### Reconciliation

Each authoritative player state includes `lastProcessedInputSeq`.

Client:

1. receives authoritative state
2. moves local predicted state to server state
3. discards acknowledged inputs
4. reapplies unacknowledged inputs
5. visually smooths only the correction delta

Target:

- corrections under 5 cm should be effectively invisible
- large corrections must converge rapidly but should never be hidden from debug telemetry

---

## 8. Player collision conventions

World up is `+Y`.

Forward is local `-Z`.

All authored GLB assets use metres, Y-up and applied transforms.

### Marine collision

```text
Standing height        1.78 m
Capsule radius         0.32 m
Collider half-height   0.57 m plus hemispheres
Eye height             1.62 m
Step height            0.35 m
Max walkable slope     48 degrees
```

### Ripper collision

Ripper uses a kinematic capsule/swept body whose local up can orient to the attached surface.

```text
Body length            ~1.10 m
Collider radius        0.28 m
Effective height       ~0.72 m
Eye offset             0.28 m from body centre toward local up
```

Do not use mesh collision for player bodies.

---

## 9. VS01 Marine movement specification

Initial values are tuning baselines, not sacred balance.

```text
Walk speed                   4.6 m/s
Sprint speed                 6.5 m/s
Backward speed               4.0 m/s
Strafe speed                 4.3 m/s
Ground acceleration         28.0 m/s²
Air acceleration             7.5 m/s²
Ground friction             12.0
Gravity                     18.0 m/s² downward
Jump vertical impulse        5.8 m/s
Hard horizontal speed cap    6.8 m/s
Default FOV                  90 degrees horizontal-equivalent target
Sprint FOV                   94 degrees
Camera bob                   restrained; never exceed 2.5 cm vertical
```

### Feel rules

- acceleration should be immediate enough for FPS duelling without feeling like instant velocity assignment
- releasing movement should stop quickly
- jumping is useful for geometry, not a dominant bunny-hop meta in VS01
- no ADS in VS01
- sprint lowers weapon immediately but does not create a long animation lock
- firing cancels sprint

---

## 10. VS01 Ripper movement specification

The Ripper is the highest-priority feel system in the slice.

### Baseline values

```text
Ground run speed              7.0 m/s
Surface run target            8.0 m/s
Maximum traversal speed       9.5 m/s
Ground/surface acceleration  42.0 m/s²
Air acceleration             14.0 m/s²
Leap forward impulse          9.5 m/s
Leap vertical/outward bias    2.2 m/s
Leap cooldown                 0.80 s
Leap energy cost             25
Energy maximum               100
Energy regeneration          20/s after 0.50 s delay
Default FOV                  100 degrees
Surface camera roll cue      max ±28 degrees by default
```

### Surface traversal model

Do not fake wall-running as a canned animation.

The Ripper maintains a `surfaceFrame`:

```ts
type SurfaceFrame = {
  normal: Vec3;
  tangentForward: Vec3;
  tangentRight: Vec3;
  state: 'ground' | 'wall' | 'ceiling' | 'air';
};
```

Use contact probes/raycast fans around the body and slightly ahead of travel.

Attachment rules:

- surface within approximately `0.38 m`
- player is moving at least `3.5 m/s`, except normal ground locomotion
- candidate normal is reachable from current surface frame without an impossible discontinuity
- player is not in leap lockout
- maintain attachment through edges using forward/side probes for a short grace window

Detach when:

- explicit leap
- no valid surface for `>120 ms`
- collision would produce an invalid penetration
- speed falls below the configured detach threshold on wall/ceiling

### Camera comfort

Default camera is **horizon-biased**.

The body may fully orient to walls and ceilings, but camera roll is deliberately limited to communicate surface state without causing continuous 90/180 degree visual rotation.

Provide a later accessibility option for full surface-relative roll. It is not required in VS01 settings UI.

### Leap

A leap:

- detaches from current surface
- preserves current tangent velocity
- adds forward impulse
- adds a small outward/up bias
- permits air steering
- does not auto-target enemies
- does not deal damage in VS01

Target practical leap length on level terrain: roughly `7–9 m` depending on launch velocity and steering.

### Vent traversal

A `1.0–1.15 m` square vent should be naturally traversable by the Ripper collider and physically inaccessible to a standing Marine, not blocked by a faction-specific invisible wall.

---

## 11. VS01 combat specification

### Marine

```text
Health                 100
Armour                  50
```

For VS01, armour is simply an additional pool depleted before health. Do not implement complex armour ratios yet.

### Pulse rifle

```text
Damage per hit           10
Rate of fire            600 RPM
Magazine                 30
Reserve                  90
Reload                   2.15 s
Base spread              0.55 degrees
Moving spread            0.85 degrees
Sustained bloom cap      1.20 degrees
Bloom recovery           quick; begin after 90 ms without firing
Damage falloff           none in VS01 map
Headshots                disabled in VS01
```

Expected perfect sustained kill on a 120 HP Ripper: about 12 hits, roughly 1.1 seconds after first valid hit at 600 RPM.

### Ripper

```text
Health                  120
Armour                    0
Energy                  100
```

### Bite

```text
Damage                   55
Cooldown                 0.55 s
Effective reach          1.35 m
Sweep radius             0.38 m
Horizontal arc           approx 70 degrees
Vertical tolerance       generous enough for fast traversal fights
```

Three valid bites kill a full 150 effective-health Marine.

### Combat rules

- no friendly fire in VS01
- no headshots
- no random critical hits
- death ragdoll is cosmetic only
- respawn time: `4.0 s`
- spawn protection: `1.0 s`, canceled immediately on attack input

---

## 12. Hit validation

### Rifle

Rifle is hitscan.

Client immediately plays:

- muzzle flash
- weapon sound
- recoil
- cosmetic tracer

Server determines whether damage happened.

Maintain approximately `250 ms` of historical target collision transforms.

On fire request:

1. validate ammo
2. validate cadence
3. estimate shot simulation time using server-known timing information
4. clamp rewind window
5. rewind target hurt volumes only
6. raycast from validated shooter origin/direction
7. apply damage
8. restore current collision transforms
9. emit authoritative hit event

Never rewind map geometry.

### Bite

Bite is a server-authoritative short swept-volume test from the Ripper's historical/validated attack transform.

Do not accept `targetId` as proof of a hit.

### Anti-cheat baseline

Reject or correct:

- impossible displacement
- movement exceeding tolerance envelope
- impossible fire rate
- fire while reloading
- ammo below zero
- pitch/yaw values outside valid representation
- sequence floods
- stale/replayed input sequence

Do not build a commercial anti-cheat system in VS01.

---

## 13. VS01 greybox map — Refinery Test Cell A

Target overall playable footprint: approximately `48 m × 34 m`, with vertical variation.

### Route graph

```text
[Marine Spawn]
      |
   8m corridor
      |
  [Junction] -------- [Resource Room]
      |                     |
 [Maintenance] -------- [Hive Approach]
      |                     |
      +---- Ripper vent ----+
                            |
                       [Bloom Spawn]
```

### Spaces

#### Marine Spawn

```text
10 m × 8 m × 4 m
```

- two exits eventually, one active in VS01
- no spawn sightline into central fight

#### Junction

```text
8 m × 8 m × 4.2 m
```

- central cover block approximately 1.5 m high
- overhead pipe/beam usable by Ripper
- wall-to-ceiling corner should deliberately test traversal

#### Resource Room

```text
12 m × 10 m × 5 m
```

- circular future resource well at centre
- two main doors
- upper maintenance ledge
- enough space to circle the node
- this room becomes the first active economic objective in VS02

#### Maintenance Route

```text
4 m wide
18 m long
3.2–4 m high
```

- bends at least once
- clutter creates partial rifle sightline breaks
- overhead traversal opportunity

#### Hive Approach / Bloom Spawn

```text
12 m × 10 m × 6 m
```

- taller ceiling
- stronger biomass visual treatment later
- multiple Ripper surface transitions

#### Vent

```text
1.05 m × 1.05 m cross-section
approximately 16–20 m path
```

- at least one 90-degree turn
- connects Junction/upper route to Hive side
- Ripper shortcut

### Geometry rules

- primary corridor width: `3.2–4.5 m`
- doors: `1.8–2.4 m` wide
- standard ceilings: `3.2–4.5 m`
- hero combat rooms: up to `6 m`
- avoid long featureless boxes
- every major space needs at least one readable Ripper traversal line
- avoid decorative collision noise

Greybox must be built from simple primitives first. Do not wait for final environment art.

---

## 14. Camera specifications

### Marine

- eye position follows controller, not weapon model
- weapon rendered in same camera initially; near clipping tuned carefully
- FOV 90 baseline
- weapon recoil should not directly rotate the entire camera by large amounts
- recoil impulse should be readable but controllable

### Ripper

- FOV 100 baseline
- low eye height
- surface roll cue max ±28° default
- leap adds mild positional kick, not FOV explosion
- no artificial cinematic motion blur

### Commander — VS02

```text
Camera altitude range       8–24 m
Pitch                       ~55–70° downward depending zoom
Pan                         WASD + optional edge pan
Zoom                        wheel
Rotation                    fixed initially
```

Commander view remains a real projection of the same map, not a separate 2D map.

---

## 15. State model

Keep synchronized state compact.

Conceptual types:

```ts
type Faction = 'expedition' | 'bloom';
type PlayerClass = 'marine' | 'ripper' | 'weaver' | 'commander';

type NetTransform = {
  px: number; py: number; pz: number;
  yaw: number; pitch: number;
};

type PlayerState = {
  id: string;
  faction: Faction;
  playerClass: PlayerClass;
  transform: NetTransform;
  health: number;
  armour: number;
  alive: boolean;
  ammo: number;
  energy: number;
  lastProcessedInputSeq: number;
  respawnAtMs: number;
};

type MatchState = {
  phase: 'warmup' | 'playing' | 'resetting';
  serverTick: number;
  players: Map<string, PlayerState>;
};
```

Do not synchronize transient particles, weapon animation time, audio playback state or raw physics internals.

Use discrete events for:

- weapon fired
- authoritative hit
- death
- respawn
- sound cue that must be heard remotely
- later build accepted/rejected

---

## 16. Join flow for VS01

No account system.

### URL

`/play`

### Flow

1. Enter display name, default generated locally.
2. `Create Room` or enter six-character room code.
3. Host receives room code.
4. Players join.
5. Select Marine or Ripper, with simple team-size guard.
6. Host presses Start when at least two players are present.
7. Match loads Test Cell A.

Support 2–4 players for VS01.

Recommended configurations:

- 1 Marine vs 1 Ripper
- 2 Marines vs 2 Rippers

No persistent lobby backend.

---

## 17. Respawn and match loop for VS01

VS01 is explicitly a combat laboratory.

It does **not** define the final game win condition.

Flow:

- spawn
- fight
- die
- 4 s respawn
- continue

Expose a test scoreboard with kills, deaths, damage and RTT.

Provide host/dev reset.

A 10-minute soft session timer may show playtest pacing but should not be treated as canonical game design.

VS02/VS03 introduce objective-driven winning.

---

## 18. Debug tooling is mandatory

Launch with `?dev=1` or dev build toggle.

Overlay:

```text
FPS
server tick / drift
RTT
jitter estimate
input sequence
last server ack
prediction error magnitude
reconciliations / second
player velocity
Ripper surface state
surface normal
weapon fire validation result
```

Visual toggles:

- player colliders
- hurt volumes
- hit rays
- bite sweep
- surface probes
- navigation/traversal probes
- spawn volumes
- interpolation ghosts

Commands/dev actions:

- teleport to named room
- switch class
- refill ammo/energy
- spawn target dummy
- reset room
- add simulated input latency in local development

If movement is hard to inspect, it will be hard to tune.

---

## 19. Asset direction

Visual target is **excellent indie 3D**, not fake AAA fidelity.

### Expedition

- graphite undersuits
- off-white ceramic armour
- cyan tactical emitters
- orange industrial environment accents
- utilitarian silhouettes

### Bloom

- matte black chitin
- pale bone armour/plates
- deep crimson tissue
- subtle violet bioluminescence
- strong silhouette differences

### Environment

- modular orbital refinery
- dirty metal
- readable hazard paint
- pipes/cable trays
- limited decal families
- Bloom biomass progressively replaces/overgrows human surfaces

---

## 20. Initial asset budget

### Characters

```text
Marine LOD0          20k–30k triangles
Ripper LOD0          20k–35k
Weaver later         25k–40k
Character texture    one primary 2K set; reduce where possible
```

### Props

```text
Small prop           0.5k–3k
Medium prop          3k–8k
Hero machinery       8k–20k
Most prop textures   1K
```

### Environment

Prefer trim sheets, atlasable materials and modular kits.

Do not create a unique 2K material for every wall panel.

### Compression

- GLB/glTF
- Meshopt geometry compression
- KTX2/Basis texture compression
- LODs for large characters and hero props
- instancing for repeated environment pieces

Measure actual browser decode/load cost before committing to large batches.

---

## 21. AI + Blender asset pipeline

### Stage 1 — reference lock

Use the approved gameplay/concept imagery as visual references.

Each asset gets a small reference sheet:

- front/side/three-quarter where relevant
- silhouette
- approximate dimensions
- material callouts
- faction palette

### Stage 2 — Meshy

Prefer image-to-3D when a reference design exists.

Generate the initial mesh/material candidate.

Generated geometry is never automatically accepted as production-ready.

### Stage 3 — Blender normalization

Automate where possible:

1. import
2. set metre scale
3. apply transforms
4. orient +Y up, forward convention documented
5. clean obvious topology issues
6. reduce material count
7. retopology/decimation as needed
8. UV validation
9. texture resolution normalization
10. rig validation
11. animation naming cleanup
12. generate LODs
13. create simplified collision geometry
14. export GLB
15. run validation

### Naming

```text
CHR_Marine_A
CHR_Ripper_A
WPN_PulseRifle_A
ENV_Wall_Industrial_A_4m
ENV_Door_Industrial_A_2m
ENV_Vent_A_1m
STR_Extractor_A
BIO_Biomass_Patch_A
```

Collision nodes:

`COL_<asset>_<index>`

Sockets/helpers:

`SOCKET_Muzzle`, `SOCKET_Weapon`, `SOCKET_FX_*`

### Stage 4 — game ingest

Asset manifest records:

- source
- GLB path
- LODs
- collision policy
- animation clips
- texture memory estimate
- owning faction
- status

### Stage 5 — performance gate

No asset is "done" until viewed in the actual browser scene with performance telemetry.

---

## 22. VS01 animation list

### Marine

Required:

- idle
- run forward
- run backward/strafe blend or acceptable locomotion blend
- jump
- land
- rifle idle
- rifle fire additive/recoil
- reload
- death

Do not create 30 emotes.

### Ripper

Required:

- idle
- ground locomotion
- surface locomotion
- leap
- land
- bite
- hit react, subtle
- death

Ripper animation should follow traversal physics rather than drive traversal displacement.

---

## 23. VS01 audio list

ElevenLabs may be used for generated source material, then edited/normalized.

Required:

### Marine

- rifle fire near
- rifle fire distant
- reload mechanical layers
- footsteps metal
- landing
- armour hit
- flesh/body hit

### Ripper

- movement claws on metal
- surface scrape accent
- leap vocal/breath accent
- bite
- hurt
- death
- nearby idle click/chitter

### Environment

- ventilation bed
- distant refinery machinery
- electrical hum
- room-tone variation

Spatial audio is important. Marine players should often hear a Ripper before seeing it.

---

## 24. VS01 VFX list

Keep VFX readable and cheap.

- rifle muzzle flash
- short tracer
- metal impact spark
- generic organic hit puff
- subtle marine shield/armour hit cue
- Ripper bite swipe cue
- death cue
- spawn cue

No full gore system in VS01.

---

## 25. Performance targets

Desktop-first VS01 target:

```text
1080p medium preset
60 FPS minimum target on a representative mid-range laptop/desktop
No sustained main-thread frame > 16.7 ms in normal combat
Server simulation holds 60 Hz without accumulating drift for a 4-player room
```

Initial compressed transfer budget target for Test Cell A:

`<= 35 MB` after first-load essentials if practical.

Treat this as a budget signal, not a reason to sabotage quality. Measure.

---

## 26. Network test matrix

Every release candidate is tested under:

```text
Local / near-zero RTT
50 ms RTT
100 ms RTT
150 ms RTT
jitter ±20 ms
brief connection interruption / reconnect
```

At 100 ms RTT:

- local Marine movement must remain immediate
- local Ripper wall traversal must remain immediate
- remote motion must not visibly teleport in normal play
- rifle hit feedback may wait for authoritative confirmation but firing feedback must be immediate
- reconciliation must not repeatedly throw the local player off surfaces

This criterion is critical.

---

## 27. Railway deployment

### `web`

- build client
- serve static assets
- public domain

### `game-server`

- one replica
- bind `0.0.0.0`
- use `PORT`
- health endpoint `/health`
- public WebSocket endpoint

### Environment

```text
NODE_ENV
CLIENT_ORIGIN
BUILD_SHA
LOG_LEVEL
```

No Redis or Postgres in VS01 unless required for operational reasons discovered during implementation.

Railway WebSockets can remain open indefinitely, but reconnect logic is still required because deploys/network interruptions can terminate a connection.

### Reconnect policy

During an active room:

- exponential backoff
- hold player's seat/state for 15 seconds initially
- reconnect token maps back to the existing player entity
- if state cannot be resumed, return to lobby with an explicit reason

---

## 28. Telemetry

Structured event/log fields:

```text
matchId
roomId
playerId
faction
class
serverTick
rttMs
reconciliationErrorM
movementCorrectionReason
shotAccepted
shotRejectReason
biteAccepted
surfaceAttachState
surfaceDetachReason
serverTickDurationMs
```

Aggregations needed during tuning:

- Marine vs Ripper kill ratio
- average encounter TTK
- rifle accuracy
- bites per kill
- Ripper time spent ground/wall/ceiling/air
- leap usage frequency
- deaths by room
- reconciliations per minute

Do not add analytics vendor complexity before local/server logs can answer these.

---

## 29. Test strategy

### Unit

- balance constants sanity
- fire cadence
- ammo/reload
- damage/death
- respawn timing
- input validation
- sequence rejection
- Ripper energy
- surface state transitions on synthetic normals

### Simulation

Headless tests for:

- Marine maximum displacement over N ticks
- Ripper maximum legal displacement
- leap trajectory envelope
- 600 RPM fire schedule
- 250 ms rewind buffer lookup

### Integration

- two clients join same room
- receive each other's transforms
- client A damages client B
- death replicates
- respawn replicates
- reconnect restores same player

### Browser E2E

At least one automated smoke flow using two browser contexts where practical.

Manual playtesting remains mandatory for movement feel.

---

## 30. VS01 engineering epics

### E0 — Monorepo and runtime bootstrap

Deliver:

- pnpm workspace
- client launches
- server launches
- shared package
- lint/typecheck/test commands
- CI

Acceptance:

`pnpm install && pnpm dev` starts client + server locally.

### E1 — Room/join/network skeleton

Deliver:

- create/join room code
- 2–4 seats
- Colyseus Room
- reconnect token
- synchronized placeholder entities

Acceptance:

Two browser windows see each other join/leave/reconnect.

### E2 — Greybox Test Cell A

Deliver:

- geometry matching section 13
- spawn points
- collision
- vent route
- lighting enough to judge readability

Acceptance:

Marine and Ripper can traverse their intended routes with placeholder controllers.

### E3 — Marine controller

Deliver:

- movement
- sprint
- jump
- camera
- collision
- prediction/reconciliation

Acceptance:

Marine feels responsive at local, 50 ms and 100 ms simulated RTT.

### E4 — Ripper traversal

Deliver:

- ground locomotion
- wall attachment
- wall-to-ceiling/edge transition
- camera comfort model
- leap
- air control
- vent traversal
- prediction/reconciliation

Acceptance:

A player can repeatedly execute:

`floor → wall → ceiling/upper surface → leap → land → vent`

without scripted rails or repeated desync.

### E5 — Rifle and bite combat

Deliver:

- rifle
- ammo/reload
- recoil
- server rewind hit validation
- bite sweep
- health/armour
- death
- respawn

Acceptance:

All damage is server-authoritative; no client can exceed legal cadence/damage through normal protocol manipulation.

### E6 — Minimal HUD and lobby

Deliver:

- room flow
- faction/class choice
- health/armour/ammo/energy
- respawn timer
- test scoreboard
- disconnect/reconnect messaging

### E7 — Debug/telemetry

Deliver all tooling in section 18 sufficient to diagnose movement and netcode.

### E8 — First art/audio replacement pass

Replace only:

- Marine
- Ripper
- pulse rifle
- core industrial modular kit
- initial sounds
- minimal VFX

Do not block E1–E7 on final art.

### E9 — Railway deployment and playtest gate

Deliver a shareable URL and documented deployment procedure.

---

## 31. VS01 Definition of Done

VS01 is complete only when all are true:

1. Two remote players can open the game in normal desktop browsers and join the same room.
2. 1v1 and 2v2 work.
3. Marine movement feels immediate and stable.
4. Ripper can ground-run, wall-run, traverse corners/ceiling transitions, leap and use the vent.
5. The Ripper controller is fun enough that testers voluntarily keep moving after the fight ends.
6. Rifle and bite damage are server-authoritative.
7. Death and 4-second respawn work repeatedly.
8. Ten consecutive minutes of combat produce no accumulating transform desync.
9. Under simulated 100 ms RTT, local prediction remains playable and Ripper attachment is not routinely broken by reconciliation.
10. Server maintains target simulation cadence for a 4-player room.
11. All major movement corrections and shot rejections are observable through debug telemetry.
12. Build is deployed and shareable.
13. At least three external playtesters have played it.
14. A short tuning report records what felt good, what felt bad and which constants changed.

**Do not proceed to VS02 merely because the tickets are closed. Proceed when the combat is fun.**

---

# VS02 — Strategy Truth Slice

VS02 begins only after VS01 passes.

## 32. Additions

### Expedition

- Command Core
- one player can enter Commander mode
- Extractor
- one active resource well
- simple order/ping system

### Bloom

- Weaver class
- Harvester
- initial biomass visual footprint

### Economy baseline

Start tuning with:

```text
Controlled resource structure income     0.6 team resource / second
Extractor cost                           10
Harvester cost                           10
Starting team resources                  20
Structure build time                     6 seconds
```

These are deliberately simple initial values.

## 33. Commander interaction

Commander physically interacts with the Command Core.

On successful entry:

- Marine body remains at console
- perspective transitions into overhead view
- Commander can select Marines
- place waypoint/ping
- place an Extractor hologram on valid resource well
- server validates placement and cost

Commander cannot free-place arbitrary structures in VS02.

### Build request

```ts
type BuildRequest = {
  requestId: number;
  structure: 'extractor';
  resourceNodeId: string;
};
```

Server validates:

- Commander role
- valid node
- node not occupied
- sufficient team resources
- match state

## 34. Weaver

Weaver is a slower support/builder alien.

VS02 abilities only:

- basic melee/weak attack
- local heal pulse or heal channel
- build Harvester on valid resource node

Do not implement the full alien structure catalogue.

## 35. VS02 objective

One central resource well becomes active.

The meaningful loop becomes:

`win fight → build collector → defend collector → gain economic advantage → enemy attacks collector`

VS02 is successful if teams naturally start caring about the room rather than simply chasing kills.

---

# VS03 — 3v3 Internal Alpha

## 36. Team format

### Expedition

- 1 Commander
- 2 Marines

### Bloom

- 3 players
- any player may use Ripper
- at least one may switch/evolve to Weaver

## 37. Additions

- two resource wells
- one additional human structure: Armoury
- one Marine tech unlock: Shotgun
- one additional Bloom evolution after Ripper/Weaver, preferably Wraith first
- base health/destruction
- canonical match win state

## 38. Win condition

### Expedition wins

Destroy the active Hive and prevent Bloom respawn/rebuild in the tiny alpha ruleset.

### Bloom wins

Destroy the Command Core/spawn capability and prevent Expedition recovery.

Keep the first implementation intentionally bounded; later multi-base recovery can be introduced when map scale supports it.

## 39. Match target

Aim for early internal matches around `12–20 minutes` for the tiny 3v3 test map.

The full game target can later move toward `20–30 minutes`.

---

# Production rules for Astra / coding agents

## 40. Agent behaviour

1. Read this document before implementation.
2. Inspect the current repository before making architecture assumptions.
3. Work in vertical, runnable increments.
4. Keep the game playable after each merged package.
5. Do not expand scope to later slices.
6. Write tests around authoritative game rules and movement envelopes.
7. Add debug visibility with each hard-to-reason-about system.
8. Prefer explicit code over framework novelty.
9. Keep client presentation separated from authoritative rules.
10. Record material deviations from this bible in `docs/DECISIONS.md` with rationale.

## 41. Stop conditions

Astra must stop and surface a decision when:

- an architecture choice would make server authority impossible
- Ripper traversal cannot be predicted/reconciled with the chosen approach
- Railway topology requires stateful multi-replica routing earlier than expected
- browser performance misses target by a material amount
- generated assets materially exceed budgets and cannot be corrected cheaply

Do not silently redesign the product to work around a hard problem.

---

# Final product principle

The first convincing build is not the one with the most systems.

It is the build where a Marine hears claws scraping above them, turns toward the ceiling, sees a Ripper launch across the corridor, opens fire, misses half the burst, and immediately wants another fight.

Everything else earns the right to exist after that works.
