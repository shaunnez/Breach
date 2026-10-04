import { describe, expect, it } from 'vitest';
import { PlayerClass, RIPPER, SurfaceState, wrapAngle, classifySurface, surfaceFrame } from '../src/index';
import { Runner } from './helpers';

const ripper = (x: number, y: number, z: number, yaw: number) => new Runner(PlayerClass.Ripper, x, y, z, yaw);
const EAST = -Math.PI / 2;

describe('ripper surface classification', () => {
  it('classifies synthetic normals', () => {
    expect(classifySurface(1)).toBe(SurfaceState.Ground);
    expect(classifySurface(0)).toBe(SurfaceState.Wall);
    expect(classifySurface(-1)).toBe(SurfaceState.Ceiling);
    expect(classifySurface(0.71)).toBe(SurfaceState.Ground);
    expect(classifySurface(0.69)).toBe(SurfaceState.Wall);
  });
  it('W climbs a wall when looking into it and follows horizon look otherwise', () => {
    const f = surfaceFrame({ x: -1, y: 0, z: 0 }, EAST, 0); // facing a wall dead on
    expect(f.tf.y).toBeCloseTo(1, 3);
    const g = surfaceFrame({ x: -1, y: 0, z: 0 }, 0, 0); // looking along the wall (-z)
    expect(g.tf.z).toBeCloseTo(-1, 3);
    const c = surfaceFrame({ x: 0, y: -1, z: 0 }, EAST, 0); // ceiling, looking east
    expect(c.tf.x).toBeCloseTo(1, 3);
  });
});

describe('ripper traversal', () => {
  it('runs on the ground at ground speed', () => {
    const r = ripper(11, 0.29, 19.2, EAST);
    r.run(30, { moveZ: 1 });
    expect(r.s.surface).toBe(SurfaceState.Ground);
    expect(Math.hypot(r.s.vx, r.s.vz)).toBeCloseTo(RIPPER.groundSpeed, 1);
  });

  it('floor -> wall -> ceiling -> far wall without scripted rails', () => {
    const r = ripper(3.4, 0.29, 23, EAST);
    const seen = new Set<SurfaceState>();
    r.run(200, { moveZ: 1 }, true);
    r.log.forEach((l) => l.attached !== -1 && seen.add(l.attached as SurfaceState));
    expect(seen.has(SurfaceState.Wall)).toBe(true);
    expect(seen.has(SurfaceState.Ceiling)).toBe(true);
    // never exceeds the traversal cap while attached
    expect(Math.hypot(r.s.vx, r.s.vy, r.s.vz)).toBeLessThanOrEqual(RIPPER.maxTraversalSpeed + 1e-6);
  });

  it('wall attach needs speed: a slow crawl into a wall does not climb', () => {
    const r = ripper(8.6, 0.29, 23, EAST);
    for (let i = 0; i < 120; i++) r.step({ moveZ: 0.25 }, false);
    expect(r.s.surface).toBe(SurfaceState.Ground);
    expect(r.s.py).toBeLessThan(0.4);
  });

  it('leap costs energy, respects cooldown, regenerates after a delay and travels 7-9 m with a slight upward aim', () => {
    const r = ripper(10.8, 0.29, 20, EAST);
    r.run(30, { moveZ: 1 }, false);
    const x0 = r.s.px;
    r.step({ moveZ: 1, jump: true, pitch: 0.16 }, false);
    expect(r.out.leaped).toBe(true);
    expect(r.s.energy).toBeCloseTo(75, 3);
    let t = 0;
    while (r.s.surface === SurfaceState.Air && t < 200) {
      r.step({ moveZ: 1, pitch: 0.16 }, false);
      t++;
    }
    const dist = r.s.px - x0;
    expect(dist).toBeGreaterThan(7);
    expect(dist).toBeLessThan(10.5);
    // cooldown: immediate second leap refused
    r.step({ jump: false }, false);
    r.step({ jump: true }, false);
    expect(r.out.leaped).toBe(false);
    // energy regen after delay
    const e = r.s.energy;
    r.run(90, {}, false);
    expect(r.s.energy).toBeGreaterThan(e);
    expect(r.s.energy).toBeLessThanOrEqual(RIPPER.maxEnergy);
  });

  it('cannot leap without energy', () => {
    const r = ripper(6, 0.29, 5, 0);
    r.s.energy = 10;
    r.step({ jump: true }, false);
    expect(r.out.leaped).toBe(false);
  });

  it('enters the vent from the junction wall, takes both bends and exits into the hive', () => {
    const r = ripper(8.0, 0.29, 22.4, EAST);
    const wps: [number, number][] = [
      [19.0, 22.4],
      [19.0, 27.6],
      [26, 27.6],
    ];
    let wi = 0;
    let maxInside = 0;
    for (let t = 0; t < 700 && r.s.px < 25; t++) {
      if (r.s.px > 10.6 && wi < wps.length) {
        if (Math.hypot(wps[wi][0] - r.s.px, wps[wi][1] - r.s.pz) < 0.9) wi++;
        if (wi < wps.length) {
          const want = Math.atan2(-(wps[wi][0] - r.s.px), -(wps[wi][1] - r.s.pz));
          r.view.look(wrapAngle(want - r.view.yaw) * 0.6, 0);
        }
      }
      r.step({ moveZ: 1 });
      if (r.s.px > 11 && r.s.px < 23 && r.s.py > 2.7 && r.s.py < 3.9) maxInside = Math.max(maxInside, r.s.px);
    }
    expect(maxInside).toBeGreaterThan(22);
    expect(r.s.px).toBeGreaterThan(24);
    expect(wi).toBeGreaterThanOrEqual(2);
  });

  it('full loop: floor -> wall -> ceiling -> leap -> land -> vent, repeatedly', () => {
    for (let lap = 0; lap < 3; lap++) {
      const r = ripper(3.4, 0.29, 23, EAST);
      r.run(95, { moveZ: 1 }); // floor -> wall -> ceiling
      expect(r.s.surface).toBe(SurfaceState.Ceiling);
      r.step({ moveZ: 1, jump: true, pitch: -0.2 });
      expect(r.out.leaped).toBe(true);
      let t = 0;
      while (r.s.surface === SurfaceState.Air && t < 300) {
        r.step({ moveZ: 1 });
        t++;
      }
      expect(r.s.surface).not.toBe(SurfaceState.Air);
      expect(t).toBeLessThan(300);
    }
  });
});
