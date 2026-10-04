import {
  sanitizeInput,
  clonePlayerSim,
  copyPlayerSim,
  newStepResult,
  stepPlayer,
  type CollisionWorld,
  type InputFrame,
  type PlayerSim,
  type StepResult,
} from '@breach/shared';

export const RECONCILE_EPSILON_M = 0.01;
/** Corrections beyond this are not smoothed (they would be a visible slide): they snap. */
export const SNAP_DISTANCE_M = 1.5;
const MAX_HISTORY = 240;

interface Entry {
  seq: number;
  input: InputFrame;
  after: PlayerSim;
}

export interface ReconcileReport {
  /** prediction error vs the server's state at the acknowledged input */
  errorM: number;
  reconciled: boolean;
  hard: boolean;
  reason: '' | 'position' | 'surface' | 'weapon' | 'velocity' | 'no-history' | 'epoch';
  replayed: number;
  surfaceChanged: boolean;
}

export interface PredictionStats {
  reconciliations: number;
  hardSnaps: number;
  lastErrorM: number;
  maxErrorM: number;
  errSum: number;
  errCount: number;
  /** reconciliations that flipped the local Ripper's surface state (the "thrown off a wall" metric) */
  surfaceBreaks: number;
}

/**
 * Local prediction + server reconciliation for the owning player.
 *
 * Flow (bible section 7): move predicted state to the server state, discard acknowledged inputs,
 * re-apply unacknowledged inputs, then visually smooth only the correction delta.
 * Pure TypeScript, no DOM: shared by the browser client and headless tests.
 */
export class PredictionController {
  sim: PlayerSim;
  prev: PlayerSim;
  nextSeq = 1;
  epoch = -1;
  history: Entry[] = [];
  /** visual correction offset, decays towards zero */
  offX = 0;
  offY = 0;
  offZ = 0;
  stats: PredictionStats = { reconciliations: 0, hardSnaps: 0, lastErrorM: 0, maxErrorM: 0, errSum: 0, errCount: 0, surfaceBreaks: 0 };
  lastAck = 0;
  /** state after the most recent acknowledged input (comparison target for repeated acks) */
  base: PlayerSim;
  baseSeq = 0;
  private res = newStepResult();

  constructor(
    private readonly world: CollisionWorld,
    initial: PlayerSim,
  ) {
    this.sim = clonePlayerSim(initial);
    this.prev = clonePlayerSim(initial);
    this.base = clonePlayerSim(initial);
  }

  get unacked(): number {
    return this.history.length;
  }

  /** Hard snap to a server state (join, respawn, teleport, reconnect). */
  reset(server: PlayerSim, epoch: number, ack: number): void {
    copyPlayerSim(this.sim, server);
    copyPlayerSim(this.prev, server);
    this.history.length = 0;
    this.epoch = epoch;
    this.offX = this.offY = this.offZ = 0;
    this.lastAck = ack;
    this.base = clonePlayerSim(server);
    this.baseSeq = ack;
    if (this.nextSeq <= ack) this.nextSeq = ack + 1;
  }

  /** Run one local tick from a freshly sampled input. Returns the step result for presentation (muzzle flash etc). */
  predict(input: Omit<InputFrame, 'seq'>): { frame: InputFrame; result: StepResult; before: PlayerSim } {
    // Predict from exactly what the server will simulate: same clamping / normalisation / yaw wrap.
    const frame = sanitizeInput({ ...input, seq: this.nextSeq++, epoch: this.epoch });
    if (!frame) throw new Error('PredictionController: unusable input frame');
    copyPlayerSim(this.prev, this.sim);
    const before = clonePlayerSim(this.sim);
    stepPlayer(this.sim, frame, this.world, this.res);
    this.history.push({ seq: frame.seq, input: frame, after: clonePlayerSim(this.sim) });
    if (this.history.length > MAX_HISTORY) this.history.shift();
    return { frame, result: this.res, before };
  }

