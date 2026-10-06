import {
  BITE,
  CLASS_NAMES,
  DEV_TELEPORTS,
  BLOOM_SPAWNS,
  MARINE,
  MARINE_SPAWNS,
  MATCH,
  NET,
  PlayerClass,
  RIFLE,
  RIPPER,
  SURFACE_NAMES,
  SurfaceState,
  TICK_MS,
  biteOrigin,
  clamp,
  closestOnSegment,
  createPlayerSim,
  createTestCellA,
  dist,
  factionOf,
  hurtCapsule,
  newStepResult,
  normalize,
  rayCapsule,
  roomAt,
  sanitizeInput,
  secToTicks,
  segSegDistSq,
  shotRay,
  stepPlayer,
  viewDir,
  type Capsule,
  type CollisionWorld,
  type DevAction,
  type GameEvent,
  type InputFrame,
  type MatchPhase,
  type PlayerSim,
  type ShotRejectReason,
  type SpawnPoint,
  type Vec3,
} from '@breach/shared';
import { Telemetry, silentTelemetry } from '../telemetry/telemetry';

export const MAX_QUEUE = 12;
export const CREDIT_CAP = 4;
export const MAX_BATCH = 8;
export const MAX_FRAMES_PER_SEC = 90;
const HISTORY_TICKS = 48;
const BITE_HALF_ARC = (BITE.horizontalArcDeg / 2) * (Math.PI / 180);
/** Defensive upper bound on one tick of displacement (never hit by honest simulation). */
export const MAX_TICK_MOVE = 0.6;

export interface PlayerStats {
  shotsFired: number;
  shotsHit: number;
  bites: number;
  biteHits: number;
  leaps: number;
  rejectedInputs: number;
  inputsDropped: number;
  ticksBySurface: [number, number, number, number];
}

export interface ServerPlayer {
  id: string;
  name: string;
  seat: number;
  cls: PlayerClass;
  pendingCls: PlayerClass | null;
  sim: PlayerSim;
  health: number;
  armour: number;
  alive: boolean;
  respawnAtTick: number;
  protectedUntilTick: number;
  kills: number;
  deaths: number;
  damage: number;
  queue: { f: InputFrame; arrival: number }[];
  credit: number;
  highestSeq: number;
  lastProcessedSeq: number;
  epoch: number;
  rttMs: number;
  connected: boolean;
  isDummy: boolean;
  host: boolean;
  prevPrimary: boolean;
  /** tick the current life first took damage (encounter time-to-kill telemetry) */
  firstDamagedAtTick: number;
  frameWindow: number[];
  stats: PlayerStats;
  lastShot: { seq: number; result: ShotRejectReason; hit: boolean; rewindMs: number };
}

export interface OutEvent {
  ev: GameEvent;
  /** if set, deliver only to this player */
  to?: string;
}

interface Snapshot {
  tick: number;
  caps: Map<string, { cap: Capsule; epoch: number }>;
}

export class Simulation {
  readonly world: CollisionWorld;
  readonly players = new Map<string, ServerPlayer>();
  readonly telemetry: Telemetry;
  tick = 0;
  phase: MatchPhase = 'warmup';
  matchStartTick = 0;
  events: OutEvent[] = [];
  matchId = '';
  roomId = '';
  private history: (Snapshot | undefined)[] = new Array(HISTORY_TICKS);
  private res = newStepResult();
  private nextSeed = 0x1234abcd;
  private dummyCounter = 0;
  private spawnCursor = { marine: 0, ripper: 0 };

  constructor(telemetry: Telemetry = silentTelemetry(), world: CollisionWorld = createTestCellA()) {
    this.telemetry = telemetry;
    this.world = world;
  }

  get timeMs(): number {
    return this.tick * TICK_MS;
  }

  // ---- roster ---------------------------------------------------------------------------------

