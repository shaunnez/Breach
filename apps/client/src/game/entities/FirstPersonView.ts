import * as THREE from 'three';
import { SurfaceState, clamp, type PlayerSim } from '@breach/shared';
import { buildRifle, type Rifle } from './Avatar';

/** Camera-attached view models: pulse rifle for the Marine, forelimb claws for the Ripper. */
export class FirstPersonView {
  private rifle: Rifle;
  private rifleRig = new THREE.Group();
  private claws = new THREE.Group();
  private clawL: THREE.Group;
  private clawR: THREE.Group;
  private kickT = 0;
  private biteT = 0;
  private reloadT = 0;
  private phase = 0;
  private sway = new THREE.Vector2();
  private visible = false;
  private lastYaw = 0;
  private lastPitch = 0;

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    this.rifle = buildRifle();
    this.rifleRig.add(this.rifle.group);
    this.rifleRig.position.set(0.2, -0.2, -0.38);
    this.rifle.group.scale.setScalar(0.85);
    camera.add(this.rifleRig);
    this.rifleRig.visible = false;
    const boneMat = new THREE.MeshStandardMaterial({ color: 0xcfc5ad, roughness: 0.5 });
    const chitin = new THREE.MeshStandardMaterial({ color: 0x0b0a0e, roughness: 0.3, metalness: 0.3 });
    const mkClaw = (side: number) => {
      const g = new THREE.Group();
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.5), chitin);
      arm.position.z = -0.25;
      g.add(arm);
      for (let i = 0; i < 3; i++) {
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.16, 5), boneMat);
        f.rotation.x = -Math.PI / 2;
        f.position.set((i - 1) * 0.03, 0, -0.56);
        g.add(f);
      }
      g.position.set(side * 0.34, -0.26, -0.4);
      g.rotation.set(0.1, side * -0.18, side * 0.1);
      return g;
    };
    this.clawL = mkClaw(-1);
    this.clawR = mkClaw(1);
    this.claws.add(this.clawL, this.clawR);
    camera.add(this.claws);
    this.claws.visible = false;
  }

  reset(): void {
    this.kickT = this.biteT = this.reloadT = 0;
  }
  kick(): void {
    this.kickT = 1;
  }
  bite(): void {
    this.biteT = 1;
  }
  reload(): void {
    this.reloadT = 1;
  }
  setVisible(v: boolean): void {
    this.visible = v;
    if (!v) {
      this.rifleRig.visible = false;
      this.claws.visible = false;
    }
  }

  muzzleWorld(camera: THREE.Camera): THREE.Vector3 {
    camera.updateMatrixWorld(true);
    return this.rifle.muzzle.getWorldPosition(new THREE.Vector3());
  }

  update(dt: number, s: PlayerSim, mode: 'marine' | 'ripper', firing: boolean): void {
    if (!this.visible) return;
    this.rifleRig.visible = mode === 'marine';
    this.claws.visible = mode === 'ripper';
    const speed = Math.hypot(s.vx, s.vz);
    const grounded = s.surface !== SurfaceState.Air;
    this.phase += dt * (4 + speed * 1.2) * (grounded ? 1 : 0.3);
    this.kickT = Math.max(0, this.kickT - dt * 9);
    this.biteT = Math.max(0, this.biteT - dt * 3.2);
    this.reloadT = Math.max(0, this.reloadT - dt / 2.1);
    const yawD = clamp(s.yaw - this.lastYaw, -0.3, 0.3);
    const pitD = clamp(s.pitch - this.lastPitch, -0.3, 0.3);
    this.lastYaw = s.yaw;
    this.lastPitch = s.pitch;
    this.sway.x += (-yawD * 0.25 - this.sway.x) * Math.min(1, dt * 8);
    this.sway.y += (pitD * 0.25 - this.sway.y) * Math.min(1, dt * 8);

    if (mode === 'marine') {
      const sprint = s.sprinting === 1;
      const bobAmt = grounded ? clamp(speed / 6.5, 0, 1) : 0;
      const bx = Math.sin(this.phase) * 0.008 * bobAmt;
      const by = Math.abs(Math.cos(this.phase)) * 0.008 * bobAmt;
      const reloadDip = Math.sin(this.reloadT * Math.PI) * (this.reloadT > 0 ? 1 : 0);
      this.rifleRig.position.set(0.2 + bx + this.sway.x, -0.2 - by + this.sway.y - reloadDip * 0.12 - (sprint ? 0.05 : 0), -0.38 + this.kickT * 0.07);
      this.rifleRig.rotation.set(this.kickT * 0.07 + reloadDip * 0.7 + (sprint ? 0.35 : 0), (sprint ? 0.5 : 0) + this.sway.x * 2, reloadDip * -0.4);
      void firing;
    } else {
      const bob = grounded ? clamp(speed / 8, 0, 1) : 0;
      const run = Math.sin(this.phase * 1.3) * 0.5 * bob;
      const lunge = Math.sin((1 - this.biteT) * Math.PI) * (this.biteT > 0 ? 1 : 0);
      this.clawL.position.set(-0.34 + lunge * 0.22, -0.26 + run * 0.04, -0.4 - lunge * 0.28 + run * 0.05);
      this.clawR.position.set(0.34 - lunge * 0.22, -0.26 - run * 0.04, -0.4 - lunge * 0.28 - run * 0.05);
      this.clawL.rotation.set(0.1 - lunge * 0.6, 0.18 - lunge * 0.9, -0.1);
      this.clawR.rotation.set(0.1 - lunge * 0.6, -0.18 + lunge * 0.9, 0.1);
      this.claws.position.set(this.sway.x, this.sway.y, 0);
    }
  }
}
