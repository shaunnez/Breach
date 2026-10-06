# PLAYTEST NOTES — VS01 Combat Truth Slice + VS02 Strategy Truth Slice

**Honest status: no human has played this build yet.** Everything below the "Measured baselines" heading was measured by
headless simulation or automated browser runs. The bible's core question — *is Marine vs Ripper genuinely fun, do testers keep
moving after the fight ends* — can only be answered by people. Section "How to run the first sessions" is the plan for that, and
the tuning log at the bottom is empty on purpose: **no constant from `config/balance.example.ts` has been changed.**

## Measured baselines (`pnpm --filter @breach/gameplay-tests feel`)

| Measurement | Value |
|---|---|
| Marine: time to 95% walk speed | 133 ms |
| Marine: stop time from walk speed | 133 ms |
| Marine: jump apex / air time | 0.98 m / 0.67 s |
| Ripper: time to 95% ground speed | 150 ms |
| Ripper: floor → wall attach / wall → ceiling (junction east wall, 3.4 m run-up) | tick 57 / tick 85; min wall speed 3.1 m/s |
| Ripper: leap, aim 0° up, running / standing | 5.0 m (0.37 s, apex 0.18 m) / 3.2 m |
| Ripper: leap, aim 6° up, running / standing | 7.2 m (0.52 s, apex 0.38 m) / 4.7 m |
| Ripper: leap, aim 9° up, running / standing | 8.5 m (0.62 s, apex 0.54 m) / 5.5 m |
| Ripper: leap, aim 11° up, running / standing | 9.3 m (0.67 s, apex 0.66 m) / 6.1 m |
| Ripper: leap, aim 17° up, running / standing | 11.0 m (0.80 s, apex 1.00 m) / 7.3 m |
| Ripper: energy | 25 per leap, 4 full-bar leaps, 5.5 s to refill; the 0.8 s cooldown dominates (max 1.25 leaps/s) |
| Ripper: vent (junction mouth → hive), 19.4 m, two bends | 3.0 s inside, ~6.5 m/s average |
| Marine rifle TTK vs Ripper (perfect aim) | 12 hits = 1.10 s after the first hit |
| Ripper bite TTK vs full Marine | 3 bites = 1.10 s after the first bite |

On paper the two kill times are symmetric (1.10 s each), which is a clean starting point: the fight is decided by who lands
the first hit, who misses, and who controls range. Expect Marine accuracy (spread 0.55–1.2°, hurt capsule r 0.4 m on a
small, fast target) and the Ripper's closing speed to decide it. The telemetry endpoint (`/debug/telemetry`) already
reports accuracy, bites per kill, mean encounter TTK, kill ratio and Ripper time on each surface.

Automated netcode numbers are in `docs/VS01_STATUS.md`.

## Known feel risks to look for first (my predictions, not observations)

1. **Ripper wall→ceiling control.** The view assist (D-15) turns the camera with the surface. If testers report disorientation,
   try `V` (off) and compare; if they report being unable to turn corners without it, the assist stays. Candidate tweaks:
   ease time constant (`SurfaceViewAssist.tau`, 70 ms), assist only on concave corners, or full surface-relative roll as the
   accessibility option the bible reserves for later.
2. **Wall stickiness. (Addressed 2026-10-06: hold F to cling.)** A Ripper that stops pressing W on a wall coasts for ~0.5 s (12 m/s² idle decel) and then drops at
   < 2 m/s. If ambush hangs on ceilings are wanted, lower `surfaceIdleDecel` / `minWallSustainSpeed`, (superseded: holding cling (F) now keeps the Ripper stationary on walls/ceilings).
3. **Leap length at level aim is 5 m** (7–9 m needs 6–11° of upward aim). If testers aim flat and find it short, raise
   `leapForwardImpulse` or lower `airGravity` rather than teaching an aim habit.
4. **Bite reach (1.35 m to target surface).** A 0.55 s cooldown with one chance per approach may feel punishing under 100 ms+
   RTT; the rewound sweep helps, but watch "bites per kill" in telemetry.
5. **Marine weapon readability.** Hit feedback waits for the server's confirmation (by design, bible section 26). At 100 ms RTT
   there is a ~100 ms gap between muzzle flash and hit marker.
6. **Open-room Marine advantage.** Hitscan at 0.55–1.2° spread against a 0.4 m-radius hurt capsule is close to 100% accurate when aimed; a
   Ripper closing 12 m of open floor at 7 m/s is exposed for ~1.7 s versus the 1.1 s the Marine needs. The Resource Room (12×10 m, well, ledge) is
   the likely Marine-favoured space; Junction corners and the Maintenance bend the Ripper-favoured ones. Watch kill ratio *by room*
   (`death.room.*` counters). Levers: Ripper speed/leap, rifle spread, cover density.
7. **Lighting/readability of the greybox** was tuned by eye from screenshots only (orange props, tinted rooms, violet vent strip).

## VS02 feel risks to look for first (my predictions, not observations)

VS02's question (bible section 35) is whether teams start caring about the room rather than only chasing kills. Watch `/debug/telemetry`
→ `summary.nodeControlExpedition/Bloom/None` and `counters["death.room.resource"]` alongside what people say.

1. **The money does nothing yet (D-33).** Income piles up with nothing to buy except a rebuild. Players may notice the number, shrug, and go
   back to deathmatch. If that happens, it is the strongest signal for a VS02-only sink, which needs an owner decision.
