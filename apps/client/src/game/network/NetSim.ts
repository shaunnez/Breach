/**
 * Simulated network conditions for local development and tests. FIFO per direction (jitter delays
 * packets but never reorders them, like TCP). Lag is round-trip: each direction gets lag/2.
 */
export interface NetSimConfig {
  lagMs: number;
  jitterMs: number;
}

export class NetSim {
  private lastUp = 0;
  private lastDown = 0;
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
    if (!this.active) {
      fn();
      return;
    }
    const t = this.now();
    const at = Math.max(dir === 'up' ? this.lastUp : this.lastDown, t + this.delay());
    if (dir === 'up') this.lastUp = at;
    else this.lastDown = at;
    this.schedule(fn, Math.max(0, at - t));
  }
}
