import { describe, expect, it } from 'vitest';
import { BITE, MARINE, MATCH, PlayerClass, RIFLE, RIPPER, emptyInput, secToTicks, viewDir, type InputFrame } from '@breach/shared';
import { Simulation, type ServerPlayer } from '../src/simulation/Simulation';

function setup() {
  const sim = new Simulation();
  const m = sim.addPlayer('m', 'Marine', PlayerClass.Marine, 0);
  const r = sim.addPlayer('r', 'Ripper', PlayerClass.Ripper, 1);
  sim.startMatch();
  m.protectedUntilTick = 0;
  r.protectedUntilTick = 0;
  return { sim, m, r };
}
const place = (p: ServerPlayer, x: number, y: number, z: number, yaw: number) => {
  p.sim.px = x;
  p.sim.py = y;
  p.sim.pz = z;
  p.sim.yaw = yaw;
  p.sim.vx = p.sim.vy = p.sim.vz = 0;
};
let seqs: Record<string, number> = {};
const frame = (id: string, patch: Partial<InputFrame>): InputFrame => {
  seqs[id] = (seqs[id] ?? 0) + 1;
  return { ...emptyInput(seqs[id]), ...patch };
};
/** feed one frame per tick for n ticks */
const hold = (sim: Simulation, id: string, n: number, patch: Partial<InputFrame> | ((i: number) => Partial<InputFrame>)) => {
  for (let i = 0; i < n; i++) {
    sim.receiveInputs(id, [frame(id, typeof patch === 'function' ? patch(i) : patch)]);
    sim.step();
  }
};
const EAST = -Math.PI / 2;

describe('rifle', () => {
  it('twelve hits kill a ripper (120 HP / 10 dmg), server-side, emitting hit + death events', () => {
    seqs = {};
    const { sim, m, r } = setup();
    place(m, 11, 0, 19.2, EAST);
    place(r, 17, 0.29, 19.2, 0);
    const pitch = -Math.atan2(MARINE.eyeHeight - 0.29, 6);
    let hits = 0;
    let killed = false;
    for (let i = 0; i < 200 && !killed; i++) {
      hold(sim, 'm', 1, { yaw: EAST, pitch, primary: true });
      for (const { ev } of sim.drainEvents()) {
        if (ev.t === 'hit') hits++;
        if (ev.t === 'death') killed = true;
      }
    }
    expect(killed).toBe(true);
    expect(hits).toBe(Math.ceil(RIPPER.health / RIFLE.damage));
    expect(r.alive).toBe(false);
    expect(m.kills).toBe(1);
    expect(r.deaths).toBe(1);
    expect(m.damage).toBe(RIPPER.health);
  });

  it('is blocked by world geometry and does not damage through walls', () => {
    seqs = {};
    const { sim, m, r } = setup();
    place(m, 2.5, 0, 5, 0); // marine spawn room, ripper in the corridor beyond the (off-centre) wall
    place(r, 6, 0.29, 12, 0);
    const toR = Math.atan2(-(r.sim.px - m.sim.px), -(r.sim.pz - m.sim.pz));
    hold(sim, 'm', 40, { yaw: toR, pitch: -0.15, primary: true });
    expect(r.health).toBe(RIPPER.health);
  });

  it('never allows more than 600 RPM even when a client floods inputs', () => {
    seqs = {};
    const { sim, m } = setup();
    place(m, 11, 0, 19.2, EAST);
    let shots = 0;
    let s = 0;
    for (let t = 0; t < 60; t++) {
      const batch: InputFrame[] = [];
      for (let k = 0; k < 8; k++) batch.push({ ...emptyInput(++s), yaw: EAST, primary: true });
      sim.receiveInputs('m', batch);
      sim.step();
      shots += sim.drainEvents().filter((e) => e.ev.t === 'fire').length;
    }
    expect(shots).toBeLessThanOrEqual(11);
    expect(m.sim.shotCount).toBeLessThanOrEqual(11);
  });

  it('no friendly fire', () => {
    seqs = {};
    const sim = new Simulation();
    const a = sim.addPlayer('a', 'A', PlayerClass.Marine, 0);
    const b = sim.addPlayer('b', 'B', PlayerClass.Marine, 1);
    sim.startMatch();
    a.protectedUntilTick = b.protectedUntilTick = 0;
    place(a, 11, 0, 19.2, EAST);
    place(b, 15, 0, 19.2, 0);
    hold(sim, 'a', 30, { yaw: EAST, pitch: 0, primary: true });
    expect(b.health).toBe(MARINE.health);
    expect(b.armour).toBe(MARINE.armour);
  });
});

