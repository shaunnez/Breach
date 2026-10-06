import * as THREE from 'three';
import { PlayerClass, SurfaceState, isWalker, surfaceFrame, type PlayerSim } from '@breach/shared';
import { SnapshotBuffer, type InterpState } from '../network/SnapshotBuffer';
import type { PlayerSnapshot } from '../network/types';

/**
 * A rendered other player. E2-E7 use simple placeholder bodies; the E8 pass swaps in `Avatar`
 * models behind the same interface (see entities/Avatar.ts).
 */
export interface AvatarLike {
  root: THREE.Object3D;
  /** advance procedural animation */
  update(dt: number, speed: number, surface: SurfaceState, alive: boolean, pitch?: number): void;
  setFlash?(t: number): void;
  dispose(): void;
}

export class RemoteEntity {
  readonly buffer = new SnapshotBuffer();
  avatar: AvatarLike;
  cls: PlayerClass;
  lastInterp: InterpState | null = null;
  snapshot: PlayerSnapshot | null = null;
  private up = new THREE.Vector3(0, 1, 0);
  private fwd = new THREE.Vector3(0, 0, -1);
  private prevPos = new THREE.Vector3();
  speed = 0;
  deathT = 0;
  stepDist = 0;
  nextChitterAt = 0;

  constructor(
    readonly id: string,
    cls: PlayerClass,
    private readonly make: (cls: PlayerClass) => AvatarLike,
    private readonly scene: THREE.Scene,
  ) {
    this.cls = cls;
    this.avatar = make(cls);
    scene.add(this.avatar.root);
  }

  setClass(cls: PlayerClass): void {
    if (cls === this.cls) return;
    this.scene.remove(this.avatar.root);
    this.avatar.dispose();
    this.cls = cls;
    this.avatar = this.make(cls);
    this.scene.add(this.avatar.root);
  }

  /** Place the avatar from an interpolated state. */
  apply(st: InterpState, snap: PlayerSnapshot, dt: number): void {
    this.lastInterp = st;
    this.snapshot = snap;
    const root = this.avatar.root;
    root.visible = true;
    const pos = new THREE.Vector3(st.px, st.py, st.pz);
    this.speed = dt > 0 ? pos.distanceTo(this.prevPos) / dt : 0;
    this.prevPos.copy(pos);
    root.position.copy(pos);
    if (isWalker(snap.sim.cls)) {
      root.quaternion.setFromAxisAngle(this.up.set(0, 1, 0), st.yaw);
    } else {
      const n = { x: st.nx, y: st.ny, z: st.nz };
      const f = surfaceFrame(n, st.yaw, st.pitch).tf;
      this.up.set(n.x, n.y, n.z);
      this.fwd.set(f.x, f.y, f.z);
      // basis: x = right, y = up(n), z = back (-fwd)
      const right = new THREE.Vector3().crossVectors(this.fwd, this.up).normalize();
      const back = this.fwd.clone().negate();
      const m = new THREE.Matrix4().makeBasis(right, this.up, back);
      root.quaternion.setFromRotationMatrix(m);
    }
    this.avatar.update(dt, this.speed, st.surface, st.alive, st.pitch);
  }

  hide(): void {
    this.avatar.root.visible = false;
  }

  dispose(): void {
    this.scene.remove(this.avatar.root);
    this.avatar.dispose();
  }
}

/** Placeholder greybox avatars (used before the E8 art pass, kept as a fallback). */
export function makePlaceholderAvatar(cls: PlayerClass): AvatarLike {
  const root = new THREE.Group();
  if (cls === PlayerClass.Marine) {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 1.1, 4, 8), new THREE.MeshStandardMaterial({ color: 0x00b8d4, roughness: 0.6 }));
    body.position.y = 0.89;
    root.add(body);
  } else {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), new THREE.MeshStandardMaterial({ color: 0xb3162d, roughness: 0.5 }));
    body.scale.set(1, 0.8, 1.9);
    root.add(body);
  }
  return {
    root,
    update() {},
    dispose() {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
      });
    },
  };
}

export const simOf = (s: PlayerSnapshot): PlayerSim => s.sim;
