import { Client, type Room } from 'colyseus.js';
import { MSG, NET, type BuildRequest, type DevAction, type GameEvent, type InputFrame, type OrderMsg, type PongMsg, type ServerPingMsg, normalizeRoomCode } from '@breach/shared';
import { ClockSync } from './ClockSync';
import { NetSim, type NetSimConfig } from './NetSim';
import { extractEconomy, extractPlayer, type ConnectionStatus, type MatchView, type NetCallbacks } from './types';

export interface ConnectOptions {
  name: string;
  dev?: boolean;
}

const BACKOFF_MS = [300, 700, 1500, 2500, 4000];

/**
 * Thin Colyseus wrapper: create/join/reconnect, input batching at 30 Hz, clock sync, simulated latency.
 * No rendering or DOM access (beyond optional sessionStorage for reload-reconnect).
 */
export class GameNetClient {
  room: Room | null = null;
  readonly clock = new ClockSync();
  readonly sim: NetSim;
  status: ConnectionStatus = 'idle';
  sessionId = '';
  lastMatch: MatchView | null = null;
  /** counters surfaced in the debug overlay */
  stats = { patchesPerSec: 0, patches: 0, bytesIn: 0, lastInputSeqSent: 0 };
  private client: Client;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private outQueue: InputFrame[] = [];
  private cbs: NetCallbacks;
  private closing = false;
  private patchWindowStart = 0;
  private patchCount = 0;
  private reconnectToken = '';

  constructor(
    private readonly url: string,
    cbs: NetCallbacks,
    simCfg: NetSimConfig = { lagMs: 0, jitterMs: 0 },
    private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
  ) {
    this.cbs = cbs;
    this.client = new Client(url);
    this.sim = new NetSim(simCfg);
  }

  private setStatus(s: ConnectionStatus, reason?: string): void {
    this.status = s;
    this.cbs.onStatus(s, reason);
  }

  async create(opts: ConnectOptions): Promise<string> {
    this.setStatus('connecting');
    const room = await this.client.create('breach', { name: opts.name, dev: opts.dev === true });
    this.attach(room);
    return room.roomId;
  }

  async join(code: string, opts: ConnectOptions): Promise<void> {
    this.setStatus('connecting');
    const room = await this.client.joinById(normalizeRoomCode(code), { name: opts.name });
    this.attach(room);
  }

  /**
   * Try to resume a seat from a stored token (page reload). Returns false if nothing to resume.
   * A fast reload can reconnect before the server has noticed the old socket closed, in which case
   * the token is briefly "invalid"; so retry with backoff for a few seconds before giving up.
   */
  async tryResume(maxWaitMs = 5000): Promise<boolean> {
    const tok = this.storage?.getItem('breach.reconnect');
    if (!tok) return false;
    this.setStatus('reconnecting');
    const deadline = performance.now() + maxWaitMs;
    let attempt = 0;
    while (performance.now() < deadline) {
      try {
        const room = await this.client.reconnect(tok);
        this.attach(room);
        return true;
      } catch {
        await new Promise((r) => setTimeout(r, [0, 250, 500, 800, 1200][Math.min(attempt, 4)] + 100));
        attempt++;
      }
    }
    this.storage?.removeItem('breach.reconnect');
    this.setStatus('idle');
    return false;
  }

  private attach(room: Room): void {
    this.room = room;
    this.sessionId = room.sessionId;
    this.closing = false;
    this.reconnectToken = room.reconnectionToken;
    this.storage?.setItem('breach.reconnect', this.reconnectToken);

    room.onStateChange((state: any) => {
      const recv = performance.now();
      const view = this.snapshotState(state);
      this.patchCount++;
      if (recv - this.patchWindowStart > 1000) {
        this.stats.patchesPerSec = (this.patchCount * 1000) / (recv - this.patchWindowStart);
        this.patchCount = 0;
        this.patchWindowStart = recv;
      }
      this.sim.down(() => {
        this.lastMatch = view;
        this.cbs.onMatch(view);
      });
    });
    room.onMessage(MSG.event, (ev: GameEvent) => this.sim.down(() => this.cbs.onEvent(ev)));
    room.onMessage(MSG.notice, (m: { text: string }) => this.sim.down(() => this.cbs.onNotice(m.text)));
    room.onMessage(MSG.pong, (m: PongMsg) =>
      this.sim.down(() => {
        this.clock.addSample(m.c, performance.now(), m.s);
      }),
    );
    room.onMessage(MSG.serverPing, (m: ServerPingMsg) => this.sim.down(() => this.sim.up(() => this.room?.send('spong', { id: m.id }))));
    room.onLeave((code) => this.onClosed(code));
    room.onError((code, msg) => this.cbs.onNotice(`Network error ${code}: ${msg ?? ''}`));

    this.setStatus('connected');
    this.startTimers();
    this.sendPing();
  }

