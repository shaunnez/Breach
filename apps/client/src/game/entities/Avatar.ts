import * as THREE from 'three';
import { PlayerClass, SurfaceState } from '@breach/shared';
import type { AvatarLike } from './RemotePlayers';

/**
 * E8 art pass v1: procedural, palette-true stand-ins for CHR_Marine_A / CHR_Ripper_A built from
 * primitives with simple procedural animation. They are deliberately shaped like the future GLB
 * characters (same origin conventions: Marine feet-centre, Ripper body-centre, -Z forward) so the
 * generated Meshy/Blender assets can replace them via the asset manifest without touching gameplay.
 */

const M = {
  graphite: new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.75, metalness: 0.2 }),
  ceramic: new THREE.MeshStandardMaterial({ color: 0xd9d6cc, roughness: 0.45, metalness: 0.1 }),
  cyan: new THREE.MeshStandardMaterial({ color: 0x00e5ff, emissive: 0x00c8e0, emissiveIntensity: 1.6, roughness: 0.3 }),
  orange: new THREE.MeshStandardMaterial({ color: 0xd9822b, roughness: 0.6, metalness: 0.2 }),
  gun: new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.5, metalness: 0.6 }),
  chitin: new THREE.MeshStandardMaterial({ color: 0x0b0a0e, roughness: 0.28, metalness: 0.35 }),
  bone: new THREE.MeshStandardMaterial({ color: 0xcfc5ad, roughness: 0.55, metalness: 0.05 }),
  crimson: new THREE.MeshStandardMaterial({ color: 0x7a0f22, roughness: 0.5, emissive: 0x2a0309, emissiveIntensity: 0.6 }),
  violet: new THREE.MeshStandardMaterial({ color: 0x9a5cff, emissive: 0x7a3cff, emissiveIntensity: 1.8, roughness: 0.4 }),
};

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

/** Pivot group: child geometry hangs below the pivot by `len` (for limbs). */
function limb(w: number, len: number, d: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const m = box(w, len, d, mat, 0, -len / 2, 0);
  g.add(m);
  return g;
}

export interface Rifle {
  group: THREE.Group;
  muzzle: THREE.Object3D;
}

export function buildRifle(): Rifle {
  const g = new THREE.Group();
  g.add(box(0.07, 0.11, 0.62, M.gun, 0, 0, -0.1));
  g.add(box(0.09, 0.07, 0.3, M.graphite, 0, -0.02, 0.2)); // stock
  g.add(box(0.05, 0.14, 0.08, M.graphite, 0, -0.12, -0.02)); // grip
  g.add(box(0.075, 0.1, 0.12, M.ceramic, 0, 0.0, -0.22)); // receiver plate
  g.add(box(0.03, 0.03, 0.28, M.cyan, 0, 0.065, -0.2)); // emitter strip
  g.add(box(0.05, 0.05, 0.22, M.gun, 0, 0.0, -0.5)); // barrel shroud
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -0.64);
  g.add(muzzle);
  return { group: g, muzzle };
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
  });
}

function makeMarine(): AvatarLike {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const hip = new THREE.Group();
  hip.position.y = 0.88;
  body.add(hip);
  const legL = limb(0.15, 0.86, 0.2, M.graphite);
  const legR = limb(0.15, 0.86, 0.2, M.graphite);
  legL.position.set(-0.11, 0, 0);
  legR.position.set(0.11, 0, 0);
  hip.add(legL, legR);
  for (const l of [legL, legR]) l.add(box(0.17, 0.3, 0.22, M.ceramic, 0, -0.5, 0.0)); // knee plate
  const torso = new THREE.Group();
  torso.position.y = 0.28;
  hip.add(torso);
  torso.add(box(0.5, 0.56, 0.3, M.ceramic, 0, 0.3, 0));
  torso.add(box(0.36, 0.12, 0.31, M.graphite, 0, 0.02, 0));
  torso.add(box(0.22, 0.05, 0.02, M.cyan, 0, 0.42, -0.16)); // chest emitter
  torso.add(box(0.34, 0.45, 0.2, M.orange, 0, 0.32, 0.25)); // pack
  const head = new THREE.Group();
  head.position.y = 0.72;
  torso.add(head);
  head.add(box(0.24, 0.26, 0.26, M.ceramic, 0, 0.1, 0));
  head.add(box(0.2, 0.08, 0.04, M.cyan, 0, 0.12, -0.14)); // visor
  const arms = new THREE.Group();
  arms.position.set(0, 0.48, 0);
  torso.add(arms);
  const rifle = buildRifle();
  rifle.group.position.set(0.17, -0.1, -0.35);
  arms.add(rifle.group);
  const armR = limb(0.1, 0.42, 0.1, M.graphite);
  armR.position.set(0.28, 0, 0);
  armR.rotation.x = -1.2;
  const armL = limb(0.1, 0.42, 0.1, M.graphite);
  armL.position.set(-0.28, 0, 0);
  armL.rotation.set(-1.25, 0, -0.35);
  arms.add(armR, armL);

  let phase = 0;
  let deathT = 0;
  return {
    root,
    update(dt, speed, surface, alive, pitch = 0) {
      const moving = Math.min(1, speed / 6);
      if (surface === SurfaceState.Ground) phase += dt * (5 + speed * 1.4);
      const sw = Math.sin(phase) * 0.9 * moving;
      legL.rotation.x = sw;
      legR.rotation.x = -sw;
      if (surface === SurfaceState.Air) {
        legL.rotation.x = -0.5;
        legR.rotation.x = 0.35;
      }
      torso.rotation.y = Math.sin(phase) * 0.06 * moving;
      hip.position.y = 0.88 + Math.abs(Math.cos(phase)) * 0.025 * moving;
      head.rotation.x = pitch * 0.7;
      arms.rotation.x = pitch * 0.85;
      if (alive) {
        deathT = 0;
        body.rotation.x = 0;
        body.position.y = 0;
      } else {
        deathT = Math.min(1, deathT + dt * 1.8);
        body.rotation.x = -deathT * 1.45;
        body.position.y = -deathT * 0.28;
      }
    },
    dispose: () => disposeTree(root),
  };
}

