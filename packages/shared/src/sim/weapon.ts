import { BITE, RIFLE, RIFLE_EXTRA, TICK_DT, WEAVER, secToTicks } from '../balance';
import { PlayerClass } from '../enums';
import { clamp, lerp, hash01, DEG } from '../math';
import type { InputFrame } from '../protocol';
import { marineSpeedFactor } from './marine';
import type { PlayerSim, StepResult } from './state';

export const FIRE_PERIOD_TICKS = Math.round((60 * 60) / RIFLE.rpm); // 600 RPM -> 6 ticks
const RELOAD_TICKS = secToTicks(RIFLE.reloadSec);
const BITE_TICKS = secToTicks(BITE.cooldownSec);
const BLOOM_DELAY_TICKS = Math.round(RIFLE_EXTRA.bloomRecoveryDelaySec * 60);

const MELEE_TICKS = secToTicks(WEAVER.meleeCooldownSec);
const PULSE_TICKS = secToTicks(WEAVER.healPulseCooldownSec);

export const RELOAD_DURATION_TICKS = RELOAD_TICKS;
export const WEAVER_MELEE_COOLDOWN_TICKS = MELEE_TICKS;
export const HEAL_PULSE_COOLDOWN_TICKS = PULSE_TICKS;

/** Weaver: weak melee (primary) and a held heal pulse (secondary) paid from its energy pool. */
function stepWeaverAbilities(s: PlayerSim, input: InputFrame, out: StepResult): void {
  if (s.biteCdTicks > 0) s.biteCdTicks--;
  if (s.fireCdTicks > 0) s.fireCdTicks--;
  s.energyIdle += TICK_DT;
  if (s.energyIdle >= WEAVER.energyRegenDelaySec) s.energy = Math.min(WEAVER.maxEnergy, s.energy + WEAVER.energyRegenPerSec * TICK_DT);
  if (input.primary) {
    if (s.biteCdTicks === 0) {
      out.bit = true;
      s.biteCdTicks = MELEE_TICKS;
    } else out.fireRejected = 'cooldown';
  }
  if (input.secondary && s.fireCdTicks === 0 && s.energy >= WEAVER.healPulseCost) {
    out.healPulse = true;
    s.energy -= WEAVER.healPulseCost;
    s.energyIdle = 0;
    s.fireCdTicks = PULSE_TICKS;
  }
}
export const BITE_COOLDOWN_TICKS = BITE_TICKS;

function startReload(s: PlayerSim, out: StepResult): void {
  s.reloadTicks = RELOAD_TICKS;
  out.reloadStarted = true;
}

/** Cadence, ammo, reload, spread: deterministic from the input stream, shared by prediction and server. */
export function stepWeapon(s: PlayerSim, input: InputFrame, out: StepResult): void {
  if (s.cls === PlayerClass.Weaver) {
    stepWeaverAbilities(s, input, out);
    return;
  }
  if (s.cls === PlayerClass.Ripper) {
    if (s.biteCdTicks > 0) s.biteCdTicks--;
    if (input.primary) {
      if (s.biteCdTicks === 0) {
        out.bit = true;
        s.biteCdTicks = BITE_TICKS;
      } else out.fireRejected = 'cooldown';
    }
    return;
  }

  if (s.fireCdTicks > 0) s.fireCdTicks--;
  if (s.reloadTicks > 0) {
    s.reloadTicks--;
    if (s.reloadTicks === 0) {
      const take = Math.min(RIFLE.magazine - s.ammo, s.reserve);
      s.ammo += take;
      s.reserve -= take;
      out.reloadFinished = true;
    }
  }
  s.bloomIdleTicks = Math.min(s.bloomIdleTicks + 1, 1000);
  if (s.bloomIdleTicks > BLOOM_DELAY_TICKS) s.bloom = Math.max(0, s.bloom - RIFLE_EXTRA.bloomRecoveryDegPerSec * TICK_DT);

  const reloadEdge = input.reload && !s.prevReload;
  s.prevReload = input.reload ? 1 : 0;
  if (reloadEdge && s.reloadTicks === 0 && s.ammo < RIFLE.magazine && s.reserve > 0) startReload(s, out);

  if (!input.primary) return;
  if (s.reloadTicks > 0) {
    out.fireRejected = 'reloading';
    return;
  }
  if (s.ammo <= 0) {
    out.fireRejected = 'empty';
    if (s.reserve > 0) startReload(s, out);
    return;
  }
  if (s.fireCdTicks > 0) {
    out.fireRejected = 'cooldown';
    return;
  }
  const base = lerp(RIFLE.baseSpreadDeg, RIFLE.movingSpreadDeg, marineSpeedFactor(s));
  out.spreadDeg = Math.min(RIFLE.bloomCapDeg, base + s.bloom);
  out.shotIndex = s.shotCount;
  out.fired = true;
  s.ammo--;
  s.shotCount++;
  s.fireCdTicks = FIRE_PERIOD_TICKS;
  s.bloom = Math.min(RIFLE.bloomCapDeg, s.bloom + RIFLE_EXTRA.bloomPerShotDeg);
  s.bloomIdleTicks = 0;
}

/** Deterministic spread offset (radians) in the plane perpendicular to the aim direction. */
export function spreadOffset(seed: number, shotIndex: number, spreadDeg: number): { a: number; b: number } {
  const u1 = hash01(seed, shotIndex, 1);
  const u2 = hash01(seed, shotIndex, 2);
  const ang = u1 * Math.PI * 2;
  const rad = Math.sqrt(u2) * spreadDeg * DEG;
  return { a: Math.cos(ang) * rad, b: Math.sin(ang) * rad };
}

export const clampAmmo = (v: number): number => clamp(v, 0, RIFLE.magazine);
