export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const DEG = Math.PI / 180;

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const madd = (a: Vec3, b: Vec3, s: number): Vec3 => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
export const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export function normalize(a: Vec3, fallback: Vec3 = { x: 0, y: 1, z: 0 }): Vec3 {
  const l = Math.hypot(a.x, a.y, a.z);
  if (l < 1e-9) return { ...fallback };
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

/** Component of `a` lying in the plane with unit normal `n`. */
export const projectOnPlane = (a: Vec3, n: Vec3): Vec3 => madd(a, n, -dot(a, n));

/**
 * View direction. Yaw 0 / pitch 0 looks down -Z; +yaw turns left (towards -X); +pitch looks up.
 * Matches three.js camera with rotation order YXZ.
 */
export function viewDir(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}
/** Horizontal forward and right for a yaw. */
export const forwardH = (yaw: number): Vec3 => ({ x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) });
export const rightH = (yaw: number): Vec3 => ({ x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) });

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

/** Deterministic 32-bit hash -> [0,1). Used for shot spread so client tracers match server rays. */
export function hash01(seed: number, n: number, salt: number): number {
  let h = (seed ^ Math.imul(n + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x7f4a7c15, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
