import { describe, expect, it } from 'vitest';
import {
  BUILD_TICKS,
  COMMAND,
  COMMAND_CONSOLE,
  ECONOMY,
  Faction,
  PlayerClass,
  RESOURCE_NODES,
  RIFLE,
  RIPPER,
  STRUCTURE,
  StructureState,
  WEAVER,
  emptyInput,
  type GameEvent,
  type InputFrame,
} from '@breach/shared';
import { Simulation, type ServerPlayer } from '../src/simulation/Simulation';

const WELL = RESOURCE_NODES[0];
const EAST = -Math.PI / 2;
const WEST = Math.PI / 2;

let seq: Record<string, number> = {};
function frame(p: ServerPlayer, patch: Partial<InputFrame>): InputFrame {
  seq[p.id] = (seq[p.id] ?? 0) + 1;
  return { ...emptyInput(seq[p.id]), epoch: p.epoch, ...patch };
}
function hold(sim: Simulation, p: ServerPlayer, n: number, patch: Partial<InputFrame> = {}): GameEvent[] {
  const evs: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    sim.receiveInputs(p.id, [frame(p, patch)]);
    sim.step();
    evs.push(...sim.drainEvents().map((e) => e.ev));
  }
  return evs;
}
function idle(sim: Simulation, n: number): GameEvent[] {
  const evs: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    sim.step();
    evs.push(...sim.drainEvents().map((e) => e.ev));
  }
  return evs;
}
const place = (p: ServerPlayer, x: number, y: number, z: number, yaw = 0) => {
  Object.assign(p.sim, { px: x, py: y, pz: z, yaw, vx: 0, vy: 0, vz: 0 });
};

/** Marine "c", Marine "m", Ripper "r", Weaver "w" in a playing match, spawn protection off. */
function setup(start = true) {
  seq = {};
  const sim = new Simulation();
  const c = sim.addPlayer('c', 'Cmdr', PlayerClass.Marine, 0);
  const m = sim.addPlayer('m', 'Marine', PlayerClass.Marine, 1);
  const r = sim.addPlayer('r', 'Ripper', PlayerClass.Ripper, 2);
  const w = sim.addPlayer('w', 'Weaver', PlayerClass.Weaver, 3);
  if (start) sim.startMatch();
  for (const p of [c, m, r, w]) p.protectedUntilTick = 0;
  return { sim, c, m, r, w };
}
const atConsole = (p: ServerPlayer) => place(p, COMMAND_CONSOLE.standX, 0, COMMAND_CONSOLE.standZ + 0.4, 0);
const extractor = (requestId = 1, node = WELL.id) => ({ requestId, structure: 'extractor', resourceNodeId: node });
const harvester = (requestId = 1, node = WELL.id) => ({ requestId, structure: 'harvester', resourceNodeId: node });
const resultsFor = (sim: Simulation, id: string) =>
  sim
    .drainEvents()
    .filter((e) => e.to === id && e.ev.t === 'build-result')
    .map((e) => e.ev as Extract<GameEvent, { t: 'build-result' }>);

describe('class guard extended for the Weaver (D-31)', () => {
  it('counts Rippers and Weavers together: at most two Bloom humans', () => {
    const sim = new Simulation();
    sim.addPlayer('a', 'A', PlayerClass.Ripper, 0);
    sim.addPlayer('b', 'B', PlayerClass.Ripper, 1);
    sim.addPlayer('x', 'X', PlayerClass.Marine, 2);
    expect(sim.canTakeClass('x', PlayerClass.Weaver)).toBe(false);
    expect(sim.canTakeClass('a', PlayerClass.Weaver)).toBe(true); // switching within your own side
    expect(sim.setClass('a', PlayerClass.Weaver)).toBe(true);
    expect(sim.players.get('a')!.cls).toBe(PlayerClass.Weaver);
    expect(sim.players.get('a')!.health).toBe(WEAVER.health);
  });
});

