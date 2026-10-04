import { Room, type Client } from '@colyseus/core';
import {
  CLASS_NAMES,
  MATCH,
  MSG,
  NET,
  PlayerClass,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  TICK_MS,
  clamp,
  factionOf,
  type DevAction,
  type InputBatchMsg,
  type PingMsg,
  type PongMsg,
  type ServerPingMsg,
} from '@breach/shared';
import { Simulation, type ServerPlayer } from '../simulation/Simulation';
import type { Telemetry } from '../telemetry/telemetry';
import { MatchSchema, PlayerSchema } from './schema';

export interface BreachRoomOptions {
  name?: string;
  dev?: boolean;
}

let telemetryRef: Telemetry | null = null;
export const setRoomTelemetry = (t: Telemetry): void => {
  telemetryRef = t;
};

const randomCode = (): string => {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) s += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  return s;
};

const cleanName = (n: unknown): string => {
  const s = typeof n === 'string' ? n.replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 20) : '';
  return s || `Player${Math.floor(Math.random() * 900 + 100)}`;
};

export class BreachRoom extends Room<MatchSchema> {
  override maxClients = MATCH.maxPlayers;
  sim!: Simulation;
  private startWall = 0;
  private lastPing = 0;
  private pingSeq = 0;
  private pingSent = new Map<string, Map<number, number>>();
  private devEnabled = false;
  private tickMsEma = 0;
  private tickMsMax = 0;
  private lastStatLog = 0;
  private tickDrift = 0;

  override async onCreate(options: BreachRoomOptions): Promise<void> {
    // short shareable room code doubles as the room id (documented Colyseus custom-id pattern)
    const existing = await this.presence.smembers(this.roomName);
    let code = randomCode();
    while (existing.includes(code)) code = randomCode();
    await this.presence.sadd(this.roomName, code);
    this.roomId = code;

    const tel = telemetryRef;
    if (!tel) throw new Error('telemetry not initialised');
    this.sim = new Simulation(tel);
    this.sim.matchId = `${code}-${Date.now().toString(36)}`;
    this.sim.roomId = code;
    this.devEnabled = options?.dev === true;

    this.setState(new MatchSchema());
    this.state.roomCode = code;
    this.state.matchId = this.sim.matchId;
    this.state.dev = this.devEnabled;
    this.setPatchRate(1000 / NET.statePatchHz);
    this.startWall = performance.now();

    this.onMessage(MSG.input, (client, msg: InputBatchMsg) => this.sim.receiveInputs(client.sessionId, msg?.frames));
    this.onMessage(MSG.ping, (client, msg: PingMsg) => {
      const out: PongMsg = { c: typeof msg?.c === 'number' ? msg.c : 0, s: this.sim.timeMs, tick: this.sim.tick };
      client.send(MSG.pong, out);
    });
    this.onMessage('spong', (client, msg: ServerPingMsg) => {
      const sent = this.pingSent.get(client.sessionId)?.get(msg?.id);
      if (sent === undefined) return;
      this.pingSent.get(client.sessionId)!.delete(msg.id);
      const rtt = clamp(performance.now() - sent, 0, 2000);
      const p = this.sim.players.get(client.sessionId);
      if (p) p.rttMs = p.rttMs === 0 ? rtt : p.rttMs * 0.7 + rtt * 0.3;
    });
    this.onMessage(MSG.setName, (client, name: unknown) => {
      const p = this.sim.players.get(client.sessionId);
      if (p) p.name = cleanName(name);
    });
    this.onMessage(MSG.setClass, (client, cls: unknown) => {
      if (cls !== 0 && cls !== 1) return;
      if (!this.sim.setClass(client.sessionId, cls as PlayerClass)) client.send(MSG.notice, { text: 'That class is full (max 2 per side).' });
    });
    this.onMessage(MSG.start, (client) => {
      if (client.sessionId !== this.state.hostId) return;
      if (this.sim.phase !== 'warmup' || this.sim.players.size < 2) {
        client.send(MSG.notice, { text: 'Need at least two players to start.' });
        return;
      }
      this.sim.startMatch();
      this.state.phase = this.sim.phase;
      this.state.matchStartMs = this.sim.timeMs;
    });
    this.onMessage(MSG.resetMatch, (client) => {
      if (client.sessionId !== this.state.hostId || this.sim.phase !== 'playing') return;
      this.sim.resetMatch();
      this.state.matchStartMs = this.sim.timeMs;
    });
    this.onMessage(MSG.dev, (client, a: DevAction) => {
      if (!this.devEnabled || !a || typeof a.action !== 'string') return;
      this.sim.devAction(client.sessionId, a);
    });
    this.onMessage('tel', (client, m: Record<string, unknown>) => {
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
      const p = this.sim.players.get(client.sessionId);
      const rec = num(m?.recCount) ?? 0;
      const secs = num(m?.windowSec) ?? 0;
      tel.inc('client.reconciliations', rec);
      tel.inc('client.minutes', secs / 60);
      const reasons = typeof m?.reasons === 'object' && m.reasons ? (m.reasons as Record<string, number>) : {};
      for (const [k, v] of Object.entries(reasons)) if (typeof v === 'number') tel.inc(`client.recon.${k}`, v);
      tel.info('client-telemetry', {
        matchId: this.sim.matchId,
        roomId: this.roomId,
        playerId: client.sessionId,
        class: p ? CLASS_NAMES[p.cls] : undefined,
        serverTick: this.sim.tick,
        rttMs: num(m?.rtt),
        reconciliationErrorM: num(m?.errAvg),
        errMaxM: num(m?.errMax),
        reconciliationsPerSec: num(m?.recPerSec),
        movementCorrectionReason: Object.keys(reasons).join(',') || undefined,
        fps: num(m?.fps),
      });
    });

    this.setSimulationInterval(() => this.loop(), 8);
    tel.info('room-created', { roomId: code, matchId: this.sim.matchId, dev: this.devEnabled });
  }