describe('bite and armour', () => {
  it('three bites kill a full marine; armour absorbs before health', () => {
    seqs = {};
    const { sim, m, r } = setup();
    place(r, 11, 0.29, 19.2, EAST);
    place(m, 12.2, 0, 19.2, 0);
    r.sim.pitch = 0;
    const log: { hp: number; ar: number }[] = [];
    for (let i = 0; i < 120 && m.alive; i++) {
      hold(sim, 'r', 1, { yaw: EAST, pitch: 0.02, primary: true });
      if (i % 33 === 0) log.push({ hp: m.health, ar: m.armour });
    }
    expect(m.alive).toBe(false);
    expect(log[1]).toEqual({ hp: MARINE.health - (BITE.damage - MARINE.armour), ar: 0 });
    expect(r.kills).toBe(1);
  });

  it('bite requires the target to be in reach, in the front arc and in line of sight', () => {
    seqs = {};
    const { sim, m, r } = setup();
    place(r, 11, 0.29, 19.2, EAST);
    place(m, 15, 0, 19.2, 0); // too far
    hold(sim, 'r', 3, { yaw: EAST, primary: true });
    expect(m.health).toBe(MARINE.health);
    // behind the ripper: outside the arc
    place(m, 9.9, 0, 19.2, 0);
    sim.drainEvents();
    hold(sim, 'r', 40, { yaw: EAST, primary: true });
    expect(m.health).toBe(MARINE.health);
    // through the wall
    place(r, 6, 0.29, 24.8, 0);
    place(m, 6, 0, 26.2, 0);
    hold(sim, 'r', 40, { yaw: 0, primary: true });
    expect(m.health).toBe(MARINE.health);
  });
});

describe('death, respawn, protection', () => {
  it('respawns after exactly 4 s with 1 s spawn protection, cancelled by attack input', () => {
    seqs = {};
    const { sim, m, r } = setup();
    place(m, 11, 0, 19.2, EAST);
    place(r, 17, 0.29, 19.2, 0);
    // kill with direct damage for speed
    const diedAt = sim.tick;
    sim.applyDamage(r, m, 9999, 'rifle', { x: 0, y: 0, z: 0 });
    expect(r.alive).toBe(false);
    expect(r.respawnAtTick - diedAt).toBe(secToTicks(MATCH.respawnSec));
    for (let i = 0; i < secToTicks(MATCH.respawnSec) - 1; i++) sim.step();
    expect(r.alive).toBe(false);
    sim.step();
    sim.step();
    expect(r.alive).toBe(true);
    expect(r.health).toBe(RIPPER.health);
    expect(r.protectedUntilTick).toBeGreaterThan(sim.tick);
    // protected: damage ignored
    expect(sim.applyDamage(r, m, 50, 'rifle', { x: 0, y: 0, z: 0 })).toBe(0);
    // attack input cancels protection
    hold(sim, 'r', 1, { primary: true });
    expect(r.protectedUntilTick).toBe(0);
    expect(sim.applyDamage(r, m, 50, 'rifle', { x: 0, y: 0, z: 0 })).toBe(50);
  });

  it('dead players ignore inputs and the server still acknowledges the sequence', () => {
    seqs = {};
    const { sim, m, r } = setup();
    sim.applyDamage(m, r, 9999, 'bite', { x: 0, y: 0, z: 0 });
    const x = m.sim.px;
    hold(sim, 'm', 10, { moveZ: 1 });
    expect(m.sim.px).toBe(x);
    expect(m.lastProcessedSeq).toBeGreaterThan(0);
  });

  it('a disconnected (seat-held) player is untouchable and frozen', () => {
    seqs = {};
    const { sim, m, r } = setup();
    place(m, 11, 0, 19.2, EAST);
    place(r, 17, 0.29, 19.2, 0);
    r.connected = false;
    const pitch = -Math.atan2(MARINE.eyeHeight - 0.29, 6);
    hold(sim, 'm', 40, { yaw: EAST, pitch, primary: true });
    expect(r.health).toBe(RIPPER.health);
  });
});

describe('lag compensation', () => {
  const EYE = MARINE.eyeHeight;
  const aim = (from: { x: number; z: number }, to: { x: number; z: number }) => {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(0.29 - EYE, Math.hypot(dx, dz)) };
  };
  /** ripper strafes east across the hive at 7 m/s; returns its position history per tick */
  const runRipper = (sim: Simulation, r: ServerPlayer) => {
    const hist: { x: number; z: number }[] = [];
    for (let i = 0; i < 90 && (hist.length < 12 || r.sim.px < 28.6); i++) {
      hold(sim, 'r', 1, { yaw: EAST, moveZ: 1 });
      hist.push({ x: r.sim.px, z: r.sim.pz });
    }
    return hist;
  };

  it('rewinds hurt volumes to what the shooter saw (rtt/2 + interpolation delay), within a 250 ms cap', () => {
    seqs = {};
    const { sim, m, r } = setup();
    place(m, 28.5, 0, 24.8, 0);
    place(r, 24.5, 0.29, 32.5, EAST);
    m.rttMs = 100; // expected rewind = 50 + 100 = 150 ms = 9 ticks
    const hist = runRipper(sim, r);
    const past = hist[hist.length - 1 - 9];
    const a = aim({ x: m.sim.px, z: m.sim.pz }, past);
    hold(sim, 'm', 1, { ...a, primary: true });
    expect(r.health).toBeLessThan(RIPPER.health);
  });

  it('a shot aimed at the target\'s current position misses a fast mover (proves rewind is applied, not ignored)', () => {
    seqs = {};
    const { sim, m, r } = setup();
    place(m, 28.5, 0, 24.8, 0);
    place(r, 24.5, 0.29, 32.5, EAST);
    m.rttMs = 0; // rewind = 100 ms interpolation delay -> target was 0.7 m further back
    const hist = runRipper(sim, r);
    const cur = hist[hist.length - 1];
    hold(sim, 'm', 1, { ...aim({ x: m.sim.px, z: m.sim.pz }, cur), primary: true });
    expect(r.health).toBe(RIPPER.health);
  });

  it('caps the rewind window at 250 ms no matter the claimed latency', () => {
    seqs = {};
    const { sim, m, r } = setup();
    place(r, 20, 0.29, 19.2, 0);
    for (let i = 0; i < 60; i++) hold(sim, 'r', 1, { yaw: EAST + Math.PI, moveZ: 1 });
    const cap = sim.rewoundCapsule(r, 100000);
    const capMax = sim.rewoundCapsule(r, 250);
    expect(cap).toEqual(capMax);
    void m;
  });
});