describe('Commander mode (bible section 33)', () => {
  it('only a living Marine at the console, during play, with no other Commander, may enter', () => {
    const pre = setup(false);
    atConsole(pre.c);
    expect(pre.sim.enterCommand('c')).toBe('wrong-phase');

    const { sim, c, m, r } = setup();
    place(c, 6, 0, 6);
    expect(sim.enterCommand('c')).toBe('out-of-reach');
    place(r, COMMAND_CONSOLE.standX, 0.29, COMMAND_CONSOLE.standZ);
    expect(sim.enterCommand('r')).toBe('wrong-role');
    atConsole(c);
    expect(sim.enterCommand('c')).toBeNull();
    expect(c.commanding).toBe(true);
    expect(sim.commanderId).toBe('c');
    atConsole(m);
    expect(sim.enterCommand('m')).toBe('occupied');
    m.alive = false;
    expect(sim.enterCommand('m')).toBe('dead');
  });

  it('the body stays at the console: snapped, new epoch, movement/fire inputs neutralised', () => {
    const { sim, c } = setup();
    atConsole(c);
    const epoch = c.epoch;
    sim.enterCommand('c');
    expect(c.epoch).toBe((epoch + 1) & 0xffff);
    expect(c.sim.px).toBe(COMMAND_CONSOLE.standX);
    expect(c.sim.pz).toBe(COMMAND_CONSOLE.standZ);
    const evs = hold(sim, c, 120, { moveZ: 1, moveX: 1, sprint: true, jump: true, primary: true, yaw: 2 });
    expect(Math.hypot(c.sim.px - COMMAND_CONSOLE.standX, c.sim.pz - COMMAND_CONSOLE.standZ)).toBeLessThan(1e-9);
    expect(c.sim.yaw).toBe(COMMAND_CONSOLE.yaw);
    expect(evs.some((e) => e.t === 'fire')).toBe(false);
    expect(c.sim.ammo).toBe(RIFLE.magazine);
  });

  it('dying, leaving and the exit message all end Commander mode; the body is still hittable', () => {
    const { sim, c, r } = setup();
    atConsole(c);
    sim.enterCommand('c');
    sim.applyDamage(c, r, 10, 'bite', { x: 0, y: 0, z: 0 });
    expect(c.health + c.armour).toBe(140);
    sim.applyDamage(c, r, 999, 'bite', { x: 0, y: 0, z: 0 });
    expect(c.alive).toBe(false);
    expect(c.commanding).toBe(false);
    expect(sim.commanderId).toBe('');
    c.alive = true;
    atConsole(c);
    sim.enterCommand('c');
    sim.exitCommand('c');
    expect(sim.commanderId).toBe('');
    atConsole(c);
    sim.enterCommand('c');
    sim.removePlayer('c');
    expect(sim.commanderId).toBe('');
  });
});

