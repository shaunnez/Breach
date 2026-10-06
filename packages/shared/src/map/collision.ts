import type { Vec3 } from '../math';

export type BoxKind = 'floor' | 'wall' | 'ceiling' | 'prop' | 'vent' | 'ledge';

/** All VS01 collision is axis-aligned boxes (see docs/DECISIONS.md D-02). */
export interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  kind: BoxKind;
}

export interface RayHit {
  t: number;
  nx: number;
  ny: number;
  nz: number;
  box: Box;
}

export interface SurfaceContact {
  /** distance from query point to the box surface (0 if inside) */
  dist: number;
  nx: number;
  ny: number;
  nz: number;
  qx: number;
  qy: number;
  qz: number;
  box: Box;
}

const EPS = 1e-9;

export class CollisionWorld {
  readonly boxes: Box[];
  constructor(boxes: Box[]) {
    this.boxes = boxes;
  }

  /** Nearest hit along a ray (direction need not be normalised but t is in units of `d`). */
  rayCast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): RayHit | null {
    let best: RayHit | null = null;
    let bestT = maxT;
    for (const b of this.boxes) {
      let tmin = 0;
      let tmax = bestT;
      let nx = 0;
      let ny = 0;
      let nz = 0;
      // X slab
      if (Math.abs(dx) < EPS) {
        if (ox < b.minX || ox > b.maxX) continue;
      } else {
        let t1 = (b.minX - ox) / dx;
        let t2 = (b.maxX - ox) / dx;
        let sn = -1;
        if (t1 > t2) {
          [t1, t2] = [t2, t1];
          sn = 1;
        }
        if (t1 > tmin) {
          tmin = t1;
          nx = sn;
          ny = 0;
          nz = 0;
        }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }
      if (Math.abs(dy) < EPS) {
        if (oy < b.minY || oy > b.maxY) continue;
      } else {
        let t1 = (b.minY - oy) / dy;
        let t2 = (b.maxY - oy) / dy;
        let sn = -1;
        if (t1 > t2) {
          [t1, t2] = [t2, t1];
          sn = 1;
        }
        if (t1 > tmin) {
          tmin = t1;
          nx = 0;
          ny = sn;
          nz = 0;
        }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }
      if (Math.abs(dz) < EPS) {
        if (oz < b.minZ || oz > b.maxZ) continue;
      } else {
        let t1 = (b.minZ - oz) / dz;
        let t2 = (b.maxZ - oz) / dz;
        let sn = -1;
        if (t1 > t2) {
          [t1, t2] = [t2, t1];
          sn = 1;
        }
        if (t1 > tmin) {
          tmin = t1;
          nx = 0;
          ny = 0;
          nz = sn;
        }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }
      if (tmin <= bestT && (nx !== 0 || ny !== 0 || nz !== 0)) {
        bestT = tmin;
        best = { t: tmin, nx, ny, nz, box: b };
      }
    }
    return best;
  }

  /** True if the open segment from a to b is unobstructed by map geometry. */
  lineOfSight(a: Vec3, b: Vec3): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-6) return true;
    return !this.rayCast(a.x, a.y, a.z, dx / l, dy / l, dz / l, l - 1e-4);
  }

  /** Closest-point contact between point p and a box. Normal points from the box towards p. */
  static contactWith(b: Box, px: number, py: number, pz: number): SurfaceContact {
    const qx = px < b.minX ? b.minX : px > b.maxX ? b.maxX : px;
    const qy = py < b.minY ? b.minY : py > b.maxY ? b.maxY : py;
    const qz = pz < b.minZ ? b.minZ : pz > b.maxZ ? b.maxZ : pz;
    const dx = px - qx;
    const dy = py - qy;
    const dz = pz - qz;
    const d = Math.hypot(dx, dy, dz);
    if (d > 1e-7) return { dist: d, nx: dx / d, ny: dy / d, nz: dz / d, qx, qy, qz, box: b };
    // inside the box: exit through the nearest face
    const exits = [
      { d: px - b.minX, nx: -1, ny: 0, nz: 0, qx: b.minX, qy: py, qz: pz },
      { d: b.maxX - px, nx: 1, ny: 0, nz: 0, qx: b.maxX, qy: py, qz: pz },
      { d: py - b.minY, nx: 0, ny: -1, nz: 0, qx: px, qy: b.minY, qz: pz },
      { d: b.maxY - py, nx: 0, ny: 1, nz: 0, qx: px, qy: b.maxY, qz: pz },
      { d: pz - b.minZ, nx: 0, ny: 0, nz: -1, qx: px, qy: py, qz: b.minZ },
      { d: b.maxZ - pz, nx: 0, ny: 0, nz: 1, qx: px, qy: py, qz: b.maxZ },
    ];
    let e = exits[0];
    for (const c of exits) if (c.d < e.d) e = c;
    return { dist: -e.d, nx: e.nx, ny: e.ny, nz: e.nz, qx: e.qx, qy: e.qy, qz: e.qz, box: b };
  }

  /** All box contacts within maxDist of p (sphere centre), nearest first. */
  surfacesNear(px: number, py: number, pz: number, maxDist: number): SurfaceContact[] {
    const out: SurfaceContact[] = [];
    for (const b of this.boxes) {
      if (px < b.minX - maxDist || px > b.maxX + maxDist) continue;
      if (py < b.minY - maxDist || py > b.maxY + maxDist) continue;
      if (pz < b.minZ - maxDist || pz > b.maxZ + maxDist) continue;
      const c = CollisionWorld.contactWith(b, px, py, pz);
      if (c.dist <= maxDist) out.push(c);
    }
    out.sort((a, b) => a.dist - b.dist);
    return out;
  }

  /**
   * Push a sphere out of all overlapping boxes (mutates p). Returns the contacts that
   * produced a push (normal = push direction), strongest first.
   */
  pushOutSphere(p: Vec3, r: number, iterations = 4): SurfaceContact[] {
    const hits: SurfaceContact[] = [];
    for (let it = 0; it < iterations; it++) {
      let moved = false;
      for (const b of this.boxes) {
        if (p.x < b.minX - r || p.x > b.maxX + r) continue;
        if (p.y < b.minY - r || p.y > b.maxY + r) continue;
        if (p.z < b.minZ - r || p.z > b.maxZ + r) continue;
        const c = CollisionWorld.contactWith(b, p.x, p.y, p.z);
        if (c.dist < r) {
          const push = r - c.dist;
          p.x += c.nx * push;
          p.y += c.ny * push;
          p.z += c.nz * push;
          moved = true;
          if (!hits.some((h) => h.box === b && Math.abs(h.nx - c.nx) + Math.abs(h.ny - c.ny) + Math.abs(h.nz - c.nz) < 1e-3)) {
            hits.push(c);
          }
        }
      }
      if (!moved) break;
    }
    return hits;
  }

  /** Any box overlapping this AABB (strictly, with a small tolerance)? */
  aabbBlocked(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean {
    const e = 1e-5;
    for (const b of this.boxes) {
      if (maxX <= b.minX + e || minX >= b.maxX - e) continue;
      if (maxY <= b.minY + e || minY >= b.maxY - e) continue;
      if (maxZ <= b.minZ + e || minZ >= b.maxZ - e) continue;
      return true;
    }
    return false;
  }
}
