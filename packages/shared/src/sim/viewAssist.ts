import { PlayerClass, SurfaceState } from '../enums';
import { clamp, cross, dot, forwardH, len, scale, viewDir, wrapAngle, type Vec3 } from '../math';
import { MAX_PITCH } from '../protocol';
import type { PlayerSim } from './state';

function rotateAbout(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const d = dot(axis, v);
  const k = cross(axis, v);
  return {
    x: v.x * c + k.x * s + axis.x * d * (1 - c),
    y: v.y * c + k.y * s + axis.y * d * (1 - c),
    z: v.z * c + k.z * s + axis.z * d * (1 - c),
  };
}

/**
 * Parallel-transport the view across a surface-normal change (floor->wall, wall->ceiling, edge wraps)
 * and express the result as horizon-biased yaw/pitch. Presentation only: the server never sees this,
 * it just receives whatever yaw/pitch the client reports.
 */
export function transportView(yaw: number, pitch: number, nOld: Vec3, nNew: Vec3): { yaw: number; pitch: number } {
  const axis0 = cross(nOld, nNew);
  const sn = len(axis0);
  if (sn < 1e-6) return { yaw, pitch };
  const axis = scale(axis0, 1 / sn);
  const angle = Math.atan2(sn, dot(nOld, nNew));
  const L = viewDir(yaw, pitch);
  const fh = forwardH(yaw);
  const U: Vec3 = { x: -Math.sin(pitch) * fh.x, y: Math.cos(pitch), z: -Math.sin(pitch) * fh.z };
  const L2 = rotateAbout(L, axis, angle);
  const U2 = rotateAbout(U, axis, angle);
  const np = Math.asin(clamp(L2.y, -1, 1));
  let ny: number;
  if (Math.abs(L2.y) < 0.995) ny = Math.atan2(-L2.x, -L2.z);
  else {
    // near the poles yaw comes from the camera-up vector
    const hx = L2.y > 0 ? -U2.x : U2.x;
    const hz = L2.y > 0 ? -U2.z : U2.z;
    ny = Math.hypot(hx, hz) > 1e-6 ? Math.atan2(-hx, -hz) : yaw;
  }
  return { yaw: wrapAngle(ny), pitch: clamp(np, -MAX_PITCH, MAX_PITCH) };
}

/**
 * Smoothed surface view assist (client, Ripper only). Mouse deltas apply to both the displayed view
 * and the transported target; edge transitions rotate the target and the view eases onto it.
 */
export class SurfaceViewAssist {
  yaw = 0;
  pitch = 0;
  private tYaw = 0;
  private tPitch = 0;
  enabled = true;
  /** time constant (s) for easing onto the transported target */
  tau = 0.07;

  reset(yaw: number, pitch: number): void {
    this.yaw = this.tYaw = yaw;
    this.pitch = this.tPitch = pitch;
  }

  look(dYaw: number, dPitch: number): void {
    this.yaw = wrapAngle(this.yaw + dYaw);
    this.tYaw = wrapAngle(this.tYaw + dYaw);
    this.pitch = clamp(this.pitch + dPitch, -MAX_PITCH, MAX_PITCH);
    this.tPitch = clamp(this.tPitch + dPitch, -MAX_PITCH, MAX_PITCH);
  }

  /** Call once per predicted tick with the state before and after. */
  onTick(prev: PlayerSim, next: PlayerSim): void {
    if (!this.enabled || next.cls !== PlayerClass.Ripper) return;
    if (prev.surface === SurfaceState.Air || next.surface === SurfaceState.Air) return;
    const a = { x: prev.nx, y: prev.ny, z: prev.nz };
    const b = { x: next.nx, y: next.ny, z: next.nz };
    if (a.x === b.x && a.y === b.y && a.z === b.z) return;
    const t = transportView(this.tYaw, this.tPitch, a, b);
    this.tYaw = t.yaw;
    this.tPitch = t.pitch;
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-dt / this.tau);
    this.yaw = wrapAngle(this.yaw + wrapAngle(this.tYaw - this.yaw) * k);
    this.pitch += (this.tPitch - this.pitch) * k;
  }
}