describe('BuildRequest validation (bible section 33): role, node, occupancy, funds, phase', () => {
  it('rejects every invalid request with the specific reason and spends nothing', () => {
    const pre = setup(false);
    pre.c.commanding = true;
    pre.sim.commanderId = 'c';
    expect(pre.sim.requestBuild('c', extractor())).toBe('wrong-phase');

    const { sim, c, m, r, w } = setup();
    expect(sim.requestBuild('m', extractor())).toBe('wrong-role'); // a Marine not in Commander mode
    expect(sim.requestBuild('r', harvester())).toBe('wrong-role'); // Ripper cannot build
    atConsole(c);
    sim.enterCommand('c');
    expect(sim.requestBuild('c', harvester())).toBe('wrong-role'); // Commander builds Extractors only
    expect(sim.requestBuild('c', extractor(2, 'well-z'))).toBe('invalid-node');
    expect(sim.requestBuild('c', { requestId: 'x', structure: 'extractor', resourceNodeId: WELL.id })).toBe('malformed');
    expect(sim.requestBuild('c', { requestId: 3, structure: 'armoury', resourceNodeId: WELL.id })).toBe('malformed');
    place(w, 10, 0, 19);
    expect(sim.requestBuild('w', harvester())).toBe('out-of-reach');
    w.alive = false;
    expect(sim.requestBuild('w', harvester())).toBe('dead');
    w.alive = true;
    sim.econ.teams[Faction.Expedition].resources = ECONOMY.extractorCost - 0.01;
    expect(sim.requestBuild('c', extractor())).toBe('insufficient-resources');
    sim.econ.teams[Faction.Expedition].resources = 20;
    expect(sim.econ.structures).toHaveLength(0);

    expect(sim.requestBuild('c', extractor(7))).toBeNull();
    place(w, WELL.x - 2.4, 0, WELL.z);
    expect(sim.requestBuild('w', harvester())).toBe('node-occupied');
    expect(sim.requestBuild('c', extractor(8))).toBe('node-occupied');
    expect(sim.econ.teams[Faction.Expedition].resources).toBe(10);
    expect(sim.econ.teams[Faction.Bloom].resources).toBe(20);
    void m;
    void r;
  });

  it('replies to the requester with a build-result (accepted / rejected + reason)', () => {
    const { sim, c } = setup();
    sim.drainEvents();
    sim.requestBuild('c', extractor(41));
    expect(resultsFor(sim, 'c')).toEqual([{ t: 'build-result', requestId: 41, structure: 'extractor', ok: false, reason: 'wrong-role', structureId: '' }]);
    atConsole(c);
    sim.enterCommand('c');
    sim.drainEvents();
    sim.requestBuild('c', extractor(42));
    const [ok] = resultsFor(sim, 'c');
    expect(ok.ok).toBe(true);
    expect(ok.requestId).toBe(42);
    expect(ok.structureId).toMatch(/^extractor-/);
  });

  it('is rate limited (message flood cannot place or probe faster than the cap)', () => {
    const { sim } = setup();
    let answered = 0;
    for (let i = 0; i < 50; i++) if (sim.requestBuild('c', extractor(i)) !== null) answered++;
    expect(answered).toBe(COMMAND.msgPerSec);
  });
});

describe('structure lifecycle and income', () => {
  it('Commander Extractor: -10, 6 s build, then 0.6/s for the Expedition', () => {
    const { sim, c } = setup();
    atConsole(c);
    sim.enterCommand('c');
    sim.requestBuild('c', extractor());
    const st = sim.econ.structures[0];
    expect(st.state).toBe(StructureState.Building);
    expect(sim.econ.teams[Faction.Expedition].resources).toBe(10);
    const evs = idle(sim, BUILD_TICKS);
    expect(st.state).toBe(StructureState.Active);
    expect(evs.some((e) => e.t === 'structure' && e.kind === 'completed' && e.id === st.id)).toBe(true);
    idle(sim, 60 * 10);
    expect(sim.econ.teams[Faction.Expedition].resources).toBeCloseTo(16, 5);
    expect(sim.econ.teams[Faction.Bloom].resources).toBe(20);
    expect(sim.telemetry.counters.get('node.ticks.expedition')).toBe(601); // the completion tick + 10 s
  });

  it('Weaver Harvester at the well, then income for the Bloom', () => {
    const { sim, w } = setup();
    place(w, WELL.x - 2.4, 0, WELL.z, EAST);
    expect(sim.requestBuild('w', harvester())).toBeNull();
    idle(sim, BUILD_TICKS + 60 * 5);
    expect(sim.econ.teams[Faction.Bloom].resources).toBeCloseTo(10 + 3, 5);
  });
});

