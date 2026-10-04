/**
 * Simulated network conditions for local development and tests. Strictly FIFO per direction (jitter
 * delays packets but never reorders them, exactly like the TCP-based WebSocket it stands in for):
 * a single pump timer per direction releases packets in order, so two timers due in the same
 * millisecond can never swap. Lag is round-trip: each direction gets lag/2.
 */
export interface NetSimConfig {
  lagMs: number;
  jitterMs: number;
}

interface Lane {
  q: { at: number; fn: () => void }[];
  timer: boolean;
  last: number;
}

export class NetSim {
  private lanes: Record<'up' | 'down', Lane> = {
    up: { q: [], timer: false, last: 0 },
    down: { q: [], timer: false, last: 0 },
  };
  constructor(
    public cfg: NetSimConfig = { lagMs: 0, jitterMs: 0 },
    private readonly schedule: (fn: () => void, ms: number) => void = (fn, ms) => void setTimeout(fn, ms),
    private readonly now: () => number = () => performance.now(),
  ) {}

  get active(): boolean {
    return this.cfg.lagMs > 0 || this.cfg.jitterMs > 0;
  }

  private delay(): number {
    const j = this.cfg.jitterMs > 0 ? (Math.random() * 2 - 1) * this.cfg.jitterMs : 0;
    return Math.max(0, this.cfg.lagMs / 2 + j);
  }

  up(fn: () => void): void {
    this.go(fn, 'up');
  }
  down(fn: () => void): void {
    this.go(fn, 'down');
  }

  private go(fn: () => void, dir: 'up' | 'down'): void {
    const lane = this.lanes[dir];
    // nothing queued and no delay configured: deliver synchronously (keeps order relative to later packets)
    if (!this.active && lane.q.length === 0) {
      fn();
      return;
    }
    const t = this.now();
    const at = Math.max(lane.last, t + this.delay());
    lane.last = at;
    lane.q.push({ at, fn });
    this.arm(lane);
  }

  private arm(lane: Lane): void {
    if (lane.timer || lane.q.length === 0) return;
    lane.timer = true;
    this.schedule(() => {
      lane.timer = false;
      const t = this.now();
      while (lane.q.length && lane.q[0].at <= t + 0.5) lane.q.shift()!.fn();
      this.arm(lane);
    }, Math.max(0, lane.q[0].at - this.now()));
  }
}
