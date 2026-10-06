import * as THREE from 'three';
import { Faction, RESOURCE_NODES, STRUCTURE, StructureState, WEAVER, type StructureType } from '@breach/shared';
import type { EconomyView, StructureView } from '../network/types';

/**
 * VS02 presentation of the strategy layer: Extractor / Harvester models (procedural stand-ins, D-18),
 * construction progress, health bars, the Harvester's biomass footprint, the active well's control ring,
 * the Commander's placement hologram, waypoint / ping beacons, selection rings and heal-pulse rings.
 * Purely visual: every number shown comes from replicated server state.
 */

const MAT = {
  graphite: new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.7, metalness: 0.3 }),
  ceramic: new THREE.MeshStandardMaterial({ color: 0xd9d6cc, roughness: 0.45, metalness: 0.1 }),
  orange: new THREE.MeshStandardMaterial({ color: 0xd9822b, roughness: 0.55, metalness: 0.3 }),
  cyan: new THREE.MeshStandardMaterial({ color: 0x00e5ff, emissive: 0x00c8e0, emissiveIntensity: 1.8, roughness: 0.3 }),
  chitin: new THREE.MeshStandardMaterial({ color: 0x120a10, roughness: 0.3, metalness: 0.35 }),
  tissue: new THREE.MeshStandardMaterial({ color: 0x7a0f22, roughness: 0.5, emissive: 0x2a0309, emissiveIntensity: 0.8 }),
  violet: new THREE.MeshStandardMaterial({ color: 0x9a5cff, emissive: 0x7a3cff, emissiveIntensity: 2.2, roughness: 0.4 }),
};

export const FACTION_COLOR = [0x00e5ff, 0x9a5cff] as const;

interface StructureVis {
  id: string;
  type: StructureType;
  root: THREE.Group;
  model: THREE.Group;
  spinner: THREE.Object3D | null;
  pods: THREE.Mesh[];
  bar: THREE.Group;
  barFill: THREE.Mesh;
  flash: number;
  view: StructureView;
  biomass: THREE.Group | null;
  dying: number;
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  return o;
}

function buildExtractor(): { model: THREE.Group; spinner: THREE.Object3D } {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(1.12, 1.15, 0.28, 20), MAT.graphite, 0, 0.64, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.92, 0.98, 1.5, 20), MAT.ceramic, 0, 1.52, 0));
  for (const y of [1.05, 1.65]) g.add(mesh(new THREE.CylinderGeometry(0.99, 0.99, 0.07, 20), MAT.cyan, 0, y, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.7, 0.92, 0.3, 20), MAT.graphite, 0, 2.42, 0));
  for (let i = 0; i < 4; i++) {
    const strut = mesh(new THREE.BoxGeometry(0.16, 1.5, 0.16), MAT.orange, Math.cos((i * Math.PI) / 2) * 1.0, 1.4, Math.sin((i * Math.PI) / 2) * 1.0);
    g.add(strut);
  }
  const spinner = new THREE.Group();
  spinner.position.y = 2.62;
  for (let i = 0; i < 3; i++) {
    const blade = mesh(new THREE.BoxGeometry(1.2, 0.05, 0.16), MAT.orange);
    blade.rotation.y = (i * Math.PI) / 3;
    spinner.add(blade);
  }
  g.add(spinner);
  return { model: g, spinner };
}

function buildHarvester(): { model: THREE.Group; pods: THREE.Mesh[] } {
  const g = new THREE.Group();
  const bulb = mesh(new THREE.SphereGeometry(0.95, 18, 12), MAT.chitin, 0, 1.3, 0);
  bulb.scale.set(1, 1.15, 1);
  g.add(bulb);
  const tissue = mesh(new THREE.SphereGeometry(0.75, 14, 10), MAT.tissue, 0, 1.45, 0);
  tissue.scale.set(1.05, 1.2, 1.05);
  g.add(tissue);
  const pods: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const p = mesh(new THREE.SphereGeometry(0.2, 10, 8), MAT.violet, Math.cos(a) * 0.85, 1.6 + (i % 2) * 0.35, Math.sin(a) * 0.85);
    g.add(p);
    pods.push(p);
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    const t = mesh(new THREE.ConeGeometry(0.12, 1.3, 6), MAT.chitin, Math.cos(a) * 1.05, 0.95, Math.sin(a) * 1.05);
    t.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
    g.add(t);
  }
  return { model: g, pods };
}

