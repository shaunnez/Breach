import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MARINE, RIPPER, secToTicks, MATCH } from '@breach/shared';
import { TestClient, roomOf, sleep, startServer, until } from './harness';

let server: Awaited<ReturnType<typeof startServer>>;
let url: string;
beforeAll(async () => {
  server = await startServer();
  url = `ws://127.0.0.1:${server.port}`;
});
afterAll(async () => {
  await server.close();
});

describe('room lifecycle', () => {
  it('creates a six-character room code, joins by code, replicates players, enforces 4 seats', async () => {
    const a = new TestClient(url);
    const code = await a.net.create({ name: 'Alice', dev: true });
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    const b = new TestClient(url);
    await b.net.join(code.toLowerCase(), { name: 'Bob' });
    await until(() => a.view?.players.length === 2 && b.view?.players.length === 2, 3000, 'two players visible');
    expect(a.view!.roomCode).toBe(code);
    expect(a.view!.hostId).toBe(a.net.sessionId);
    expect(new Set(a.view!.players.map((p) => p.seat)).size).toBe(2);
    const c = new TestClient(url);
    const d = new TestClient(url);
    await c.net.join(code, { name: 'C' });
    await d.net.join(code, { name: 'D' });
    const e = new TestClient(url);
    await expect(e.net.join(code, { name: 'E' })).rejects.toBeTruthy();
    // class guard: classes balanced 2/2 automatically
    await until(() => a.view?.players.length === 4, 3000, 'four players');
    const classes = a.view!.players.map((p) => p.sim.cls).sort();
    expect(classes).toEqual([0, 0, 1, 1]);
    // leave is visible to others
    await d.net.leave();
    await until(() => a.view?.players.length === 3, 3000, 'leave replicated');
    await a.net.leave();
    await b.net.leave();
    await c.net.leave();
  });

  it('only the host can start, needs two players, and moves everyone to playing', async () => {
    const a = new TestClient(url);
    const code = await a.net.create({ name: 'Host', dev: true });
    await until(() => a.me !== undefined, 2000, 'host entity');
    a.net.start();
    await until(() => a.notices.length > 0, 2000, 'notice for lone start');
    const b = new TestClient(url);
    await b.net.join(code, { name: 'Guest' });
    await until(() => b.view?.players.length === 2, 2000, 'guest sees both');
    b.net.start(); // guest cannot start
    await sleep(150);
    expect(a.view!.phase).toBe('warmup');
    a.net.start();
    await until(() => a.view?.phase === 'playing' && b.view?.phase === 'playing', 2000, 'playing');
    expect(a.view!.players.every((p) => p.alive)).toBe(true);
    await a.net.leave();
    await b.net.leave();
  });
});

describe('authoritative play over real sockets', () => {
  it('movement replicates, rifle damage is server-side, death + 4 s respawn replicate', async () => {
    const a = new TestClient(url);
    const code = await a.net.create({ name: 'Marine', dev: true });
    const b = new TestClient(url);
    await b.net.join(code, { name: 'Ripper' });
    await until(() => b.view?.players.length === 2, 2000);
    a.net.start();
    await until(() => a.view?.phase === 'playing' && b.view?.phase === 'playing', 2000, 'playing');
    const room = roomOf(code);
    const ma = room.sim.players.get(a.net.sessionId)!;
    const rb = room.sim.players.get(b.net.sessionId)!;
    expect(ma.cls).toBe(0);
    expect(rb.cls).toBe(1);

    // placement (test-only direct poke of server state), spawn protection off
    const EAST = -Math.PI / 2;
    ma.sim.px = 11;
    ma.sim.py = 0;
    ma.sim.pz = 19.2;
    rb.sim.px = 17;
    rb.sim.py = 0.29;
    rb.sim.pz = 19.2;
    ma.protectedUntilTick = rb.protectedUntilTick = 0;

    // ripper moves; its movement replicates to the marine's view
    const x0 = rb.sim.px;
    for (let i = 0; i < 30; i++) b.input({ moveZ: 1, yaw: Math.PI / 2 });
    await until(() => (a.player(b.net.sessionId)?.sim.px ?? x0) < x0 - 0.5, 3000, 'ripper movement replicated');

    // marine shoots: client sends inputs only, never hit results
    const pitch = -Math.atan2(MARINE.eyeHeight - 0.29, 6);
    for (let i = 0; i < 150; i++) {
      // keep target on the line of fire: re-place ripper each batch (server poke) so the test is deterministic
      if (i % 3 === 0) {
        rb.sim.px = 17;
        rb.sim.pz = 19.2;
        rb.sim.vx = rb.sim.vz = 0;
      }
      a.input({ yaw: EAST, pitch, primary: true });
      await sleep(8);
      if (b.view && !b.me?.alive) break;
    }
    await until(() => b.me?.alive === false, 5000, 'ripper dead');
    expect(a.events.some((e) => e.t === 'death')).toBe(true);
    expect(a.me!.kills).toBe(1);
    expect(b.me!.deaths).toBe(1);
    expect(b.me!.health).toBe(0);
    const diedAt = Date.now();
    await until(() => b.me?.alive === true, 7000, 'respawn');
    const dt = (Date.now() - diedAt) / 1000;
    expect(dt).toBeGreaterThan(MATCH.respawnSec - 0.8);
    expect(dt).toBeLessThan(MATCH.respawnSec + 1.2);
    expect(b.me!.health).toBe(RIPPER.health);
    expect(b.me!.protected).toBe(true);
    expect(secToTicks(MATCH.respawnSec)).toBe(240);
    await a.net.leave();
    await b.net.leave();
  });

  it('reconnect restores the same player entity within the seat-hold window', async () => {
    const a = new TestClient(url);
    const code = await a.net.create({ name: 'Host', dev: true });
    const b = new TestClient(url);
    await b.net.join(code, { name: 'Flaky' });
    await until(() => a.view?.players.length === 2, 2000);
    a.net.start();
    await until(() => b.view?.phase === 'playing', 2000);
    const id = b.net.sessionId;
    const room = roomOf(code);
    const before = room.sim.players.get(id)!;
    const seat = before.seat;
    before.kills = 7; // state that must survive
    b.net.dropConnection();
    await until(() => a.player(id)?.connected === false, 3000, 'seen disconnected');
    await until(() => b.net.status === 'connected' && b.statuses.includes('reconnecting'), 8000, 'reconnected');
    await until(() => a.player(id)?.connected === true, 3000, 'seen reconnected');
    expect(b.net.sessionId).toBe(id);
    expect(a.player(id)!.seat).toBe(seat);
    expect(a.player(id)!.kills).toBe(7);
    expect(room.sim.players.size).toBe(2);
    await a.net.leave();
    await b.net.leave();
  });

  it('simulated 100 ms RTT is reflected in client clock sync and server-measured RTT', async () => {
    const a = new TestClient(url, 100);
    const code = await a.net.create({ name: 'Laggy', dev: true });
    await until(() => a.net.clock.samples >= 3 && (a.me?.rttMs ?? 0) > 0, 6000, 'rtt samples');
    expect(a.net.clock.rtt).toBeGreaterThan(80);
    expect(a.net.clock.rtt).toBeLessThan(200);
    await until(() => (a.me?.rttMs ?? 0) > 70, 6000, 'server rtt');
    expect(roomOf(code).sim.players.get(a.net.sessionId)!.rttMs).toBeGreaterThan(70);
    await a.net.leave();
  });
});
