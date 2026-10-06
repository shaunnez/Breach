import { RIPPER, RIPPER_EXTRA, TICK_DT } from '../balance';
import { SurfaceState } from '../enums';
import {
  add,
  clamp,
  cross,
  dot,
  forwardH,
  len,
  madd,
  normalize,
  projectOnPlane,
  rightH,
  scale,
  v3,
  viewDir,
  type Vec3,
} from '../math';
import type { InputFrame } from '../protocol';
import type { CollisionWorld, SurfaceContact } from '../map/collision';
import type { PlayerSim, StepResult } from './state';

const R = RIPPER.colliderRadius;
const REST = R + RIPPER_EXTRA.restGap;
const PROBE = RIPPER.surfaceProbeDistance;
const GRACE = RIPPER.detachGraceMs / 1000;
const UP: Vec3 = { x: 0, y: 1, z: 0 };
/** Seconds after losing a surface during which a leap is still honoured (coyote time). */
const LEAP_COYOTE = GRACE + 0.13;

export function classifySurface(ny: number): SurfaceState {
  if (ny > 0.7) return SurfaceState.Ground;
  if (ny < -0.7) return SurfaceState.Ceiling;
  return SurfaceState.Wall;
}

export interface SurfaceFrame {
  /** direction W moves along the surface */
  tf: Vec3;
  /** direction D moves along the surface */
  tr: Vec3;
  /** the surface's natural "up" direction used when looking into the surface */
  up: Vec3;
}

/**
 * Camera-relative surface frame. W travels along the surface towards where the (horizon-biased)
 * camera looks; looking straight into a wall converts the "into" component to wall-up, so a
 * Ripper running at a wall naturally climbs it. Strafe follows screen-right.
 */
export function surfaceFrame(n: Vec3, yaw: number, pitch: number): SurfaceFrame {
  const L = viewDir(yaw, pitch);
  const fh = forwardH(yaw);
  const Rh = rightH(yaw);
  const up = Math.abs(n.y) > 0.7 ? fh : normalize(projectOnPlane(UP, n), fh);
  const Lp = projectOnPlane(L, n);
  const into = Math.max(0, -dot(L, n));
  const tf = normalize(madd(Lp, up, into), up);
  const Rp = projectOnPlane(Rh, n);
  const rl = clamp(len(Rp), 0, 1);
  const body = cross(tf, n);
  let tr = add(scale(Rp, rl), scale(body, 1 - rl));
  tr = projectOnPlane(tr, tf);
  tr = normalize(tr, body);
  return { tf, tr, up };
}

function moveToward(v: Vec3, target: Vec3, maxStep: number): Vec3 {
  const d = { x: target.x - v.x, y: target.y - v.y, z: target.z - v.z };
  const l = len(d);
  if (l <= maxStep || l < 1e-9) return { ...target };
  return madd(v, d, maxStep / l);
}

function setSurface(s: PlayerSim, n: Vec3, out: StepResult): void {
  const prev = s.surface;
  s.nx = n.x;
  s.ny = n.y;
  s.nz = n.z;
  s.surface = classifySurface(n.y);
  if (prev !== s.surface && out.attached === -1) out.attached = s.surface;
}

/** Rotate momentum from one surface onto the next: into-surface speed becomes travel away from the old surface. */
function redirect(vt: Vec3, oldN: Vec3, newN: Vec3, factor: number): Vec3 {
  const vin = Math.max(0, -dot(vt, newN));
  const hint = normalize(projectOnPlane(oldN, newN), projectOnPlane(UP, newN));
  return madd(projectOnPlane(vt, newN), hint, vin * factor);
}

