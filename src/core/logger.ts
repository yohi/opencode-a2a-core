export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};
const MASK_KEYS = new Set([
  'apikey',
  'api_key',
  'token',
  'access_token',
  'refresh_token',
  'password',
  'authorization',
  'secret',
  'client_secret',
  'accesstoken',
]);

export class ConsoleLogger implements Logger {
  private readonly threshold: number;

  constructor(opts: { level?: LogLevel } = {}) {
    this.threshold = LEVELS[opts.level ?? 'info'];
  }

  debug(msg: string, ctx?: Record<string, unknown>): void {
    this.emit('debug', msg, ctx);
  }

  info(msg: string, ctx?: Record<string, unknown>): void {
    this.emit('info', msg, ctx);
  }

  warn(msg: string, ctx?: Record<string, unknown>): void {
    this.emit('warn', msg, ctx);
  }

  error(msg: string, ctx?: Record<string, unknown>): void {
    this.emit('error', msg, ctx);
  }

  private emit(
    level: LogLevel,
    msg: string,
    ctx?: Record<string, unknown>
  ): void {
    if (LEVELS[level] < this.threshold) return;
    try {
      const entry = {
        ...this.mask(ctx ?? {}),
        timestamp: new Date().toISOString(),
        level,
        msg,
      };
      const json = JSON.stringify(entry, (_k, v) =>
        typeof v === 'bigint' ? v.toString() : v
      );
      process.stdout.write(`${json}\n`);
    } catch (err) {
      const fallback = JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        msg: 'Failed to serialize log entry',
        error: err instanceof Error ? err.message : String(err),
      });
      process.stdout.write(`${fallback}\n`);
    }
  }

  private mask(ctx: Record<string, unknown>): Record<string, unknown> {
    const seen = new WeakSet<object>();
    const recurse = (val: unknown): unknown => {
      if (val instanceof Error) {
        return { message: val.message, name: val.name, stack: val.stack };
      }
      if (typeof val !== 'object' || val === null) return val;
      if (seen.has(val as object)) return '[Circular]';
      seen.add(val as object);

      if (Array.isArray(val)) return val.map(recurse);
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        out[k] = MASK_KEYS.has(k.toLowerCase()) ? '***' : recurse(v);
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
