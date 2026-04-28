export interface BackoffOptions {
  initialMs: number;
  multiplier: number;
  jitterRatio: number; // 0 = no jitter, 0.2 = ±20%
  maxMs?: number;
}

export function computeBackoffMs(
  attempt: number,
  opts: BackoffOptions,
  rng: () => number = Math.random
): number {
  if (attempt < 1) throw new Error('attempt must be >= 1');
  if (opts.initialMs <= 0) throw new Error('initialMs must be > 0');
  if (opts.multiplier < 0) throw new Error('multiplier must be >= 0');
  if (opts.jitterRatio < 0 || opts.jitterRatio > 1) {
    throw new Error('jitterRatio must be between 0 and 1');
  }

  const base = opts.initialMs * Math.pow(opts.multiplier, attempt - 1);
  const jitter = (2 * rng() - 1) * opts.jitterRatio;
  const delay = Math.round(base * (1 + jitter));

  const result = opts.maxMs !== undefined ? Math.min(delay, opts.maxMs) : delay;
  return Math.max(0, result);
}
