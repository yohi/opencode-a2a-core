export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MASK_KEYS = new Set(["apikey", "token", "password", "authorization", "secret", "accesstoken"]);

export class ConsoleLogger implements Logger {
  private readonly threshold: number;

  constructor(opts: { level?: LogLevel } = {}) {
    this.threshold = LEVELS[opts.level ?? "info"];
  }

  debug(msg: string, ctx?: Record<string, unknown>): void {
    this.emit("debug", msg, ctx);
  }

  info(msg: string, ctx?: Record<string, unknown>): void {
    this.emit("info", msg, ctx);
  }

  warn(msg: string, ctx?: Record<string, unknown>): void {
    this.emit("warn", msg, ctx);
  }

  error(msg: string, ctx?: Record<string, unknown>): void {
    this.emit("error", msg, ctx);
  }

  private emit(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
    if (LEVELS[level] < this.threshold) return;
    const entry = {
      ...this.mask(ctx ?? {}),
      timestamp: new Date().toISOString(),
      level,
      msg,
    };
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  }

  private mask(ctx: Record<string, unknown>): Record<string, unknown> {
    const recurse = (val: unknown): unknown => {
      if (typeof val !== "object" || val === null) return val;
      if (Array.isArray(val)) return val.map(recurse);
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        out[k] = MASK_KEYS.has(k.toLowerCase()) ? "***" : recurse(v);
      }
      return out;
    };
    return recurse(ctx) as Record<string, unknown>;
  }
}

export function createLogger(opts?: { level?: LogLevel }): Logger {
  return new ConsoleLogger(opts);
}

export type LogContext = Record<string, unknown>;