2. **Commander is a lonely job in 2v2.** Taking the console removes one of only two Marines from the fight, so the remaining Marine faces both
   Bloom players. Expect Commander time to be short or avoided at 2v2. Watch `command.enter` and how long sessions last. 3v3 (VS03) is where the role was designed to live.
3. **Commander body at the console is a free kill.** A Ripper who finds the console can kill the Commander. That is intended (bible: the body
   remains), but there is no warning to the Commander yet beyond the damage flash. Candidate: a HUD alarm when the body takes damage.
4. **Asymmetric upkeep.** The Weaver can heal its Harvester (60 per pulse); Marines cannot repair an Extractor. With 600 HP and a 6 s build, a lone
   Ripper kills an undefended Extractor in ~6 s of biting. Levers: `STRUCTURE.*Health`, `WEAVER.healPulseStructureAmount`, or a VS03 welder.
5. **Weaver may be boring to play.** It is slow (4.0 m/s), cannot climb, and its claw does 20. Its value is the Harvester and heals. If nobody
   picks it twice, buff its build role before its combat role.
6. **First come, first served.** Both sides start with 20 and the well is free, so whoever reaches it first claims it (the soak runs show the
   Weaver often wins the race). Watch whether the opening becomes a scripted rush.
7. **Overhead readability.** The greybox was designed for first person. From above, rooms are legible with ceilings hidden, but walls are tall
   and the 70° pitch may hide Marines near walls. Zoom and pan help. Screenshots only so far.

## How to run the first sessions (Definition of Done items 5, 13, 14)

1. Deploy (`docs/DEPLOYMENT.md`) and send the URL. Ask each tester to open the link, enter a name, and either create a room or paste the code.
2. 1v1 first (one Marine, one Ripper), swap sides after 10 minutes, then a 2v2 block. Keep the soft timer (10:00) as pacing only.
3. Observe silently for the first 5 minutes. Note: do they find the vent? do they leap on purpose? do they climb walls without being told?
   **After the fight ends, do they keep moving/climbing?** (That is the bible's test for Ripper fun.)
4. Ask: what felt good, what felt bad, what did you want to do and couldn't, would you play again right now? Ask Ripper players
   specifically about wall→ceiling transitions and whether they tried `V`.
5. Use `?dev=1` yourself in a *separate* room to reproduce complaints (simulated RTT slider, hurt volumes, surface probes).
6. Record results in the table below; change at most 2–3 constants between rounds and log each change here.

| Date | Testers (n) | Format | What felt good | What felt bad | Fun verdict ("play again?") | Constants changed |
|---|---|---|---|---|---|---|
| 2026-10-06 | 1 (project owner, solo, hands-on) | Ripper movement | Wall/ceiling climbing concept | Auto wall-attach caught the Ripper in doorways/under roofs; Ripper fell off walls when stationary; could not stop half-way up a wall | n/a (not a fun test) | Cling key (hold/toggle); no slow-detach while clinging; cling brakes on the spot (see tuning log) |

**VS02 sessions** (after VS01 is fun): 2v2 as Commander + Marine vs Ripper + Weaver, then swap. Ask: did you care about the well? Why did
you leave or defend it? Did the Commander feel useful or like a punishment? Did anyone pick the Weaver twice?

## Tuning log

| Date | Change | Why | Where |
|---|---|---|---|
| 2026-10-06 | **Wall/ceiling cling is now an explicit key** (hold **F**, or **T** to switch to toggle mode). Without it the Ripper only sticks to floors; walls/ceilings are neither attached to nor adhered to. | First hands-on feedback (project owner): auto-attach was janky, e.g. running through doorways or under roofs snapped the Ripper onto the frame. | `InputFrame.cling` (D-25), `ripper.ts` |
| 2026-10-06 | **Slow-speed wall detach (`minWallSustainSpeed`, 2 m/s) now only applies when cling is not held.** Holding cling lets the Ripper sit stationary on walls/ceilings (ambush hangs). | Owner feedback: Ripper fell off walls when stopped. Resolves known feel risk 2 ("add an explicit hold"). | `ripper.ts` |

| 2026-10-06 | **New `RIPPER_EXTRA.clingIdleDecel` = 40 m/s²** (was effectively `surfaceIdleDecel` 12 while clinging). Releasing W while holding cling now stops the Ripper within ~0.2 s, about 0.5–1 m past the release point. Without cling, walls keep the old 12 m/s² coast. | Owner feedback: you should be able to climb half-way up a wall and stop. Before this, a Ripper at wall speed (8 m/s) coasted ~2.7 m and ended at the ceiling corner, so it could never stop part-way. Verified in a browser test (stops 1.95 m up a 4.2 m wall, server agrees, 0 corrections). | `balance.ts`, `ripper.ts`, `ripper.test.ts`, e2e |

No constants in `config/balance.example.ts` or `RIPPER` have changed. The first two entries are input/rule changes; the third adds one extra constant (`RIPPER_EXTRA.clingIdleDecel`).

**VS02 starting values** (not yet tuned by people): bible economy verbatim (`ECONOMY`: income 0.6/s, Extractor 10, Harvester 10, start 20, build 6 s).
The extras are `STRUCTURE` (600 HP, starts at 25 % HP), `WEAVER` and `COMMAND`; see D-27 to D-29.

_(baseline values from `config/balance.example.ts` are in force; extras are in `RIPPER_EXTRA` / `RIFLE_EXTRA` and justified in DECISIONS.md D-14.)_