  addPlayer(id: string, name: string, cls: PlayerClass, seat: number, isDummy = false): ServerPlayer {
    const sp = this.pickSpawn(cls);
    const p: ServerPlayer = {
      id,
      name,
      seat,
      cls,
      pendingCls: null,
      sim: createPlayerSim(cls, sp.x, sp.y, sp.z, sp.yaw, (this.nextSeed = (Math.imul(this.nextSeed, 1664525) + 1013904223) >>> 0)),
      health: cls === PlayerClass.Marine ? MARINE.health : RIPPER.health,
      armour: cls === PlayerClass.Marine ? MARINE.armour : RIPPER.armour,
      alive: this.phase === 'playing' || isDummy,
      respawnAtTick: 0,
      protectedUntilTick: 0,
      kills: 0,
      deaths: 0,
      damage: 0,
      queue: [],
      credit: CREDIT_CAP,
      highestSeq: -1,
      lastProcessedSeq: -1,
      epoch: 1,
      rttMs: 0,
      connected: true,
      isDummy,
      host: false,
      prevPrimary: false,
      firstDamagedAtTick: 0,
      frameWindow: [],
      stats: { shotsFired: 0, shotsHit: 0, bites: 0, biteHits: 0, leaps: 0, rejectedInputs: 0, inputsDropped: 0, ticksBySurface: [0, 0, 0, 0] },
      lastShot: { seq: 0, result: 'ok', hit: false, rewindMs: 0 },
    };
    this.players.set(id, p);
    return p;
  }

  removePlayer(id: string): void {
    this.players.delete(id);
  }

  classCount(cls: PlayerClass, exceptId?: string): number {
    let n = 0;
    for (const p of this.players.values()) if (!p.isDummy && p.id !== exceptId && (p.pendingCls ?? p.cls) === cls) n++;
    return n;
  }

  /** Simple team-size guard: at most ceil(maxPlayers/2) humans per class. */
  canTakeClass(id: string, cls: PlayerClass): boolean {
    return this.classCount(cls, id) < Math.ceil(MATCH.maxPlayers / 2);
  }

  setClass(id: string, cls: PlayerClass): boolean {
    const p = this.players.get(id);
    if (!p || (cls !== PlayerClass.Marine && cls !== PlayerClass.Ripper)) return false;
    if (!p.isDummy && !this.canTakeClass(id, cls)) return false;
    if (this.phase === 'warmup') {
      this.spawnPlayer(p, cls, false);
      p.alive = false;
      p.pendingCls = null;
    } else {
      p.pendingCls = cls === p.cls ? null : cls;
    }
    return true;
  }

  // ---- match lifecycle ------------------------------------------------------------------------

  startMatch(): void {
    this.phase = 'playing';
    this.matchStartTick = this.tick;
    for (const p of this.players.values()) {
      p.kills = p.deaths = p.damage = 0;
      this.spawnPlayer(p, p.pendingCls ?? p.cls, true);
    }
    this.events.push({ ev: { t: 'phase', phase: 'playing' } });
    this.telemetry.info('match-start', { matchId: this.matchId, roomId: this.roomId, serverTick: this.tick, players: this.players.size });
  }

  resetMatch(): void {
    for (const p of [...this.players.values()]) if (p.isDummy) this.players.delete(p.id);
    this.startMatch();
  }

  private pickSpawn(cls: PlayerClass): SpawnPoint {
    const list = cls === PlayerClass.Marine ? MARINE_SPAWNS : BLOOM_SPAWNS;
    const enemies = [...this.players.values()].filter((p) => p.alive && factionOf(p.cls) !== factionOf(cls));
    if (enemies.length === 0) {
      const key = cls === PlayerClass.Marine ? 'marine' : 'ripper';
      const sp = list[this.spawnCursor[key] % list.length];
      this.spawnCursor[key]++;
      return sp;
    }
    let best = list[0];
    let bestD = -1;
    for (const sp of list) {
      let md = Infinity;
      for (const e of enemies) md = Math.min(md, Math.hypot(e.sim.px - sp.x, e.sim.pz - sp.z));
      if (md > bestD) {
        bestD = md;
        best = sp;
      }
    }
    return best;
  }

