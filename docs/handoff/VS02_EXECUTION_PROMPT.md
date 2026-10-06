# Execution Prompt — BREACH//HIVE VS02: Strategy Truth Slice

You are the implementation lead for **VS02**. Sources of truth, in order: `docs/BREACH_HIVE_IMPLEMENTATION_BIBLE.md`
(sections 32–35, plus the sections they reference), `docs/DECISIONS.md`, `docs/VS01_STATUS.md`, `docs/PLAYTEST_NOTES.md`.
Read them first. VS01 is signed off for now (Railway deploy and external playtests are deferred; do not work on them).
Do **not** start VS03.

## Mission

Add one active resource room and the minimum strategy layer so that FPS combat changes who controls the node:
`win fight → build collector → defend collector → gain economic advantage → enemy attacks collector`.
Success = teams care about the room, not just kills.

## Scope (and nothing more)

Expedition: Command Core with Commander mode (a Marine enters at the console, body stays, overhead view; select Marines,
waypoint/ping, place an Extractor hologram on a valid well; server validates), Extractor, one active resource well.
Bloom: Weaver class (slow support/builder: weak melee, local heal pulse/channel, builds a Harvester on a valid node),
Harvester, initial biomass footprint.
Economy start values: controlled-structure income 0.6 team resource/s, Extractor 10, Harvester 10, starting resources 20,
build time 6 s. Commander cannot free-place structures. Do not implement the wider structure catalogue.

## Rules

- Keep the VS01 architecture: server-authoritative `Simulation`, shared deterministic step functions, client prediction only for
  the local player's movement. Economy, build requests (`BuildRequest` per bible 33), structure HP/ownership, Commander role and
  Weaver abilities are server state, validated server-side (role, node valid/free, cost, match state), replicated via the schema.
- Respect existing decisions: wall/ceiling cling is an input (D-25, hold F / toggle T), class caps and lobby rules (D-21).
  Extend the class guard for Commander (max 1) and Weaver deliberately and record it in `docs/DECISIONS.md`.
- Constants go in `config/balance.example.ts` / `packages/shared/src/balance.ts` style, not magic numbers. Log every deviation as a numbered decision.
- Extend, don't fork, the test strategy: shared unit tests for rules, server tests for validation/economy (including rejects:
  wrong role, occupied node, insufficient funds, wrong phase), integration over real sockets, virtual-time soak with a Commander
  and a Weaver in the mix, and a Playwright e2e of "Commander builds Extractor, Weaver builds Harvester".
  `pnpm typecheck && pnpm lint && pnpm test` must stay green; keep CI green on the branch.
- Telemetry/debug: add economy and structure state to the `?dev=1` overlay and `/debug/telemetry` (income, resources, structure
  HP, who controls the node over time) so VS02 can be judged from data.
- Art/audio stay procedural placeholders (D-18).

## Build order

1. Economy + structure model in `packages/shared` (resources, node ownership, build timers), with unit tests.
2. Server: Command Core interaction, Commander role, `BuildRequest` validation, Extractor/Harvester lifecycle, income tick, replication.
3. Resource Room becomes the active well; map changes for the Core console and node, in `testCellA`.
4. Client: Commander overhead view, selection/ping, hologram placement UI, resource HUD.
5. Weaver class: stats, melee, heal pulse, Harvester build.
6. Structures take damage and can be destroyed by the opposing side (this is what makes the room contested).
7. Debug/telemetry additions, soak with new roles, e2e.
8. Docs: update `VS01_STATUS.md`-style status page as `docs/VS02_STATUS.md` with an honest Definition-of-Done checklist, update `PLAYTEST_NOTES.md` with VS02 feel risks.

## Definition of done

Mirror the bible's section 35 objective: a match where holding the resource room produces a visible economic edge and the other
team has a reason and a means to attack the collector. State clearly what is automated vs what needs human playtesting.

Work on a feature branch, open a PR, and keep it green. Ask before anything outward-facing (deploys, accounts).
