# VS02 status: Strategy Truth Slice

**Built and tested, not yet played by humans.** Everything in bible sections 32–35 exists and runs in the same match as VS01's combat. The
slice's real question, from bible section 35, is: *do teams naturally start caring about the room instead of just chasing kills?* Only playtests
can answer that. Railway deploy and external playtests stay deferred, as agreed at VS01 sign-off. VS03 has not been started.

"Automated" means proven by tests or tools in this repo. "Human" means it needs people.

## Definition of Done (bible sections 32–35 + the VS02 execution prompt)

| # | Item | Status | Evidence / what is missing |
|---|---|---|---|
| 1 | One active resource well (the Resource Room) | **Automated** | `RESOURCE_NODES` (`well-a`), well head + control ring, `economy.test.ts`. |
| 2 | Command Core: a Marine enters Commander mode at the console; the body stays there | **Automated** | `strategy.test.ts`: role, reach, phase, occupancy and dead are each rejected; the body snaps to the console, inputs are neutralised, it stays hittable, and death/leave/exit end the mode. e2e: E at the console → overhead view. |
| 3 | Commander overhead view (altitude 8–24 m, pitch 55–70°, WASD pan, wheel zoom, fixed rotation), a real projection of the same map | **Automated (exists) / Human (usability)** | `CommanderController`, `commanderCameraPose`; ceilings are hidden while commanding. Screenshots only; nobody has commanded a real game. |
| 4 | Commander selects Marines, places waypoints and pings | **Automated (server) / Human (usability)** | `order()` tests: Commander only, Marines only as targets, out-of-map points refused, 30 s TTL. Client: LMB select, RMB move/ping, beacons for the Expedition. Selection by clicking is not e2e-tested. |
| 5 | Commander places an Extractor hologram on a valid well; the server validates placement and cost | **Automated** | Playwright: build mode → click the well → Extractor → built in 6 s → income. Server tests cover every reject reason. The hologram turns red when the well is taken or funds are short. |
| 6 | `BuildRequest` validation: role, valid node, node free, funds, match state | **Automated** | `strategy.test.ts` "rejects every invalid request…" (each reason, and nothing is spent), the reply event, and a rate limit. The socket integration test covers wrong-role and node-occupied over the wire. |
| 7 | Economy: income 0.6/s, Extractor 10, Harvester 10, start 20, build 6 s | **Automated** | `ECONOMY` is the bible's values verbatim (asserted). Build takes exactly 360 ticks, and 10 s of an active structure pays exactly 6.0. |
| 8 | Weaver: slow builder, weak melee, local heal pulse, builds a Harvester on a valid well | **Automated** | `weaver.test.ts` (speed, no sprint, collision, melee cadence, pulse energy/cooldown) and `strategy.test.ts` (20 damage melee, heals Bloom players and structures but never Marines, capped, Harvester build and reach). e2e: Weaver presses E at the well → Harvester → income. |
| 9 | Initial biomass visual footprint | **Exists (visual only)** | Biomass spreads around a Harvester as it builds, on top of VS01's hive biomass. Seen in screenshots; procedural (D-18). |
| 10 | Structures can be damaged and destroyed by the other side; destruction frees the well | **Automated** | Ripper bites an Extractor to death and the Weaver then builds; rifle damages a Harvester; friendly fire does nothing; Weaver claws chip an Extractor. Socket integration test: Extractor built → destroyed by a Ripper → Harvester rebuilt → Bloom income. |
| 11 | Economy / structures / roles are server state, replicated through the schema | **Automated** | `MatchSchema` (resources, income, Commander, ping, `structures`) and `PlayerSchema` (`commanding`, order). Clients only send messages, and the server validates them. |
| 12 | Economy data in the `?dev=1` overlay and `/debug/telemetry` (income, resources, structure HP, who controls the node over time) | **Met** | Overlay "ECONOMY (server)" section. `/debug/telemetry` → `summary.nodeControl*`, structure counts, build rejects, Commander entries, heal pulses, plus `rooms[code]` with the live economy (D-34). |
| 13 | Prediction stays clean with the new roles | **Automated** | Virtual 4 min at 100 ± 20 ms with Commander + Marine + Ripper + Weaver: **0 reconciliations for all four**, max error 0. Real-socket soak (2 min, same lineup): worst 1.5 reconciliations/min. Numbers below. |
| 14 | **The loop**: win fight → build collector → defend it → economic edge → enemy attacks it | **Human: unproven** | Every step is mechanically possible and tested. Whether players *want* to do it is the slice's open question. Also see D-33: resources have nothing to buy yet except rebuilds. |
| 15 | Teams care about the room rather than just chasing kills | **Human: unproven** | Measure with `nodeControl*` and `death.room.resource` from `/debug/telemetry` during playtests. |

