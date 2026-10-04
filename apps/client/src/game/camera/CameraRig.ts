import * as THREE from 'three';
import { MARINE, PlayerClass, RIPPER, SurfaceState, clamp, DEG, eyePosition, type PlayerSim } from '@breach/shared';

/**
 * First-person camera. Marine: eye follows the controller (not the weapon) with restrained bob.
 * Ripper: horizon-biased - world yaw/pitch, body orients to surfaces, roll is only a limited cue (+-28 deg).
 */
export class CameraRig {
  private roll = 0;
  private nx = 0;
  private ny = 1;
  private nz = 0;
  private bobPhase = 0;
  private bob = 0;
  private fov: number = MARINE.fov;
  private leapKick = 0;
  /** weapon recoil as a pure view-model/camera shake; never changes actual aim */
  recoil = 0;
  position = new THREE.Vector3();
  /** extra camera-space offset (m) applied on top of the simulated eye */
  fullSurfaceRoll = false;

  reset(s: PlayerSim): void {
    this.nx = s.nx;
    this.ny = s.ny;
    this.nz = s.nz;
    this.roll = 0;
    this.leapKick = 0;
    this.fov = s.cls === PlayerClass.Ripper ? RIPPER.fov : MARINE.fov;
  }

  kickLeap(): void {
    this.leapKick = 1;
  }
  kickRecoil(): void {
    this.recoil = Math.min(1, this.recoil + 0.35);
  }

  /** s: interpolated predicted state (position already blended); view yaw/pitch are live. */
  update(cam: THREE.PerspectiveCamera, s: PlayerSim, yaw: number, pitch: number, offset: THREE.Vector3, dt: number): number {
    const ripper = s.cls === PlayerClass.Ripper;
    const targetFov = ripper ? RIPPER.fov : s.sprinting ? MARINE.sprintFov : MARINE.fov;
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-dt / 0.08));

    // smoothed surface normal (render-only; the sim normal can change discretely at concave corners)
    const k = 1 - Math.exp(-dt / 0.05);
    this.nx += (s.nx - this.nx) * k;
    this.ny += (s.ny - this.ny) * k;
    this.nz += (s.nz - this.nz) * k;
    const nl = Math.hypot(this.nx, this.ny, this.nz) || 1;
    const sn = { x: this.nx / nl, y: this.ny / nl, z: this.nz / nl };

    let eye: { x: number; y: number; z: number };
    if (ripper) {
      const base = { ...s, nx: sn.x, ny: sn.y, nz: sn.z };
      eye = eyePosition(base);
    } else {
      eye = eyePosition(s);
      const speed = Math.hypot(s.vx, s.vz);
      const grounded = s.surface === SurfaceState.Ground;
      const target = grounded ? clamp(speed / MARINE.sprintSpeed, 0, 1) : 0;
      this.bob += (target - this.bob) * (1 - Math.exp(-dt / 0.1));
      this.bobPhase += dt * (6 + speed * 1.3);
      eye.y += Math.sin(this.bobPhase) * 0.012 * this.bob; // <= 1.2 cm, well inside the 2.5 cm cap
    }

    this.position.set(eye.x + offset.x, eye.y + offset.y, eye.z + offset.z);

    // roll cue
    let targetRoll = 0;
    if (ripper && s.surface !== SurfaceState.Air) {
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      const lean = sn.x * rx + sn.z * rz;
      targetRoll = -lean * RIPPER.maxCameraRollDeg * DEG * (1 - sn.y * sn.y);
    }
    this.roll += (targetRoll - this.roll) * (1 - Math.exp(-dt / 0.12));

    // leap: mild positional kick (pull the eye back along the view direction), no FOV explosion
    this.leapKick = Math.max(0, this.leapKick - dt / 0.22);
    this.recoil = Math.max(0, this.recoil - dt * 5.5);

    cam.position.copy(this.position);
    cam.rotation.set(pitch + this.recoil * 0.004, yaw, this.roll, 'YXZ');
    if (this.leapKick > 0) {
      const f = new THREE.Vector3(0, 0, 1).applyEuler(cam.rotation);
      cam.position.addScaledVector(f, 0.12 * this.leapKick * this.leapKick);
    }
    return this.fov;
  }
}
