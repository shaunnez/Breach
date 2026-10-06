import type { Vec3 } from './math';
import { add, dot, scale, sub } from './math';

/** Closest points between segments p1-q1 and p2-q2; returns squared distance. (Ericson, RTCD) */
export function segSegDistSq(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): number {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  let s: number;
  let t: number;
  const EPS = 1e-9;
  if (a <= EPS && e <= EPS) return dot(r, r);
  if (a <= EPS) {
    s = 0;
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = dot(d1, r);
    if (e <= EPS) {
      t = 0;
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom > EPS ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  const c1 = add(p1, scale(d1, s));
  const c2 = add(p2, scale(d2, t));
  const d = sub(c1, c2);
  return dot(d, d);
}

/** Closest point on segment a-b to point p. */
export function closestOnSegment(a: Vec3, b: Vec3, p: Vec3): Vec3 {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-12) return { ...a };
  const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2));
  return add(a, scale(ab, t));
}

/** Ray vs capsule (segment a-b, radius r). Returns t along unit dir or null. */
export function rayCapsule(o: Vec3, d: Vec3, a: Vec3, b: Vec3, r: number, maxT: number): number | null {
  // Sample the minimal distance via analytic cylinder + sphere caps.
  const ba = sub(b, a);
  const oa = sub(o, a);
  const baba = dot(ba, ba);
  const bard = dot(ba, d);
  const baoa = dot(ba, oa);
  const rdoa = dot(d, oa);
  const oaoa = dot(oa, oa);
  let best: number | null = null;
  const consider = (t: number) => {
    if (t >= 0 && t <= maxT && (best === null || t < best)) best = t;
  };
  const sphere = (c: Vec3) => {
    const oc = sub(o, c);
    const bq = dot(oc, d);
    const cq = dot(oc, oc) - r * r;
    const disc = bq * bq - cq;
    if (disc < 0) return;
    const sq = Math.sqrt(disc);
    const t0 = -bq - sq;
    const t1 = -bq + sq;
    if (t0 >= 0) consider(t0);
    else if (t1 >= 0) consider(0); // origin inside sphere
  };
  if (baba > 1e-12) {
    const A = baba - bard * bard;
    const B = baba * rdoa - baoa * bard;
    const C = baba * oaoa - baoa * baoa - r * r * baba;
    if (A > 1e-12) {
      const h = B * B - A * C;
      if (h >= 0) {
        const t = (-B - Math.sqrt(h)) / A;
        const y = baoa + t * bard;
        if (y > 0 && y < baba && t >= 0) consider(t);
      }
    }
  }
  sphere(a);
  sphere(b);
  return best;
}

/** Ray vs axis-aligned box. Returns the entry t along unit dir (0 if the origin is inside) or null. */
export function rayAabb(o: Vec3, d: Vec3, min: Vec3, max: Vec3, maxT: number): number | null {
  let t0 = 0;
  let t1 = maxT;
  for (const k of ['x', 'y', 'z'] as const) {
    if (Math.abs(d[k]) < 1e-12) {
      if (o[k] < min[k] || o[k] > max[k]) return null;
      continue;
    }
    let a = (min[k] - o[k]) / d[k];
    let b = (max[k] - o[k]) / d[k];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}

/** Closest point on (or in) an axis-aligned box to p. */
export function closestOnAabb(min: Vec3, max: Vec3, p: Vec3): Vec3 {
  return { x: Math.min(max.x, Math.max(min.x, p.x)), y: Math.min(max.y, Math.max(min.y, p.y)), z: Math.min(max.z, Math.max(min.z, p.z)) };
}
