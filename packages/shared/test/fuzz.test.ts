import { describe, expect, it } from 'vitest';
import { BLOOM_SPAWNS, CollisionWorld, MAP_BOUNDS, MARINE, MARINE_SPAWNS, PlayerClass, RIPPER, RIPPER_EXTRA, createPlayerSim, emptyInput, newStepResult, stepPlayer, SurfaceViewAssist, clonePlayerSim, type PlayerSim } from '../src/index';
import { world } from './helpers';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Returns a description of the first violated invariant, or '' (plain loops: expect() per box per tick is far too slow). */
function violation(s: PlayerSim): string {
  if (!Number.isFinite(s.px + s.py + s.pz + s.vx + s.vy + s.vz + s.nx + s.ny + s.nz)) return 'non-finite state';
  if (s.px < MAP_BOUNDS.minX - 0.8 || s.px > MAP_BOUNDS.maxX + 0.8 || s.pz < MAP_BOUNDS.minZ - 0.8 || s.pz > MAP_BOUNDS.maxZ + 0.8) return `out of plan bounds (${s.px.toFixed(2)}, ${s.pz.toFixed(2)})`;
  if (s.py < -0.05 || s.py > 7) return `out of height bounds (${s.py.toFixed(2)})`;
  if (s.cls === PlayerClass.Marine) {
    const r = MARINE.colliderRadius;
    if (world.aabbBlocked(s.px - r + 2e-3, s.py + 2e-3, s.pz - r + 2e-3, s.px + r - 2e-3, s.py + MARINE.standingHeight - 2e-3, s.pz + r - 2e-3)) return 'marine inside geometry';
  } else {
    for (const b of world.boxes) {
      const c = CollisionWorld.contactWith(b, s.px, s.py, s.pz);
      if (c.dist < RIPPER.colliderRadius - 0.03) return `ripper penetrates ${b.kind} by ${(RIPPER.colliderRadius - c.dist).toFixed(3)}`;
    }
  }
  return '';
}

describe('physics fuzz: random inputs never break the controllers', () => {
  for (const cls of [PlayerClass.Marine, PlayerClass.Ripper]) {
    it(`${cls === PlayerClass.Marine ? 'marine' : 'ripper'}: 24 seeds x 3000 ticks`, () => {
      const out = newStepResult();
      let wallTicks = 0;
      let ceilTicks = 0;
      let maxSpeed = 0;
      const bad: string[] = [];
      for (let seed = 1; seed <= 24; seed++) {
        const r = rng(seed * 7919);
        const spawns = cls === PlayerClass.Marine ? MARINE_SPAWNS : BLOOM_SPAWNS;
        const sp = spawns[seed % spawns.length];
        const s = createPlayerSim(cls, sp.x, sp.y, sp.z, sp.yaw, seed);
        const view = new SurfaceViewAssist();
        view.reset(sp.yaw, 0);
        let yawRate = 0;
        let moveZ = 1;
        let moveX = 0;
        for (let t = 0; t < 3000; t++) {
          if (t % 20 === 0) {
            yawRate = (r() - 0.5) * 5;
            moveZ = r() < 0.85 ? 1 : r() < 0.5 ? 0 : -1;
            moveX = r() < 0.3 ? Math.round(r() * 2 - 1) : 0;
          }
          view.look(yawRate / 60, (r() - 0.5) * 0.03);
          const i = emptyInput(t + 1);
          i.yaw = view.yaw;
          i.pitch = view.pitch;
          i.moveZ = moveZ;
          i.moveX = moveX;
          i.jump = r() < 0.03;
          i.sprint = r() < 0.5;
          i.secondary = r() < 0.004;
          i.primary = r() < 0.2;
          i.reload = r() < 0.01;
          const prev = clonePlayerSim(s);
          stepPlayer(s, i, world, out);
          view.onTick(prev, s);
          view.update(1 / 60);
          const v = violation(s);
          if (v) bad.push(`seed ${seed} tick ${t}: ${v}`);
          const sp2 = Math.hypot(s.vx, s.vy, s.vz);
          maxSpeed = Math.max(maxSpeed, sp2);
          if (s.surface === 1) wallTicks++;
          if (s.surface === 2) ceilTicks++;
          if (out.moved >= 0.6) bad.push(`seed ${seed} tick ${t}: displacement ${out.moved}`);
        }
      }
      expect(bad.slice(0, 5)).toEqual([]);
      if (cls === PlayerClass.Ripper) {
        expect(wallTicks).toBeGreaterThan(5000);
        expect(ceilTicks).toBeGreaterThan(1000);
        expect(maxSpeed).toBeLessThan(RIPPER_EXTRA.airSpeedCap + RIPPER.leapForwardImpulse + 10);
      } else {
        expect(maxSpeed).toBeLessThan(MARINE.horizontalSpeedCap + MARINE.jumpImpulse + 8);
      }
    });
  }
});
