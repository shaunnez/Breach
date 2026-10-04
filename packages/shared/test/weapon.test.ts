import { describe, expect, it } from 'vitest';
import { PlayerClass, RIFLE, BITE, FIRE_PERIOD_TICKS, RELOAD_DURATION_TICKS, BITE_COOLDOWN_TICKS, shotRay, hurtCapsule } from '../src/index';
import { Runner } from './helpers';

describe('weapons', () => {
  it('fires at exactly 600 RPM', () => {
    expect(FIRE_PERIOD_TICKS).toBe(6);
    const r = new Runner(PlayerClass.Marine, 6, 0, 4, 0);
    let shots = 0;
    for (let i = 0; i < 60; i++) {
      r.step({ primary: true }, false);
      if (r.out.fired) shots++;
    }
    expect(shots).toBe(10);
  });

  it('empties the magazine, auto-reloads, and cannot fire while reloading', () => {
    const r = new Runner(PlayerClass.Marine, 6, 0, 4, 0);
    let shots = 0;
    let reloadStartedAt = -1;
    for (let i = 0; i < 600; i++) {
      r.step({ primary: true }, false);
      if (r.out.fired) shots++;
      if (r.out.reloadStarted && reloadStartedAt < 0) reloadStartedAt = i;
    }
    expect(RELOAD_DURATION_TICKS).toBe(129);
    expect(reloadStartedAt).toBeGreaterThanOrEqual(RIFLE.magazine * FIRE_PERIOD_TICKS - FIRE_PERIOD_TICKS);
    // after 30 shots there must be a pause of at least the reload duration
    const fireTicks = r.log.map((l, i) => (l.fired ? i : -1)).filter((i) => i >= 0);
    const gap = fireTicks[RIFLE.magazine] - fireTicks[RIFLE.magazine - 1];
    expect(gap).toBeGreaterThanOrEqual(RELOAD_DURATION_TICKS);
    expect(r.s.ammo + r.s.reserve + shots).toBe(RIFLE.magazine + RIFLE.reserve);
    expect(r.s.ammo).toBeGreaterThanOrEqual(0);
  });

  it('manual reload transfers ammo and honours the reserve', () => {
    const r = new Runner(PlayerClass.Marine, 6, 0, 4, 0);
    r.run(6, { primary: true }, false); // fires 1
    r.run(1, { reload: true }, false);
    r.run(RELOAD_DURATION_TICKS + 2, {}, false);
    expect(r.s.ammo).toBe(RIFLE.magazine);
    expect(r.s.reserve).toBe(RIFLE.reserve - 1);
  });

  it('spread is deterministic per (seed, shot) and bounded by the bloom cap', () => {
    const r = new Runner(PlayerClass.Marine, 6, 0, 4, 0);
    const a = shotRay(r.s, 3, 1.2);
    const b = shotRay(r.s, 3, 1.2);
    expect(a.dir).toEqual(b.dir);
    const fwd = shotRay(r.s, 0, 0).dir;
    for (let i = 0; i < 200; i++) {
      const d = shotRay(r.s, i, RIFLE.bloomCapDeg).dir;
      const ang = Math.acos(Math.min(1, d.x * fwd.x + d.y * fwd.y + d.z * fwd.z));
      expect(ang).toBeLessThanOrEqual((RIFLE.bloomCapDeg * Math.PI) / 180 + 1e-6);
    }
  });

  it('bite cadence is 0.55 s', () => {
    expect(BITE_COOLDOWN_TICKS).toBe(33);
    const r = new Runner(PlayerClass.Ripper, 6, 0.29, 4, 0);
    const at: number[] = [];
    for (let i = 0; i < 100; i++) {
      r.step({ primary: true }, false);
      if (r.out.bit) at.push(i);
    }
    expect(at.slice(1).map((v, i) => v - at[i])).toEqual(at.slice(1).map(() => 33));
    expect(BITE.damage * 3).toBeGreaterThanOrEqual(150);
  });

  it('hurt capsules exist for both classes', () => {
    const m = new Runner(PlayerClass.Marine, 6, 0, 4, 0);
    expect(hurtCapsule(m.s).b.y).toBeGreaterThan(1.3);
    const rp = new Runner(PlayerClass.Ripper, 6, 0.29, 4, 0);
    expect(hurtCapsule(rp.s).r).toBeGreaterThan(0.3);
  });
});