/** Organic floor patches that spread around a Harvester: the Bloom's initial biomass footprint. */
function buildBiomass(seed: number): THREE.Group {
  const g = new THREE.Group();
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const flesh = new THREE.MeshStandardMaterial({ color: 0x2a0b18, roughness: 0.4, metalness: 0.2, emissive: 0x1a0310, emissiveIntensity: 0.6 });
  for (let i = 0; i < 34; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 1.3 + rnd() * 2.4;
    const big = i % 4 === 0;
    const blob = mesh(new THREE.SphereGeometry(big ? 0.3 + rnd() * 0.15 : 0.12 + rnd() * 0.16, 8, 6), i % 9 === 0 ? MAT.violet : i % 3 === 0 ? MAT.tissue : flesh, Math.cos(a) * r, 0.0, Math.sin(a) * r);
    blob.scale.y = 0.15 + rnd() * 0.12;
    g.add(blob);
  }
  return g;
}

function hpBar(): { bar: THREE.Group; fill: THREE.Mesh } {
  const bar = new THREE.Group();
  const bg = mesh(new THREE.PlaneGeometry(1.6, 0.16), new THREE.MeshBasicMaterial({ color: 0x0b0e12, transparent: true, opacity: 0.8, depthTest: false }));
  const fill = mesh(new THREE.PlaneGeometry(1.52, 0.1), new THREE.MeshBasicMaterial({ color: 0x40ff80, depthTest: false, transparent: true }) /* same pass as the background so renderOrder applies */, 0, 0, 0.001);
  bg.renderOrder = 10;
  fill.renderOrder = 11;
  bar.add(bg, fill);
  return { bar, fill };
}

