// Initial tuning baseline: config/balance.example.ts (verbatim values) plus the small
// number of extra constants VS01 needs. Extras are marked and documented in docs/DECISIONS.md.

export const NET = {
  clientPredictionHz: 60,
  inputSendHz: 30,
  serverSimulationHz: 60,
  statePatchHz: 20,
  rewindHistoryMs: 250,
  interpolationBufferMs: 100,
  reconnectSeatHoldMs: 15_000,
} as const;

export const MARINE = {
  health: 100,
  armour: 50,
  walkSpeed: 4.6,
  sprintSpeed: 6.5,
  backwardSpeed: 4.0,
  strafeSpeed: 4.3,
  groundAcceleration: 28,
  airAcceleration: 7.5,
  friction: 12,
  gravity: 18,
  jumpImpulse: 5.8,
  horizontalSpeedCap: 6.8,
  fov: 90,
  sprintFov: 94,
  colliderRadius: 0.32,
  standingHeight: 1.78,
  eyeHeight: 1.62,
  stepHeight: 0.35,
  maxSlopeDeg: 48,
} as const;

export const RIPPER = {
  health: 120,
  armour: 0,
  groundSpeed: 7.0,
  surfaceSpeed: 8.0,
  maxTraversalSpeed: 9.5,
  surfaceAcceleration: 42,
  airAcceleration: 14,
  leapForwardImpulse: 9.5,
  leapBiasImpulse: 2.2,
  leapCooldownSec: 0.8,
  maxEnergy: 100,
  leapEnergyCost: 25,
  energyRegenPerSec: 20,
  energyRegenDelaySec: 0.5,
  fov: 100,
  maxCameraRollDeg: 28,
  surfaceProbeDistance: 0.38,
  minWallAttachSpeed: 3.5,
  detachGraceMs: 120,
  colliderRadius: 0.28,
} as const;

/** EXTRA (not in balance.example.ts): Ripper constants the bible leaves implicit. */
export const RIPPER_EXTRA = {
  /** World-down acceleration while airborne. Lower than Marine so a leap reaches the 7-9 m target. */
  airGravity: 12,
  /** Detach from wall/ceiling when tangent speed stays below this (bible: "configured detach threshold"). */
  minWallSustainSpeed: 2.0,
  /** Deceleration with no input while attached to ground / wall+ceiling (wall coasting keeps momentum). */
  groundIdleDecel: 40,
  surfaceIdleDecel: 12,
  /** Deceleration with no input while clinging (F) to a wall/ceiling: stop where you are, like on the floor (D-25). */
  clingIdleDecel: 40,
  /** Soft cap applied when tangent speed exceeds maxTraversalSpeed (e.g. after landing a leap). */
  overspeedDecel: 25,
  /** Horizontal speed cap in the air. */
  airSpeedCap: 14,
  /** Surface attach disabled for this long after leaving a surface by leap/drop. */
  leapLockoutSec: 0.09,
  /** Fraction of into-surface speed converted into travel along the surface when landing on a wall/ceiling. */
  landConversion: 0.65,
  /** Air attach contact tolerance beyond the collider radius. */
  restGap: 0.006,
  /** Hurt volume (server-side hit tests only). */
  hurtRadius: 0.4,
  hurtHalfSegment: 0.2,
} as const;

export const RIFLE = {
  damage: 10,
  rpm: 600,
  magazine: 30,
  reserve: 90,
  reloadSec: 2.15,
  baseSpreadDeg: 0.55,
  movingSpreadDeg: 0.85,
  bloomCapDeg: 1.2,
} as const;

/** EXTRA: bloom detail the bible gives only qualitatively ("quick; begin after 90 ms without firing"). */
export const RIFLE_EXTRA = {
  bloomPerShotDeg: 0.09,
  bloomRecoveryDelaySec: 0.09,
  bloomRecoveryDegPerSec: 6,
} as const;

export const BITE = {
  damage: 55,
  cooldownSec: 0.55,
  reach: 1.35,
  sweepRadius: 0.38,
  horizontalArcDeg: 70,
} as const;

export const MATCH = {
  respawnSec: 4,
  spawnProtectionSec: 1,
  maxPlayers: 4,
} as const;

/** EXTRA: Marine hurt volume (vertical capsule, server-side hit tests only). */
export const MARINE_HURT = { radius: 0.36, bottom: 0.36, top: 1.46 } as const;

// ---- VS02: Strategy Truth Slice ------------------------------------------------------------------

/** Bible section 32 "Economy baseline", verbatim (also in config/balance.example.ts). */
export const ECONOMY = {
  structureIncomePerSec: 0.6,
  extractorCost: 10,
  harvesterCost: 10,
  startingResources: 20,
  structureBuildSec: 6,
} as const;

/** EXTRA (VS02, D-27): structure values the bible leaves open. */
export const STRUCTURE = {
  extractorHealth: 600,
  harvesterHealth: 600,
  /** a structure starts at this fraction of max health and grows to full over the build time */
  buildStartHealthFrac: 0.25,
  /** hurt box around the well head: half extents on X/Z, height above the floor */
  hurtHalf: 1.15,
  hurtHeight: 2.6,
} as const;

/** EXTRA (VS02, D-28): Weaver, the slow Bloom support/builder (bible section 34). Ground walker. */
export const WEAVER = {
  health: 150,
  armour: 0,
  walkSpeed: 4.0,
  backwardSpeed: 3.4,
  strafeSpeed: 3.8,
  groundAcceleration: 24,
  airAcceleration: 6,
  friction: 12,
  gravity: 18,
  jumpImpulse: 4.8,
  horizontalSpeedCap: 5.0,
  colliderRadius: 0.4,
  standingHeight: 1.3,
  eyeHeight: 1.1,
  stepHeight: 0.35,
  fov: 95,
  maxEnergy: 100,
  energyRegenPerSec: 12,
  energyRegenDelaySec: 0.6,
  /** basic melee: weaker and slower than the Ripper bite */
  meleeDamage: 20,
  meleeCooldownSec: 0.7,
  meleeReach: 1.4,
  meleeSweepRadius: 0.35,
  meleeArcDeg: 80,
  /** local heal pulse (secondary): Bloom players and Bloom structures in radius */
  healPulseCost: 40,
  healPulseCooldownSec: 2,
  healPulseRadius: 5,
  healPulseAmount: 30,
  healPulseStructureAmount: 60,
  /** horizontal distance from the well centre within which a Weaver may build */
  buildReach: 3.0,
  /** hurt volume (vertical capsule, server-side hit tests only) */
  hurtRadius: 0.45,
  hurtBottom: 0.45,
  hurtTop: 0.95,
} as const;

/** EXTRA (VS02, D-29): Commander interaction. */
export const COMMAND = {
  /** horizontal distance from the console stand point within which a Marine may enter */
  consoleReach: 1.8,
  maxCommanders: 1,
  /** waypoint / ping lifetime */
  orderTtlSec: 30,
  /** command / build / order message rate limit per player */
  msgPerSec: 12,
  cameraMinAltitude: 8,
  cameraMaxAltitude: 24,
  cameraMinPitchDeg: 55,
  cameraMaxPitchDeg: 70,
  cameraPanSpeed: 14,
} as const;

export const TICK_HZ = NET.serverSimulationHz;
export const TICK_DT = 1 / TICK_HZ;
export const TICK_MS = 1000 / TICK_HZ;
export const secToTicks = (sec: number): number => Math.round(sec * TICK_HZ);
