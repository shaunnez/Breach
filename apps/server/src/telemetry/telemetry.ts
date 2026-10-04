export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

export interface TelemetryFields {
  matchId?: string;
  roomId?: string;
  playerId?: string;
  faction?: string;
  class?: string;
  serverTick?: number;
  rttMs?: number;
  reconciliationErrorM?: number;
  movementCorrectionReason?: string;
  shotAccepted?: boolean;
  shotRejectReason?: string;
  biteAccepted?: boolean;
  surfaceAttachState?: string;
  surfaceDetachReason?: string;
  serverTickDurationMs?: number;
  [k: string]: unknown;
}

/** Structured JSON logging + in-memory counters that answer the bible's tuning questions. */
export class Telemetry {
  level: LogLevel;
  sink: (line: string) => void;
  counters = new Map<string, number>();
  /** ring of recent events, exposed on /debug/telemetry */
  recent: Record<string, unknown>[] = [];

  constructor(level: LogLevel = 'info', sink: (line: string) => void = (l) => process.stdout.write(l + '\n')) {
    this.level = level;
    this.sink = sink;
  }

  inc(key: string, by = 1): void {
    this.counters.set(key, (this.counters.get(key) ?? 0) + by);
  }

  log(level: Exclude<LogLevel, 'silent'>, event: string, fields: TelemetryFields = {}): void {
    const rec = { t: new Date().toISOString(), level, event, ...fields };
    this.recent.push(rec);
    if (this.recent.length > 200) this.recent.shift();
    if (ORDER[level] >= ORDER[this.level]) this.sink(JSON.stringify(rec));
  }

  info(event: string, fields?: TelemetryFields): void {
    this.log('info', event, fields);
  }
  warn(event: string, fields?: TelemetryFields): void {
    this.log('warn', event, fields);
  }
  debug(event: string, fields?: TelemetryFields): void {
    this.log('debug', event, fields);
  }

  /** Derived tuning metrics from the bible's section 28 aggregation list. */
  summary(): Record<string, number | string> {
    const c = (k: string) => this.counters.get(k) ?? 0;
    const surf = ['ground', 'wall', 'ceiling', 'air'].map((s) => c(`ripper.ticks.${s}`));
    const surfTotal = surf.reduce((a, b) => a + b, 0) || 1;
    const marineDeaths = c('death.marine');
    const ripperDeaths = c('death.ripper');
    return {
      marineKillsPerRipperKill: ripperDeaths ? +(c('death.ripper') ? (ripperDeaths / Math.max(1, marineDeaths)).toFixed(2) : 0) : 0,
      avgEncounterTtkMs: c('ttk.count') ? Math.round(c('ttk.sumMs') / c('ttk.count')) : 0,
      rifleAccuracy: c('rifle.shots') ? +(c('rifle.hits') / c('rifle.shots')).toFixed(3) : 0,
      bitesPerKill: c('kill.bite') ? +(c('bite.attempts') / c('kill.bite')).toFixed(2) : 0,
      ripperTimeGround: +(surf[0] / surfTotal).toFixed(3),
      ripperTimeWall: +(surf[1] / surfTotal).toFixed(3),
      ripperTimeCeiling: +(surf[2] / surfTotal).toFixed(3),
      ripperTimeAir: +(surf[3] / surfTotal).toFixed(3),
      leaps: c('ripper.leaps'),
      reconciliationReports: c('client.reconciliations'),
      reconciliationsPerMinute: c('client.minutes') ? +(c('client.reconciliations') / c('client.minutes')).toFixed(2) : 0,
    };
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries([...this.counters.entries()].sort());
  }
}

export const silentTelemetry = (): Telemetry => new Telemetry('silent', () => {});
