import { MARINE, TICK_DT } from '../balance';
import { SurfaceState } from '../enums';
import { clamp, forwardH, rightH } from '../math';
import type { InputFrame } from '../protocol';
import type { CollisionWorld } from '../map/collision';
import type { PlayerSim, StepResult } from './state';

const R = MARINE.colliderRadius;
const H = MARINE.standingHeight;
const SKIN = 1e-4;

function blocked(world: CollisionWorld, x: number, y: number, z: number): boolean {
  return world.aabbBlocked(x - R, y, z - R, x + R, y + H, z + R);
}

/** Highest box top under the footprint within [y - maxDrop, y + 1e-4], or null. */
function supportBelow(world: CollisionWorld, x: number, y: number, z: number, maxDrop: number): number | null {
  let best: number | null = null;
  for (const b of world.boxes) {
    if (x + R <= b.minX + 1e-5 || x - R >= b.maxX - 1e-5) continue;
    if (z + R <= b.minZ + 1e-5 || z - R >= b.maxZ - 1e-5) continue;
    if (b.maxY > y + 1e-4 || b.maxY < y - maxDrop) continue;
    if (best === null || b.maxY > best) best = b.maxY;
  }
  return best;
}

/** Slide-move along one horizontal axis with step-up. Returns true if blocked. */
function moveAxis(world: CollisionWorld, s: PlayerSim, axis: 'x' | 'z', d: number, grounded: boolean): boolean {
  if (d === 0) return false;
  const nx = axis === 'x' ? s.px + d : s.px;
  const nz = axis === 'z' ? s.pz + d : s.pz;
  if (!blocked(world, nx, s.py, nz)) {
    s.px = nx;
    s.pz = nz;
    return false;
  }
  if (grounded && !blocked(world, nx, s.py + MARINE.stepHeight, nz) && !blocked(world, s.px, s.py + MARINE.stepHeight, s.pz)) {
    s.px = nx;
    s.pz = nz;
    s.py += MARINE.stepHeight; // settled back onto the tread by the ground snap
    return false;
  }
  // push flush against whatever blocks us
  let limit = d > 0 ? Infinity : -Infinity;
  for (const b of world.boxes) {
    if (s.py + H <= b.minY + 1e-5 || s.py >= b.maxY - 1e-5) continue;
    const otherMin = axis === 'x' ? s.pz - R : s.px - R;
    const otherMax = axis === 'x' ? s.pz + R : s.px + R;
    const bo0 = axis === 'x' ? b.minZ : b.minX;
    const bo1 = axis === 'x' ? b.maxZ : b.maxX;
    if (otherMax <= bo0 + 1e-5 || otherMin >= bo1 - 1e-5) continue;
    const a0 = axis === 'x' ? b.minX : b.minZ;
    const a1 = axis === 'x' ? b.maxX : b.maxZ;
    const cur = axis === 'x' ? s.px : s.pz;
    if (d > 0 && a0 >= cur + R - 1e-5) limit = Math.min(limit, a0 - R - SKIN);
    if (d < 0 && a1 <= cur - R + 1e-5) limit = Math.max(limit, a1 + R + SKIN);
  }
  if (d > 0 && limit !== Infinity) {
    const to = Math.min(limit, axis === 'x' ? s.px + d : s.pz + d);
    if (axis === 'x') s.px = Math.max(s.px, to);
    else s.pz = Math.max(s.pz, to);
  } else if (d < 0 && limit !== -Infinity) {
    const to = Math.max(limit, axis === 'x' ? s.px + d : s.pz + d);
    if (axis === 'x') s.px = Math.min(s.px, to);
    else s.pz = Math.min(s.pz, to);
  }
  return true;
}