function makeRipper(): AvatarLike {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  // torso + abdomen
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10), M.chitin);
  torso.scale.set(0.95, 0.72, 1.45);
  body.add(torso);
  const abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), M.chitin);
  abdomen.scale.set(0.9, 0.7, 1.3);
  abdomen.position.set(0, 0.0, 0.46);
  body.add(abdomen);
  // dorsal plates (pale bone) and crimson tissue between
  for (let i = 0; i < 5; i++) {
    const p = box(0.26 - i * 0.02, 0.05, 0.1, M.bone, 0, 0.17 - i * 0.012, -0.22 + i * 0.16);
    p.rotation.x = -0.15;
    body.add(p);
  }
  body.add(box(0.1, 0.04, 0.9, M.crimson, 0, 0.145, 0.05));
  // glow nodes
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) body.add(new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), M.violet).translateX(sx * 0.2).translateY(0.05).translateZ(-0.2 + i * 0.2));
  // head + jaws
  const head = new THREE.Group();
  head.position.set(0, 0.0, -0.46);
  body.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), M.chitin);
  skull.scale.set(0.9, 0.7, 1.25);
  head.add(skull);
  head.add(box(0.1, 0.04, 0.18, M.bone, 0, 0.1, -0.05));
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), M.violet);
  eyeL.position.set(-0.07, 0.04, -0.16);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.07;
  head.add(eyeL, eyeR);
  const jawL = limb(0.035, 0.26, 0.05, M.bone);
  const jawR = limb(0.035, 0.26, 0.05, M.bone);
  jawL.position.set(-0.08, 0.0, -0.2);
  jawR.position.set(0.08, 0.0, -0.2);
  jawL.rotation.x = Math.PI / 2 + 0.2;
  jawR.rotation.x = Math.PI / 2 + 0.2;
  head.add(jawL, jawR);
  // six legs, two segments each
  const legs: { hip: THREE.Group; knee: THREE.Group; side: number; idx: number }[] = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const hipG = new THREE.Group();
      hipG.position.set(side * 0.2, -0.04, -0.28 + i * 0.28);
      body.add(hipG);
      const upper = limb(0.045, 0.34, 0.045, M.chitin);
      upper.rotation.z = side * -1.1;
      hipG.add(upper);
      const kneeG = new THREE.Group();
      kneeG.position.set(0, -0.34, 0);
      upper.add(kneeG);
      const lower = limb(0.035, 0.42, 0.035, M.chitin);
      lower.rotation.z = side * 1.5;
      kneeG.add(lower);
      const claw = box(0.025, 0.09, 0.025, M.bone, 0, -0.43, 0);
      lower.add(claw);
      legs.push({ hip: hipG, knee: kneeG, side, idx: i });
    }
  }
  // tail
  const tail: THREE.Group[] = [];
  let parent: THREE.Object3D = body;
  for (let i = 0; i < 4; i++) {
    const seg = new THREE.Group();
    seg.position.set(0, 0, i === 0 ? 0.62 : 0.2);
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.07 - i * 0.012, 0.22, 6), M.chitin);
    m.rotation.x = -Math.PI / 2;
    m.position.z = 0.1;
    seg.add(m);
    parent.add(seg);
    parent = seg;
    tail.push(seg);
  }
  body.position.y = 0.0;

  let phase = 0;
  let flash = 0;
  let deathT = 0;
  let breathe = 0;
  return {
    root,
    update(dt, speed, surface, alive) {
      const moving = Math.min(1, speed / 7);
      phase += dt * (6 + speed * 1.9);
      breathe += dt * 2.2;
      flash = Math.max(0, flash - dt * 5);
      for (const l of legs) {
        const tripod = (l.idx + (l.side > 0 ? 1 : 0)) % 2 === 0 ? 0 : Math.PI;
        const s = Math.sin(phase + tripod);
        const lift = Math.max(0, Math.cos(phase + tripod));
        l.hip.rotation.y = s * 0.45 * moving + (l.idx - 1) * 0.28 * l.side * -1;
        l.hip.rotation.x = -lift * 0.35 * moving;
        l.knee.rotation.z = l.side * (-lift * 0.5 * moving);
        if (surface === SurfaceState.Air) {
          l.hip.rotation.y = (l.idx - 1) * 0.5 * -l.side;
          l.hip.rotation.x = -0.4;
          l.knee.rotation.z = l.side * 0.5;
        }
      }
      tail.forEach((t, i) => (t.rotation.y = Math.sin(phase * 0.7 - i * 0.7) * 0.28 * (0.3 + moving)));
      const j = 0.2 + flash * 0.9;
      jawL.rotation.x = Math.PI / 2 + 0.2 - j;
      jawR.rotation.x = Math.PI / 2 + 0.2 - j;
      head.position.z = -0.46 - flash * 0.22;
      torso.scale.y = 0.72 + Math.sin(breathe) * 0.015;
      if (alive) {
        deathT = 0;
        body.rotation.z = 0;
        body.position.y = 0;
      } else {
        deathT = Math.min(1, deathT + dt * 2.2);
        body.rotation.z = deathT * Math.PI * 0.95;
        body.position.y = deathT * 0.08;
        legs.forEach((l) => (l.knee.rotation.z = l.side * deathT * 1.2));
      }
    },
    setFlash(v: number) {
      flash = v;
    },
    dispose: () => disposeTree(root),
  };
}


