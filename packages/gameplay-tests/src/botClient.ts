import { PlayerClass, SurfaceViewAssist, TICK_DT, createTestCellA, emptyInput, type InputFrame } from '@breach/shared';
import { GameNetClient } from '../../../apps/client/src/game/network/GameNetClient';
import { PredictionController } from '../../../apps/client/src/game/network/PredictionController';
import type { MatchView, PlayerSnapshot } from '../../../apps/client/src/game/network/types';
import { mulberry32 } from './virtual';

export type BotBrain = (ctx: { me: PlayerSnapshot; view: MatchView; tick: number; rnd: () => number; st: Record<string, number> }) => Partial<InputFrame>;

/** A headless real-socket client built from the real network + prediction code. */
export class BotClient {
  net: GameNetClient;
  ctrl: PredictionController | null = null;
  assist = new SurfaceViewAssist();
  view: MatchView | null = null;
  me: PlayerSnapshot | null = null;
  rnd: () => number;
  st: Record<string, number> = {};
  tickN = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private acc = 0;
  private last = performance.now();
  reconTimes: number[] = [];
  reasons: Record<string, number> = {};
  reconLog: string[] = [];
  events = { death: 0, respawn: 0, hits: 0 };
  statuses: string[] = [];

  constructor(
    public url: string,
    public name: string,
    lagMs: number,
    jitterMs: number,
    public brain: BotBrain,
    seed: number,
  ) {
    this.rnd = mulberry32(seed);
    this.net = new GameNetClient(
      url,
      {
        onMatch: (v) => this.onMatch(v),
        onEvent: (e) => {
          if (e.t === 'death' && e.victim === this.net.sessionId) this.events.death++;
          if (e.t === 'respawn' && e.id === this.net.sessionId) this.events.respawn++;
          if (e.t === 'hit' && e.shooter === this.net.sessionId) this.events.hits++;
        },
        onNotice: () => {},
        onStatus: (s) => this.statuses.push(s),
      },
      { lagMs, jitterMs },
      null,
    );
  }

  private onMatch(v: MatchView): void {
    this.view = v;
    const me = v.players.find((p) => p.id === this.net.sessionId) ?? null;
    this.me = me;
    if (!me || v.phase !== 'playing' || !me.alive) return;
    if (!this.ctrl) {
      this.ctrl = new PredictionController(createTestCellA(), me.sim);
      this.ctrl.reset(me.sim, me.epoch, me.ack);
      this.assist.reset(me.sim.yaw, me.sim.pitch);
      return;
    }
    const epoch = this.ctrl.epoch;
    const rep = this.ctrl.onServerState(me.sim, me.ack, me.epoch);
    if (rep.reconciled && !rep.hard) {
      this.reconTimes.push(performance.now());
      this.reasons[rep.reason] = (this.reasons[rep.reason] ?? 0) + 1;
      if (this.reconLog.length < 8) this.reconLog.push(`${rep.reason} err=${rep.errorM.toFixed(3)} surf=${me.sim.surface} v=${Math.hypot(me.sim.vx, me.sim.vz).toFixed(2)} ack=${me.ack} replay=${rep.replayed} tick=${v.serverTick}`);
    }
    if (this.ctrl.epoch !== epoch) this.assist.reset(me.sim.yaw, me.sim.pitch);
  }

