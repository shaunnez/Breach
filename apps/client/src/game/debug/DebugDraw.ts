import * as THREE from 'three';

/** Immediate-mode line drawing for debug visualisation (colliders, hurt volumes, rays, probes...). */
export class DebugDraw {
  readonly object: THREE.LineSegments;
  private pos: Float32Array;
  private col: Float32Array;
  private n = 0;
  private readonly max: number;
  private readonly geo = new THREE.BufferGeometry();
  private tmp = new THREE.Color();

  constructor(maxSegments = 6000) {
    this.max = maxSegments;
    this.pos = new Float32Array(maxSegments * 6);
    this.col = new Float32Array(maxSegments * 6);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.95, fog: false });
    this.object = new THREE.LineSegments(this.geo, mat);
    this.object.frustumCulled = false;
    this.object.renderOrder = 999;
    this.object.visible = false;
  }

  begin(): void {
    this.n = 0;
  }

  line(ax: number, ay: number, az: number, bx: number, by: number, bz: number, color: number): void {
    if (this.n >= this.max) return;
    this.tmp.setHex(color);
    const i = this.n * 6;
    this.pos[i] = ax;
    this.pos[i + 1] = ay;
    this.pos[i + 2] = az;
    this.pos[i + 3] = bx;
    this.pos[i + 4] = by;
    this.pos[i + 5] = bz;
    for (let k = 0; k < 2; k++) {
      this.col[i + k * 3] = this.tmp.r;
      this.col[i + k * 3 + 1] = this.tmp.g;
      this.col[i + k * 3 + 2] = this.tmp.b;
    }
    this.n++;
  }

  box(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, color: number): void {
    const x = [minX, maxX];
    const y = [minY, maxY];
    const z = [minZ, maxZ];
    for (const yy of y) {
      this.line(x[0], yy, z[0], x[1], yy, z[0], color);
      this.line(x[1], yy, z[0], x[1], yy, z[1], color);
      this.line(x[1], yy, z[1], x[0], yy, z[1], color);
      this.line(x[0], yy, z[1], x[0], yy, z[0], color);
    }
    for (const xx of x) for (const zz of z) this.line(xx, y[0], zz, xx, y[1], zz, color);
  }

  circle(cx: number, cy: number, cz: number, r: number, ax: 'x' | 'y' | 'z', color: number, seg = 16): void {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const p = (a: number): [number, number, number] =>
        ax === 'y' ? [cx + Math.cos(a) * r, cy, cz + Math.sin(a) * r] : ax === 'x' ? [cx, cy + Math.cos(a) * r, cz + Math.sin(a) * r] : [cx + Math.cos(a) * r, cy + Math.sin(a) * r, cz];
      const [x0, y0, z0] = p(a0);
      const [x1, y1, z1] = p(a1);
      this.line(x0, y0, z0, x1, y1, z1, color);
    }
  }

  sphere(cx: number, cy: number, cz: number, r: number, color: number): void {
    this.circle(cx, cy, cz, r, 'x', color);
    this.circle(cx, cy, cz, r, 'y', color);
    this.circle(cx, cy, cz, r, 'z', color);
  }

  capsule(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, r: number, color: number): void {
    this.sphere(a.x, a.y, a.z, r, color);
    this.sphere(b.x, b.y, b.z, r, color);
    this.line(a.x + r, a.y, a.z, b.x + r, b.y, b.z, color);
    this.line(a.x - r, a.y, a.z, b.x - r, b.y, b.z, color);
    this.line(a.x, a.y, a.z + r, b.x, b.y, b.z + r, color);
    this.line(a.x, a.y, a.z - r, b.x, b.y, b.z - r, color);
  }

  arrow(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, color: number): void {
    this.line(ox, oy, oz, ox + dx, oy + dy, oz + dz, color);
    this.sphere(ox + dx, oy + dy, oz + dz, 0.04, color);
  }

  end(): void {
    // zero the tail so stale segments don't render
    this.geo.setDrawRange(0, this.n * 2);
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  set visible(v: boolean) {
    this.object.visible = v;
  }
  get visible(): boolean {
    return this.object.visible;
  }
}
