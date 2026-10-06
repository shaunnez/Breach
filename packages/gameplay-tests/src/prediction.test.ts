import { describe, expect, it } from 'vitest';
import { Faction, PlayerClass, TICK_HZ } from '@breach/shared';
import { VirtualSession, marineBot, ripperBot, weaverBot } from './virtual';

function session(lag: number, jitter: number, minutes: number, seed = 7) {
  const s = new VirtualSession(lag, jitter, seed);
  s.addClient({ id: 'marine', cls: PlayerClass.Marine, bot: marineBot, seed: seed + 1 });
  s.addClient({ id: 'ripper', cls: PlayerClass.Ripper, bot: ripperBot, seed: seed + 2 });
  s.start();
  s.run(Math.round(minutes * 60 * TICK_HZ));
  return s;
}

describe.each([
  { lag: 0, jitter: 0 },
  { lag: 50, jitter: 0 },
  { lag: 100, jitter: 20 },
  { lag: 150, jitter: 20 },
])('prediction at $lag ms RTT +/-$jitter ms jitter (virtual 2 min of fuzzed play)', ({ lag, jitter }) => {
  const s = session(lag, jitter, 2);
  const [m, r] = s.results();
  it('marine prediction stays in agreement with the server', () => {
    console.log(`[${lag}/${jitter}] marine`, JSON.stringify({ rec: m.reconciliations, perMin: +m.correctionsPerMinute.toFixed(2), max: +m.maxErrorM.toFixed(4), mean: +m.meanErrorM.toFixed(6), div: +m.finalDivergenceM.toFixed(4), dropped: m.inputsDropped }));
    expect(m.maxErrorM).toBeLessThan(0.05);
    expect(m.finalDivergenceM).toBeLessThan(0.5);
  });
  it('ripper prediction stays in agreement and is not thrown off surfaces', () => {
    console.log(`[${lag}/${jitter}] ripper`, JSON.stringify({ rec: r.reconciliations, perMin: +r.correctionsPerMinute.toFixed(2), max: +r.maxErrorM.toFixed(4), mean: +r.meanErrorM.toFixed(6), breaks: r.surfaceBreaks, surf: r.surfaceTicks, leaps: r.leaps, dropped: r.inputsDropped }));
    expect(r.surfaceBreaks).toBeLessThanOrEqual(2);
    expect(r.maxErrorM).toBeLessThan(0.1);
    expect(r.surfaceTicks[1] + r.surfaceTicks[2]).toBeGreaterThan(200); // the fuzzer really exercised walls/ceilings
  });
});

describe('reconciliation actually corrects real divergence', () => {
  it('recovers from lost input batches and converges (adversarial: reliable transports never do this)', () => {
    const s = new VirtualSession(100, 20, 11);
    s.addClient({ id: 'marine', cls: PlayerClass.Marine, bot: marineBot, seed: 3 });
    s.addClient({ id: 'ripper', cls: PlayerClass.Ripper, bot: ripperBot, seed: 4 });
    s.start();
    s.upLoss = 0.03;
    s.run(60 * TICK_HZ);
    s.upLoss = 0;
    s.run(8 * TICK_HZ); // loss-free tail: must converge
    for (const c of s.clients) {
      const st = c.ctrl.stats;
      console.log(`[loss] ${c.cfg.id}`, JSON.stringify({ rec: st.reconciliations, max: +st.maxErrorM.toFixed(3), last: +st.lastErrorM.toFixed(5), breaks: st.surfaceBreaks }));
      expect(st.reconciliations).toBeGreaterThan(0);
      expect(st.lastErrorM).toBeLessThan(0.01);
      expect(st.maxErrorM).toBeLessThan(1.5);
    }
  });

  it('smooths a server-side shove without a visible pop, then decays the offset', () => {
    const s = new VirtualSession(100, 0, 5);
    s.addClient({ id: 'marine', cls: PlayerClass.Marine, bot: () => ({ yaw: 0 }), seed: 1 });
    s.start();
    s.run(120);
    const c = s.clients[0];
    const before = { x: c.ctrl.sim.px, z: c.ctrl.sim.pz };
    s.server.players.get('marine')!.sim.px += 0.4; // authoritative displacement, same epoch
    s.run(40);
    expect(c.ctrl.stats.reconciliations).toBeGreaterThan(0);
    expect(c.ctrl.sim.px).toBeCloseTo(before.x + 0.4, 1); // prediction adopted the server's truth
    expect(c.ctrl.correctionMagnitude).toBeGreaterThan(0); // and a visual offset was queued
    for (let i = 0; i < 60; i++) c.ctrl.smooth(1 / 60);
    expect(c.ctrl.correctionMagnitude).toBeLessThan(0.01);
  });

  it('hard-snaps on respawn (epoch change) and keeps working afterwards', () => {
    const s = new VirtualSession(100, 20, 9);
    s.addClient({ id: 'ripper', cls: PlayerClass.Ripper, bot: ripperBot, seed: 2 });
    s.start();
    s.run(300);
    const p = s.server.players.get('ripper')!;
    s.server.applyDamage(p, p, 9999, 'bite', { x: 0, y: 0, z: 0 });
    s.run(260); // 4 s respawn + network
    expect(p.alive).toBe(true);
    s.run(600);
    const st = s.clients[0].ctrl.stats;
    expect(st.hardSnaps).toBeGreaterThanOrEqual(1);
    expect(st.lastErrorM).toBeLessThan(0.01);
  });
});

