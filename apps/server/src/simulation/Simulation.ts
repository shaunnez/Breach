import {
  BITE,
  BUILD_TICKS,
  CLASS_CHANGE,
  CLASS_NAMES,
  atOwnBase,
  COMMAND,
  COMMAND_CONSOLE,
  Faction,
  MAP_BOUNDS,
  RESOURCE_NODES,
  STRUCTURE,
  STRUCTURE_COST,
  STRUCTURE_LABEL,
  StructureState,
  WEAVER,
  closestOnAabb,
  commanderFrame,
  createEconomy,
  damageStructure,
  findNode,
  healStructure,
  incomePerSec,
  isPlayerClass,
  isStructureType,
  maxArmourOf,
  maxHealthOf,
  nodeController,
  placeStructure,
  rayAabb,
  stepEconomy,
  structureHurtBox,
  validateBuild,
  type BuildRejectReason,
  type BuildRequest,
  type CommandRejectReason,
  type DamageKind,
  type EconomyState,
  type OrderMsg,
  type Structure,
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

/** horizontal distance */
const hdist = (ax: number, az: number, bx: number, bz: number): number => Math.hypot(ax - bx, az - bz);
import { Telemetry, silentTelemetry } from '../telemetry/telemetry';

export const MAX_QUEUE = 12;
export const CREDIT_CAP = 4;
export const MAX_BATCH = 8;
export const MAX_FRAMES_PER_SEC = 90;
const HISTORY_TICKS = 48;
const BITE_HALF_ARC = (BITE.horizontalArcDeg / 2) * (Math.PI / 180);
const MELEE_HALF_ARC = (WEAVER.meleeArcDeg / 2) * (Math.PI / 180);
const ORDER_TTL_TICKS = secToTicks(COMMAND.orderTtlSec);
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
  /** VS02 */
  structureDamage: number;
  healed: number;
  heals: number;
  builds: number;
  buildRejects: number;
}

export interface Order {
  kind: 'move' | 'ping';
  x: number;
  y: number;
  z: number;
  untilTick: number;
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
  /** VS02: in Commander mode (body frozen at the console, inputs neutralised) */
  commanding: boolean;
  /** VS02: latest Commander waypoint / ping for this Marine */
  order: Order | null;
  /** VS02: command/build/order message timestamps (rate limit) */
  msgWindow: number[];
  /** VS02: earliest tick of the next in-base class change (D-36) */
  classChangeReadyTick: number;
}

