import { PlayerClass, SurfaceState } from '../enums';
import { MARINE, RIFLE, RIPPER, WEAVER } from '../balance';

/**
 * The deterministic per-player simulation state. Everything needed to re-simulate an input frame
 * lives here and is replicated to the owning client so it can replay unacknowledged inputs.
 * Health / armour / death / respawn / scoring are NOT here: they are server-only game rules.
 *
 * Flat numbers on purpose: cheap to clone, trivial to map onto the Colyseus schema.
 */
export interface PlayerSim {
  cls: PlayerClass;
  /** Marine: feet centre. Ripper: sphere centre. */
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  /** Ripper surface normal (Marine keeps 0,1,0). */
  nx: number;
  ny: number;
  nz: number;
  surface: SurfaceState;
  /** seconds with no valid surface (Ripper detach grace accumulator) */
  detachT: number;
  /** seconds of surface-attach lockout after a leap / drop */
  lockT: number;
  leapCd: number;
  energy: number;
  /** seconds since energy last spent (regen delay). Weaver: heal pulse cooldown lives in fireCdTicks. */
  energyIdle: number;
  prevJump: number;
  prevReload: number;
  sprinting: number;
  // weapon (integer ticks for exact cadence)
  ammo: number;
  reserve: number;
  reloadTicks: number;
  fireCdTicks: number;
  biteCdTicks: number;
  bloom: number;
  bloomIdleTicks: number;
  shotCount: number;
  /** per-player spread seed assigned by the server */
  seed: number;
}

export function createPlayerSim(cls: PlayerClass, x: number, y: number, z: number, yaw: number, seed: number): PlayerSim {
  return {
    cls,
    px: x,
    py: y,
    pz: z,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw,
    pitch: 0,
    nx: 0,
    ny: 1,
    nz: 0,
    surface: SurfaceState.Ground,
    detachT: 0,
    lockT: 0,
    leapCd: 0,
    energy: cls === PlayerClass.Ripper ? RIPPER.maxEnergy : cls === PlayerClass.Weaver ? WEAVER.maxEnergy : 0,
    energyIdle: 1,
    prevJump: 0,
    prevReload: 0,
    sprinting: 0,
    ammo: cls === PlayerClass.Marine ? RIFLE.magazine : 0,
    reserve: cls === PlayerClass.Marine ? RIFLE.reserve : 0,
    reloadTicks: 0,
    fireCdTicks: 0,
    biteCdTicks: 0,
    bloom: 0,
    bloomIdleTicks: 0,
    shotCount: 0,
    seed,
  };
}

export function clonePlayerSim(s: PlayerSim): PlayerSim {
  return { ...s };
}

export function copyPlayerSim(dst: PlayerSim, src: PlayerSim): void {
  Object.assign(dst, src);
}

/** Per-frame notable happenings, consumed by the server (authority) and client (presentation). */
export interface StepResult {
  fired: boolean;
  /** shot index (0-based count of shots this life) and spread used, valid when fired */
  shotIndex: number;
  spreadDeg: number;
  bit: boolean;
  /** Weaver: heal pulse released this tick (the server applies the healing) */
  healPulse: boolean;
  /** an attack was requested but refused by cadence/ammo/reload */
  fireRejected: '' | 'empty' | 'reloading' | 'cooldown';
  reloadStarted: boolean;
  reloadFinished: boolean;
  jumped: boolean;
  leaped: boolean;
  landed: boolean;
  /** Ripper surface events for telemetry */
  attached: SurfaceState | -1;
  detachReason: '' | 'leap' | 'drop' | 'no-surface' | 'slow';
  /** horizontal+vertical distance moved this tick (for the envelope check) */
  moved: number;
}

export function newStepResult(): StepResult {
  return {
    fired: false,
    shotIndex: 0,
    spreadDeg: 0,
    bit: false,
    healPulse: false,
    fireRejected: '',
    reloadStarted: false,
    reloadFinished: false,
    jumped: false,
    leaped: false,
    landed: false,
    attached: -1,
    detachReason: '',
    moved: 0,
  };
}

export function resetStepResult(r: StepResult): StepResult {
  r.fired = false;
  r.shotIndex = 0;
  r.spreadDeg = 0;
  r.bit = false;
  r.healPulse = false;
  r.fireRejected = '';
  r.reloadStarted = false;
  r.reloadFinished = false;
  r.jumped = false;
  r.leaped = false;
  r.landed = false;
  r.attached = -1;
  r.detachReason = '';
  r.moved = 0;
  return r;
}

export const marineEyeHeight = MARINE.eyeHeight;
