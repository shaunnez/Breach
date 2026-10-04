import {
  PlayerClass,
  SurfaceViewAssist,
  TICK_DT,
  TICK_MS,
  emptyInput,
  clonePlayerSim,
  createTestCellA,
  type InputFrame,
  type PlayerSim,
} from '@breach/shared';
import { Simulation, type ServerPlayer } from '../../../apps/server/src/simulation/Simulation';
import { PredictionController } from '../../../apps/client/src/game/network/PredictionController';

/** Deterministic PRNG so soak runs are reproducible. */
export function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const F32_KEYS: (keyof PlayerSim)[] = [
  'px', 'py', 'pz', 'vx', 'vy', 'vz', 'yaw', 'pitch', 'nx', 'ny', 'nz', 'detachT', 'lockT', 'leapCd', 'energy', 'energyIdle', 'bloom',
];
/** Emulate the Colyseus float32 wire quantisation of replicated movement state. */
export function quantise(s: PlayerSim): PlayerSim {
  const q = clonePlayerSim(s) as unknown as Record<string, number>;
  for (const k of F32_KEYS) q[k as string] = Math.fround(q[k as string]);
  return q as unknown as PlayerSim;
}

export type Bot = (s: PlayerSim, tick: number, rnd: () => number, st: Record<string, number>) => Partial<InputFrame>;

/** Random "mouse and keyboard" fuzzer for a Marine: wanders, strafes, jumps, sprints, fires, reloads. */
export const marineBot: Bot = (s, tick, rnd, st) => {
  if (tick % 40 === 0) {
    st.yawRate = (rnd() - 0.5) * 3;
    st.strafe = Math.round(rnd() * 2 - 1);
    st.fwd = rnd() < 0.8 ? 1 : rnd() < 0.5 ? 0 : -1;
    st.sprint = rnd() < 0.3 ? 1 : 0;
  }
  st.yaw = (st.yaw ?? 0) + (st.yawRate ?? 0) * TICK_DT;
  return {
    moveZ: st.fwd ?? 1,
    moveX: st.strafe ?? 0,
    yaw: st.yaw,
    pitch: Math.sin(tick / 90) * 0.2,
    jump: rnd() < 0.02,
    sprint: st.sprint === 1,
    primary: Math.floor(tick / 45) % 3 === 0,
    reload: tick % 400 === 0,
  };
};

/** Random Ripper driver: mostly W, steering and leaping erratically so it climbs walls, crosses ceilings and enters vents. */
export const ripperBot: Bot = (s, tick, rnd, st) => {
  if (tick % 25 === 0) {
    st.yawRate = (rnd() - 0.5) * 4;
    st.pitchTarget = (rnd() - 0.5) * 0.9;
    st.strafe = rnd() < 0.2 ? Math.round(rnd() * 2 - 1) : 0;
    st.stop = rnd() < 0.05 ? 1 : 0;
  }
  st.yaw = (st.yaw ?? 0) + (st.yawRate ?? 0) * TICK_DT;
  return {
    moveZ: st.stop ? 0 : 1,
    moveX: st.strafe ?? 0,
    yaw: st.yaw,
    pitch: st.pitchTarget ?? 0,
    jump: rnd() < 0.015,
    secondary: rnd() < 0.002,
    primary: Math.floor(tick / 60) % 4 === 0,
  };
};

interface Packet {
  at: number;
  fn: () => void;
}

export interface VirtualClientCfg {
  id: string;
  cls: PlayerClass;
  bot: Bot;
  seed: number;
}

export interface VirtualResult {
  id: string;
  ticks: number;
  reconciliations: number;
  hardSnaps: number;
  maxErrorM: number;
  meanErrorM: number;
  surfaceBreaks: number;
  correctionsPerMinute: number;
  finalDivergenceM: number;
  inputsDropped: number;
  rejected: number;
  surfaceTicks: number[];
  leaps: number;
}

/**
 * In-process client<->server link with virtual time. Uses the *real* Simulation and the *real*
 * PredictionController; only the transport is simulated (latency, jitter, float32 quantisation,
 * 30 Hz input batches, 20 Hz state patches, FIFO ordering).
 */
export class VirtualSession {
  server = new Simulation();
  now = 0;
  private up: Packet[] = [];
  private down: Packet[] = [];
  private lastUp = 0;
  private lastDown = 0;
  private rnd: () => number;
  /** probability that an input batch is lost on the way up (adversarial testing; real WebSockets are reliable) */
  upLoss = 0;
  clients: {
    cfg: VirtualClientCfg;
    ctrl: PredictionController;
    view: SurfaceViewAssist;
    rnd: () => number;
    botState: Record<string, number>;
    out: InputFrame[];
    tickN: number;
    player: ServerPlayer;
  }[] = [];
  constructor(
    public lagMs: number,
    public jitterMs: number,
    seed = 1,
  ) {
    this.rnd = mulberry32(seed);
  }

