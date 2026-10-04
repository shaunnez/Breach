import { describe, expect, it } from 'vitest';
import { PlayerClass, createPlayerSim, createTestCellA, emptyInput, SurfaceState } from '@breach/shared';
import { ClockSync } from '../src/game/network/ClockSync';
import { NetSim } from '../src/game/network/NetSim';
import { SnapshotBuffer } from '../src/game/network/SnapshotBuffer';
import { PredictionController } from '../src/game/network/PredictionController';
import type { PlayerSnapshot } from '../src/game/network/types';

const snap = (t: number, x: number, epoch = 1, alive = true): PlayerSnapshot => {
  const sim = createPlayerSim(PlayerClass.Marine, x, 0, 5, 0, 1);
  return { id: 'p', name: 'p', seat: 0, faction: 0, connected: true, host: false, dummy: false, alive, protected: false, epoch, sim, health: 100, armour: 50, ack: 0, respawnAtMs: 0, kills: 0, deaths: 0, damage: 0, rttMs: 0, pendingCls: 255, t };
};

describe('ClockSync', () => {
  it('recovers the server clock offset and RTT from symmetric samples', () => {
    const c = new ClockSync();
    // server clock = client clock + 5000; one-way 40 ms
    for (let i = 0; i < 20; i++) {
      const sent = 1000 + i * 1000;
      c.addSample(sent, sent + 80, sent + 40 + 5000);
    }
    expect(c.rtt).toBeCloseTo(80, 0);
    expect(c.serverNow(10_000)).toBeCloseTo(15_000, -1);
  });
});

describe('SnapshotBuffer', () => {
  it('interpolates between snapshots and extrapolates only briefly', () => {
    const b = new SnapshotBuffer();
    b.push(snap(1000, 0));
    b.push(snap(1050, 1));
    b.push(snap(1100, 2));
    expect(b.sample(1025)!.px).toBeCloseTo(0.5, 5);
    expect(b.sample(1075)!.px).toBeCloseTo(1.5, 5);
    expect(b.sample(900)!.px).toBe(0);
    const late = b.sample(1100 + 60)!;
    expect(late.starved).toBe(true);
    expect(late.px).toBe(2); // zero velocity in test snapshots
  });
  it('never interpolates across a respawn (epoch change) and ignores out-of-order snapshots', () => {
    const b = new SnapshotBuffer();
    b.push(snap(1000, 0, 1));
    b.push(snap(1050, 10, 2));
    b.push(snap(1040, 99, 2)); // stale
    expect(b.sample(1025)!.px).toBe(10);
    expect(b.latest()!.sim.px).toBe(10);
  });
});

describe('NetSim', () => {
  it('delays each direction by lag/2 and never reorders packets under jitter, even for same-millisecond timers', () => {
    // fake clock + fake timer wheel that deliberately fires same-due timers in REVERSE creation order
    let now = 0;
    const timers: { due: number; fn: () => void; id: number }[] = [];
    let id = 0;
    const sim = new NetSim({ lagMs: 100, jitterMs: 45 }, (fn, ms) => timers.push({ due: now + ms, fn, id: ++id }), () => now);
    const got: number[] = [];
    for (let i = 0; i < 200; i++) {
      now = i * 3;
      sim.up(() => got.push(i));
    }
    // advance time, firing due timers with the adversarial tie-break
    while (timers.length) {
      timers.sort((a, b) => a.due - b.due || b.id - a.id);
      const t = timers.shift()!;
      now = Math.max(now, t.due);
      t.fn();
    }
    expect(got).toEqual(Array.from({ length: 200 }, (_, i) => i));
    expect(now).toBeGreaterThanOrEqual(5 + 199 * 3 - 1);
  });
  it('passes straight through when no latency is configured', () => {
    const sim = new NetSim({ lagMs: 0, jitterMs: 0 });
    const got: number[] = [];
    sim.up(() => got.push(1));
    sim.up(() => got.push(2));
    expect(got).toEqual([1, 2]);
  });
});

describe('PredictionController', () => {
  it('replays unacknowledged inputs on top of a server state and smooths only the delta', () => {
    const world = createTestCellA();
    const start = createPlayerSim(PlayerClass.Marine, 6, 0, 3, Math.PI, 1);
    const c = new PredictionController(world, start);
    c.reset(start, 1, 0);
    const base = { ...emptyInput(0), moveZ: 1, yaw: Math.PI };
    for (let i = 0; i < 20; i++) c.predict(base);
    const predicted = c.sim.pz;
    // server says: at ack 10 you were 0.3 m behind where you predicted
    const server = { ...start };
    const at10 = c.history.find((h) => h.seq === 10)!.after;
    Object.assign(server, at10, { pz: at10.pz - 0.3 });
    const rep = c.onServerState(server as typeof start, 10, 1);
    expect(rep.reconciled).toBe(true);
    expect(rep.errorM).toBeCloseTo(0.3, 3);
    expect(rep.replayed).toBe(10);
    expect(c.sim.pz).toBeLessThan(predicted - 0.25);
    expect(c.correctionMagnitude).toBeGreaterThan(0.2); // visual offset keeps the old on-screen position
    for (let i = 0; i < 90; i++) c.smooth(1 / 60);
    expect(c.correctionMagnitude).toBeLessThan(0.01);
    expect(c.stats.reconciliations).toBe(1);
  });

  it('does not reconcile when the server agrees, and hard-snaps on epoch change', () => {
    const world = createTestCellA();
    const start = createPlayerSim(PlayerClass.Ripper, 6, 0.29, 3, 0, 1);
    const c = new PredictionController(world, start);
    c.reset(start, 1, 0);
    for (let i = 0; i < 10; i++) c.predict({ ...emptyInput(0), moveZ: 1 });
    const agree = c.history.find((h) => h.seq === 5)!.after;
    expect(c.onServerState(agree, 5, 1).reconciled).toBe(false);
    const respawn = createPlayerSim(PlayerClass.Ripper, 30, 0.29, 30, 0, 1);
    const rep = c.onServerState(respawn, 7, 2);
    expect(rep.hard).toBe(true);
    expect(c.sim.px).toBe(30);
    expect(c.unacked).toBe(0);
    expect(c.sim.surface).toBe(SurfaceState.Ground);
  });
});