  spawnPlayer(p: ServerPlayer, cls: PlayerClass, alive: boolean): void {
    const sp = this.pickSpawn(cls);
    p.cls = cls;
    p.pendingCls = null;
    p.sim = createPlayerSim(cls, sp.x, sp.y, sp.z, sp.yaw, p.sim.seed);
    p.health = cls === PlayerClass.Marine ? MARINE.health : RIPPER.health;
    p.armour = cls === PlayerClass.Marine ? MARINE.armour : RIPPER.armour;
    p.alive = alive;
    p.epoch = (p.epoch + 1) & 0xffff;
    p.queue.length = 0;
    p.firstDamagedAtTick = 0;
    p.lastProcessedSeq = p.highestSeq;
    p.protectedUntilTick = alive ? this.tick + secToTicks(MATCH.spawnProtectionSec) : 0;
    p.credit = CREDIT_CAP;
  }

  // ---- input intake (validation lives here; authority = what actually gets simulated) ---------

  receiveInputs(id: string, rawFrames: unknown): void {
    const p = this.players.get(id);
    if (!p || p.isDummy) return;
    const list = Array.isArray(rawFrames) ? rawFrames : [];
    if (list.length === 0 || list.length > MAX_BATCH) {
      this.reject(p, 'malformed');
      return;
    }
    const nowMs = this.timeMs;
    p.frameWindow = p.frameWindow.filter((t) => nowMs - t < 1000);
    for (const raw of list) {
      const f = sanitizeInput(raw);
      if (!f) {
        this.reject(p, 'malformed');
        continue;
      }
      if (f.seq <= p.highestSeq) {
        this.reject(p, 'stale-seq');
        continue;
      }
      if (f.epoch !== p.epoch) {
        // produced before the client learned of a spawn/teleport/reconnect: never simulate it
        this.reject(p, 'stale-epoch');
        continue;
      }
      if (p.frameWindow.length >= MAX_FRAMES_PER_SEC) {
        this.reject(p, 'flood');
        continue;
      }
      if (f.seq > p.highestSeq + 1 && p.highestSeq >= 0 && f.seq - p.highestSeq > 600) {
        this.reject(p, 'seq-gap');
        continue;
      }
      if (p.queue.length >= MAX_QUEUE) {
        p.stats.inputsDropped++;
        this.telemetry.inc('input.queue-full');
        this.telemetry.warn('input-rejected', { playerId: p.id, reason: 'queue-full', serverTick: this.tick });
        continue;
      }
      p.frameWindow.push(nowMs);
      p.highestSeq = f.seq;
      p.queue.push({ f, arrival: this.tick });
    }
  }

  private reject(p: ServerPlayer, reason: string): void {
    p.stats.rejectedInputs++;
    this.telemetry.inc(`input.reject.${reason}`);
    this.telemetry.debug('input-rejected', { playerId: p.id, reason, serverTick: this.tick });
  }

  // ---- fixed step -----------------------------------------------------------------------------

  step(): void {
    this.recordHistory();
    for (const p of this.players.values()) {
      p.credit = Math.min(CREDIT_CAP, p.credit + 1);
      if (!p.alive && p.respawnAtTick > 0 && this.tick >= p.respawnAtTick && this.phase === 'playing') {
        this.spawnPlayer(p, p.pendingCls ?? p.cls, true);
        this.events.push({ ev: { t: 'respawn', id: p.id } });
      }
      if (this.phase !== 'playing') continue;
      if (!p.connected) continue; // seat held, body frozen + untouchable
      while (p.credit >= 1 && p.queue.length > 0) {
        const q = p.queue.shift()!;
        p.credit--;
        this.processFrame(p, q.f, q.arrival);
      }
    }
    this.tick++;
  }

