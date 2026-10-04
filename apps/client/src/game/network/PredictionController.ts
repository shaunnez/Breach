import {
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
  private res = newStepResult();

  constructor(
    private readonly world: CollisionWorld,
    initial: PlayerSim,
  ) {
    this.sim = clonePlayerSim(initial);
    this.prev = clonePlayerSim(initial);
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
    if (this.nextSeq <= ack) this.nextSeq = ack + 1;
  }

  /** Run one local tick from a freshly sampled input. Returns the step result for presentation (muzzle flash etc). */
  predict(input: Omit<InputFrame, 'seq'>): { frame: InputFrame; result: StepResult; before: PlayerSim } {
    const frame: InputFrame = { ...input, seq: this.nextSeq++ };
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
    this.lastAck = ack;
    // discard inputs older than the ack; keep the ack entry for comparison
    while (this.history.length > 1 && this.history[1].seq <= ack) this.history.shift();
    const entry = this.history[0] && this.history[0].seq === ack ? this.history[0] : undefined;

    let err = 0;
    let reason: ReconcileReport['reason'] = '';
    if (entry) {
      const m = this.mismatch(entry.after, server);
      err = m.err;
      reason = m.reason;
    } else if (this.history.length > 0 && this.history[0].seq < ack) {
      // ack is ahead of everything we kept (we were starved of history)
      reason = 'no-history';
      err = Math.hypot(this.sim.px - server.px, this.sim.py - server.py, this.sim.pz - server.pz);
    } else if (this.history.length === 0) {
      const m = this.mismatch(this.sim, server);
      err = m.err;
      reason = m.reason;
    } else {
      // history starts after ack + 1: no entry to compare, trust the server and replay
      reason = 'no-history';
      err = Math.hypot(this.sim.px - server.px, this.sim.py - server.py, this.sim.pz - server.pz);
    }
    this.stats.lastErrorM = err;
    this.stats.maxErrorM = Math.max(this.stats.maxErrorM, err);
    this.stats.errSum += err;
    this.stats.errCount++;

    // drop the compared entry now that it is acknowledged
    if (this.history.length && this.history[0].seq <= ack) this.history.shift();

    if (reason === '') {
      return { errorM: err, reconciled: false, hard: false, reason, replayed: 0, surfaceChanged: false };
    }

    const oldX = this.sim.px;
    const oldY = this.sim.py;
    const oldZ = this.sim.pz;
    const oldSurface = this.sim.surface;
    copyPlayerSim(this.sim, server);
    let replayed = 0;
    for (const e of this.history) {
      if (e.seq <= ack) continue;
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