  private mismatch(a: PlayerSim, b: PlayerSim): { err: number; reason: ReconcileReport['reason'] } {
    const err = Math.hypot(a.px - b.px, a.py - b.py, a.pz - b.pz);
    if (err > RECONCILE_EPSILON_M) return { err, reason: 'position' };
    if (a.surface !== b.surface || a.cls !== b.cls) return { err, reason: 'surface' };
    if (a.ammo !== b.ammo || a.reloadTicks !== b.reloadTicks || a.shotCount !== b.shotCount || a.biteCdTicks !== b.biteCdTicks || Math.abs(a.energy - b.energy) > 0.5) {
      return { err, reason: 'weapon' };
    }
    if (Math.hypot(a.vx - b.vx, a.vy - b.vy, a.vz - b.vz) > 0.25) return { err, reason: 'velocity' };
    return { err, reason: '' };
  }

  /** Apply an authoritative snapshot of the local player. `ack` is lastProcessedInputSeq. */
  onServerState(server: PlayerSim, ack: number, epoch: number): ReconcileReport {
    if (epoch !== this.epoch) {
      this.reset(server, epoch, ack);
      this.stats.hardSnaps++;
      return { errorM: 0, reconciled: true, hard: true, reason: 'epoch', replayed: 0, surfaceChanged: false };
    }
    if (ack < this.baseSeq) {
      // stale snapshot (cannot happen on an ordered transport, harmless if it does)
      return { errorM: 0, reconciled: false, hard: false, reason: '', replayed: 0, surfaceChanged: false };
    }
    this.lastAck = ack;

    // locate the state we predicted for the acknowledged input, and discard everything up to it
    let ref: PlayerSim | undefined;
    if (ack === this.baseSeq) {
      ref = this.base;
    } else {
      const idx = this.history.findIndex((e) => e.seq === ack);
      if (idx >= 0) {
        ref = this.history[idx].after;
        this.base = this.history[idx].after;
        this.baseSeq = ack;
        this.history.splice(0, idx + 1);
      }
    }

    let err: number;
    let reason: ReconcileReport['reason'];
    if (ref) {
      const m = this.mismatch(ref, server);
      err = m.err;
      reason = m.reason;
    } else {
      // the ack refers to an input we no longer hold (e.g. after a long stall): trust the server
      reason = 'no-history';
      err = Math.hypot(this.sim.px - server.px, this.sim.py - server.py, this.sim.pz - server.pz);
      this.history = this.history.filter((e) => e.seq > ack);
      this.baseSeq = ack;
    }
    this.stats.lastErrorM = err;
    this.stats.maxErrorM = Math.max(this.stats.maxErrorM, err);
    this.stats.errSum += err;
    this.stats.errCount++;

    if (reason === '') {
      return { errorM: err, reconciled: false, hard: false, reason, replayed: 0, surfaceChanged: false };
    }

    const oldX = this.sim.px;
    const oldY = this.sim.py;
    const oldZ = this.sim.pz;
    const oldSurface = this.sim.surface;
    copyPlayerSim(this.sim, server);
    this.base = clonePlayerSim(server);
    this.baseSeq = ack;
    let replayed = 0;
    for (const e of this.history) {
      copyPlayerSim(this.prev, this.sim);
      stepPlayer(this.sim, e.input, this.world, this.res);
      copyPlayerSim(e.after, this.sim);
      replayed++;
    }
    this.stats.reconciliations++;
    const surfaceChanged = oldSurface !== this.sim.surface;
    if (surfaceChanged && this.sim.cls === 1) this.stats.surfaceBreaks++;
    // smooth only the correction delta
    const dx = oldX - this.sim.px;
    const dy = oldY - this.sim.py;
    const dz = oldZ - this.sim.pz;
    if (Math.hypot(dx, dy, dz) > SNAP_DISTANCE_M) {
      this.offX = this.offY = this.offZ = 0;
      this.stats.hardSnaps++;
    } else {
      this.offX += dx;
      this.offY += dy;
      this.offZ += dz;
    }
    return { errorM: err, reconciled: true, hard: false, reason, replayed, surfaceChanged };
  }

  /** Decay the visual offset (call per render frame). */
  smooth(dtSec: number, tauSec = 0.09): void {
    const k = Math.exp(-dtSec / tauSec);
    this.offX *= k;
    this.offY *= k;
    this.offZ *= k;
    if (Math.abs(this.offX) + Math.abs(this.offY) + Math.abs(this.offZ) < 1e-4) this.offX = this.offY = this.offZ = 0;
  }

  get correctionMagnitude(): number {
    return Math.hypot(this.offX, this.offY, this.offZ);
  }
}
