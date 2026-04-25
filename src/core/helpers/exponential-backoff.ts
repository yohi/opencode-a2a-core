export interface BackoffOptions {
  initialMs: number;
  multiplier: number;
  jitterRatio: number; // 0 = no jitter, 0.2 = ±20%
}

export function computeBackoffMs(
  attempt: number,
  opts: BackoffOptions,
  rng: () => number = Math.random,
): number {
  if (attempt < 1) throw new Error("attempt must be >= 1");
  const base = opts.initialMs * Math.pow(opts.multiplier, attempt - 1);
  const jitter = (2 * rng() - 1) * opts.jitterRatio;
  return Math.round(base * (1 + jitter));
}