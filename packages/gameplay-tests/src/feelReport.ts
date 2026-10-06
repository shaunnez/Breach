/** Prints measured movement/combat baselines for docs/PLAYTEST_NOTES.md. `pnpm --filter @breach/gameplay-tests feel` */
import { BITE, MARINE, PlayerClass, RIFLE, RIPPER, SurfaceState, TICK_DT, wrapAngle } from '@breach/shared';
import { Runner } from '../../shared/test/helpers';

const EAST = -Math.PI / 2;
const rows: [string, string][] = [];
const add = (k: string, v: string) => rows.push([k, v]);
const f = (n: number, d = 2) => n.toFixed(d);

// Marine
{
  const r = new Runner(PlayerClass.Marine, 6, 0, 2, Math.PI);
  let t = 0;
  while (Math.hypot(r.s.vx, r.s.vz) < MARINE.walkSpeed * 0.95 && t < 100) { r.step({ moveZ: 1 }, false); t++; }
  add('Marine: time to 95% walk speed', `${f(t * TICK_DT * 1000, 0)} ms`);
  r.run(20, { moveZ: 1 }, false);
  t = 0;
  while (Math.hypot(r.s.vx, r.s.vz) > 0.05 && t < 100) { r.step({}, false); t++; }
  add('Marine: stop time from walk speed', `${f(t * TICK_DT * 1000, 0)} ms`);
  const j = new Runner(PlayerClass.Marine, 6, 0, 4, 0);
  j.step({ jump: true }, false);
  let apex = 0; let air = 1;
  while (j.s.surface === SurfaceState.Air && air < 200) { j.step({}, false); apex = Math.max(apex, j.s.py); air++; }
  add('Marine: jump apex / air time', `${f(apex)} m / ${f(air * TICK_DT)} s`);
}

// Ripper
{
  const r = new Runner(PlayerClass.Ripper, 11, 0.29, 19.2, EAST);
  let t = 0;
  while (Math.hypot(r.s.vx, r.s.vz) < RIPPER.groundSpeed * 0.95 && t < 100) { r.step({ moveZ: 1 }, false); t++; }
  add('Ripper: time to 95% ground speed', `${f(t * TICK_DT * 1000, 0)} ms`);

  const w = new Runner(PlayerClass.Ripper, 3.4, 0.29, 23, EAST);
  let tFloorWall = -1; let tCeil = -1; let vMinWall = 99;
  for (let i = 0; i < 200; i++) {
    w.step({ moveZ: 1 });
    if (tFloorWall < 0 && w.s.surface === SurfaceState.Wall) tFloorWall = i;
    if (tFloorWall >= 0 && w.s.surface === SurfaceState.Wall) vMinWall = Math.min(vMinWall, Math.hypot(w.s.vx, w.s.vy, w.s.vz));
    if (tCeil < 0 && w.s.surface === SurfaceState.Ceiling) tCeil = i;
  }
  add('Ripper: floor -> wall attach / wall -> ceiling (junction east wall, from a 3.4 m run-up)', `tick ${tFloorWall} / tick ${tCeil}; min wall speed ${f(vMinWall, 1)} m/s`);

  for (const pitch of [0, 0.1, 0.16, 0.2, 0.3]) {
    const run = new Runner(PlayerClass.Ripper, 10.8, 0.29, 20, EAST);
    run.run(30, { moveZ: 1 }, false);
    const x0 = run.s.px;
    run.step({ moveZ: 1, jump: true, pitch }, false);
    let air = 1; let maxY = run.s.py;
    while (run.s.surface === SurfaceState.Air && air < 200) { run.step({ moveZ: 1, pitch }, false); air++; maxY = Math.max(maxY, run.s.py); }
    const st = new Runner(PlayerClass.Ripper, 10.8, 0.29, 20, EAST);
    st.step({ jump: true, pitch }, false);
    let a2 = 1;
    const sx0 = st.s.px;
    while (st.s.surface === SurfaceState.Air && a2 < 200) { st.step({ pitch }, false); a2++; }
    add(`Ripper: leap, aim ${f(pitch * 57.3, 0)}° up, running / standing`, `${f(run.s.px - x0, 1)} m (${f(air * TICK_DT)} s, apex ${f(maxY - 0.29)} m) / ${f(st.s.px - sx0 + 0.0, 1)} m`);
  }
  const e = new Runner(PlayerClass.Ripper, 6, 0.29, 5, 0);
  let leaps = 0;
  for (let i = 0; i < 600; i++) { e.step({ jump: i % 2 === 0 }, false); if (e.out.leaped) leaps++; if (leaps === 4) break; }
  add('Ripper: energy', `${RIPPER.leapEnergyCost} per leap, ${RIPPER.maxEnergy / RIPPER.leapEnergyCost} full-bar leaps, ${f(RIPPER.maxEnergy / RIPPER.energyRegenPerSec + RIPPER.energyRegenDelaySec, 1)} s to refill; cooldown ${RIPPER.leapCooldownSec} s dominates (${f(1 / RIPPER.leapCooldownSec, 2)} leaps/s max)`);

  const v = new Runner(PlayerClass.Ripper, 8.0, 0.29, 22.4, EAST);
  const wps: [number, number][] = [[19, 22.4], [19, 27.6], [26, 27.6]];
  let wi = 0; let tEnter = -1; let tExit = -1;
  for (let i = 0; i < 800 && v.s.px < 25; i++) {
    if (v.s.px > 10.6 && wi < wps.length) {
      if (Math.hypot(wps[wi][0] - v.s.px, wps[wi][1] - v.s.pz) < 0.9) wi++;
      if (wi < wps.length) v.view.look(wrapAngle(Math.atan2(-(wps[wi][0] - v.s.px), -(wps[wi][1] - v.s.pz)) - v.view.yaw) * 0.6, 0);
    }
    v.step({ moveZ: 1 });
    if (tEnter < 0 && v.s.px > 10.5 && v.s.py > 2.7) tEnter = i;
    if (tExit < 0 && v.s.px > 24.3) tExit = i;
  }
  add('Ripper: vent (junction mouth -> hive), 19.4 m, two bends', `${f((tExit - tEnter) * TICK_DT, 1)} s inside at ~${f(19.4 / ((tExit - tEnter) * TICK_DT), 1)} m/s average`);
}

// TTK
add('Marine rifle TTK vs Ripper (perfect aim)', `${Math.ceil(RIPPER.health / RIFLE.damage)} hits = ${f((Math.ceil(RIPPER.health / RIFLE.damage) - 1) / (RIFLE.rpm / 60))} s after the first hit`);
add('Ripper bite TTK vs full Marine', `${Math.ceil((MARINE.health + MARINE.armour) / BITE.damage)} bites = ${f((Math.ceil((MARINE.health + MARINE.armour) / BITE.damage) - 1) * BITE.cooldownSec)} s after the first bite`);
console.log('| Measurement | Value |\n|---|---|');
for (const [k, val] of rows) console.log(`| ${k} | ${val} |`);