export class StrategyLayer {
  readonly group = new THREE.Group();
  private vis = new Map<string, StructureVis>();
  private wellRing: THREE.Mesh;
  private wellRingMat: THREE.MeshBasicMaterial;
  private hologram: THREE.Group;
  private holoMat: THREE.MeshBasicMaterial;
  private beacons: THREE.Group[] = [];
  private rings: THREE.Mesh[] = [];
  private pulses: { m: THREE.Mesh; t: number }[] = [];
  private t = 0;
  /** set by the runtime: true while the local player is the Commander (bars get bigger, ceilings hidden) */
  overhead = false;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    const n = RESOURCE_NODES[0];
    this.wellRingMat = new THREE.MeshBasicMaterial({ color: 0xffb36b, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    this.wellRing = mesh(new THREE.RingGeometry(1.35, 1.6, 40), this.wellRingMat, n.x, 0.02, n.z);
    this.wellRing.rotation.x = -Math.PI / 2;
    this.group.add(this.wellRing);

    this.holoMat = new THREE.MeshBasicMaterial({ color: 0x40ff80, transparent: true, opacity: 0.35, depthWrite: false });
    this.hologram = new THREE.Group();
    this.hologram.add(mesh(new THREE.CylinderGeometry(1.05, 1.1, 2.4, 20, 1, true), this.holoMat, 0, 1.2, 0));
    const ring = mesh(new THREE.RingGeometry(1.1, 1.25, 32), this.holoMat, 0, 0.03, 0);
    ring.rotation.x = -Math.PI / 2;
    this.hologram.add(ring);
    this.hologram.visible = false;
    this.group.add(this.hologram);
  }

  sync(econ: EconomyView): void {
    const seen = new Set<string>();
    for (const s of econ.structures) {
      seen.add(s.id);
      let v = this.vis.get(s.id);
      if (!v) {
        v = this.create(s);
        this.vis.set(s.id, v);
      }
      v.view = s;
      v.dying = 0;
    }
    for (const [id, v] of this.vis) if (!seen.has(id) && v.dying === 0) v.dying = 0.0001; // fade out
    // well control ring: neutral amber, or the occupant's faction colour (pulses while building)
    const occ = econ.structures.find((s) => s.nodeId === RESOURCE_NODES[0].id);
    this.wellRingMat.color.setHex(occ ? FACTION_COLOR[occ.faction] : 0xffb36b);
  }

  private create(s: StructureView): StructureVis {
    const root = new THREE.Group();
    root.position.set(s.x, 0, s.z);
    let model: THREE.Group;
    let spinner: THREE.Object3D | null = null;
    let pods: THREE.Mesh[] = [];
    if (s.type === 'extractor') ({ model, spinner } = buildExtractor());
    else ({ model, pods } = buildHarvester());
    root.add(model);
    const { bar, fill } = hpBar();
    bar.position.y = STRUCTURE.hurtHeight + 0.5;
    root.add(bar);
    let biomass: THREE.Group | null = null;
    if (s.faction === Faction.Bloom) {
      biomass = buildBiomass(s.id.length * 977 + 13);
      biomass.scale.setScalar(0.01);
      root.add(biomass);
    }
    this.group.add(root);
    return { id: s.id, type: s.type, root, model, spinner, pods, bar, barFill: fill, flash: 0, view: s, biomass, dying: 0 };
  }

  hit(id: string): void {
    const v = this.vis.get(id);
    if (v) v.flash = 1;
  }

  /** Commander placement hologram; null hides it. */
  setHologram(p: { x: number; z: number } | null, valid: boolean): void {
    this.hologram.visible = !!p;
    if (!p) return;
    this.hologram.position.set(p.x, 0.5, p.z);
    this.holoMat.color.setHex(valid ? 0x40ff80 : 0xff4040);
  }

  /** Waypoint / ping beacons (vertical beams with a ground ring). */
  setBeacons(list: { x: number; y: number; z: number; color: number }[]): void {
    while (this.beacons.length < list.length) {
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending });
      g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 5, 8, 1, true), mat, 0, 2.5, 0));
      const r = mesh(new THREE.RingGeometry(0.45, 0.6, 24), mat, 0, 0.04, 0);
      r.rotation.x = -Math.PI / 2;
      g.add(r);
      this.group.add(g);
      this.beacons.push(g);
    }
    this.beacons.forEach((b, i) => {
      const e = list[i];
      b.visible = !!e;
      if (!e) return;
      b.position.set(e.x, e.y, e.z);
      ((b.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(e.color);
    });
  }

  /** Commander selection rings under selected Marines. */
  setSelection(list: { x: number; y: number; z: number }[]): void {
    while (this.rings.length < list.length) {
      const r = mesh(new THREE.RingGeometry(0.5, 0.62, 24), new THREE.MeshBasicMaterial({ color: 0x40ff80, side: THREE.DoubleSide }));
      r.rotation.x = -Math.PI / 2;
      this.group.add(r);
      this.rings.push(r);
    }
    this.rings.forEach((r, i) => {
      const e = list[i];
      r.visible = !!e;
      if (e) r.position.set(e.x, e.y + 0.05, e.z);
    });
  }

  healPulse(x: number, y: number, z: number): void {
    const m = mesh(new THREE.RingGeometry(0.9, 1, 40), new THREE.MeshBasicMaterial({ color: 0x9aff6a, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }), x, y + 0.08, z);
    m.rotation.x = -Math.PI / 2;
    this.group.add(m);
    this.pulses.push({ m, t: 0 });
  }

  update(dt: number, camera: THREE.Camera): void {
    this.t += dt;
    const occupied = [...this.vis.values()].find((v) => v.dying === 0);
    const building = occupied && occupied.view.state === StructureState.Building;
    this.wellRingMat.opacity = building ? 0.45 + 0.4 * Math.abs(Math.sin(this.t * 5)) : 0.85;
    for (const [id, v] of this.vis) {
      const p = v.view.state === StructureState.Active ? 1 : v.view.progress;
      if (v.dying > 0) {
        v.dying += dt;
        v.root.scale.setScalar(Math.max(0.01, 1 - v.dying * 1.6));
        v.root.rotation.z = v.dying * 0.6;
        if (v.dying > 0.6) {
          this.group.remove(v.root);
          v.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
          this.vis.delete(id);
        }
        continue;
      }
      v.model.scale.set(1, 0.2 + 0.8 * p, 1);
      v.model.visible = !(p < 1 && Math.sin(this.t * 30) > 0.85); // construction flicker
      if (v.spinner && v.view.state === StructureState.Active) v.spinner.rotation.y += dt * 4;
      v.pods.forEach((pod, i) => pod.scale.setScalar(1 + Math.sin(this.t * 3 + i) * 0.12));
      if (v.biomass) v.biomass.scale.setScalar(Math.max(0.01, p));
      v.flash = Math.max(0, v.flash - dt * 6);
      v.model.position.x = (Math.random() - 0.5) * 0.06 * v.flash;
      const frac = Math.max(0, Math.min(1, v.view.hp / Math.max(1, v.view.maxHp)));
      v.barFill.scale.x = Math.max(0.001, frac);
      v.barFill.position.x = -0.76 * (1 - frac);
      (v.barFill.material as THREE.MeshBasicMaterial).color.setHex(frac > 0.5 ? 0x40ff80 : frac > 0.25 ? 0xffc040 : 0xff4040);
      v.bar.quaternion.copy(camera.quaternion);
      v.bar.scale.setScalar(this.overhead ? 2.2 : 1);
    }
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const pu = this.pulses[i];
      pu.t += dt;
      const k = pu.t / 0.55;
      pu.m.scale.setScalar(0.2 + k * WEAVER.healPulseRadius);
      (pu.m.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
      if (k >= 1) {
        this.group.remove(pu.m);
        pu.m.geometry.dispose();
        this.pulses.splice(i, 1);
      }
    }
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}
