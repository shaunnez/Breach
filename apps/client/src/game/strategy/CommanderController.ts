import * as THREE from 'three';
import { COMMAND, MAP_BOUNDS, clamp, commanderCameraPose, rayToGround } from '@breach/shared';

export interface GroundClick {
  button: 0 | 2;
  x: number;
  z: number;
  shift: boolean;
}

/**
 * Commander overhead view (bible section 14): a real projection of the same map. Altitude 8-24 m,
 * pitch 55-70 deg with zoom, WASD pan, wheel zoom, fixed rotation; the mouse is free (no pointer lock)
 * and picks points on the floor. Client presentation only: what a click *does* is a server request.
 */
export class CommanderController {
  active = false;
  focus = { x: 18, z: 17 };
  altitude = 16;
  /** cursor projected onto the floor (null when off the map or not over the canvas) */
  cursor: { x: number; z: number } | null = null;
  onClick: (c: GroundClick) => void = () => {};
  private ndc = new THREE.Vector2(0, 0);
  private hasMouse = false;
  private ray = new THREE.Raycaster();

  constructor(private readonly canvas: HTMLCanvasElement) {
    canvas.addEventListener('mousemove', this.mm);
    canvas.addEventListener('mousedown', this.md);
    canvas.addEventListener('wheel', this.wh, { passive: false });
    canvas.addEventListener('mouseleave', this.ml);
  }

  enter(x: number, z: number): void {
    this.active = true;
    this.focus = { x: clamp(x, MAP_BOUNDS.minX, MAP_BOUNDS.maxX), z: clamp(z, MAP_BOUNDS.minZ, MAP_BOUNDS.maxZ) };
  }

  exit(): void {
    this.active = false;
    this.cursor = null;
  }

  dispose(): void {
    this.canvas.removeEventListener('mousemove', this.mm);
    this.canvas.removeEventListener('mousedown', this.md);
    this.canvas.removeEventListener('wheel', this.wh);
    this.canvas.removeEventListener('mouseleave', this.ml);
  }

  private setNdc(e: MouseEvent): void {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, -((e.clientY - r.top) / Math.max(1, r.height)) * 2 + 1);
    this.hasMouse = true;
  }
  private mm = (e: MouseEvent) => this.setNdc(e);
  private ml = () => {
    this.hasMouse = false;
  };
  private md = (e: MouseEvent) => {
    if (!this.active || (e.button !== 0 && e.button !== 2)) return;
    this.setNdc(e);
    e.preventDefault();
    if (this.cursor) this.onClick({ button: e.button as 0 | 2, x: this.cursor.x, z: this.cursor.z, shift: e.shiftKey });
  };
  private wh = (e: WheelEvent) => {
    if (!this.active) return;
    e.preventDefault();
    this.altitude = clamp(this.altitude + Math.sign(e.deltaY) * 1.5, COMMAND.cameraMinAltitude, COMMAND.cameraMaxAltitude);
  };

  /** Pan with WASD/arrows (screen-aligned: the view looks north), place the camera, update the cursor. */
  update(dt: number, cam: THREE.PerspectiveCamera, keyDown: (code: string) => boolean): void {
    const k = (a: string, b: string) => keyDown(a) || keyDown(b);
    const speed = COMMAND.cameraPanSpeed * (0.5 + this.altitude / COMMAND.cameraMaxAltitude);
    const mx = (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0);
    const mz = (k('KeyS', 'ArrowDown') ? 1 : 0) - (k('KeyW', 'ArrowUp') ? 1 : 0);
    if (keyDown('KeyQ')) this.altitude = clamp(this.altitude - 12 * dt, COMMAND.cameraMinAltitude, COMMAND.cameraMaxAltitude);
    if (keyDown('KeyZ')) this.altitude = clamp(this.altitude + 12 * dt, COMMAND.cameraMinAltitude, COMMAND.cameraMaxAltitude);
    this.focus.x = clamp(this.focus.x + mx * speed * dt, MAP_BOUNDS.minX, MAP_BOUNDS.maxX);
    this.focus.z = clamp(this.focus.z + mz * speed * dt, MAP_BOUNDS.minZ, MAP_BOUNDS.maxZ);
    const pose = commanderCameraPose(this.focus.x, this.focus.z, this.altitude);
    cam.position.set(pose.x, pose.y, pose.z);
    cam.rotation.set(pose.pitch, 0, 0, 'YXZ');
    cam.updateMatrixWorld(true);
    this.cursor = null;
    if (!this.hasMouse) return;
    this.ray.setFromCamera(this.ndc, cam);
    const o = this.ray.ray.origin;
    const d = this.ray.ray.direction;
    const g = rayToGround(o.x, o.y, o.z, d.x, d.y, d.z, 0);
    if (g && g.x >= MAP_BOUNDS.minX && g.x <= MAP_BOUNDS.maxX && g.z >= MAP_BOUNDS.minZ && g.z <= MAP_BOUNDS.maxZ) this.cursor = g;
  }
}