  private processFrame(p: ServerPlayer, f: InputFrame, arrivalTick: number): void {
    p.lastProcessedSeq = f.seq;
    if (!p.alive) return;
    const res = this.res;
    stepPlayer(p.sim, f, this.world, res);
    p.stats.ticksBySurface[p.sim.surface]++;
    if (p.cls === PlayerClass.Ripper) this.telemetry.inc(`ripper.ticks.${SURFACE_NAMES[p.sim.surface]}`);
    if (!Number.isFinite(p.sim.px + p.sim.py + p.sim.pz) || res.moved > MAX_TICK_MOVE) {
      // Defensive: the shared step cannot do this; if it ever does, snap back to spawn and tell telemetry.
      this.telemetry.warn('movement-envelope', { playerId: p.id, movementCorrectionReason: 'envelope', serverTick: this.tick });
      this.spawnPlayer(p, p.cls, true);
      return;
    }
    if (res.attached !== -1) {
      this.telemetry.debug('surface-attach', { playerId: p.id, surfaceAttachState: SURFACE_NAMES[res.attached], serverTick: this.tick });
    }
    if (res.detachReason) {
      this.telemetry.inc(`ripper.detach.${res.detachReason}`);
      this.telemetry.debug('surface-detach', { playerId: p.id, surfaceDetachReason: res.detachReason, serverTick: this.tick });
    }
    if (res.leaped) {
      p.stats.leaps++;
      this.telemetry.inc('ripper.leaps');
      this.events.push({ ev: { t: 'leap', id: p.id } });
    }
    if (res.reloadStarted) this.events.push({ ev: { t: 'reload', id: p.id } });
    if (f.primary && p.protectedUntilTick > this.tick) p.protectedUntilTick = 0; // attack input cancels spawn protection

    const ageTicks = Math.max(0, this.tick - arrivalTick);
    const rewindMs = clamp(ageTicks * TICK_MS + p.rttMs / 2 + NET.interpolationBufferMs, 0, NET.rewindHistoryMs);

    if (res.fired) this.resolveRifle(p, f, res.shotIndex, res.spreadDeg, rewindMs);
    else if (res.bit) this.resolveBite(p, f, rewindMs);
    else if (f.primary && !p.prevPrimary && res.fireRejected) {
      const reason = res.fireRejected as ShotRejectReason;
      p.lastShot = { seq: f.seq, result: reason, hit: false, rewindMs: 0 };
      this.telemetry.inc(`shot.reject.${reason}`);
      this.telemetry.debug('shot-rejected', { playerId: p.id, shotAccepted: false, shotRejectReason: reason, serverTick: this.tick });
      this.events.push({ ev: { t: 'shot-result', id: p.id, seq: f.seq, result: reason, hit: false, rewindMs: 0 }, to: p.id });
    }
    p.prevPrimary = f.primary;
  }

  // ---- lag compensation -----------------------------------------------------------------------

  private recordHistory(): void {
    const caps = new Map<string, { cap: Capsule; epoch: number }>();
    for (const p of this.players.values()) if (p.alive) caps.set(p.id, { cap: hurtCapsule(p.sim), epoch: p.epoch });
    this.history[this.tick % HISTORY_TICKS] = { tick: this.tick, caps };
  }