export function stepMarineMovement(s: PlayerSim, input: InputFrame, world: CollisionWorld, out: StepResult): void {
  const dt = TICK_DT;
  const ox = s.px;
  const oy = s.py;
  const oz = s.pz;
  s.yaw = input.yaw;
  s.pitch = input.pitch;
  const wasGrounded = s.surface === SurfaceState.Ground;

  // sprint: forward intent, key held, not firing. Firing cancels sprint immediately.
  const sprinting = input.sprint && input.moveZ > 0.5 && !input.primary;
  s.sprinting = sprinting ? 1 : 0;

  const fwdSpeed = sprinting ? MARINE.sprintSpeed : MARINE.walkSpeed;
  const wl = input.moveX * MARINE.strafeSpeed;
  const wf = input.moveZ * (input.moveZ > 0 ? fwdSpeed : MARINE.backwardSpeed);
  const f = forwardH(s.yaw);
  const r = rightH(s.yaw);
  const wishX = r.x * wl + f.x * wf;
  const wishZ = r.z * wl + f.z * wf;

  if (wasGrounded) {
    const dx = wishX - s.vx;
    const dz = wishZ - s.vz;
    const l = Math.hypot(dx, dz);
    if (l > 1e-9) {
      const step = Math.max(MARINE.groundAcceleration, MARINE.friction * l) * dt;
      if (step >= l) {
        s.vx = wishX;
        s.vz = wishZ;
      } else {
        s.vx += (dx / l) * step;
        s.vz += (dz / l) * step;
      }
    }
  } else {
    const ws = Math.hypot(wishX, wishZ);
    if (ws > 1e-9) {
      const wdx = wishX / ws;
      const wdz = wishZ / ws;
      const addSpeed = ws - (s.vx * wdx + s.vz * wdz);
      if (addSpeed > 0) {
        const a = Math.min(MARINE.airAcceleration * dt, addSpeed);
        s.vx += wdx * a;
        s.vz += wdz * a;
      }
    }
  }
  const hs = Math.hypot(s.vx, s.vz);
  if (hs > MARINE.horizontalSpeedCap) {
    const k = MARINE.horizontalSpeedCap / hs;
    s.vx *= k;
    s.vz *= k;
  }

  // jump / gravity
  if (wasGrounded && input.jump) {
    s.vy = MARINE.jumpImpulse;
    out.jumped = true;
  } else if (!wasGrounded) {
    s.vy -= MARINE.gravity * dt;
  } else {
    s.vy = 0;
  }
  const groundedForStep = wasGrounded && !out.jumped;

  // horizontal collision (axis separated)
  if (moveAxis(world, s, 'x', s.vx * dt, groundedForStep)) s.vx = 0;
  if (moveAxis(world, s, 'z', s.vz * dt, groundedForStep)) s.vz = 0;

  // vertical
  let grounded = false;
  if (s.vy > 0) {
    const ny = s.py + s.vy * dt;
    if (blocked(world, s.px, ny, s.pz)) {
      let lowest = Infinity;
      for (const b of world.boxes) {
        if (s.px + R <= b.minX + 1e-5 || s.px - R >= b.maxX - 1e-5) continue;
        if (s.pz + R <= b.minZ + 1e-5 || s.pz - R >= b.maxZ - 1e-5) continue;
        if (b.minY >= s.py + H - 1e-5 && b.minY < ny + H) lowest = Math.min(lowest, b.minY);
      }
      s.py = lowest === Infinity ? s.py : lowest - H - SKIN;
      s.vy = 0;
    } else {
      s.py = ny;
    }
  } else {
    const drop = Math.max(-s.vy * dt, wasGrounded && !out.jumped ? MARINE.stepHeight + 0.02 : 0);
    const sup = supportBelow(world, s.px, s.py, s.pz, drop + 1e-4);
    if (sup !== null && sup >= s.py + s.vy * dt - 1e-6) {
      if (!wasGrounded) out.landed = true;
      s.py = sup;
      s.vy = 0;
      grounded = true;
    } else {
      s.py += s.vy * dt;
    }
  }
  s.surface = grounded ? SurfaceState.Ground : SurfaceState.Air;
  s.nx = 0;
  s.ny = 1;
  s.nz = 0;
  out.moved = Math.hypot(s.px - ox, s.py - oy, s.pz - oz);
}

export const marineSpeedFactor = (s: PlayerSim): number => clamp(Math.hypot(s.vx, s.vz) / MARINE.walkSpeed, 0, 1);