/** What a class request did: switched on the spot (at base), queued for the next spawn, or refused (side full). */
export type ClassChangeResult = 'now' | 'queued' | 'refused';

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
  /** VS02 economy: the only live copy (D-26) */
  econ: EconomyState = createEconomy();
  commanderId = '';
  /** team-wide Commander ping (null when none) */
  teamPing: Order | null = null;
  private econOut = { completed: [] as Structure[] };

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
      health: maxHealthOf(cls),
      armour: maxArmourOf(cls),
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
      stats: { shotsFired: 0, shotsHit: 0, bites: 0, biteHits: 0, leaps: 0, rejectedInputs: 0, inputsDropped: 0, ticksBySurface: [0, 0, 0, 0], structureDamage: 0, healed: 0, heals: 0, builds: 0, buildRejects: 0 },
      lastShot: { seq: 0, result: 'ok', hit: false, rewindMs: 0 },
      commanding: false,
      order: null,
      msgWindow: [],
      classChangeReadyTick: 0,
    };
    this.players.set(id, p);
    return p;
  }

  removePlayer(id: string): void {
    if (this.commanderId === id) this.exitCommand(id, 'left');
    this.players.delete(id);
  }

  classCount(cls: PlayerClass, exceptId?: string): number {
    let n = 0;
    for (const p of this.players.values()) if (!p.isDummy && p.id !== exceptId && (p.pendingCls ?? p.cls) === cls) n++;
    return n;
  }

  /** Humans on a side (counting queued class changes). */
  factionCount(f: Faction, exceptId?: string): number {
    let n = 0;
    for (const p of this.players.values()) if (!p.isDummy && p.id !== exceptId && factionOf(p.pendingCls ?? p.cls) === f) n++;
    return n;
  }

  /** Simple team-size guard (D-21, extended for the Weaver in D-31): at most ceil(maxPlayers/2) humans per side. */
  canTakeClass(id: string, cls: PlayerClass): boolean {
    return this.factionCount(factionOf(cls), id) < Math.ceil(MATCH.maxPlayers / 2);
  }

  setClass(id: string, cls: PlayerClass): boolean {
    return this.requestClass(id, cls) !== 'refused';
  }

  /**
   * Lobby: immediate. In a match: a living player standing in their own base switches to another class of the same
   * side on the spot (D-36, e.g. Ripper <-> Weaver in the Hive); otherwise the change waits for the next spawn.
   */
  requestClass(id: string, cls: PlayerClass): ClassChangeResult {
    const p = this.players.get(id);
    if (!p || !isPlayerClass(cls)) return 'refused';
    if (!p.isDummy && !this.canTakeClass(id, cls)) return 'refused';
    if (this.phase === 'warmup') {
      this.spawnPlayer(p, cls, false);
      p.alive = false;
      p.pendingCls = null;
      return 'now';
    }
    if (
      p.alive &&
      p.connected &&
      !p.commanding &&
      cls !== p.cls &&
      factionOf(cls) === factionOf(p.cls) &&
      atOwnBase(p.cls, p.sim.px, p.sim.pz) &&
      this.tick >= p.classChangeReadyTick
    ) {
      this.spawnPlayer(p, cls, true);
      p.classChangeReadyTick = this.tick + secToTicks(CLASS_CHANGE.baseCooldownSec);
      this.telemetry.inc(`class.change.base.${CLASS_NAMES[cls]}`);
      this.events.push({ ev: { t: 'respawn', id: p.id } });
      return 'now';
    }
    p.pendingCls = cls === p.cls ? null : cls;
    return 'queued';
  }

  // ---- match lifecycle ------------------------------------------------------------------------

  startMatch(): void {
    this.phase = 'playing';
    this.matchStartTick = this.tick;
    this.econ = createEconomy();
    this.commanderId = '';
    this.teamPing = null;
    for (const p of this.players.values()) {
      p.kills = p.deaths = p.damage = 0;
      p.commanding = false;
      p.order = null;
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
    const sp = this.pickSpawnPoint(cls);
    // Bloom spawn points are Ripper sphere centres; the Weaver is a walker whose origin is its feet
    return cls === PlayerClass.Weaver ? { ...sp, y: 0 } : sp;
  }

  private pickSpawnPoint(cls: PlayerClass): SpawnPoint {
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
    if (p.commanding) this.exitCommand(p.id, 'died');
    const sp = this.pickSpawn(cls);
    p.cls = cls;
    p.pendingCls = null;
    p.sim = createPlayerSim(cls, sp.x, sp.y, sp.z, sp.yaw, p.sim.seed);
    p.health = maxHealthOf(cls);
    p.armour = maxArmourOf(cls);
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
    if (this.phase === 'playing') this.stepStrategy();
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
    if (p.commanding) f = commanderFrame(f); // body stays at the console (the client predicts the same frame)
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
    if (res.healPulse) this.resolveHealPulse(p);
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
    // structures stop rounds whichever side owns them; only enemy structures take damage (not lag-compensated: they never move)
    let struct: Structure | null = null;
    for (const st of this.econ.structures) {
      const b = structureHurtBox(st);
      const t = rayAabb(origin, dir, b.min, b.max, Math.min(maxT, bestT));
      if (t !== null && t < bestT) {
        bestT = t;
        struct = st;
        victim = null;
      }
    }
    const endT = victim || struct ? bestT : maxT;
    const end = { x: origin.x + dir.x * endT, y: origin.y + dir.y * endT, z: origin.z + dir.z * endT };
    this.events.push({
      ev: { t: 'fire', shooter: shooter.id, ox: origin.x, oy: origin.y, oz: origin.z, dx: dir.x, dy: dir.y, dz: dir.z, ex: end.x, ey: end.y, ez: end.z, hit: victim ? 2 : struct ? 3 : wall ? 1 : 0, tick: this.tick },
    });
    if (struct && struct.faction !== factionOf(shooter.cls)) this.damageStructureBy(struct, shooter, RIFLE.damage, 'rifle', end);
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
    // Ripper bite (VS01) or Weaver melee (VS02): same swept-sphere test, per-class numbers
    const weaver = attacker.cls === PlayerClass.Weaver;
    const reach = weaver ? WEAVER.meleeReach : BITE.reach;
    const sweep = weaver ? WEAVER.meleeSweepRadius : BITE.sweepRadius;
    const halfArc = weaver ? MELEE_HALF_ARC : BITE_HALF_ARC;
    const damage = weaver ? WEAVER.meleeDamage : BITE.damage;
    const kind: DamageKind = weaver ? 'melee' : 'bite';
    attacker.stats.bites++;
    this.telemetry.inc(weaver ? 'melee.attempts' : 'bite.attempts');
    const o = biteOrigin(attacker.sim);
    const d = viewDir(attacker.sim.yaw, attacker.sim.pitch);
    const segLen = Math.max(0.1, reach - sweep);
    const end: Vec3 = { x: o.x + d.x * segLen, y: o.y + d.y * segLen, z: o.z + d.z * segLen };
    const dh = normalize({ x: d.x, y: 0, z: d.z }, { x: 0, y: 0, z: -1 });
    let best: { t: ServerPlayer; d: number; point: Vec3 } | null = null;
    for (const t of this.players.values()) {
      if (!this.isHittable(attacker, t)) continue;
      const cap = this.rewoundCapsule(t, rewindMs);
      if (!cap) continue;
      const dd = Math.sqrt(segSegDistSq(o, end, cap.a, cap.b));
      if (dd > sweep + cap.r) continue;
      const near = closestOnSegment(cap.a, cap.b, o);
      const vx = near.x - o.x;
      const vz = near.z - o.z;
      const hl = Math.hypot(vx, vz);
      if (hl > 0.35) {
        const ang = Math.acos(clamp((vx * dh.x + vz * dh.z) / hl, -1, 1));
        if (ang > halfArc) continue;
      }
      if (!this.world.lineOfSight(o, near)) continue;
      if (!best || dd < best.d) best = { t, d: dd, point: near };
    }
    // no player in the sweep: an enemy structure within reach takes the swing
    let struct: { s: Structure; point: Vec3 } | null = null;
    if (!best) {
      for (const st of this.econ.structures) {
        if (st.faction === factionOf(attacker.cls)) continue;
        const b = structureHurtBox(st);
        for (let i = 0; i <= 4; i++) {
          const k = i / 4;
          const q: Vec3 = { x: o.x + (end.x - o.x) * k, y: o.y + (end.y - o.y) * k, z: o.z + (end.z - o.z) * k };
          const c = closestOnAabb(b.min, b.max, q);
          if (dist(c, q) <= sweep && this.world.lineOfSight(o, c)) {
            struct = { s: st, point: c };
            break;
          }
        }
        if (struct) break;
      }
    }
    const hit = !!best || !!struct;
    this.events.push({ ev: { t: 'bite', shooter: attacker.id, ox: o.x, oy: o.y, oz: o.z, dx: d.x, dy: d.y, dz: d.z, hit } });
    attacker.lastShot = { seq: f.seq, result: 'ok', hit, rewindMs };
    this.telemetry.debug('bite', { playerId: attacker.id, biteAccepted: true, hit, rewindMs, serverTick: this.tick });
    this.events.push({ ev: { t: 'shot-result', id: attacker.id, seq: f.seq, result: 'ok', hit, rewindMs }, to: attacker.id });
    if (best) {
      attacker.stats.biteHits++;
      this.telemetry.inc(weaver ? 'melee.hits' : 'bite.hits');
      this.applyDamage(best.t, attacker, damage, kind, best.point);
    } else if (struct) {
      this.damageStructureBy(struct.s, attacker, damage, kind, struct.point);
    }
  }

  applyDamage(target: ServerPlayer, attacker: ServerPlayer, dmg: number, kind: DamageKind, at: Vec3): number {
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

  private kill(victim: ServerPlayer, killer: ServerPlayer | null, kind: DamageKind | 'reset'): void {
    victim.alive = false;
    if (victim.commanding) this.exitCommand(victim.id, 'died');
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

  // ---- VS02 strategy layer (all server authority; D-26) -----------------------------------------

  /** Per tick while playing: construction, income, order expiry, node-control telemetry. */
  private stepStrategy(): void {
    const done = stepEconomy(this.econ, this.econOut).completed;
    for (const st of done) {
      this.telemetry.inc(`structure.completed.${st.type}`);
      this.telemetry.info('structure-completed', { matchId: this.matchId, roomId: this.roomId, structure: st.type, structureId: st.id, serverTick: this.tick });
      this.events.push({ ev: { t: 'structure', kind: 'completed', id: st.id, type: st.type, faction: st.faction, by: st.builderId, x: st.x, y: st.y, z: st.z } });
    }
    for (const n of RESOURCE_NODES) {
      const c = nodeController(this.econ, n.id);
      this.telemetry.inc(`node.ticks.${c === null ? 'none' : c === Faction.Expedition ? 'expedition' : 'bloom'}`);
    }
    if (this.teamPing && this.tick >= this.teamPing.untilTick) this.teamPing = null;
    for (const p of this.players.values()) if (p.order && this.tick >= p.order.untilTick) p.order = null;
  }

  /** Command / build / order messages are rate limited per player (they bypass the input queue). */
  private allowMsg(p: ServerPlayer): boolean {
    const now = this.timeMs;
    p.msgWindow = p.msgWindow.filter((t) => now - t < 1000);
    if (p.msgWindow.length >= COMMAND.msgPerSec) {
      this.telemetry.inc('command.reject.flood');
      return false;
    }
    p.msgWindow.push(now);
    return true;
  }

  /** A Marine at the Command Core console enters Commander mode (bible section 33). */
  enterCommand(id: string): CommandRejectReason | null {
    const p = this.players.get(id);
    if (!p || !this.allowMsg(p)) return null;
    let reason: CommandRejectReason | null = null;
    if (this.phase !== 'playing') reason = 'wrong-phase';
    else if (!p.alive) reason = 'dead';
    else if (p.cls !== PlayerClass.Marine) reason = 'wrong-role';
    else if (p.commanding) return null;
    else if (this.commanderId && this.players.get(this.commanderId)?.commanding) reason = 'occupied';
    else if (hdist(p.sim.px, p.sim.pz, COMMAND_CONSOLE.standX, COMMAND_CONSOLE.standZ) > COMMAND.consoleReach) reason = 'out-of-reach';
    if (reason) {
      this.telemetry.inc(`command.reject.${reason}`);
      this.events.push({ ev: { t: 'command', id, on: false, reason }, to: id });
      return reason;
    }
    // the body stays at the console: snap it onto the stand point (a server-side teleport: new epoch)
    const s = p.sim;
    s.px = COMMAND_CONSOLE.standX;
    s.pz = COMMAND_CONSOLE.standZ;
    s.vx = s.vy = s.vz = 0;
    s.yaw = COMMAND_CONSOLE.yaw;
    s.pitch = 0;
    s.sprinting = 0;
    p.epoch = (p.epoch + 1) & 0xffff;
    p.queue.length = 0;
    p.lastProcessedSeq = p.highestSeq;
    p.commanding = true;
    p.order = null;
    this.commanderId = id;
    this.telemetry.inc('command.enter');
    this.telemetry.info('commander-enter', { matchId: this.matchId, roomId: this.roomId, playerId: id, serverTick: this.tick });
    this.events.push({ ev: { t: 'command', id, on: true, reason: '' } });
    return null;
  }

  exitCommand(id: string, reason: 'left' | 'died' | '' = ''): void {
    const p = this.players.get(id);
    if (p) p.commanding = false;
    if (this.commanderId !== id) return;
    this.commanderId = '';
    this.telemetry.inc('command.exit');
    this.events.push({ ev: { t: 'command', id, on: false, reason } });
  }

  /** Bible section 33 BuildRequest. Commander -> Extractor, Weaver -> Harvester. Returns the reject reason or null. */
  requestBuild(id: string, raw: unknown): BuildRejectReason | null {
    const p = this.players.get(id);
    if (!p || !this.allowMsg(p)) return null;
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const req: BuildRequest = {
      requestId: typeof r.requestId === 'number' && Number.isInteger(r.requestId) ? r.requestId : -1,
      structure: isStructureType(r.structure) ? r.structure : ('' as never),
      resourceNodeId: typeof r.resourceNodeId === 'string' ? r.resourceNodeId.slice(0, 32) : '',
    };
    let reason: BuildRejectReason | null = null;
    if (req.requestId < 0 || !isStructureType(req.structure)) reason = 'malformed';
    else if (this.phase !== 'playing') reason = 'wrong-phase';
    else if (req.structure === 'extractor' && !(p.commanding && this.commanderId === id)) reason = 'wrong-role';
    else if (req.structure === 'harvester' && p.cls !== PlayerClass.Weaver) reason = 'wrong-role';
    else if (!p.alive) reason = 'dead';
    else reason = validateBuild(this.econ, req, this.phase);
    if (!reason && req.structure === 'harvester') {
      const n = findNode(req.resourceNodeId)!;
      if (hdist(p.sim.px, p.sim.pz, n.x, n.z) > WEAVER.buildReach) reason = 'out-of-reach';
    }
    const structure = isStructureType(req.structure) ? req.structure : 'extractor';
    if (reason) {
      p.stats.buildRejects++;
      this.telemetry.inc(`build.reject.${reason}`);
      this.telemetry.debug('build-rejected', { playerId: id, structure, buildRejectReason: reason, serverTick: this.tick });
      this.events.push({ ev: { t: 'build-result', requestId: req.requestId, structure, ok: false, reason, structureId: '' }, to: id });
      return reason;
    }
    const st = placeStructure(this.econ, req.structure, req.resourceNodeId, id);
    p.stats.builds++;
    this.telemetry.inc(`structure.placed.${st.type}`);
    this.telemetry.inc(`economy.spent.${st.faction === Faction.Expedition ? 'expedition' : 'bloom'}`, STRUCTURE_COST[st.type]);
    this.telemetry.info('structure-placed', { matchId: this.matchId, roomId: this.roomId, playerId: id, structure: st.type, structureId: st.id, serverTick: this.tick });
    this.events.push({ ev: { t: 'build-result', requestId: req.requestId, structure: st.type, ok: true, reason: '', structureId: st.id }, to: id });
    this.events.push({ ev: { t: 'structure', kind: 'placed', id: st.id, type: st.type, faction: st.faction, by: id, x: st.x, y: st.y, z: st.z } });
    return null;
  }

  /** Commander waypoint (selected Marines) or team ping (no targets). */
  order(id: string, raw: unknown): boolean {
    const p = this.players.get(id);
    if (!p || !this.allowMsg(p) || !p.commanding || this.commanderId !== id || this.phase !== 'playing') {
      this.telemetry.inc('order.reject');
      return false;
    }
    const m = (raw && typeof raw === 'object' ? raw : {}) as Partial<OrderMsg>;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
    const x = num(m.x);
    const y = num(m.y);
    const z = num(m.z);
    if (!(x >= MAP_BOUNDS.minX && x <= MAP_BOUNDS.maxX && z >= MAP_BOUNDS.minZ && z <= MAP_BOUNDS.maxZ && y >= -1 && y <= 8)) {
      this.telemetry.inc('order.reject');
      return false;
    }
    const kind = m.kind === 'move' ? 'move' : 'ping';
    const ids = Array.isArray(m.targets) ? m.targets.filter((t): t is string => typeof t === 'string').slice(0, 8) : [];
    const targets = ids.filter((t) => {
      const q = this.players.get(t);
      return !!q && q.id !== id && q.cls === PlayerClass.Marine;
    });
    const o: Order = { kind, x, y, z, untilTick: this.tick + ORDER_TTL_TICKS };
    if (targets.length === 0) this.teamPing = o;
    for (const t of targets) this.players.get(t)!.order = { ...o };
    this.telemetry.inc(`order.${kind}`);
    this.events.push({ ev: { t: 'order', by: id, kind, targets, x, y, z } });
    return true;
  }

  private damageStructureBy(st: Structure, attacker: ServerPlayer, dmg: number, kind: DamageKind, at: Vec3): void {
    const r = damageStructure(this.econ, st, dmg);
    if (r.dealt <= 0) return;
    attacker.stats.structureDamage += r.dealt;
    this.telemetry.inc(`structure.damage.${st.type}`, r.dealt);
    this.events.push({ ev: { t: 'structure-hit', id: st.id, attacker: attacker.id, dmg: r.dealt, px: at.x, py: at.y, pz: at.z, kind, destroyed: r.destroyed } });
    if (r.destroyed) {
      this.telemetry.inc(`structure.destroyed.${st.type}`);
      this.telemetry.info('structure-destroyed', { matchId: this.matchId, roomId: this.roomId, playerId: attacker.id, structure: st.type, structureId: st.id, kind, serverTick: this.tick });
      this.events.push({ ev: { t: 'structure', kind: 'destroyed', id: st.id, type: st.type, faction: st.faction, by: attacker.id, x: st.x, y: st.y, z: st.z } });
    }
  }

  /** Weaver heal pulse: Bloom players and Bloom structures within the radius. */
  private resolveHealPulse(p: ServerPlayer): void {
    const f = factionOf(p.cls);
    let players = 0;
    let structures = 0;
    let total = 0;
    for (const q of this.players.values()) {
      if (!q.alive || !q.connected || factionOf(q.cls) !== f) continue;
      if (dist({ x: q.sim.px, y: q.sim.py, z: q.sim.pz }, { x: p.sim.px, y: p.sim.py, z: p.sim.pz }) > WEAVER.healPulseRadius) continue;
      const before = q.health;
      q.health = Math.min(maxHealthOf(q.cls), q.health + WEAVER.healPulseAmount);
      if (q.health > before) {
        players++;
        total += q.health - before;
      }
    }
    for (const st of this.econ.structures) {
      if (st.faction !== f || hdist(st.x, st.z, p.sim.px, p.sim.pz) > WEAVER.healPulseRadius + STRUCTURE.hurtHalf) continue;
      const h = healStructure(st, WEAVER.healPulseStructureAmount);
      if (h > 0) {
        structures++;
        total += h;
      }
    }
    p.stats.heals++;
    p.stats.healed += total;
    this.telemetry.inc('weaver.heal.pulses');
    this.telemetry.inc('weaver.heal.amount', total);
    this.events.push({ ev: { t: 'heal', id: p.id, x: p.sim.px, y: p.sim.py, z: p.sim.pz, players, structures } });
  }

  /** Live economy snapshot (dev overlay + /debug/telemetry). */
  economySnapshot(): Record<string, unknown> {
    return {
      phase: this.phase,
      serverTick: this.tick,
      commanderId: this.commanderId,
      resources: { expedition: +this.econ.teams[0].resources.toFixed(2), bloom: +this.econ.teams[1].resources.toFixed(2) },
      incomePerSec: { expedition: incomePerSec(this.econ, Faction.Expedition), bloom: incomePerSec(this.econ, Faction.Bloom) },
      earned: { expedition: +this.econ.teams[0].earned.toFixed(2), bloom: +this.econ.teams[1].earned.toFixed(2) },
      spent: { expedition: this.econ.teams[0].spent, bloom: this.econ.teams[1].spent },
      structures: this.econ.structures.map((st) => ({
        id: st.id,
        type: st.type,
        label: STRUCTURE_LABEL[st.type],
        hp: Math.round(st.hp),
        maxHp: st.maxHp,
        state: st.state === StructureState.Active ? 'active' : 'building',
        progress: +Math.min(1, st.buildTicks / BUILD_TICKS).toFixed(2),
      })),
      nodes: RESOURCE_NODES.map((n) => ({ id: n.id, controller: ['expedition', 'bloom'][nodeController(this.econ, n.id) ?? -1] ?? 'none' })),
    };
  }

  // ---- dev tools (host only, rooms created with dev=true) --------------------------------------

  devAction(id: string, a: DevAction): void {
    const p = this.players.get(id);
    if (!p) return;
    switch (a.action) {
      case 'teleport': {
        const tp = DEV_TELEPORTS[a.room];
        if (!tp) return;
        if (p.commanding) this.exitCommand(p.id);
        const sp = p.cls === PlayerClass.Ripper ? tp.ripper : tp.marine;
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
        const cls = isPlayerClass(a.cls) ? a.cls : PlayerClass.Marine;
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
        } else s.energy = p.cls === PlayerClass.Weaver ? WEAVER.maxEnergy : RIPPER.maxEnergy;
        p.health = maxHealthOf(p.cls);
        break;
      }
      case 'spawnDummy': {
        if ([...this.players.values()].filter((x) => x.isDummy).length >= 4) return;
        const did = `dummy-${++this.dummyCounter}`;
        const cls = isPlayerClass(a.cls) ? a.cls : PlayerClass.Marine;
        const d = this.addPlayer(did, `Dummy ${this.dummyCounter}`, cls, 90 + this.dummyCounter, true);
        d.alive = true;
        // park it in front of the requesting player on the floor if that is free, else at its faction spawn
        const f = viewDir(p.sim.yaw, 0);
        const y = cls !== PlayerClass.Ripper ? (p.sim.surface === SurfaceState.Ground && p.cls !== PlayerClass.Ripper ? p.sim.py : 0) : 0.29;
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
      case 'grantResources': {
        const amt = typeof a.amount === 'number' && Number.isFinite(a.amount) ? clamp(a.amount, 0, 1000) : 0;
        for (const t of this.econ.teams) t.resources += amt;
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