describe('structures are contested: damaged and destroyed by the other side', () => {
  it('Rippers can bite an Extractor to death, freeing the well; the Bloom can then build', () => {
    const { sim, c, r, w } = setup();
    atConsole(c);
    sim.enterCommand('c');
    sim.requestBuild('c', extractor());
    idle(sim, BUILD_TICKS);
    const st = sim.econ.structures[0];
    place(r, WELL.x - STRUCTURE.hurtHalf - 1.15, 0.29, WELL.z, EAST);
    let destroyed = false;
    for (let i = 0; i < 60 * 12 && !destroyed; i++) {
      const evs = hold(sim, r, 1, { primary: true, yaw: EAST, pitch: 0 });
      destroyed = evs.some((e) => e.t === 'structure' && e.kind === 'destroyed');
    }
    expect(destroyed).toBe(true);
    expect(Math.ceil(STRUCTURE.extractorHealth / 55)).toBe(11);
    expect(r.stats.structureDamage).toBeCloseTo(st.maxHp);
    expect(sim.econ.structures).toHaveLength(0);
    place(w, WELL.x - 2.4, 0, WELL.z, EAST);
    expect(sim.requestBuild('w', harvester())).toBeNull();
  });

  it('rifle fire damages an enemy Harvester; friendly structures stop rounds but take no damage', () => {
    const { sim, c, m, w } = setup();
    place(w, WELL.x - 2.4, 0, WELL.z, EAST);
    sim.requestBuild('w', harvester());
    idle(sim, BUILD_TICKS);
    const h = sim.econ.structures[0];
    place(m, 24.6, 0, WELL.z, EAST);
    place(w, 10, 0, 19); // out of the line of fire
    const evs = hold(sim, m, 60, { primary: true, yaw: EAST, pitch: 0 });
    const fires = evs.filter((e) => e.t === 'fire');
    expect(fires.length).toBe(10);
    expect(fires.every((e) => e.t === 'fire' && e.hit === 3)).toBe(true);
    expect(h.hp).toBeCloseTo(h.maxHp - 10 * RIFLE.damage);

    // a destroyed harvester, then the Commander's own extractor in the same spot: friendly rounds do nothing
    sim.econ.structures.length = 0;
    atConsole(c);
    sim.enterCommand('c');
    sim.requestBuild('c', extractor());
    idle(sim, BUILD_TICKS);
    const e = sim.econ.structures[0];
    hold(sim, m, 60, { primary: true, yaw: EAST, pitch: 0 });
    expect(e.hp).toBe(e.maxHp);
  });

  it('Weaver melee is weak: 20 damage to a Marine, and it can chip an Extractor', () => {
    const { sim, c, m, w } = setup();
    place(m, 12, 0, 19.2);
    place(w, 11, 0, 19.2, EAST);
    idle(sim, 10); // hits are lag-compensated: let the history catch up with the teleport
    hold(sim, w, 1, { primary: true, yaw: EAST, pitch: 0 });
    expect(m.armour + m.health).toBe(150 - WEAVER.meleeDamage);
    atConsole(c);
    sim.enterCommand('c');
    sim.requestBuild('c', extractor());
    hold(sim, w, BUILD_TICKS); // cooldowns advance per simulated input frame, so keep feeding the Weaver
    place(w, WELL.x - 2.0, 0, WELL.z, EAST);
    hold(sim, w, 1, { primary: true, yaw: EAST, pitch: 0 });
    expect(sim.econ.structures[0].hp).toBe(STRUCTURE.extractorHealth - WEAVER.meleeDamage);
  });
});

describe('Weaver heal pulse', () => {
  it('heals nearby Bloom players and Bloom structures, never Marines', () => {
    const { sim, m, r, w } = setup();
    place(w, WELL.x - 2.4, 0, WELL.z, EAST);
    sim.requestBuild('w', harvester());
    idle(sim, BUILD_TICKS);
    const h = sim.econ.structures[0];
    h.hp -= 200;
    r.health = 50;
    m.health = 40;
    place(r, WELL.x - 3, 0.29, WELL.z + 1);
    place(m, WELL.x - 3, 0, WELL.z - 1.5);
    const evs = hold(sim, w, 1, { secondary: true, yaw: EAST });
    const heal = evs.find((e) => e.t === 'heal');
    expect(heal).toMatchObject({ t: 'heal', id: 'w', players: 1, structures: 1 });
    expect(r.health).toBe(50 + WEAVER.healPulseAmount);
    expect(m.health).toBe(40);
    expect(h.hp).toBeCloseTo(h.maxHp - 200 + WEAVER.healPulseStructureAmount);
    r.health = RIPPER.health - 5;
    hold(sim, w, Math.round(WEAVER.healPulseCooldownSec * 60), { secondary: true });
    expect(r.health).toBe(RIPPER.health); // capped at max
  });
});

