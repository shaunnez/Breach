/**
 * Real-socket soak: N headless clients (real network + prediction code) fight for T minutes under a
 * simulated RTT/jitter, against an in-process server (or --url). Reports reconciliation / desync,
 * server tick health and combat telemetry, and exits non-zero if the bible's gates fail.
 *
 *   pnpm soak                         # 4 clients, 100 ms RTT +/-20 ms, 10 minutes
 *   pnpm soak -- --minutes 2 --lag 150
 *
 * VS02 lineup: M0 = Commander (Extractor whenever the well is free), R1 = Ripper, M2 = Marine, W3 = Weaver
 * (Harvester whenever the well is free). Gatherings at the resource room make the well a real fight.
 */
import { PlayerClass } from '@breach/shared';
import { startServer, sleep, roomOf } from './harness';
import { BotClient, aimingMarine, brawlingWeaver, chasingRipper } from './botClient';

const arg = (k: string, d: number | string): string => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : String(d);
};
const minutes = Number(arg('minutes', 10));
const lag = Number(arg('lag', 100));
const jitter = Number(arg('jitter', 20));
const players = Math.min(4, Math.max(2, Number(arg('players', 4))));
const extUrl = arg('url', '');

const local = extUrl ? null : await startServer();
const url = extUrl || `ws://127.0.0.1:${local!.port}`;

const bots: BotClient[] = [];
const CLASSES = [0, 1, 0, 2] as const;
for (let i = 0; i < players; i++) {
  const cls = CLASSES[i];
  const name = cls === 0 ? `M${i}` : cls === 1 ? `R${i}` : `W${i}`;
  bots.push(new BotClient(url, name, lag, jitter, cls === 0 ? aimingMarine : cls === 1 ? chasingRipper : brawlingWeaver, 100 + i));
}
const code = await bots[0].net.create({ name: 'soak', dev: true });
for (const b of bots.slice(1)) await b.net.join(code, { name: b.name });
await sleep(400);
for (let i = 0; i < bots.length; i++) bots[i].net.setClass(CLASSES[i]);
await sleep(400);
bots[0].net.start();
await sleep(500);
for (const b of bots) b.start();
// meet in the middle every 20 s so fights, deaths and respawns actually happen (the Commander stays at the console)
const commander = bots[0];
const weaver = bots.find((b) => b.name.startsWith('W'));
const gather = () => bots.forEach((b) => b !== commander && b.net.dev({ action: 'teleport', room: 'resource' }));
setTimeout(gather, 1500);
const gatherTimer = setInterval(gather, 20_000);
// strategy layer: the Commander (re)takes the console and builds whenever the well is free; so does the Weaver
const wellFree = () => (commander.view?.economy.structures.length ?? 1) === 0;
const strategyTimer = setInterval(() => {
  if (!commander.me?.alive) return;
  if (!commander.me.commanding) {
    commander.net.dev({ action: 'teleport', room: 'console' });
    setTimeout(() => commander.net.command('enter'), 300);
  } else if (wellFree()) commander.net.build('extractor', 'well-a');
  if (weaver?.me?.alive && wellFree()) {
    weaver.net.dev({ action: 'teleport', room: 'well' });
    setTimeout(() => weaver.net.build('harvester', 'well-a'), 300);
  }
}, 4000);

console.log(`soak: ${players} clients, ${minutes} min, RTT ${lag} ms +/-${jitter} ms, url ${url}`);
const t0 = Date.now();
const room = local ? roomOf(code) : null;
let lastReport = 0;
while (Date.now() - t0 < minutes * 60_000) {
  await sleep(1000);
  const sec = (Date.now() - t0) / 1000;
  if (sec - lastReport >= 30) {
    lastReport = sec;
    const line = bots
      .map((b) => `${b.name}: rec=${b.ctrl?.stats.reconciliations ?? 0} maxErr=${(b.ctrl?.stats.maxErrorM ?? 0).toFixed(3)} d=${b.events.death} k=${b.me?.kills ?? 0}`)
      .join(' | ');
    console.log(`[${sec.toFixed(0)}s] ${line}`);
  }
}
clearInterval(gatherTimer);
clearInterval(strategyTimer);
for (const b of bots) b.stop();

const rows = bots.map((b) => {
  const st = b.ctrl?.stats;
  const mins = (Date.now() - t0) / 60000;
  return {
    name: b.name,
    cls: b.me?.sim.cls === PlayerClass.Marine ? (b === commander ? 'commander' : 'marine') : b.me?.sim.cls === PlayerClass.Weaver ? 'weaver' : 'ripper',
    ticks: b.tickN,
    reconciliations: st?.reconciliations ?? 0,
    perMin: +((st?.reconciliations ?? 0) / mins).toFixed(2),
    hardSnaps: st?.hardSnaps ?? 0,
    maxErrM: +(st?.maxErrorM ?? 0).toFixed(3),
    surfaceBreaks: st?.surfaceBreaks ?? 0,
    deaths: b.events.death,
    respawns: b.events.respawn,
    hits: b.events.hits,
  };
});
console.table(rows);
for (const b of bots) if (b.reconLog.length) console.log(b.name, JSON.stringify(b.reasons), b.reconLog.slice(0, 4).join(' ; '));
let ok = true;
if (room) {
  const sum = room.sim.telemetry.summary();
  console.log('server telemetry summary:', JSON.stringify(sum));
  console.log('economy:', JSON.stringify(room.sim.economySnapshot()));
  const ticks = room.sim.tick;
  const expected = Math.floor(((Date.now() - t0) / 1000 + 1) * 60);
  console.log(`server ticks ${ticks} (≈${expected - ticks} behind wall-clock expectation incl. startup)`);
  const dropped = [...room.sim.players.values()].reduce((a, p) => a + p.stats.inputsDropped, 0);
  console.log(`inputs dropped by queue cap: ${dropped}`);
  console.log('input rejects:', JSON.stringify(Object.fromEntries([...room.sim.telemetry.counters].filter(([k]) => k.startsWith('input.')))));
  const tickDur = (room as unknown as { tickMsEma: number }).tickMsEma;
  console.log(`server tick duration EMA: ${tickDur.toFixed(3)} ms (budget 16.67 ms)`);
  ok = ok && tickDur < 8 && dropped === 0;
}
const worst = rows.reduce((a, r) => Math.max(a, r.perMin), 0);
const breaks = rows.reduce((a, r) => a + r.surfaceBreaks, 0);
console.log(`worst reconciliations/min ${worst}, ripper surface breaks ${breaks}`);
ok = ok && worst < 12 && rows.every((r) => r.maxErrM < 1.5);
for (const b of bots) await b.net.leave().catch(() => {});
await local?.close();
console.log(ok ? 'SOAK PASS' : 'SOAK FAIL');
process.exit(ok ? 0 : 1);
