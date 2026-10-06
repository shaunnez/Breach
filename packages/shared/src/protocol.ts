import { clamp } from './math';
import type { MatchPhase, StructureType } from './enums';
import type { BuildRejectReason } from './economy';

/**
 * One 60 Hz input frame. Clients send these in batches at 30 Hz; the server simulates exactly one
 * frame per fixed tick of that player, so legal displacement is bounded by construction.
 * moveX: +1 = right (D). moveZ: +1 = forward (W).
 */
export interface InputFrame {
  seq: number;
  clientTimeMs: number;
  moveX: number;
  moveZ: number;
  yaw: number;
  pitch: number;
  jump: boolean;
  sprint: boolean;
  primary: boolean;
  secondary: boolean;
  /** Ripper: wall/ceiling cling wanted (hold or toggle on the client). Floors always stick. */
  cling: boolean;
  interact: boolean;
  /** Smallest prerequisite beyond the bible's frame: Marine needs a reload key. */
  reload: boolean;
  /**
   * Server epoch the client believed it was in when it produced this frame. The server bumps the epoch
   * on spawn/teleport/reconnect and drops frames from an older epoch (they were simulated against a
   * position the player no longer has).
   */
  epoch: number;
}

export const emptyInput = (seq = 0): InputFrame => ({
  seq,
  clientTimeMs: 0,
  moveX: 0,
  moveZ: 0,
  yaw: 0,
  pitch: 0,
  jump: false,
  sprint: false,
  primary: false,
  secondary: false,
  cling: true,
  interact: false,
  reload: false,
  epoch: 0,
});

export const MAX_PITCH = (Math.PI / 2) * 0.998;

export type InputReject = 'malformed' | 'stale-seq' | 'seq-gap' | 'queue-full' | 'stale-epoch' | 'flood';

/** Validate + clamp a raw input object. Returns null if unusable. */
export function sanitizeInput(raw: unknown): InputFrame | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const seq = num(r.seq);
  const yaw = num(r.yaw);
  const pitch = num(r.pitch);
  const mx = num(r.moveX);
  const mz = num(r.moveZ);
  const ct = num(r.clientTimeMs);
  if (seq === null || yaw === null || pitch === null || mx === null || mz === null || ct === null) return null;
  if (!Number.isInteger(seq) || seq < 0 || seq > 0x7fffffff) return null;
  let mxc = clamp(mx, -1, 1);
  let mzc = clamp(mz, -1, 1);
  const m = Math.hypot(mxc, mzc);
  if (m > 1) {
    mxc /= m;
    mzc /= m;
  }
  // yaw is wrapped (any finite value is a valid representation); pitch is clamped.
  let y = yaw % (Math.PI * 2);
  if (y > Math.PI) y -= Math.PI * 2;
  if (y < -Math.PI) y += Math.PI * 2;
  return {
    seq,
    clientTimeMs: ct,
    moveX: mxc,
    moveZ: mzc,
    yaw: y,
    pitch: clamp(pitch, -MAX_PITCH, MAX_PITCH),
    jump: r.jump === true,
    sprint: r.sprint === true,
    primary: r.primary === true,
    secondary: r.secondary === true,
    cling: r.cling !== false,
    interact: r.interact === true,
    reload: r.reload === true,
    epoch: typeof r.epoch === 'number' && Number.isFinite(r.epoch) ? ((r.epoch | 0) & 0xffff) : 0,
  };
}

// ---- messages -------------------------------------------------------------------------------

export const MSG = {
  // client -> server
  input: 'input',
  ping: 'ping',
  setName: 'setName',
  setClass: 'setClass',
  start: 'start',
  resetMatch: 'reset',
  dev: 'dev',
  /** VS02: enter / exit Commander mode at the Command Core console */
  command: 'cmd',
  /** VS02: BuildRequest (Commander: extractor, Weaver: harvester) */
  build: 'build',
  /** VS02: Commander waypoint / ping */
  order: 'order',
  // server -> client
  pong: 'pong',
  serverPing: 'sping',
  event: 'ev',
  notice: 'notice',
} as const;