export function stepRipperMovement(s: PlayerSim, input: InputFrame, world: CollisionWorld, out: StepResult): void {
  const dt = TICK_DT;
  const ox = s.px;
  const oy = s.py;
  const oz = s.pz;
  s.yaw = input.yaw;
  s.pitch = input.pitch;
  s.sprinting = 0;

  // timers
  s.leapCd = Math.max(0, s.leapCd - dt);
  s.lockT = Math.max(0, s.lockT - dt);
  s.energyIdle += dt;
  if (s.energyIdle >= RIPPER.energyRegenDelaySec) {
    s.energy = Math.min(RIPPER.maxEnergy, s.energy + RIPPER.energyRegenPerSec * dt);
  }

  const jumpPressed = input.jump && !s.prevJump;
  s.prevJump = input.jump ? 1 : 0;

  const n: Vec3 = { x: s.nx, y: s.ny, z: s.nz };
  let v: Vec3 = { x: s.vx, y: s.vy, z: s.vz };
  const frame = surfaceFrame(n, s.yaw, s.pitch);
  const mx = input.moveX;
  const mz = input.moveZ;
  const hasInput = Math.hypot(mx, mz) > 0.05;
  const wish = hasInput ? add(scale(frame.tf, mz), scale(frame.tr, mx)) : v3();
  const attached = s.surface !== SurfaceState.Air;

  // ---- leap / drop ---------------------------------------------------------------------------
  if (jumpPressed && s.leapCd <= 0 && s.energy >= RIPPER.leapEnergyCost && (attached || s.detachT < LEAP_COYOTE)) {
    const base = attached ? projectOnPlane(v, n) : v;
    const look = viewDir(s.yaw, s.pitch);
    v = madd(madd(base, look, RIPPER.leapForwardImpulse), n, RIPPER.leapBiasImpulse);
    const hs = Math.hypot(v.x, v.z);
    if (hs > RIPPER_EXTRA.airSpeedCap) {
      v.x *= RIPPER_EXTRA.airSpeedCap / hs;
      v.z *= RIPPER_EXTRA.airSpeedCap / hs;
    }
    s.energy -= RIPPER.leapEnergyCost;
    s.energyIdle = 0;
    s.leapCd = RIPPER.leapCooldownSec;
    s.lockT = RIPPER_EXTRA.leapLockoutSec;
    s.surface = SurfaceState.Air;
    s.detachT = 999;
    out.leaped = true;
    out.detachReason = 'leap';
  } else if (attached && s.surface !== SurfaceState.Ground && !input.cling) {
    // cling released on a wall/ceiling: fall off
    v = projectOnPlane(v, n);
    s.surface = SurfaceState.Air;
    s.detachT = 999;
    out.detachReason = 'drop';
  } else if (attached && input.secondary && s.lockT <= 0) {
    v = projectOnPlane(v, n);
    s.surface = SurfaceState.Air;
    s.lockT = 0.2;
    s.detachT = 999;
    out.detachReason = 'drop';
  }

  if (s.surface !== SurfaceState.Air) {
    attachedStep(s, n, v, wish, hasInput, input.cling, world, out);
  } else {
    airStep(s, n, v, hasInput, mx, mz, input.cling, frame, world, out);
  }
  out.moved = Math.hypot(s.px - ox, s.py - oy, s.pz - oz);
}

function attachedStep(s: PlayerSim, n0: Vec3, v0: Vec3, wish: Vec3, hasInput: boolean, cling: boolean, world: CollisionWorld, out: StepResult): void {
  const dt = TICK_DT;
  let n = n0;
  let vt = projectOnPlane(v0, n);
  const ground = s.surface === SurfaceState.Ground;

  // tangential acceleration
  if (hasInput) {
    const wl = len(wish);
    const dir = wl > 1 ? scale(wish, 1 / wl) : wish;
    const target = scale(dir, (ground ? RIPPER.groundSpeed : RIPPER.surfaceSpeed) * Math.min(1, wl));
    const dl = len(add(target, scale(vt, -1)));
    vt = moveToward(vt, target, Math.max(RIPPER.surfaceAcceleration, 10 * dl) * dt);
  } else {
    const sp = len(vt);
    const dec = (ground ? RIPPER_EXTRA.groundIdleDecel : RIPPER_EXTRA.surfaceIdleDecel) * dt;
    vt = sp <= dec ? v3() : scale(vt, (sp - dec) / sp);
  }
  const sp0 = len(vt);
  if (sp0 > RIPPER.maxTraversalSpeed) {
    const target = RIPPER.maxTraversalSpeed;
    const ns = Math.max(target, sp0 - RIPPER_EXTRA.overspeedDecel * dt);
    vt = scale(vt, ns / sp0);
  }

  const p: Vec3 = { x: s.px, y: s.py, z: s.pz };
  const sub = clamp(Math.ceil((len(vt) * dt) / 0.1), 1, 4);
  const h = dt / sub;
  let lostSurface = 0;
  for (let i = 0; i < sub; i++) {
    p.x += vt.x * h;
    p.y += vt.y * h;
    p.z += vt.z * h;

    // --- collisions: slide, or transition onto the surface ahead
    const contacts = world.pushOutSphere(p, R);
    for (const c of contacts) {
      const cn: Vec3 = { x: c.nx, y: c.ny, z: c.nz };
      const align = dot(cn, n);
      const into = -dot(vt, cn);
      if (align > 0.75 || into <= 0.05) continue;
      if (align < -0.3) {
        vt = madd(vt, cn, into); // opposing / reverse surface: just slide
        continue;
      }
      const speed = len(vt);
      const newGround = cn.y > 0.7;
      const stepFace = ground && Math.abs(cn.y) < 0.2 && c.box.maxY - (p.y - REST) <= 0.36;
      const intent = hasInput && dot(normalize(wish), scale(cn, -1)) > 0.25;
      if (newGround || stepFace || (cling && speed >= RIPPER.minWallAttachSpeed && intent)) {
        vt = redirect(vt, n, cn, 1);
        n = cn;
        setSurface(s, n, out);
      } else {
        vt = madd(vt, cn, into); // slow or not pressing into it: slide along
      }
    }

    // --- adhesion: stay on the nearest reachable surface (rounds convex edges)
    const near = world.surfacesNear(p.x, p.y, p.z, PROBE);
    let best: SurfaceContact | null = null;
    let bestScore = Infinity;
    for (const c of near) {
      const a = c.nx * n.x + c.ny * n.y + c.nz * n.z;
      if (a < -0.3) continue;
      if (!cling && c.ny <= 0.7) continue; // walk through doorways without snapping to the frame
      const score = c.dist - 0.12 * a;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best) {
      const bn: Vec3 = { x: best.nx, y: best.ny, z: best.nz };
      const gap = REST - best.dist;
      p.x += bn.x * gap;
      p.y += bn.y * gap;
      p.z += bn.z * gap;
      // keep momentum when the normal swings around an edge
      const sp = len(vt);
      n = bn;
      vt = projectOnPlane(vt, n);
      const nl = len(vt);
      if (nl > 1e-6) vt = scale(vt, sp / nl);
      setSurface(s, n, out);
      s.detachT = 0;
      lostSurface = 0;
    } else {
      lostSurface += h;
    }
  }
  if (lostSurface > 0) s.detachT += lostSurface;

  s.px = p.x;
  s.py = p.y;
  s.pz = p.z;
  s.vx = vt.x;
  s.vy = vt.y;
  s.vz = vt.z;

  if (s.detachT > GRACE) {
    s.surface = SurfaceState.Air;
    out.detachReason = 'no-surface';
  } else if (s.surface !== SurfaceState.Ground && len(vt) < RIPPER_EXTRA.minWallSustainSpeed) {
    s.surface = SurfaceState.Air;
    s.detachT = 999;
    out.detachReason = 'slow';
  }
}