describe('input validation', () => {
  it('rejects malformed, stale and out-of-range input; clamps legal-looking abuse', () => {
    seqs = {};
    const { sim, m } = setup();
    sim.receiveInputs('m', [{ seq: 'x' }]);
    sim.receiveInputs('m', [{ ...emptyInput(1), yaw: NaN }]);
    sim.receiveInputs('m', 'nonsense');
    sim.receiveInputs('m', []);
    expect(m.queue.length).toBe(0);
    sim.receiveInputs('m', [{ ...emptyInput(5), moveZ: 1e9, moveX: -1e9, pitch: 99, yaw: 1000 }]);
    expect(m.queue.length).toBe(1);
    const q = m.queue[0].f;
    expect(Math.hypot(q.moveX, q.moveZ)).toBeLessThanOrEqual(1 + 1e-9);
    expect(Math.abs(q.pitch)).toBeLessThan(Math.PI / 2);
    expect(Math.abs(q.yaw)).toBeLessThanOrEqual(Math.PI);
    sim.receiveInputs('m', [{ ...emptyInput(5) }, { ...emptyInput(3) }]); // stale / replayed
    expect(m.queue.length).toBe(1);
    expect(sim.telemetry.counters.get('input.reject.stale-seq')).toBe(2);
    expect(sim.telemetry.counters.get('input.reject.malformed')).toBeGreaterThanOrEqual(3);
  });

  it('a speed-hacking client (more than 60 frames/s) cannot out-move an honest one', () => {
    seqs = {};
    const sim = new Simulation();
    const honest = sim.addPlayer('h', 'H', PlayerClass.Marine, 0);
    const cheat = sim.addPlayer('c', 'C', PlayerClass.Marine, 1);
    sim.startMatch();
    for (const p of [honest, cheat]) {
      p.protectedUntilTick = 0;
      place(p, p === honest ? 4 : 8, 0, 2, Math.PI);
    }
    let hs = 0;
    let cs = 0;
    for (let t = 0; t < 120; t++) {
      sim.receiveInputs('h', [{ ...emptyInput(++hs), moveZ: 1, yaw: Math.PI }]);
      const batch: InputFrame[] = [];
      for (let k = 0; k < 8; k++) batch.push({ ...emptyInput(++cs), moveZ: 1, yaw: Math.PI });
      sim.receiveInputs('c', batch);
      sim.step();
    }
    const frames = (p: ServerPlayer) => p.stats.ticksBySurface.reduce((a, b) => a + b, 0);
    expect(cheat.stats.inputsDropped + cheat.stats.rejectedInputs).toBeGreaterThan(0);
    expect(frames(cheat)).toBeLessThanOrEqual(frames(honest) + 5);
  });
});

describe('class guard and dev tools', () => {
  it('limits each class to two humans', () => {
    const sim = new Simulation();
    for (let i = 0; i < 3; i++) sim.addPlayer(`p${i}`, `P${i}`, PlayerClass.Marine, i);
    // p0,p1 marines; p2 (marine) must be refused the third marine seat when counted
    expect(sim.canTakeClass('p2', PlayerClass.Marine)).toBe(false);
    expect(sim.canTakeClass('p2', PlayerClass.Ripper)).toBe(true);
  });

  it('dev teleport / refill / dummy / reset work', () => {
    seqs = {};
    const { sim, m } = setup();
    sim.devAction('m', { action: 'teleport', room: 'hive' });
    expect(m.sim.pz).toBeGreaterThan(24);
    m.sim.ammo = 3;
    sim.devAction('m', { action: 'refill' });
    expect(m.sim.ammo).toBe(RIFLE.magazine);
    sim.devAction('m', { action: 'spawnDummy', cls: 1 });
    expect([...sim.players.values()].some((p) => p.isDummy)).toBe(true);
    sim.devAction('m', { action: 'reset' });
    expect([...sim.players.values()].some((p) => p.isDummy)).toBe(false);
  });
});

void viewDir;
