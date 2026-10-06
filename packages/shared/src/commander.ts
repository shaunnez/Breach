import { COMMAND } from './balance';
import { clamp, DEG } from './math';
import { COMMAND_CONSOLE } from './map/testCellA';
import type { InputFrame } from './protocol';

/**
 * While commanding, the Marine's body stays at the console: every frame is simulated as "no input,
 * facing the console". Server authority applies it; the client predicts with the same function.
 */
export function commanderFrame(f: InputFrame): InputFrame {
  return { ...f, moveX: 0, moveZ: 0, yaw: COMMAND_CONSOLE.yaw, pitch: 0, jump: false, sprint: false, primary: false, secondary: false, reload: false, interact: false };
}

/**
 * Commander overhead camera (bible section 14): altitude 8-24 m, pitch ~55-70 deg depending on zoom,
 * fixed rotation looking north (-Z). Returns the eye position for a ground focus point (fx, fz).
 */
export function commanderCameraPose(fx: number, fz: number, altitude: number): { x: number; y: number; z: number; pitch: number } {
  const alt = clamp(altitude, COMMAND.cameraMinAltitude, COMMAND.cameraMaxAltitude);
  const t = (alt - COMMAND.cameraMinAltitude) / (COMMAND.cameraMaxAltitude - COMMAND.cameraMinAltitude);
  const pitch = (COMMAND.cameraMinPitchDeg + (COMMAND.cameraMaxPitchDeg - COMMAND.cameraMinPitchDeg) * t) * DEG;
  return { x: fx, y: alt, z: fz + alt / Math.tan(pitch), pitch: -pitch };
}

/** Intersect a ray with the floor plane y = h. */
export function rayToGround(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, h = 0): { x: number; z: number } | null {
  if (dy > -1e-6) return null;
  const t = (h - oy) / dy;
  return t > 0 ? { x: ox + dx * t, z: oz + dz * t } : null;
}
