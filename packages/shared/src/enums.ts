export enum PlayerClass {
  Marine = 0,
  Ripper = 1,
}

export enum Faction {
  Expedition = 0,
  Bloom = 1,
}

/** Ripper surface state (Marine uses Ground / Air only). */
export enum SurfaceState {
  Ground = 0,
  Wall = 1,
  Ceiling = 2,
  Air = 3,
}

export type MatchPhase = 'warmup' | 'playing' | 'resetting';

export const factionOf = (c: PlayerClass): Faction => (c === PlayerClass.Marine ? Faction.Expedition : Faction.Bloom);

export const SURFACE_NAMES = ['ground', 'wall', 'ceiling', 'air'] as const;
export const CLASS_NAMES = ['marine', 'ripper'] as const;