  override onJoin(client: Client, options: BreachRoomOptions): void {
    let seat = 0;
    const used = new Set([...this.sim.players.values()].filter((p) => !p.isDummy).map((p) => p.seat));
    while (used.has(seat)) seat++;
    const marines = this.sim.classCount(PlayerClass.Marine);
    const rippers = this.sim.classCount(PlayerClass.Ripper);
    const cls = marines <= rippers ? PlayerClass.Marine : PlayerClass.Ripper;
    const p = this.sim.addPlayer(client.sessionId, cleanName(options?.name), cls, seat);
    if (!this.state.hostId || !this.sim.players.get(this.state.hostId)) {
      this.state.hostId = client.sessionId;
    }
    if (this.sim.phase === 'playing') this.sim.spawnPlayer(p, cls, true);
    this.sim.telemetry.info('player-join', { roomId: this.roomId, playerId: client.sessionId, class: CLASS_NAMES[cls], serverTick: this.sim.tick });
  }

  override async onLeave(client: Client, consented: boolean): Promise<void> {
    const p = this.sim.players.get(client.sessionId);
    if (!p) return;
    this.pingSent.delete(client.sessionId);
    if (!consented) {
      p.connected = false;
      this.sim.telemetry.info('player-disconnected', { roomId: this.roomId, playerId: client.sessionId, serverTick: this.sim.tick });
      try {
        await this.allowReconnection(client, NET.reconnectSeatHoldMs / 1000);
        p.connected = true;
        p.queue.length = 0;
        p.lastProcessedSeq = p.highestSeq;
        p.epoch = (p.epoch + 1) & 0xffff;
        this.sim.telemetry.info('player-reconnected', { roomId: this.roomId, playerId: client.sessionId, serverTick: this.sim.tick });
        return;
      } catch {
        // seat hold expired
      }
    }
    this.sim.removePlayer(client.sessionId);
    this.state.players.delete(client.sessionId);
    if (this.state.hostId === client.sessionId) {
      const next = [...this.sim.players.values()].find((x) => !x.isDummy);
      this.state.hostId = next ? next.id : '';
    }
    this.sim.telemetry.info('player-left', { roomId: this.roomId, playerId: client.sessionId, serverTick: this.sim.tick });
    if (![...this.sim.players.values()].some((x) => !x.isDummy)) this.sim.phase = 'warmup';
  }

  override async onDispose(): Promise<void> {
    await this.presence.srem(this.roomName, this.roomId);
    this.sim.telemetry.info('room-disposed', { roomId: this.roomId, matchId: this.sim.matchId });
  }

  // ---- loop -----------------------------------------------------------------------------------

