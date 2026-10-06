import { MARINE, MARINE_HURT, RIPPER_EXTRA, WEAVER } from '../balance';
import { PlayerClass } from '../enums';
import { add, madd, normalize, scale, viewDir, type Vec3 } from '../math';
import type { InputFrame } from '../protocol';
import type { CollisionWorld } from '../map/collision';
import { stepWalkerMovement, walkerProfile } from './marine';
import { surfaceFrame, stepRipperMovement } from './ripper';
import { spreadOffset, stepWeapon } from './weapon';
import type { PlayerSim, StepResult } from './state';
import { resetStepResult } from './state';

/** Advance one fixed 1/60 s tick of one player from one input frame. Mutates `s` and `out`. */
export function stepPlayer(s: PlayerSim, input: InputFrame, world: CollisionWorld, out: StepResult): StepResult {
  resetStepResult(out);
  if (s.cls === PlayerClass.Ripper) stepRipperMovement(s, input, world, out);
  else stepWalkerMovement(s, input, world, out, walkerProfile(s.cls));
  // weapons use post-move state (spread depends on speed)
  stepWeapon(s, input, out);
  return out;
}

/** Camera / ray origin. Walkers: eye height. Ripper: 0.28 m off the surface along its normal. */
export function eyePosition(s: PlayerSim): Vec3 {
  if (s.cls === PlayerClass.Marine) return { x: s.px, y: s.py + MARINE.eyeHeight, z: s.pz };
  if (s.cls === PlayerClass.Weaver) return { x: s.px, y: s.py + WEAVER.eyeHeight, z: s.pz };
  return { x: s.px + s.nx * 0.28, y: s.py + s.ny * 0.28, z: s.pz + s.nz * 0.28 };
}

/** Ray used for a rifle shot: aim direction plus deterministic spread. */
export function shotRay(s: PlayerSim, shotIndex: number, spreadDeg: number): { origin: Vec3; dir: Vec3 } {
  const fwd = viewDir(s.yaw, s.pitch);
  const right = normalize({ x: -fwd.z, y: 0, z: fwd.x }, { x: 1, y: 0, z: 0 });
  const up = normalize({ x: right.y * fwd.z - right.z * fwd.y, y: right.z * fwd.x - right.x * fwd.z, z: right.x * fwd.y - right.y * fwd.x });
  const o = spreadOffset(s.seed, shotIndex, spreadDeg);
  const dir = normalize(add(add(fwd, scale(right, o.a)), scale(up, o.b)));
  return { origin: eyePosition(s), dir };
}

export interface Capsule {
  a: Vec3;
  b: Vec3;
  r: number;
}

/** Server-side hurt volume (never a collider). */
export function hurtCapsule(s: PlayerSim): Capsule {
  if (s.cls === PlayerClass.Marine) {
    return {
      a: { x: s.px, y: s.py + MARINE_HURT.bottom, z: s.pz },
      b: { x: s.px, y: s.py + MARINE_HURT.top, z: s.pz },
      r: MARINE_HURT.radius,
    };
  }
  if (s.cls === PlayerClass.Weaver) {
    return { a: { x: s.px, y: s.py + WEAVER.hurtBottom, z: s.pz }, b: { x: s.px, y: s.py + WEAVER.hurtTop, z: s.pz }, r: WEAVER.hurtRadius };
  }
  const f = surfaceFrame({ x: s.nx, y: s.ny, z: s.nz }, s.yaw, s.pitch).tf;
  const c: Vec3 = { x: s.px, y: s.py, z: s.pz };
  return { a: madd(c, f, RIPPER_EXTRA.hurtHalfSegment), b: madd(c, f, -RIPPER_EXTRA.hurtHalfSegment), r: RIPPER_EXTRA.hurtRadius };
}

/** Origin of a Ripper bite / Weaver melee (centre of the head sweep). */
export function biteOrigin(s: PlayerSim): Vec3 {
  return eyePosition(s);
}

