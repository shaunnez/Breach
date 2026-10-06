import type { GameEvent, MatchPhase, PlayerSim, StructureState, StructureType } from '@breach/shared';

/** Plain (non-schema) view of one replicated player, extracted at patch time. */
export interface PlayerSnapshot {
  id: string;
  name: string;
  seat: number;
  faction: number;
  connected: boolean;
  host: boolean;
  dummy: boolean;
  alive: boolean;
  protected: boolean;
  epoch: number;
  sim: PlayerSim;
  health: number;
  armour: number;
  ack: number;
  respawnAtMs: number;
  kills: number;
  deaths: number;
  damage: number;
  rttMs: number;
  pendingCls: number;
  /** VS02 */
  commanding: boolean;
  order: OrderView | null;
  /** server time (tick based ms) this snapshot describes */
  t: number;
}

export interface OrderView {
  kind: string;
  x: number;
  y: number;
  z: number;
  untilMs: number;
}

/** VS02 replicated structure (Extractor / Harvester). */
export interface StructureView {
  id: string;
  type: StructureType;
  faction: number;
  nodeId: string;
  x: number;
  y: number;
  z: number;
  hp: number;
  maxHp: number;
  state: StructureState;
  progress: number;
  builderId: string;
}

/** VS02 economy view (server state). Index by Faction. */
export interface EconomyView {
  commanderId: string;
  resources: [number, number];
  income: [number, number];
  ping: OrderView | null;
  structures: StructureView[];
}

export interface MatchView {
  phase: MatchPhase;
  serverTick: number;
  serverTimeMs: number;
  roomCode: string;
  hostId: string;
  matchId: string;
  dev: boolean;
  matchStartMs: number;
  players: PlayerSnapshot[];
  economy: EconomyView;
}

export function extractEconomy(st: any): EconomyView {
  const structures: StructureView[] = [];
  st.structures?.forEach((x: any) =>
    structures.push({ id: x.id, type: x.type, faction: x.faction, nodeId: x.nodeId, x: x.x, y: x.y, z: x.z, hp: x.hp, maxHp: x.maxHp, state: x.state, progress: x.progress, builderId: x.builderId }),
  );
  return {
    commanderId: st.commanderId ?? '',
    resources: [st.resExpedition ?? 0, st.resBloom ?? 0],
    income: [st.incomeExpedition ?? 0, st.incomeBloom ?? 0],
    ping: st.pingUntilMs > 0 ? { kind: st.pingKind, x: st.pingX, y: st.pingY, z: st.pingZ, untilMs: st.pingUntilMs } : null,
    structures,
  };
}

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'lost';

export interface NetCallbacks {
  onMatch(view: MatchView): void;
  onEvent(ev: GameEvent): void;
  onNotice(text: string): void;
  onStatus(status: ConnectionStatus, reason?: string): void;
}

export function extractPlayer(ps: any, t: number): PlayerSnapshot {
  return {
    id: ps.id,
    name: ps.name,
    seat: ps.seat,
    faction: ps.faction,
    connected: ps.connected,
    host: ps.host,
    dummy: ps.dummy,
    alive: ps.alive,
    protected: ps.protected,
    epoch: ps.epoch,
    sim: {
      cls: ps.cls,
      px: ps.px,
      py: ps.py,
      pz: ps.pz,
      vx: ps.vx,
      vy: ps.vy,
      vz: ps.vz,
      yaw: ps.yaw,
      pitch: ps.pitch,
      nx: ps.nx,
      ny: ps.ny,
      nz: ps.nz,
      surface: ps.surface,
      detachT: ps.detachT,
      lockT: ps.lockT,
      leapCd: ps.leapCd,
      energy: ps.energy,
      energyIdle: ps.energyIdle,
      prevJump: ps.prevJump,
      prevReload: ps.prevReload,
      sprinting: ps.sprinting,
      ammo: ps.ammo,
      reserve: ps.reserve,
      reloadTicks: ps.reloadTicks,
      fireCdTicks: ps.fireCdTicks,
      biteCdTicks: ps.biteCdTicks,
      bloom: ps.bloom,
      bloomIdleTicks: ps.bloomIdleTicks,
      shotCount: ps.shotCount,
      seed: ps.seed,
    },
    health: ps.health,
    armour: ps.armour,
    ack: ps.lastProcessedInputSeq,
    respawnAtMs: ps.respawnAtMs,
    kills: ps.kills,
    deaths: ps.deaths,
    damage: ps.damage,
    rttMs: ps.rttMs,
    pendingCls: ps.pendingCls,
    commanding: !!ps.commanding,
    order: ps.orderUntilMs > 0 ? { kind: ps.orderKind, x: ps.orderX, y: ps.orderY, z: ps.orderZ, untilMs: ps.orderUntilMs } : null,
    t,
  };
}
