export enum PlayerClass {
  Marine = 0,
  Ripper = 1,
  /** VS02: slow Bloom support/builder (ground walker). */
  Weaver = 2,
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
export const CLASS_NAMES = ['marine', 'ripper', 'weaver'] as const;
export const CLASS_LABELS = ['Marine', 'Ripper', 'Weaver'] as const;
export const isPlayerClass = (v: unknown): v is PlayerClass => v === 0 || v === 1 || v === 2;
/** Walkers use the AABB controller (Marine, Weaver); the Ripper uses the surface sphere. */
export const isWalker = (c: PlayerClass): boolean => c !== PlayerClass.Ripper;

/** VS02 structures (bible section 32): one per faction, both built on a resource well. */
export type StructureType = 'extractor' | 'harvester';
export enum StructureState {
  Building = 0,
  Active = 1,
}