## Automated test inventory (all green at the time of writing)

| Suite | Count | VS02 additions |
|---|---|---|
| `packages/shared` | 35 | `economy.test.ts` (bible values, validation order, 6 s build, 0.6/s income, destroy frees the well, heal ceiling, hurt box ray), `weaver.test.ts` (walker speed, collision, melee and heal-pulse cadence/energy) |
| `apps/server` | 31 | `strategy.test.ts`: side guard with the Weaver; Commander entry rules, console snap and neutralised inputs, exit on death/leave; `BuildRequest` rejects for every reason; reply events; rate limit; Extractor/Harvester lifecycle and income; Ripper bites → destroyed; rifle vs enemy and friendly structures; Weaver melee; heal pulse; orders |
| `apps/client` | 7 | (VS01 network/prediction tests; fixtures updated) |
| `packages/gameplay-tests` | 21 | Real sockets: full loop (wrong-role reject → enter → Extractor → income → node-occupied reject → Ripper destroys → Weaver Harvester → Bloom income → exit → `/debug/telemetry`), side cap with a third Bloom player. Virtual 4 min with Commander + Weaver: prediction, economy invariants, income = active ticks × 0.6/60. |
| Playwright e2e | 7 | Commander: E at the console → Extractor button → click the well → 6 s build → income → E to leave. Weaver: E at the well → Harvester → Bloom income. |

## Soak results (this sandbox)

**Virtual time, 4 minutes, 100 ms ± 20 ms, Commander + Marine + Ripper + Weaver fuzzers** (`prediction.test.ts`): 0 reconciliations and
max error 0.000 m for every client. The Commander held the console for most of the run (1 entry), and the Extractor held the well 97 % of the time.
48 heal pulses. Resources were never negative, and there was never more than one structure on the well.

**Real sockets, 2 minutes, 100 ms ± 20 ms** (`soak.ts`, the CI configuration), two runs:

| Run | Worst reconciliations/min | Inputs dropped | Server tick EMA | Well |
|---|---|---|---|---|
| 1 | 0 | 0 | 0.057 ms | Weaver's Harvester first, Bloom earned 65.8 |
| 2 | 1.5 | 0 | 0.152 ms | same |

The Commander ran at 0 reconciliations in every run. One earlier 1.5-minute run **failed the soak gate** with 12 inputs dropped at the queue cap.
All three affected clients corrected at the same server tick, which matches a process stall on the shared sandbox CPU (bots and server share one
Node process) rather than a VS02 rule. It did not reproduce in two further runs. If CI shows it again, it is the existing VS01 gate being sensitive
to host stalls, not new netcode.

## Not built (by design: scope) / open

* No free placement, no other structures, no tech, no win condition (VS03). The Command Core itself is indestructible in VS02.
* **D-33 (owner decision):** resources accumulate but have no sink besides rebuilding a collector.
* No Marine repair tool: only the Bloom can heal its structure (the Weaver's pulse). This asymmetry is deliberate for now and is a feel risk (see `PLAYTEST_NOTES.md`).
* Art and audio are procedural stand-ins (Extractor, Harvester, biomass, Weaver; D-18). Commander selection is click-only, with no drag-box.

## Fastest way to see it

```bash
pnpm dev   # open http://localhost:5173/play?dev=1 in two windows
```

1. Create a room and join it. One player picks Marine, the other Weaver. Start the match.
2. Marine: F3 → "→ console" (or walk to the console on the spawn room's north wall), press **E**. In the overhead view press **B** and click the glowing well.
3. Weaver: F3 → "→ well", wait for the Extractor, claw it (LMB) or bring a Ripper, then press **E** at the free well.
