import * as THREE from 'three';
import { DOOR_OPENINGS, MAP_LIGHTS, ROOMS } from '@breach/shared';

/**
 * E8 environment pass v1 (core industrial kit stand-in): purely visual, non-colliding dressing that
 * makes the greybox legible and on-palette - door frames with hazard trim, floor hazard strips,
 * ceiling light fixtures, pipe runs, and Bloom biomass in the hive. Collision stays the shared boxes.
 */
function hazardTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#16181c';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#e0a02a';
  for (let i = -2; i < 6; i++) {
    g.beginPath();
    g.moveTo(i * 16, 64);
    g.lineTo(i * 16 + 16, 64);
    g.lineTo(i * 16 + 48, 0);
    g.lineTo(i * 16 + 32, 0);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class MapDecor {
  readonly group = new THREE.Group();
  /** ceiling-mounted dressing, hidden in the Commander's overhead view */
  readonly overhead = new THREE.Group();

  constructor() {
    const haz = hazardTexture();
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.5, metalness: 0.6 });
    const ventFrame = new THREE.MeshStandardMaterial({ color: 0x3a2a66, emissive: 0x6a3cff, emissiveIntensity: 0.9, roughness: 0.5 });
    const trim = new THREE.MeshStandardMaterial({ map: haz, roughness: 0.7 });
    const add = (m: THREE.Mesh) => this.group.add(m);
    const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      return m;
    };

    // door frames + threshold hazard strips
    for (const d of DOOR_OPENINGS) {
      const t = 0.16;
      const depth = 0.55;
      const mat = d.vent ? ventFrame : frameMat;
      const yMid = d.y0 + d.h / 2;
      if (d.axis === 'z') {
        add(box(t, d.h + t, depth, mat, d.c - d.w / 2 - t / 2, yMid + t / 2, d.plane));
        add(box(t, d.h + t, depth, mat, d.c + d.w / 2 + t / 2, yMid + t / 2, d.plane));
        add(box(d.w + 2 * t, t, depth, mat, d.c, d.y0 + d.h + t / 2, d.plane));
      } else {
        add(box(depth, d.h + t, t, mat, d.plane, yMid + t / 2, d.c - d.w / 2 - t / 2));
        add(box(depth, d.h + t, t, mat, d.plane, yMid + t / 2, d.c + d.w / 2 + t / 2));
        add(box(depth, t, d.w + 2 * t, mat, d.plane, d.y0 + d.h + t / 2, d.c));
      }
      if (!d.vent && d.y0 === 0) {
        const strip = d.axis === 'z' ? box(d.w, 0.012, 0.5, trim, d.c, 0.008, d.plane) : box(0.5, 0.012, d.w, trim, d.plane, 0.008, d.c);
        (strip.material as THREE.MeshStandardMaterial).map!.repeat.set(Math.max(2, d.w * 1.6), 1);
        add(strip);
      }
    }

    // ceiling light fixtures at the lighting rig positions (emissive panels, so light sources are readable)
    for (const l of MAP_LIGHTS) {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(l.color).multiplyScalar(1.4) });
      this.overhead.add(box(0.9, 0.06, 0.35, mat, l.x, l.y + 0.62, l.z));
    }
    this.group.add(this.overhead);

    // pipe runs along the overhead pipe/beam props (cosmetic cylinders slightly inside the collision boxes)
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x6b7480, roughness: 0.35, metalness: 0.8 });
    const pipe = (x0: number, x1: number, y: number, z: number, r = 0.14) => {
      const len = x1 - x0;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), pipeMat);
      m.rotation.z = Math.PI / 2;
      m.position.set((x0 + x1) / 2, y, z);
      add(m);
      for (let i = 1; i < len / 3; i++) add(box(0.1, r * 2.4, r * 2.4, frameMat, x0 + i * 3, y, z));
    };
    pipe(24, 36, 4.4, 16.15); // resource room overhead
    pipe(8.4, 23.6, 3.1, 29.25, 0.12); // maintenance run
    pipe(2, 10, 3.7, 21, 0.15); // junction beam

    // Bloom biomass in the hive: dark chitin mounds with crimson tissue and violet glow nodes (no collision)
    const hive = ROOMS.find((r) => r.name === 'hive')!;
    const chitin = new THREE.MeshStandardMaterial({ color: 0x120a10, roughness: 0.35, metalness: 0.3 });
    const tissue = new THREE.MeshStandardMaterial({ color: 0x7a0f22, roughness: 0.5, emissive: 0x2a0309, emissiveIntensity: 0.7 });
    const glow = new THREE.MeshStandardMaterial({ color: 0x9a5cff, emissive: 0x7a3cff, emissiveIntensity: 2, roughness: 0.4 });
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 16; i++) {
      const x = hive.x0 + 0.8 + rnd() * (hive.x1 - hive.x0 - 1.6);
      const z = hive.z0 + 0.8 + rnd() * (hive.z1 - hive.z0 - 1.6);
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.35 + rnd() * 0.5, 10, 6), i % 3 === 0 ? tissue : chitin);
      m.scale.y = 0.06 + rnd() * 0.08;
      m.position.set(x, 0.02, z);
      add(m);
      if (i % 2 === 0) {
        const g = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), glow);
        g.position.set(x + (rnd() - 0.5) * 0.4, 0.07, z + (rnd() - 0.5) * 0.4);
        add(g);
      }
    }
    // wall tendrils (west and north hive walls), cones leaning off the wall
    for (let i = 0; i < 10; i++) {
      const onWest = i % 2 === 0;
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.1 + rnd() * 0.08, 1.2 + rnd() * 1.6, 6), i % 3 === 0 ? tissue : chitin);
      const y = 0.8 + rnd() * 3.6;
      if (onWest) {
        m.position.set(hive.x0 + 0.12, y, hive.z0 + 1 + rnd() * (hive.z1 - hive.z0 - 2));
        m.rotation.z = -0.35;
      } else {
        m.position.set(hive.x0 + 1 + rnd() * (hive.x1 - hive.x0 - 2), y, hive.z0 + 0.12);
        m.rotation.x = 0.35;
      }
      add(m);
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
    });
  }
}
