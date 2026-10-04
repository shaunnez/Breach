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

  snapshot(): Record<string, number> {
    return Object.fromEntries([...this.counters.entries()].sort());
  }
}

export const silentTelemetry = (): Telemetry => new Telemetry('silent', () => {});