  private loop(): void {
    const now = performance.now();
    const due = Math.floor((now - this.startWall) / TICK_MS);
    let steps = 0;
    let dur = 0;
    while (this.sim.tick < due && steps < 5) {
      const t0 = performance.now();
      this.sim.step();
      dur += performance.now() - t0;
      steps++;
    }
    if (this.sim.tick < due - 5) {
      // fell badly behind: drop the backlog instead of spiralling, and record it
      this.sim.telemetry.warn('tick-overrun', { roomId: this.roomId, serverTick: this.sim.tick, behind: due - this.sim.tick });
      this.startWall = now - this.sim.tick * TICK_MS;
    }
    this.tickDrift = due - this.sim.tick;
    if (steps > 0) {
      const per = dur / steps;
      this.tickMsEma = this.tickMsEma === 0 ? per : this.tickMsEma * 0.95 + per * 0.05;
      this.tickMsMax = Math.max(this.tickMsMax, per);
      this.syncState();
      this.flushEvents();
    }
    if (now - this.lastPing > 1000) {
      this.lastPing = now;
      this.sendPings(now);
    }
    if (now - this.lastStatLog > 10_000) {
      this.lastStatLog = now;
      this.sim.telemetry.info('server-tick-stats', {
        roomId: this.roomId,
        serverTick: this.sim.tick,
        serverTickDurationMs: Number(this.tickMsEma.toFixed(3)),
        serverTickMaxMs: Number(this.tickMsMax.toFixed(3)),
        driftTicks: this.tickDrift,
        players: this.sim.players.size,
      });
      this.tickMsMax = 0;
    }
  }

  private sendPings(now: number): void {
    for (const c of this.clients) {
      const id = ++this.pingSeq;
      let m = this.pingSent.get(c.sessionId);
      if (!m) this.pingSent.set(c.sessionId, (m = new Map()));
      if (m.size > 8) m.clear();
      m.set(id, now);
      c.send(MSG.serverPing, { id });
    }
  }

  private flushEvents(): void {
    for (const { ev, to } of this.sim.drainEvents()) {
      if (to) this.clients.find((c) => c.sessionId === to)?.send(MSG.event, ev);
      else this.broadcast(MSG.event, ev);
    }
  }

  private syncState(): void {
    const st = this.state;
    st.serverTick = this.sim.tick;
    st.serverTimeMs = this.sim.timeMs;
    st.phase = this.sim.phase;
    // drop schema entries for removed players (dummies)
    for (const id of [...st.players.keys()]) if (!this.sim.players.has(id)) st.players.delete(id);
    for (const p of this.sim.players.values()) {
      let ps = st.players.get(p.id);
      if (!ps) {
        ps = new PlayerSchema();
        st.players.set(p.id, ps);
      }
      writePlayer(ps, p, this.sim.tick, this.state.hostId);
    }
  }
}

function writePlayer(ps: PlayerSchema, p: ServerPlayer, tick: number, hostId: string): void {
  const s = p.sim;
  ps.id = p.id;
  ps.name = p.name;
  ps.seat = p.seat;
  ps.cls = p.cls;
  ps.faction = factionOf(p.cls);
  ps.connected = p.connected;
  ps.host = p.id === hostId;
  ps.dummy = p.isDummy;
  ps.alive = p.alive;
  ps.protected = p.protectedUntilTick > tick;
  ps.epoch = p.epoch;
  ps.px = s.px;
  ps.py = s.py;
  ps.pz = s.pz;
  ps.yaw = s.yaw;
  ps.pitch = s.pitch;
  ps.vx = s.vx;
  ps.vy = s.vy;
  ps.vz = s.vz;
  ps.nx = s.nx;
  ps.ny = s.ny;
  ps.nz = s.nz;
  ps.surface = s.surface;
  ps.detachT = s.detachT;
  ps.lockT = s.lockT;
  ps.leapCd = s.leapCd;
  ps.energy = s.energy;
  ps.energyIdle = s.energyIdle;
  ps.prevJump = s.prevJump;
  ps.prevReload = s.prevReload;
  ps.sprinting = s.sprinting;
  ps.ammo = s.ammo;
  ps.reserve = s.reserve;
  ps.reloadTicks = s.reloadTicks;
  ps.fireCdTicks = s.fireCdTicks;
  ps.biteCdTicks = s.biteCdTicks;
  ps.bloom = s.bloom;
  ps.bloomIdleTicks = s.bloomIdleTicks;
  ps.shotCount = s.shotCount;
  ps.seed = s.seed;
  ps.health = Math.round(p.health);
  ps.armour = Math.round(p.armour);
  ps.lastProcessedInputSeq = Math.max(0, p.lastProcessedSeq);
  ps.respawnAtMs = p.alive ? 0 : p.respawnAtTick * TICK_MS;
  ps.kills = p.kills;
  ps.deaths = p.deaths;
  ps.damage = Math.round(p.damage);
  ps.rttMs = Math.round(p.rttMs);
  ps.pendingCls = p.pendingCls ?? 255;
}