export interface InputBatchMsg {
  frames: InputFrame[];
}
export interface PingMsg {
  c: number; // client time
}
export interface PongMsg {
  c: number;
  s: number; // server time ms (tick based)
  tick: number;
}
export interface ServerPingMsg {
  id: number;
}
export interface ServerPongMsg {
  id: number;
}

export type DevAction =
  | { action: 'teleport'; room: DevRoom }
  | { action: 'switchClass'; cls: 0 | 1 | 2 }
  | { action: 'refill' }
  | { action: 'spawnDummy'; cls: 0 | 1 | 2 }
  | { action: 'grantResources'; amount: number }
  | { action: 'clearDummies' }
  | { action: 'reset' };

export type DevRoom = 'marineSpawn' | 'junction' | 'resource' | 'ledge' | 'maintenance' | 'hive' | 'vent' | 'console' | 'well';
export const DEV_ROOMS: DevRoom[] = ['marineSpawn', 'junction', 'resource', 'ledge', 'maintenance', 'hive', 'vent', 'console', 'well'];

export interface CommandMsg {
  action: 'enter' | 'exit';
}

/** Commander order. Empty `targets` = a team-wide ping. */
export interface OrderMsg {
  kind: 'move' | 'ping';
  targets: string[];
  x: number;
  y: number;
  z: number;
}

export type CommandRejectReason = 'wrong-role' | 'out-of-reach' | 'occupied' | 'wrong-phase' | 'dead';
export type DamageKind = 'rifle' | 'bite' | 'melee';

export type ShotRejectReason = 'ok' | 'empty' | 'reloading' | 'cooldown' | 'dead' | 'protected-cancel';

export type GameEvent =
  /** hit: 0 miss, 1 world, 2 player, 3 structure */
  | { t: 'fire'; shooter: string; ox: number; oy: number; oz: number; dx: number; dy: number; dz: number; ex: number; ey: number; ez: number; hit: 0 | 1 | 2 | 3; tick: number }
  | { t: 'hit'; shooter: string; target: string; dmg: number; armourDmg: number; px: number; py: number; pz: number; killed: boolean; kind: DamageKind }
  | { t: 'bite'; shooter: string; ox: number; oy: number; oz: number; dx: number; dy: number; dz: number; hit: boolean }
  | { t: 'death'; victim: string; killer: string; kind: DamageKind | 'reset'; px: number; py: number; pz: number }
  // ---- VS02 ----
  | { t: 'build-result'; requestId: number; structure: StructureType; ok: boolean; reason: BuildRejectReason | ''; structureId: string }
  | { t: 'structure'; kind: 'placed' | 'completed' | 'destroyed'; id: string; type: StructureType; faction: number; by: string; x: number; y: number; z: number }
  | { t: 'structure-hit'; id: string; attacker: string; dmg: number; px: number; py: number; pz: number; kind: DamageKind; destroyed: boolean }
  | { t: 'heal'; id: string; x: number; y: number; z: number; players: number; structures: number }
  | { t: 'order'; by: string; kind: 'move' | 'ping'; targets: string[]; x: number; y: number; z: number }
  | { t: 'command'; id: string; on: boolean; reason: CommandRejectReason | 'left' | 'died' | '' }
  | { t: 'respawn'; id: string }
  | { t: 'leap'; id: string }
  | { t: 'reload'; id: string }
  | { t: 'phase'; phase: MatchPhase }
  | { t: 'shot-result'; id: string; seq: number; result: ShotRejectReason; hit: boolean; rewindMs: number };

export interface NoticeMsg {
  text: string;
}

/** Shared pure helpers for room codes. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
export function normalizeRoomCode(s: string): string {
  return s.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}
