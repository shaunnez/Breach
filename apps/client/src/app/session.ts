import { PlayerClass, type GameEvent } from '@breach/shared';
import { GameNetClient } from '../game/network/GameNetClient';
import type { ConnectionStatus, MatchView } from '../game/network/types';
import type { GameRuntime } from '../game/bootstrap/GameRuntime';
import { getState, setState } from './store';

const params = new URLSearchParams(location.search);

export function serverUrl(): string {
  const env = (import.meta as any).env?.VITE_SERVER_URL as string | undefined;
  if (env) return env;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  if ((import.meta as any).env?.DEV) return `${proto}://${location.hostname}:2567`;
  return `${proto}://${location.host}`;
}

class Session {
  net: GameNetClient;
  runtime: GameRuntime | null = null;

  constructor() {
    const lag = Number(params.get('lag') ?? 0);
    const jitter = Number(params.get('jitter') ?? 0);
    this.net = new GameNetClient(
      serverUrl(),
      {
        onMatch: (v) => this.onMatch(v),
        onEvent: (e) => this.onEvent(e),
        onNotice: (text) => setState({ notice: { text, at: performance.now() } }),
        onStatus: (s, reason) => this.onStatus(s, reason),
      },
      { lagMs: Number.isFinite(lag) ? lag : 0, jitterMs: Number.isFinite(jitter) ? jitter : 0 },
    );
  }

  private onMatch(v: MatchView): void {
    const s = getState();
    const screen = v.phase === 'playing' ? 'game' : s.screen === 'landing' ? 'landing' : 'lobby';
    setState({ match: v, roomCode: v.roomCode, sessionId: this.net.sessionId, screen: s.screen === 'landing' && this.net.status !== 'connected' ? 'landing' : screen });
    this.runtime?.onMatch(v);
  }

  private onEvent(e: GameEvent): void {
    this.runtime?.onEvent(e);
  }

  private onStatus(s: ConnectionStatus, reason?: string): void {
    setState({ status: s, statusReason: reason ?? '' });
    if (s === 'lost' || (s === 'idle' && getState().screen !== 'landing')) {
      setState({ screen: 'landing', match: null, error: reason ?? (s === 'lost' ? 'Connection lost.' : null), busy: false });
    }
  }

  private fail(e: unknown): void {
    const msg = e instanceof Error ? e.message : String(e);
    setState({ error: /not found|invalid_room|locked/i.test(msg) ? 'Room not found or already full.' : `Could not connect: ${msg}`, busy: false, status: 'idle', screen: 'landing' });
  }

  async create(): Promise<void> {
    const { name, dev } = getState();
    setState({ busy: true, error: null });
    try {
      localStorage.setItem('breach.name', name);
    } catch {}
    try {
      const code = await this.net.create({ name, dev });
      setState({ screen: 'lobby', roomCode: code, busy: false });
    } catch (e) {
      this.fail(e);
    }
  }

  async join(code: string): Promise<void> {
    const { name } = getState();
    setState({ busy: true, error: null });
    try {
      localStorage.setItem('breach.name', name);
    } catch {}
    try {
      await this.net.join(code, { name });
      setState({ screen: 'lobby', busy: false });
    } catch (e) {
      this.fail(e);
    }
  }

  async resume(): Promise<void> {
    if (await this.net.tryResume()) setState({ screen: 'lobby' });
  }

  async leave(): Promise<void> {
    await this.net.leave();
    setState({ screen: 'landing', match: null, error: null });
  }

  setClass(cls: PlayerClass): void {
    this.net.setClass(cls);
  }
}

export const session = new Session();