/** VS02 Weaver: a squat, slow Bloom builder. Feet-centre origin (walker), -Z forward, ~1.3 m tall. */
function makeWeaver(): AvatarLike {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), M.chitin);
  torso.scale.set(1, 0.78, 1.15);
  torso.position.set(0, 0.72, 0.05);
  body.add(torso);
  // glowing builder sac on the back: the Weaver's silhouette read
  const sac = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), M.violet);
  sac.position.set(0, 0.98, 0.28);
  body.add(sac);
  for (let i = 0; i < 4; i++) {
    const p = box(0.5 - i * 0.06, 0.05, 0.12, M.bone, 0, 1.02 - i * 0.05, -0.24 + i * 0.1);
    p.rotation.x = -0.25;
    body.add(p);
  }
  const head = new THREE.Group();
  head.position.set(0, 0.74, -0.42);
  body.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), M.bone);
  skull.scale.set(1, 0.8, 1.2);
  head.add(skull);
  head.add(box(0.2, 0.05, 0.08, M.crimson, 0, -0.08, -0.14));
  // four stubby legs + two builder arms
  const legs: THREE.Group[] = [];
  for (const [x, z] of [
    [-0.32, -0.22],
    [0.32, -0.22],
    [-0.32, 0.3],
    [0.32, 0.3],
  ] as const) {
    const l = limb(0.12, 0.55, 0.12, M.chitin);
    l.position.set(x, 0.58, z);
    l.add(box(0.14, 0.08, 0.16, M.bone, 0, -0.56, -0.03));
    body.add(l);
    legs.push(l);
  }
  const arms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const a = limb(0.06, 0.42, 0.06, M.chitin);
    a.position.set(side * 0.24, 0.7, -0.36);
    a.rotation.set(-1.0, 0, side * 0.25);
    a.add(box(0.05, 0.12, 0.05, M.bone, 0, -0.45, 0));
    body.add(a);
    arms.push(a);
  }

  let phase = 0;
  let pulse = 0;
  let flash = 0;
  let deathT = 0;
  return {
    root,
    update(dt, speed, _surface, alive, pitch = 0) {
      const moving = Math.min(1, speed / 4);
      phase += dt * (4 + speed * 1.6);
      pulse += dt * 3;
      flash = Math.max(0, flash - dt * 4);
      legs.forEach((l, i) => (l.rotation.x = Math.sin(phase + (i % 2 === 0 ? 0 : Math.PI) + (i > 1 ? Math.PI : 0)) * 0.5 * moving));
      arms.forEach((a, i) => (a.rotation.x = -1.0 - flash * 0.9 + Math.sin(phase + i * Math.PI) * 0.15 * moving));
      sac.scale.setScalar(1 + Math.sin(pulse) * 0.05);
      head.rotation.x = pitch * 0.6;
      torso.position.y = 0.72 + Math.abs(Math.sin(phase)) * 0.02 * moving;
      if (alive) {
        deathT = 0;
        body.rotation.z = 0;
        body.position.y = 0;
      } else {
        deathT = Math.min(1, deathT + dt * 1.6);
        body.rotation.z = deathT * 1.4;
        body.position.y = -deathT * 0.2;
      }
    },
    setFlash(v: number) {
      flash = v;
    },
    dispose: () => disposeTree(root),
  };
}

export function makeAvatar(cls: PlayerClass): AvatarLike & { dispose(): void } {
  return cls === PlayerClass.Marine ? makeMarine() : cls === PlayerClass.Weaver ? makeWeaver() : makeRipper();
}