describe('ten consecutive minutes at 100 ms RTT +/-20 ms: no accumulating desync', () => {
  const s = session(100, 20, 10, 21);
  const [m, r] = s.results();
  it('prints and bounds the long-run numbers', () => {
    console.log('[10min] marine', JSON.stringify(m));
    console.log('[10min] ripper', JSON.stringify(r));
    expect(m.reconciliations).toBeLessThanOrEqual(5);
    expect(r.reconciliations).toBeLessThanOrEqual(5);
    expect(r.surfaceBreaks).toBe(0);
    expect(m.maxErrorM).toBeLessThan(0.05);
    expect(r.maxErrorM).toBeLessThan(0.05);
    expect(r.surfaceTicks[1] + r.surfaceTicks[2]).toBeGreaterThan(2000);
  });
});

describe('VS02: virtual 4 minutes at 100 ms RTT +/-20 ms with a Commander and a Weaver in the mix', () => {
  const s = new VirtualSession(100, 20, 31);
  s.addClient({ id: 'cmdr', cls: PlayerClass.Marine, bot: marineBot, seed: 41 });
  s.addClient({ id: 'marine', cls: PlayerClass.Marine, bot: marineBot, seed: 42 });
  s.addClient({ id: 'ripper', cls: PlayerClass.Ripper, bot: ripperBot, seed: 43 });
  s.addClient({ id: 'weaver', cls: PlayerClass.Weaver, bot: weaverBot, seed: 44 });
  s.start();
  const sim = s.server;
  let minRes = Infinity;
  let maxOnNode = 0;
  let commandTicks = 0;
  let builds = 0;
  s.run(4 * 60 * TICK_HZ, (t) => {
    // Commander script, over the real (delayed) uplink: walk-in via dev teleport, enter, build whenever the well is free
    if (t % (20 * TICK_HZ) === 30 && !sim.players.get('cmdr')!.commanding) s.message(() => sim.devAction('cmdr', { action: 'teleport', room: 'console' }));
    if (t % (20 * TICK_HZ) === 60) s.message(() => sim.enterCommand('cmdr'));
    if (t % (5 * TICK_HZ) === 90) s.message(() => sim.requestBuild('cmdr', { requestId: ++builds, structure: 'extractor', resourceNodeId: 'well-a' }));
    // the Weaver fuzzer is pulled back to the well now and then and tries to claim it
    if (t % (30 * TICK_HZ) === 200) s.message(() => sim.devAction('weaver', { action: 'teleport', room: 'well' }));
    if (t % (30 * TICK_HZ) === 230) s.message(() => sim.requestBuild('weaver', { requestId: ++builds, structure: 'harvester', resourceNodeId: 'well-a' }));
    // a Ripper raid on the well every 45 s (the fuzzer bites a quarter of the time)
    if (t % (45 * TICK_HZ) === 600) s.message(() => sim.devAction('ripper', { action: 'teleport', room: 'well' }));
    if (sim.players.get('cmdr')!.commanding) commandTicks++;
    minRes = Math.min(minRes, sim.econ.teams[0].resources, sim.econ.teams[1].resources);
    maxOnNode = Math.max(maxOnNode, sim.econ.structures.filter((x) => x.nodeId === 'well-a').length);
  });
  const res = s.results();
  const by = Object.fromEntries(res.map((r) => [r.id, r]));
  const c = sim.telemetry.counters;

  it('prints the strategy telemetry', () => {
    console.log('[vs02] economy', JSON.stringify(sim.economySnapshot()));
    console.log('[vs02] summary', JSON.stringify(sim.telemetry.summary()));
    for (const r of res) console.log(`[vs02] ${r.id}`, JSON.stringify({ rec: r.reconciliations, hard: r.hardSnaps, max: +r.maxErrorM.toFixed(4), breaks: r.surfaceBreaks, dropped: r.inputsDropped }));
    expect(commandTicks).toBeGreaterThan(60 * TICK_HZ);
  });

  it('commanding and the Weaver add no prediction desync', () => {
    for (const r of res) {
      expect(r.maxErrorM).toBeLessThan(0.05);
      expect(r.reconciliations).toBeLessThanOrEqual(5);
      expect(r.inputsDropped).toBe(0);
    }
    expect(by.cmdr.hardSnaps).toBeGreaterThanOrEqual(1); // the console snap is an epoch change, not a correction
    expect(by.ripper.surfaceBreaks).toBeLessThanOrEqual(1);
  });

  it('economy invariants hold: never negative, one structure per well, income only from active structures', () => {
    expect(minRes).toBeGreaterThanOrEqual(0);
    expect(maxOnNode).toBeLessThanOrEqual(1);
    expect(c.get('structure.placed.extractor') ?? 0).toBeGreaterThanOrEqual(1);
    const earned = sim.econ.teams[Faction.Expedition].earned + sim.econ.teams[Faction.Bloom].earned;
    const activeTicks = (c.get('node.ticks.expedition') ?? 0) + (c.get('node.ticks.bloom') ?? 0);
    // a structure counts as controlling on its completion tick and pays from the next one
    const completions = (c.get('structure.completed.extractor') ?? 0) + (c.get('structure.completed.harvester') ?? 0);
    expect(earned).toBeCloseTo(((activeTicks - completions) * 0.6) / TICK_HZ, 6);
  });
});
