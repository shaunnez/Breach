# Astra Execution Prompt — BREACH//HIVE VS01

You are the implementation lead for **BREACH//HIVE Vertical Slice 01: Combat Truth Slice**.

Your source of truth is `docs/BREACH_HIVE_IMPLEMENTATION_BIBLE.md`.

## Mission

Build a browser-based authoritative multiplayer combat slice in which 2–4 players can create/join a room and repeatedly fight as:

- Expedition Marine
- Bloom Ripper

The key test is whether **Marine vs Ripper combat and traversal are genuinely fun**.

Do not implement VS02 or VS03 systems until explicitly instructed.

## Required stack

- TypeScript
- pnpm workspaces
- Vite + React client shell/HUD
- raw Three.js WebGLRenderer game runtime
- Rapier 3D WASM on client and server as needed
- Colyseus authoritative game server
- Railway-compatible deployment

## Build order

Implement and verify in this order:

1. monorepo/bootstrap/CI
2. Colyseus room create/join/reconnect skeleton
3. Test Cell A greybox
4. authoritative fixed-step simulation and client prediction/reconciliation
5. Marine controller
6. Ripper ground/wall/ceiling/leap/vent traversal
7. rifle + bite server-authoritative combat
8. death/respawn
9. minimal lobby/HUD/scoreboard
10. debug overlays and telemetry
11. first approved art/audio replacements
12. Railway deployment
13. 100 ms RTT test pass
14. external playtest build

## Scope control

Do NOT add:

- accounts
- persistence
- full economy
- Commander
- Weaver
- additional alien classes
- tech tree
- multiple maps
- cosmetics
- mobile
- controllers
- matchmaking rating
- monetisation

If you discover a prerequisite, implement the smallest prerequisite that preserves the VS01 boundary.

## Engineering constraints

- server is authoritative for transform validation, health, armour, ammo, fire cadence, damage, death and respawn
- clients send inputs, never canonical transforms or hit results
- prediction must remain local and immediate
- use 60 Hz client prediction and server simulation, 30 Hz input send, approximately 20 Hz state patches
- maintain up to 250 ms target history for rifle lag compensation
- do not use deterministic lockstep
- Ripper traversal is physics/query driven, not a canned animation path
- default Ripper camera is horizon-biased with limited roll cue
- build debug visualization alongside traversal and netcode

## Quality gates

Do not report VS01 complete until every Definition of Done item in the bible passes.

Particularly:

- ten minutes repeated combat without accumulating desync
- Ripper floor → wall → ceiling/upper transition → leap → land → vent works repeatedly
- 100 ms RTT remains playable
- server rejects impossible movement/fire cadence
- 1v1 and 2v2 work remotely
- deployed shareable URL exists

## Working method

For each epic:

1. inspect relevant existing code
2. write/adjust tests first where practical
3. implement the smallest vertical increment
4. run typecheck, lint and tests
5. manually verify the gameplay behaviour where automation cannot judge feel
6. update `docs/DECISIONS.md` for material deviations
7. keep a concise `docs/PLAYTEST_NOTES.md` with observed feel and tuning changes

Do not optimize prematurely, but do measure frame time, server tick duration and reconciliation error before declaring systems stable.

## First deliverable

Begin with E0 and E1 only:

- create the monorepo
- client + server run together locally
- two browser windows can create/join the same Colyseus room
- placeholder player entities replicate
- reconnect restores the same player where possible
- add basic network/debug overlay

When those acceptance tests pass, proceed to E2 and onward without broadening scope.