  addClient(cfg: VirtualClientCfg): void {
    const p = this.server.addPlayer(cfg.id, cfg.id, cfg.cls, this.clients.length);
    p.rttMs = this.lagMs;
    const ctrl = new PredictionController(createTestCellA(), p.sim);
    const view = new SurfaceViewAssist();
    view.reset(p.sim.yaw, 0);
    this.clients.push({ cfg, ctrl, view, rnd: mulberry32(cfg.seed), botState: { yaw: p.sim.yaw }, out: [], tickN: 0, player: p });
  }

  start(): void {
    this.server.startMatch();
    for (const c of this.clients) {
      c.player.protectedUntilTick = 0;
      c.ctrl.reset(clonePlayerSim(c.player.sim), c.player.epoch, 0);
    }
  }

  private delay(): number {
    const j = this.jitterMs > 0 ? (this.rnd() * 2 - 1) * this.jitterMs : 0;
    return Math.max(0, this.lagMs / 2 + j);
  }
  private send(dir: 'up' | 'down', fn: () => void): void {
    const q = dir === 'up' ? this.up : this.down;
    const last = dir === 'up' ? this.lastUp : this.lastDown;
    const at = Math.max(last, this.now + this.delay());
    if (dir === 'up') this.lastUp = at;
    else this.lastDown = at;
    q.push({ at, fn });
  }
  private pump(q: Packet[]): void {
    while (q.length && q[0].at <= this.now) q.shift()!.fn();
  }

  run(ticks: number, onTick?: (t: number) => void): void {
    for (let t = 0; t < ticks; t++) {
      this.pump(this.up);
      this.pump(this.down);
      for (const c of this.clients) {
        if (!c.player.alive) continue;
        const s = c.ctrl.sim;
        const patch = c.cfg.bot(s, c.tickN, c.rnd, c.botState);
        // the bot steers yaw directly; the surface view assist adds the transported delta on top
        c.view.look(0, 0);
        const input: Omit<InputFrame, 'seq'> = { ...emptyInput(0), ...patch, clientTimeMs: this.now };
        if (s.cls === PlayerClass.Ripper) {
          // let the assist own pitch/yaw on surfaces, bot supplies mouse deltas
          const dy = (patch.yaw ?? 0) - (c.botState.lastBotYaw ?? patch.yaw ?? 0);
          c.botState.lastBotYaw = patch.yaw ?? 0;
          c.view.look(dy, ((patch.pitch ?? 0) - c.view.pitch) * 0.05);
          input.yaw = c.view.yaw;
          input.pitch = c.view.pitch;
        }
        const { frame, before } = c.ctrl.predict(input);
        if (s.cls === PlayerClass.Ripper) {
          c.view.onTick(before, c.ctrl.sim);
          c.view.update(TICK_DT);
        }
        c.out.push(frame);
        if (c.out.length >= 2) {
          const frames = c.out.splice(0, 2);
          if (this.upLoss > 0 && this.rnd() < this.upLoss) {
            // lost batch: never reaches the server
          } else this.send('up', () => this.server.receiveInputs(c.cfg.id, frames));
        }
        c.tickN++;
      }
      this.server.step();
      this.server.drainEvents();
      if (this.server.tick % 3 === 0) {
        for (const c of this.clients) {
          const p = c.player;
          const snap = quantise(clonePlayerSim(p.sim));
          const ack = p.lastProcessedSeq;
          const epoch = p.epoch;
          this.send('down', () => {
            if (p.alive) c.ctrl.onServerState(snap, ack, epoch);
          });
        }
      }
      onTick?.(t);
      this.now += TICK_MS;
    }
  }

  results(): VirtualResult[] {
    return this.clients.map((c) => {
      const st = c.ctrl.stats;
      const mins = (c.tickN * TICK_DT) / 60;
      // flush: compare predicted state at the latest acked seq against the server's state once the network drains
      const ps = c.ctrl.sim;
      const ss = c.player.sim;
      return {
        id: c.cfg.id,
        ticks: c.tickN,
        reconciliations: st.reconciliations,
        hardSnaps: st.hardSnaps,
        maxErrorM: st.maxErrorM,
        meanErrorM: st.errCount ? st.errSum / st.errCount : 0,
        surfaceBreaks: st.surfaceBreaks,
        correctionsPerMinute: st.reconciliations / Math.max(mins, 1e-9),
        finalDivergenceM: Math.hypot(ps.px - ss.px, ps.py - ss.py, ps.pz - ss.pz),
        inputsDropped: c.player.stats.inputsDropped,
        rejected: c.player.stats.rejectedInputs,
        surfaceTicks: [...c.player.stats.ticksBySurface],
        leaps: c.player.stats.leaps,
      };
    });
  }
}