function airStep(
  s: PlayerSim,
  n: Vec3,
  v0: Vec3,
  hasInput: boolean,
  mx: number,
  mz: number,
  cling: boolean,
  frame: SurfaceFrame,
  world: CollisionWorld,
  out: StepResult,
): void {
  const dt = TICK_DT;
  let v = v0;
  s.detachT = Math.min(s.detachT + dt, 999);
  v = { ...v, y: v.y - RIPPER_EXTRA.airGravity * dt };

  if (hasInput) {
    const f = forwardH(s.yaw);
    const r = rightH(s.yaw);
    const wx = r.x * mx + f.x * mz;
    const wz = r.z * mx + f.z * mz;
    const wl = Math.hypot(wx, wz);
    if (wl > 1e-6) {
      const dx = wx / wl;
      const dz = wz / wl;
      const addSpeed = RIPPER.groundSpeed - (v.x * dx + v.z * dz);
      if (addSpeed > 0) {
        const a = Math.min(RIPPER.airAcceleration * dt, addSpeed);
        v = { x: v.x + dx * a, y: v.y, z: v.z + dz * a };
      }
    }
  }
  const hs = Math.hypot(v.x, v.z);
  if (hs > RIPPER_EXTRA.airSpeedCap) {
    v.x *= RIPPER_EXTRA.airSpeedCap / hs;
    v.z *= RIPPER_EXTRA.airSpeedCap / hs;
  }
  v.y = Math.max(v.y, -30);

  const p: Vec3 = { x: s.px, y: s.py, z: s.pz };
  const sub = clamp(Math.ceil((len(v) * dt) / 0.1), 1, 4);
  const h = dt / sub;
  let attachedNow = false;
  let nn = n;
  for (let i = 0; i < sub && !attachedNow; i++) {
    p.x += v.x * h;
    p.y += v.y * h;
    p.z += v.z * h;
    const contacts = world.pushOutSphere(p, R);
    for (const c of contacts) {
      const cn: Vec3 = { x: c.nx, y: c.ny, z: c.nz };
      const into = -dot(v, cn);
      if (into <= 0) continue;
      const speed = len(v);
      if (s.lockT <= 0 && (cn.y > 0.7 || (cling && speed >= RIPPER.minWallAttachSpeed))) {
        if (cn.y > 0.7) {
          v = projectOnPlane(v, cn);
          out.landed = true;
        } else {
          // wall / ceiling catch: convert part of the impact into travel along intent
          const tf = surfaceFrame(cn, s.yaw, s.pitch).tf;
          const tang = projectOnPlane(v, cn);
          const dir = hasInput ? tf : normalize(tang, tf);
          v = madd(tang, dir, into * RIPPER_EXTRA.landConversion);
        }
        nn = cn;
        attachedNow = true;
        break;
      }
      v = madd(v, cn, into); // slide
    }
  }
  s.px = p.x;
  s.py = p.y;
  s.pz = p.z;
  s.vx = v.x;
  s.vy = v.y;
  s.vz = v.z;
  if (attachedNow) {
    setSurface(s, nn, out);
    s.detachT = 0;
  }
}
