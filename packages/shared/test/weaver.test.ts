import { describe, expect, it } from 'vitest';
import { MARINE, PlayerClass, SurfaceState, WEAVER, factionOf, hurtCapsule, eyePosition, Faction } from '../src/index';
import { Runner } from './helpers';

describe('Weaver (bible section 34)', () => {
  it('is a Bloom ground walker, slower than a Marine, that cannot sprint', () => {
    expect(factionOf(PlayerClass.Weaver)).toBe(Faction.Bloom);
    const w = new Runner(PlayerClass.Weaver, 6, 0, 5, Math.PI);
    w.run(90, { moveZ: 1, sprint: true }, false);
    const sp = Math.hypot(w.s.vx, w.s.vz);
    expect(sp).toBeCloseTo(WEAVER.walkSpeed, 2);
    expect(sp).toBeLessThan(MARINE.walkSpeed);
    expect(w.s.sprinting).toBe(0);
    expect(w.s.surface).toBe(SurfaceState.Ground);
    expect(eyePosition(w.s).y).toBeCloseTo(w.s.py + WEAVER.eyeHeight);
    const c = hurtCapsule(w.s);
    expect(c.r).toBe(WEAVER.hurtRadius);
  });

  it('collides with walls using its own (wider) collider and does not climb', () => {
    const w = new Runner(PlayerClass.Weaver, 6, 0, 5, 0); // marine spawn room, facing north wall (z = 1)
    w.run(240, { moveZ: 1 }, false);
    expect(w.s.pz).toBeGreaterThan(1.6 + WEAVER.colliderRadius - 0.01); // stopped by the Command Core console front
    expect(w.s.py).toBeCloseTo(0, 3);
  });

  it('weak melee has its own cadence; heal pulse costs energy, has a cooldown, and regenerates', () => {
    const w = new Runner(PlayerClass.Weaver, 6, 0, 5, 0);
    let swings = 0;
    for (let i = 0; i < 120; i++) if (w.step({ primary: true }, false).bit) swings++;
    expect(swings).toBe(Math.ceil(120 / Math.round(WEAVER.meleeCooldownSec * 60)));
    expect(w.s.energy).toBe(WEAVER.maxEnergy);
    let pulses = 0;
    for (let i = 0; i < 60 * 4; i++) if (w.step({ secondary: true }, false).healPulse) pulses++;
    // 100 energy, 40 per pulse, 2 s cooldown, regen 12/s after 0.6 s idle: exactly two pulses (0 s and 2 s) in a 4 s hold
    expect(pulses).toBe(2);
    w.run(60 * 4, {}, false);
    expect(w.s.energy).toBeGreaterThan(WEAVER.healPulseCost);
    expect(w.step({ secondary: true }, false).healPulse).toBe(true);
  });
});
