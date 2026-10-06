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

// VS02 (bible section 32)
export const ECONOMY = {
  structureIncomePerSec: 0.6,
  extractorCost: 10,
  harvesterCost: 10,
  startingResources: 20,
  structureBuildSec: 6,
} as const;