  private snapshotState(state: any): MatchView {
    const t = state.serverTimeMs as number;
    const players: MatchView['players'] = [];
    state.players.forEach((ps: any) => players.push(extractPlayer(ps, t)));
    return {
      phase: state.phase,
      serverTick: state.serverTick,
      serverTimeMs: t,
      roomCode: state.roomCode,
      hostId: state.hostId,
      matchId: state.matchId,
      dev: state.dev,
      matchStartMs: state.matchStartMs,
      players,
      economy: extractEconomy(state),
    };
  }

  private startTimers(): void {
    this.stopTimers();
    this.pingTimer = setInterval(() => this.sendPing(), 1000);
    this.flushTimer = setInterval(() => this.flushInputs(), 1000 / NET.inputSendHz);
  }
  private stopTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.pingTimer = this.flushTimer = null;
  }

  private sendPing(): void {
    const c = performance.now();
    this.sim.up(() => this.room?.send(MSG.ping, { c }));
  }

  /** Queue a frame; frames are sent in batches at 30 Hz. */
  queueInput(frame: InputFrame): void {
    this.outQueue.push(frame);
    this.stats.lastInputSeqSent = frame.seq;
    if (this.outQueue.length > 60) this.outQueue.splice(0, this.outQueue.length - 60);
  }

  private flushInputs(): void {
    if (this.outQueue.length === 0 || !this.room) return;
    while (this.outQueue.length) {
      const frames = this.outQueue.splice(0, 8);
      this.sim.up(() => this.room?.send(MSG.input, { frames }));
    }
  }

  send(type: string, msg?: unknown): void {
    this.sim.up(() => this.room?.send(type, msg));
  }
  setClass(cls: 0 | 1 | 2): void {
    this.send(MSG.setClass, cls);
  }
  /** VS02: enter / exit Commander mode (server checks role, reach, occupancy). */
  command(action: 'enter' | 'exit'): void {
    this.send(MSG.command, { action });
  }
  private buildSeq = 0;
  /** VS02: BuildRequest; the answer arrives as a `build-result` event. Returns the requestId. */
  build(structure: BuildRequest['structure'], resourceNodeId: string): number {
    const requestId = ++this.buildSeq;
    this.send(MSG.build, { requestId, structure, resourceNodeId } satisfies BuildRequest);
    return requestId;
  }
  order(m: OrderMsg): void {
    this.send(MSG.order, m);
  }
  start(): void {
    this.send(MSG.start);
  }
  resetMatch(): void {
    this.send(MSG.resetMatch);
  }
  dev(a: DevAction): void {
    this.send(MSG.dev, a);
  }
  telemetry(m: Record<string, number>): void {
    this.send('tel', m);
  }

  /** Simulate a dropped connection (dev + tests). */
  dropConnection(): void {
    (this.room as any)?.connection?.transport?.ws?.close?.(3001);
  }

  private async onClosed(code: number): Promise<void> {
    this.stopTimers();
    if (this.closing || code === 1000 || code === 4001) {
      this.storage?.removeItem('breach.reconnect');
      this.setStatus('idle', code === 4001 ? 'kicked' : undefined);
      return;
    }
    this.setStatus('reconnecting', `connection lost (${code})`);
    const deadline = performance.now() + NET.reconnectSeatHoldMs;
    let attempt = 0;
    while (performance.now() < deadline && !this.closing) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]));
      attempt++;
      try {
        const room = await this.client.reconnect(this.reconnectToken);
        this.attach(room);
        return;
      } catch {
        // keep trying until the seat hold expires
      }
    }
    this.storage?.removeItem('breach.reconnect');
    this.setStatus('lost', 'Could not resume your seat in time. Returning to lobby.');
  }

  async leave(): Promise<void> {
    this.closing = true;
    this.stopTimers();
    this.storage?.removeItem('breach.reconnect');
    try {
      await this.room?.leave(true);
    } catch {}
    this.room = null;
    this.setStatus('idle');
  }
}
