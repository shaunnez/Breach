import { SurfaceState, clamp, lerpAngle } from '@breach/shared';
import type { PlayerSnapshot } from './types';

export interface InterpState {
  px: number;
  py: number;
  pz: number;
  yaw: number;
  pitch: number;
  nx: number;
  ny: number;
  nz: number;
  surface: SurfaceState;
  alive: boolean;
  /** true when we had to extrapolate or hold because snapshots ran dry */
  starved: boolean;
}

/** Per-remote-player interpolation buffer (~100 ms behind server time). */
export class SnapshotBuffer {
  private snaps: PlayerSnapshot[] = [];
  readonly capacity = 40;

  push(s: PlayerSnapshot): void {
    const last = this.snaps[this.snaps.length - 1];
    if (last && s.t <= last.t) return;
    if (last && last.epoch !== s.epoch) this.snaps.length = 0; // teleport: never interpolate across respawns
    this.snaps.push(s);
    if (this.snaps.length > this.capacity) this.snaps.shift();
  }

  latest(): PlayerSnapshot | undefined {
    return this.snaps[this.snaps.length - 1];
  }

  clear(): void {
    this.snaps.length = 0;
  }

  sample(renderT: number, maxExtrapolateMs = 120): InterpState | null {
    const n = this.snaps.length;
    if (n === 0) return null;
    const first = this.snaps[0];
    const last = this.snaps[n - 1];
    const mk = (s: PlayerSnapshot, starved: boolean): InterpState => ({
      px: s.sim.px,
      py: s.sim.py,
      pz: s.sim.pz,
      yaw: s.sim.yaw,
      pitch: s.sim.pitch,
      nx: s.sim.nx,
      ny: s.sim.ny,
      nz: s.sim.nz,
      surface: s.sim.surface,
      alive: s.alive,
      starved,
    });
    if (renderT <= first.t) return mk(first, false);
    if (renderT >= last.t) {
      const over = renderT - last.t;
      const st = mk(last, true);
      if (last.alive && over > 0) {
        const e = Math.min(over, maxExtrapolateMs) / 1000;
        st.px += last.sim.vx * e;
        st.py += last.sim.vy * e;
        st.pz += last.sim.vz * e;
      }
      return st;
    }
    let i = n - 1;
    while (i > 0 && this.snaps[i - 1].t > renderT) i--;
    const a = this.snaps[i - 1];
    const b = this.snaps[i];
    const u = clamp((renderT - a.t) / (b.t - a.t || 1), 0, 1);
    const nx = a.sim.nx + (b.sim.nx - a.sim.nx) * u;
    const ny = a.sim.ny + (b.sim.ny - a.sim.ny) * u;
    const nz = a.sim.nz + (b.sim.nz - a.sim.nz) * u;
    const nl = Math.hypot(nx, ny, nz) || 1;
    return {
      px: a.sim.px + (b.sim.px - a.sim.px) * u,
      py: a.sim.py + (b.sim.py - a.sim.py) * u,
      pz: a.sim.pz + (b.sim.pz - a.sim.pz) * u,
      yaw: lerpAngle(a.sim.yaw, b.sim.yaw, u),
      pitch: a.sim.pitch + (b.sim.pitch - a.sim.pitch) * u,
      nx: nx / nl,
      ny: ny / nl,
      nz: nz / nl,
      surface: u < 0.5 ? a.sim.surface : b.sim.surface,
      alive: b.alive,
      starved: false,
    };
  }
}
