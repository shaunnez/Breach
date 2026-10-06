import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MAP_BOXES, MAP_LIGHTS, ROOMS, VENT_PATH, type Box } from '@breach/shared';

/** Procedural 1 m grid + hazard accents so scale and surface orientation are readable in greybox. */
function makeGridTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#9aa3ad';
  g.fillRect(0, 0, 256, 256);
  // subtle noise
  for (let i = 0; i < 1800; i++) {
    const v = 140 + Math.random() * 40;
    g.fillStyle = `rgba(${v},${v},${v + 6},0.18)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  g.strokeStyle = 'rgba(20,26,34,0.85)';
  g.lineWidth = 3;
  g.strokeRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(20,26,34,0.35)';
  g.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    g.beginPath();
    g.moveTo((i * 256) / 4, 0);
    g.lineTo((i * 256) / 4, 256);
    g.moveTo(0, (i * 256) / 4);
    g.lineTo(256, (i * 256) / 4);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** World-metre UVs so the grid tiles at 1 m regardless of box size. */
function boxGeometry(b: Box): THREE.BufferGeometry {
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const d = b.maxZ - b.minZ;
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // BoxGeometry face order: +x,-x,+y,-y,+z,-z ; 4 verts each
  const dims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
    }
  }
  g.translate((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
  return g;
}

function tintFor(b: Box): number {
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  if (b.kind === 'vent') return 0x2f353c;
  for (const r of ROOMS) if (cx >= r.x0 - 0.5 && cx <= r.x1 + 0.5 && cz >= r.z0 - 0.5 && cz <= r.z1 + 0.5) {
    if (b.kind === 'prop') return 0xd08a3c; // props read as orange industrial accents
    return r.tint;
  }
  return b.kind === 'prop' ? 0xd08a3c : 0x4a5058;
}

export class MapView {
  readonly group = new THREE.Group();
  readonly lights: THREE.PointLight[] = [];

  constructor() {
    const tex = makeGridTexture();
    const byTint = new Map<number, THREE.BufferGeometry[]>();
    for (const b of MAP_BOXES) {
      const tint = b.kind === 'floor' ? 0x3c4046 : tintFor(b);
      const arr = byTint.get(tint) ?? [];
      arr.push(boxGeometry(b));
      byTint.set(tint, arr);
    }
    for (const [tint, geoms] of byTint) {
      const merged = mergeGeometries(geoms, false);
      for (const g of geoms) g.dispose();
      if (!merged) continue;
      const mat = new THREE.MeshStandardMaterial({ map: tex, color: tint, roughness: 0.82, metalness: 0.25 });
      const mesh = new THREE.Mesh(merged, mat);
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    }

    // readable lighting: a dim hemisphere + coloured point lights per space (no shadows: browser budget)
    this.group.add(new THREE.HemisphereLight(0xa9bdd6, 0x2a2018, 1.25));
    for (const l of MAP_LIGHTS) {
      const pl = new THREE.PointLight(l.color, l.intensity * 9, l.distance * 1.7, 1.5);
      pl.position.set(l.x, l.y, l.z);
      this.group.add(pl);
      this.lights.push(pl);
    }

    // emissive vent guide strips so the Ripper shortcut is discoverable (cyan on the inside floor)
    const stripMat = new THREE.MeshBasicMaterial({ color: 0x7a4dff });
    for (let i = 0; i < VENT_PATH.length - 1; i++) {
      const a = VENT_PATH[i];
      const b = VENT_PATH[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(b.x - a.x) > 0.1 ? len : 0.05, 0.02, Math.abs(b.z - a.z) > 0.1 ? len : 0.05), stripMat);
      strip.position.set((a.x + b.x) / 2, a.y - 0.51, (a.z + b.z) / 2);
      this.group.add(strip);
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
    });
  }
}
