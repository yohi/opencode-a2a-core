import { describe, it, expect } from "vitest";
import { computeBackoffMs } from "../../../src/core/helpers/exponential-backoff.js";

describe("computeBackoffMs", () => {
  const opts = { initialMs: 500, multiplier: 2, jitterRatio: 0 };

  it("computes exponentially with zero jitter", () => {
    expect(computeBackoffMs(1, opts)).toBe(500);   // 500 * 2^0
    expect(computeBackoffMs(2, opts)).toBe(1000);  // 500 * 2^1
    expect(computeBackoffMs(3, opts)).toBe(2000);  // 500 * 2^2
  });

  it("adds jitter within ±ratio range", () => {
    const optsWithJitter = { initialMs: 1000, multiplier: 2, jitterRatio: 0.2 };
    const rng = () => 0.5; // deterministic
    // base = 1000 * 2^(n-1); jitter factor = 1 + (2*0.5 - 1) * 0.2 = 1
    expect(computeBackoffMs(1, optsWithJitter, rng)).toBe(1000);
    const rngLow = () => 0;  // factor = 1 - 0.2 = 0.8
    expect(computeBackoffMs(1, optsWithJitter, rngLow)).toBe(800);
    const rngHigh = () => 1; // factor = 1 + 0.2 = 1.2
    expect(computeBackoffMs(1, optsWithJitter, rngHigh)).toBe(1200);
  });

  it("throws on attempt < 1", () => {
    expect(() => computeBackoffMs(0, opts)).toThrow();
  });
});