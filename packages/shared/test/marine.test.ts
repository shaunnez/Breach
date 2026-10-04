import { describe, expect, it } from 'vitest';
import { MARINE, PlayerClass, SurfaceState, TICK_DT } from '../src/index';
import { Runner } from './helpers';

const marine = (x: number, z: number, yaw: number) => new Runner(PlayerClass.Marine, x, 0, z, yaw);

describe('marine movement', () => {
  it('accelerates to walk speed quickly and stops quickly', () => {
    const r = marine(6, 3, Math.PI); // facing +z (south) in the spawn room
    r.run(10, { moveZ: 1 }, false); // ~0.17 s
    expect(Math.hypot(r.s.vx, r.s.vz)).toBeGreaterThan(MARINE.walkSpeed * 0.9);
    r.run(30, { moveZ: 1 }, false);
    expect(Math.hypot(r.s.vx, r.s.vz)).toBeCloseTo(MARINE.walkSpeed, 2);
    r.run(10, {}, false); // release
    expect(Math.hypot(r.s.vx, r.s.vz)).toBeLessThan(0.01);
  });

  it('sprints to sprintSpeed and firing cancels sprint', () => {
    const r = marine(6, 2, Math.PI);
    r.run(30, { moveZ: 1, sprint: true }, false);
    expect(Math.hypot(r.s.vx, r.s.vz)).toBeCloseTo(MARINE.sprintSpeed, 1);
    r.step({ moveZ: 1, sprint: true, primary: true }, false);
    expect(r.s.sprinting).toBe(0);
  });

  it('backward and strafe are slower than forward', () => {
    const a = marine(6, 5, Math.PI);
    a.run(30, { moveZ: -1 }, false);
    expect(Math.hypot(a.s.vx, a.s.vz)).toBeCloseTo(MARINE.backwardSpeed, 1);
    const b = marine(6, 5, Math.PI);
    b.run(30, { moveX: 1 }, false);
    expect(Math.hypot(b.s.vx, b.s.vz)).toBeCloseTo(MARINE.strafeSpeed, 1);
  });

  it('never exceeds the legal per-tick displacement envelope', () => {
    const r = marine(6, 5, 0);
    let max = 0;
    for (let i = 0; i < 600; i++) {
      r.step({ moveZ: 1, moveX: Math.sin(i / 20), sprint: true, jump: i % 50 === 0, yaw: (i / 15) % 6 }, false);
      max = Math.max(max, r.out.moved);
    }
    expect(max).toBeLessThanOrEqual(MARINE.horizontalSpeedCap * TICK_DT + MARINE.jumpImpulse * TICK_DT + 1e-6);
  });

  it('is stopped by walls', () => {
    const r = marine(6, 5, Math.PI); // run south into the spawn south wall (door at x 4.8..7.2: go off-centre)
    r.s.px = 3.0;
    r.run(240, { moveZ: 1 }, false);
    expect(r.s.pz).toBeLessThan(9 - MARINE.colliderRadius + 1e-3);
  });

  it('jumps ~0.93 m and lands', () => {
    const r = marine(6, 4, 0);
    r.step({ jump: true }, false);
    let apex = 0;
    for (let i = 0; i < 80; i++) {
      r.step({}, false);
      apex = Math.max(apex, r.s.py);
    }
    expect(apex).toBeGreaterThan(0.85);
    expect(apex).toBeLessThan(1.0);
    expect(r.s.surface).toBe(SurfaceState.Ground);
    expect(r.s.py).toBeCloseTo(0, 3);
  });

  it('walks up the 0.325 m resource-room stairs to the ledge and cannot jump onto the 1.5 m cover block', () => {
    // stairs rise towards -z along the east wall (x 34.8..36), ledge top y=2.6
    const r = marine(35.4, 17.5, 0); // facing -z
    r.run(220, { moveZ: 1 }, false);
    expect(r.s.py).toBeGreaterThan(2.5);
    const j = marine(6, 24, 0); // junction, facing -z towards the 1.5 m block at z 20.2..21.8
    for (let i = 0; i < 200; i++) j.step({ moveZ: 1, jump: true }, false);
    expect(j.s.py).toBeLessThan(0.1);
  });

  it('cannot enter the vent mouth in the junction wall', () => {
    const r = marine(8.6, 22.4, -Math.PI / 2); // facing east at the mouth (mouth bottom 2.775 m up)
    r.run(240, { moveZ: 1, jump: true }, false);
    expect(r.s.px).toBeLessThan(10);
  });
});
