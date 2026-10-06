import { useSyncExternalStore } from 'react';
import type { ConnectionStatus, MatchView } from '../game/network/types';

export interface KillFeedEntry {
  id: number;
  text: string;
  at: number;
  mine: boolean;
}

export interface HudState {
  alive: boolean;
  cls: number;
  health: number;
  armour: number;
  ammo: number;
  reserve: number;
  reloading: number; // 0..1 progress, 0 if not reloading
  energy: number;
  leapReady: boolean;
  protected: boolean;
  respawnIn: number; // seconds
  spread: number; // degrees, for crosshair
  hitMarkerAt: number;
  hitKind: 'flesh' | 'armour' | 'kill' | '';
  damageFlashAt: number;
  damageDirs: { at: number; angle: number }[];
  speed: number;
  surface: number;
  locked: boolean;
  rtt: number;
}

export interface DebugState {
  fps: number;
  frameMs: number;
  frameMsMax: number;
  drawCalls: number;
  serverTick: number;
  tickDriftMs: number;
  rttMs: number;
  jitterMs: number;
  inputSeq: number;
  lastAck: number;
  unacked: number;
  predErrM: number;
  predErrMaxM: number;
  reconPerSec: number;
  reconTotal: number;
  surfaceBreaks: number;
  correctionM: number;
  speed: number;
  surface: string;
  normal: string;
  lastShot: string;
  patchesPerSec: number;
  simLagMs: number;
  simJitterMs: number;
  viewAssist: boolean;
  toggles: Record<string, boolean>;
}

export interface UiState {
  screen: 'landing' | 'lobby' | 'game';
  name: string;
  roomCode: string;
  status: ConnectionStatus;
  statusReason: string;
  match: MatchView | null;
  notice: { text: string; at: number } | null;
  error: string | null;
  hud: HudState;
  debug: DebugState | null;
  dev: boolean;
  scoreboard: boolean;
  killFeed: KillFeedEntry[];
  sessionId: string;
  busy: boolean;
}

export const emptyHud = (): HudState => ({
  alive: false,
  cls: 0,
  health: 0,
  armour: 0,
  ammo: 0,
  reserve: 0,
  reloading: 0,
  energy: 0,
  leapReady: false,
  protected: false,
  respawnIn: 0,
  spread: 0.5,
  hitMarkerAt: 0,
  hitKind: '',
  damageFlashAt: 0,
  damageDirs: [],
  speed: 0,
  surface: 0,
  locked: false,
  rtt: 0,
});

const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');

let state: UiState = {
  screen: 'landing',
  name: (() => {
    try {
      return localStorage.getItem('breach.name') || `Player${Math.floor(100 + Math.random() * 900)}`;
    } catch {
      return 'Player';
    }
  })(),
  roomCode: (params.get('room') ?? '').toUpperCase(),
  status: 'idle',
  statusReason: '',
  match: null,
  notice: null,
  error: null,
  hud: emptyHud(),
  debug: null,
  dev: params.get('dev') === '1',
  scoreboard: false,
  killFeed: [],
  sessionId: '',
  busy: false,
};

const listeners = new Set<() => void>();
export const getState = (): UiState => state;
export function setState(patch: Partial<UiState> | ((s: UiState) => Partial<UiState>)): void {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}
export function useStore<T>(sel: (s: UiState) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => sel(state),
  );
}