describe('Commander orders', () => {
  it('only the Commander may order; targets are Marines; out-of-map points are refused', () => {
    const { sim, c, m, r } = setup();
    expect(sim.order('m', { kind: 'ping', targets: [], x: 20, y: 0, z: 18 })).toBe(false);
    atConsole(c);
    sim.enterCommand('c');
    sim.drainEvents();
    expect(sim.order('c', { kind: 'move', targets: ['m', 'r', 'c'], x: 30, y: 0, z: 18 })).toBe(true);
    expect(m.order).toMatchObject({ kind: 'move', x: 30, z: 18 });
    expect(r.order).toBeNull();
    const ev = sim.drainEvents().find((e) => e.ev.t === 'order')!.ev;
    expect(ev).toMatchObject({ t: 'order', targets: ['m'] });
    expect(sim.order('c', { kind: 'ping', targets: [], x: 500, y: 0, z: 18 })).toBe(false);
    expect(sim.order('c', { kind: 'ping', targets: [], x: 25, y: 0, z: 13 })).toBe(true);
    expect(sim.teamPing).toMatchObject({ kind: 'ping', x: 25 });
    idle(sim, COMMAND.orderTtlSec * 60);
    expect(sim.teamPing).not.toBeNull();
    idle(sim, 1);
    expect(sim.teamPing).toBeNull();
    expect(m.order).toBeNull();
    void WEST;
  });
});

describe('changing class at your own base (D-36)', () => {
  it('a living Ripper in the Hive becomes a Weaver on the spot; elsewhere it waits for the next spawn', () => {
    const { sim, r } = setup();
    place(r, 20, 0.29, 30); // maintenance corridor, not the Hive
    expect(sim.requestClass('r', PlayerClass.Weaver)).toBe('queued');
    expect(r.cls).toBe(PlayerClass.Ripper);
    expect(r.pendingCls).toBe(PlayerClass.Weaver);
    place(r, 30, 0.29, 31); // Hive
    const epoch = r.epoch;
    expect(sim.requestClass('r', PlayerClass.Weaver)).toBe('now');
    expect(r.cls).toBe(PlayerClass.Weaver);
    expect(r.pendingCls).toBeNull();
    expect(r.alive).toBe(true);
    expect(r.health).toBe(WEAVER.health);
    expect(r.epoch).not.toBe(epoch); // a respawn-style snap: the client hard-resets onto the new body
    expect(sim.drainEvents().some((e) => e.ev.t === 'respawn' && e.ev.id === 'r')).toBe(true);
  });

  it('has a cooldown, never switches sides on the spot, and does nothing for the dead or the Commander', () => {
    const { sim, r, c } = setup();
    place(r, 30, 0.29, 31);
    expect(sim.requestClass('r', PlayerClass.Weaver)).toBe('now');
    place(r, 30, 0, 31);
    expect(sim.requestClass('r', PlayerClass.Ripper)).toBe('queued'); // 3 s cooldown
    idle(sim, 3 * 60);
    expect(sim.requestClass('r', PlayerClass.Ripper)).toBe('now');
    place(r, 30, 0.29, 31);
    expect(sim.requestClass('r', PlayerClass.Marine)).toBe('refused'); // Expedition already has two humans
    place(c, 6, 0, 5); // in the Expedition base, asking for a Bloom class: the Bloom is full (and a side change never happens on the spot)
    expect(sim.requestClass('c', PlayerClass.Ripper)).toBe('refused');
    r.alive = false;
    idle(sim, 3 * 60);
    expect(sim.requestClass('r', PlayerClass.Weaver)).toBe('queued');
  });
});