  start(): void {
    this.last = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      this.acc += Math.min(0.25, (now - this.last) / 1000);
      this.last = now;
      let n = 0;
      while (this.acc >= TICK_DT && n < 6) {
        this.acc -= TICK_DT;
        n++;
        this.tick(now);
      }
    }, 8);
  }

  private tick(now: number): void {
    const ctrl = this.ctrl;
    if (!ctrl || !this.view || this.view.phase !== 'playing' || !this.me?.alive) return;
    const patch = this.brain({ me: { ...this.me, sim: ctrl.sim }, view: this.view, tick: this.tickN++, rnd: this.rnd, st: this.st });
    // brains steer by absolute yaw/pitch; the view assist adds surface transport on top (Ripper only)
    const ripper = ctrl.sim.cls === PlayerClass.Ripper;
    let yaw = patch.yaw ?? this.assist.yaw;
    let pitch = patch.pitch ?? this.assist.pitch;
    if (ripper) {
      const dyaw = Math.atan2(Math.sin(yaw - this.assist.yaw), Math.cos(yaw - this.assist.yaw));
      this.assist.look(Math.max(-0.12, Math.min(0.12, dyaw)), Math.max(-0.1, Math.min(0.1, pitch - this.assist.pitch)));
      yaw = this.assist.yaw;
      pitch = this.assist.pitch;
    } else {
      this.assist.reset(yaw, pitch);
    }
    const { frame, before } = ctrl.predict({ ...emptyInput(0), ...patch, yaw, pitch, clientTimeMs: now });
    this.net.queueInput(frame);
    if (ripper) {
      this.assist.onTick(before, ctrl.sim);
      this.assist.update(TICK_DT);
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

const nearestEnemy = (ctx: Parameters<BotBrain>[0]) => {
  let best: PlayerSnapshot | null = null;
  let bd = Infinity;
  for (const p of ctx.view.players) {
    if (p.id === ctx.me.id || !p.alive || p.faction === ctx.me.faction) continue;
    const d = Math.hypot(p.sim.px - ctx.me.sim.px, p.sim.pz - ctx.me.sim.pz);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return { best, dist: bd };
};

/** Marine: strafes erratically, turns toward the nearest Ripper and fires when roughly aligned. */
export const aimingMarine: BotBrain = (ctx) => {
  const { best, dist } = nearestEnemy(ctx);
  const s = ctx.me.sim;
  if (ctx.tick % 30 === 0) ctx.st.strafe = Math.round(ctx.rnd() * 2 - 1);
  if (ctx.tick % 200 === 0) ctx.st.wander = (ctx.rnd() - 0.5) * 3;
  if (!best) return { moveZ: 1, moveX: ctx.st.strafe ?? 0, yaw: (ctx.st.yaw = (ctx.st.yaw ?? s.yaw) + (ctx.st.wander ?? 0) * TICK_DT), jump: ctx.rnd() < 0.01 };
  const dx = best.sim.px - s.px;
  const dz = best.sim.pz - s.pz;
  const dy = best.sim.py + (best.sim.cls === PlayerClass.Marine ? 1 : 0.1) - (s.py + 1.62);
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz));
  const aligned = Math.abs(Math.atan2(Math.sin(yaw - s.yaw), Math.cos(yaw - s.yaw))) < 0.25;
  return { yaw, pitch, moveZ: dist > 7 ? 1 : dist < 3 ? -1 : 0, moveX: ctx.st.strafe ?? 0, primary: aligned && dist < 28, reload: s.ammo === 0, jump: ctx.rnd() < 0.01 };
};

/** Ripper: chases the nearest Marine, climbs obstacles on contact, leaps when mid-range, bites in reach. */
export const chasingRipper: BotBrain = (ctx) => {
  const { best, dist } = nearestEnemy(ctx);
  const s = ctx.me.sim;
  if (ctx.tick % 90 === 0) ctx.st.wander = (ctx.rnd() - 0.5) * 3;
  if (!best) return { moveZ: 1, yaw: (ctx.st.yaw = (ctx.st.yaw ?? s.yaw) + (ctx.st.wander ?? 0) * TICK_DT), jump: ctx.rnd() < 0.02 };
  const dx = best.sim.px - s.px;
  const dz = best.sim.pz - s.pz;
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(best.sim.py + 1 - s.py, Math.hypot(dx, dz));
  return { yaw, pitch: dist < 3 ? pitch : 0.1, moveZ: 1, moveX: Math.sin(ctx.tick / 25) * 0.4, jump: dist > 5 && dist < 11 && ctx.rnd() < 0.05, primary: dist < 1.9, secondary: ctx.rnd() < 0.002 };
};
