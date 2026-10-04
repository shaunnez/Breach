import { matchMaker } from '@colyseus/core';
import { emptyInput, type GameEvent, type InputFrame } from '@breach/shared';
import { createGameServer, type RunningServer } from '../../../apps/server/src/createServer';
import type { BreachRoom } from '../../../apps/server/src/rooms/BreachRoom';
import { Telemetry } from '../../../apps/server/src/telemetry/telemetry';
import { GameNetClient } from '../../../apps/client/src/game/network/GameNetClient';
import type { ConnectionStatus, MatchView } from '../../../apps/client/src/game/network/types';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function until(cond: () => boolean, timeoutMs = 5000, label = 'condition'): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await sleep(10);
  }
}

export async function startServer(): Promise<RunningServer & { telemetry: Telemetry }> {
  const telemetry = new Telemetry('silent');
  const s = await createGameServer({ port: 0, host: '127.0.0.1', telemetry });
  return Object.assign(s, { telemetry });
}

export class TestClient {
  net: GameNetClient;
  view: MatchView | null = null;
  events: GameEvent[] = [];
  notices: string[] = [];
  statuses: ConnectionStatus[] = [];
  seq = 0;
  constructor(url: string, lagMs = 0) {
    this.net = new GameNetClient(
      url,
      {
        onMatch: (v) => (this.view = v),
        onEvent: (e) => this.events.push(e),
        onNotice: (t) => this.notices.push(t),
        onStatus: (s) => this.statuses.push(s),
      },
      { lagMs, jitterMs: 0 },
      null,
    );
  }
  get me() {
    return this.view?.players.find((p) => p.id === this.net.sessionId);
  }
  player(id: string) {
    return this.view?.players.find((p) => p.id === id);
  }
  input(patch: Partial<InputFrame> = {}): InputFrame {
    const f = { ...emptyInput(++this.seq), ...patch };
    this.net.queueInput(f);
    return f;
  }
}

export const roomOf = (code: string): BreachRoom => matchMaker.getLocalRoomById(code) as unknown as BreachRoom;