  /** Target hurt volume as it was `rewindMs` ago (clamped to the history window). Never rewinds map geometry. */
  rewoundCapsule(target: ServerPlayer, rewindMs: number): Capsule | null {
    const live = { cap: hurtCapsule(target.sim), epoch: target.epoch };
    const tf = this.tick - clamp(rewindMs, 0, NET.rewindHistoryMs) / TICK_MS;
    if (tf >= this.tick - 1e-6) return live.cap;
    const lo = Math.floor(tf);
    const hi = lo + 1;
    const a = this.history[((lo % HISTORY_TICKS) + HISTORY_TICKS) % HISTORY_TICKS];
    const b = hi >= this.tick ? undefined : this.history[hi % HISTORY_TICKS];
    const ea = a && a.tick === lo ? a.caps.get(target.id) : undefined;
    const eb = hi >= this.tick ? live : b && b.tick === hi ? b.caps.get(target.id) : undefined;
    if (!ea && !eb) return null;
    if (!ea || ea.epoch !== target.epoch) return (eb ?? live).cap;
    if (!eb || eb.epoch !== ea.epoch) return ea.cap;
    const t = tf - lo;
    const mix = (u: Vec3, v: Vec3): Vec3 => ({ x: u.x + (v.x - u.x) * t, y: u.y + (v.y - u.y) * t, z: u.z + (v.z - u.z) * t });
    return { a: mix(ea.cap.a, eb.cap.a), b: mix(ea.cap.b, eb.cap.b), r: ea.cap.r };
  }

  private isHittable(shooter: ServerPlayer, t: ServerPlayer): boolean {
    return t.id !== shooter.id && t.alive && t.connected && factionOf(t.cls) !== factionOf(shooter.cls);
  }

  // ---- combat ---------------------------------------------------------------------------------

  private resolveRifle(shooter: ServerPlayer, f: InputFrame, shotIndex: number, spreadDeg: number, rewindMs: number): void {
    shooter.stats.shotsFired++;
    this.telemetry.inc('rifle.shots');
    const { origin, dir } = shotRay(shooter.sim, shotIndex, spreadDeg);
    const wall = this.world.rayCast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, 300);
    const maxT = wall ? wall.t : 300;
    let bestT = Infinity;
    let victim: ServerPlayer | null = null;
    for (const t of this.players.values()) {
      if (!this.isHittable(shooter, t)) continue;
      const cap = this.rewoundCapsule(t, rewindMs);
      if (!cap) continue;
      const hitT = rayCapsule(origin, dir, cap.a, cap.b, cap.r, maxT);
      if (hitT !== null && hitT < bestT) {
        bestT = hitT;
        victim = t;
      }
    }
    const endT = victim ? bestT : maxT;
    const end = { x: origin.x + dir.x * endT, y: origin.y + dir.y * endT, z: origin.z + dir.z * endT };
    this.events.push({
      ev: { t: 'fire', shooter: shooter.id, ox: origin.x, oy: origin.y, oz: origin.z, dx: dir.x, dy: dir.y, dz: dir.z, ex: end.x, ey: end.y, ez: end.z, hit: victim ? 2 : wall ? 1 : 0, tick: this.tick },
    });
    shooter.lastShot = { seq: f.seq, result: 'ok', hit: !!victim, rewindMs };
    this.telemetry.debug('shot', { playerId: shooter.id, shotAccepted: true, hit: !!victim, rewindMs, serverTick: this.tick });
    this.events.push({ ev: { t: 'shot-result', id: shooter.id, seq: f.seq, result: 'ok', hit: !!victim, rewindMs }, to: shooter.id });
    if (victim) {
      shooter.stats.shotsHit++;
      this.telemetry.inc('rifle.hits');
      this.applyDamage(victim, shooter, RIFLE.damage, 'rifle', end);
    }
  }

  private resolveBite(attacker: ServerPlayer, f: InputFrame, rewindMs: number): void {
    attacker.stats.bites++;
    this.telemetry.inc('bite.attempts');
    const o = biteOrigin(attacker.sim);
    const d = viewDir(attacker.sim.yaw, attacker.sim.pitch);
    const segLen = Math.max(0.1, BITE.reach - BITE.sweepRadius);
    const end: Vec3 = { x: o.x + d.x * segLen, y: o.y + d.y * segLen, z: o.z + d.z * segLen };
    const dh = normalize({ x: d.x, y: 0, z: d.z }, { x: 0, y: 0, z: -1 });
    let best: { t: ServerPlayer; d: number; point: Vec3 } | null = null;
    for (const t of this.players.values()) {
      if (!this.isHittable(attacker, t)) continue;
      const cap = this.rewoundCapsule(t, rewindMs);
      if (!cap) continue;
      const dd = Math.sqrt(segSegDistSq(o, end, cap.a, cap.b));
      if (dd > BITE.sweepRadius + cap.r) continue;
      const near = closestOnSegment(cap.a, cap.b, o);
      const vx = near.x - o.x;
      const vz = near.z - o.z;
      const hl = Math.hypot(vx, vz);
      if (hl > 0.35) {
        const ang = Math.acos(clamp((vx * dh.x + vz * dh.z) / hl, -1, 1));
        if (ang > BITE_HALF_ARC) continue;
      }
      if (!this.world.lineOfSight(o, near)) continue;
      if (!best || dd < best.d) best = { t, d: dd, point: near };
    }
    this.events.push({ ev: { t: 'bite', shooter: attacker.id, ox: o.x, oy: o.y, oz: o.z, dx: d.x, dy: d.y, dz: d.z, hit: !!best } });
    attacker.lastShot = { seq: f.seq, result: 'ok', hit: !!best, rewindMs };
    this.telemetry.debug('bite', { playerId: attacker.id, biteAccepted: true, hit: !!best, rewindMs, serverTick: this.tick });
    this.events.push({ ev: { t: 'shot-result', id: attacker.id, seq: f.seq, result: 'ok', hit: !!best, rewindMs }, to: attacker.id });
    if (best) {
      attacker.stats.biteHits++;
      this.telemetry.inc('bite.hits');
      this.applyDamage(best.t, attacker, BITE.damage, 'bite', best.point);
    }
  }

  applyDamage(target: ServerPlayer, attacker: ServerPlayer, dmg: number, kind: 'rifle' | 'bite', at: Vec3): number {
    if (!target.alive) return 0;
    if (target.protectedUntilTick > this.tick) return 0;
    if (target.firstDamagedAtTick === 0) target.firstDamagedAtTick = this.tick;
    const armourDmg = Math.min(target.armour, dmg);
    target.armour -= armourDmg;
    const healthDmg = dmg - armourDmg;
    target.health = Math.max(0, target.health - healthDmg);
    attacker.damage += armourDmg + healthDmg;
    const killed = target.health <= 0;
    this.events.push({ ev: { t: 'hit', shooter: attacker.id, target: target.id, dmg: healthDmg, armourDmg, px: at.x, py: at.y, pz: at.z, killed, kind } });
    if (killed) this.kill(target, attacker, kind);
    return armourDmg + healthDmg;
  }

  private kill(victim: ServerPlayer, killer: ServerPlayer | null, kind: 'rifle' | 'bite' | 'reset'): void {
    victim.alive = false;
    victim.deaths++;
    if (killer && killer.id !== victim.id) killer.kills++;
    victim.respawnAtTick = this.tick + secToTicks(MATCH.respawnSec);
    victim.queue.length = 0;
    const eventPos = { x: victim.sim.px, y: victim.sim.py, z: victim.sim.pz };
    this.events.push({ ev: { t: 'death', victim: victim.id, killer: killer?.id ?? '', kind, px: eventPos.x, py: eventPos.y, pz: eventPos.z } });
    const ttkMs = victim.firstDamagedAtTick ? (this.tick - victim.firstDamagedAtTick) * TICK_MS : 0;
    if (ttkMs > 0) {
      this.telemetry.inc('ttk.sumMs', ttkMs);
      this.telemetry.inc('ttk.count');
    }
    this.telemetry.inc(`kill.${kind}`);
    this.telemetry.inc(`death.${CLASS_NAMES[victim.cls]}`);
    this.telemetry.inc(`death.room.${roomAt(eventPos.x, eventPos.z)}`);
    this.telemetry.info('death', {
      matchId: this.matchId,
      roomId: this.roomId,
      playerId: victim.id,
      class: CLASS_NAMES[victim.cls],
      killer: killer?.id,
      kind,
      ttkMs: Math.round(ttkMs),
      room: roomAt(eventPos.x, eventPos.z),
      serverTick: this.tick,
    });
  }

  // ---- dev tools (host only, rooms created with dev=true) --------------------------------------

  devAction(id: string, a: DevAction): void {
    const p = this.players.get(id);
    if (!p) return;
    switch (a.action) {
      case 'teleport': {
        const tp = DEV_TELEPORTS[a.room];
        if (!tp) return;
        const sp = p.cls === PlayerClass.Marine ? tp.marine : tp.ripper;
        const s = p.sim;
        s.px = sp.x;
        s.py = sp.y;
        s.pz = sp.z;
        s.vx = s.vy = s.vz = 0;
        s.yaw = sp.yaw;
        s.nx = 0;
        s.ny = 1;
        s.nz = 0;
        s.surface = SurfaceState.Ground;
        p.epoch = (p.epoch + 1) & 0xffff;
        p.queue.length = 0;
        p.lastProcessedSeq = p.highestSeq;
        if (this.phase === 'playing') p.alive = true;
        break;
      }
      case 'switchClass': {
        const cls = a.cls === 1 ? PlayerClass.Ripper : PlayerClass.Marine;
        this.spawnPlayer(p, cls, this.phase === 'playing');
        break;
      }
      case 'refill': {
        const s = p.sim;
        if (p.cls === PlayerClass.Marine) {
          s.ammo = RIFLE.magazine;
          s.reserve = RIFLE.reserve;
          s.reloadTicks = 0;
          p.armour = MARINE.armour;
        } else s.energy = RIPPER.maxEnergy;
        p.health = p.cls === PlayerClass.Marine ? MARINE.health : RIPPER.health;
        break;
      }
      case 'spawnDummy': {
        if ([...this.players.values()].filter((x) => x.isDummy).length >= 4) return;
        const did = `dummy-${++this.dummyCounter}`;
        const cls = a.cls === 1 ? PlayerClass.Ripper : PlayerClass.Marine;
        const d = this.addPlayer(did, `Dummy ${this.dummyCounter}`, cls, 90 + this.dummyCounter, true);
        d.alive = true;
        // park it in front of the requesting player on the floor if that is free, else at its faction spawn
        const f = viewDir(p.sim.yaw, 0);
        const y = cls === PlayerClass.Marine ? p.sim.surface === SurfaceState.Ground && p.cls === PlayerClass.Marine ? p.sim.py : 0 : 0.29;
        if (p.sim.py < 0.5) {
          // furthest free spot in front of the requester (walls may be close to the spawn points)
          for (const dist of [4, 3.2, 2.6, 2.1, 1.7]) {
            const x = p.sim.px + f.x * dist;
            const z = p.sim.pz + f.z * dist;
            if (!this.world.aabbBlocked(x - 0.45, y + 0.01, z - 0.45, x + 0.45, y + 1.8, z + 0.45)) {
              d.sim.px = x;
              d.sim.py = y;
              d.sim.pz = z;
              break;
            }
          }
        }
        break;
      }
      case 'clearDummies':
        for (const x of [...this.players.values()]) if (x.isDummy) this.players.delete(x.id);
        break;
      case 'reset':
        this.resetMatch();
        break;
    }
  }

  drainEvents(): OutEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  distance(a: string, b: string): number {
    const pa = this.players.get(a);
    const pb = this.players.get(b);
    if (!pa || !pb) return Infinity;
    return dist({ x: pa.sim.px, y: pa.sim.py, z: pa.sim.pz }, { x: pb.sim.px, y: pb.sim.py, z: pb.sim.pz });
  }
}

