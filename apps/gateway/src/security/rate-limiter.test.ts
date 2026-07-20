import { describe, expect, it } from 'vitest';
import { FixedWindowRateLimiter } from './rate-limiter.js';

describe('FixedWindowRateLimiter', () => {
  it('rejects excess requests and recovers at the next window', () => {
    let now = 1_000;
    const limiter = new FixedWindowRateLimiter(2, 1_000, () => now);
    expect(limiter.consume('ip').allowed).toBe(true);
    expect(limiter.consume('ip').allowed).toBe(true);
    expect(limiter.consume('ip')).toEqual({ allowed: false, retryAfterSeconds: 1 });
    now += 1_000;
    expect(limiter.consume('ip').allowed).toBe(true);
  });

  it('isolates caller keys', () => {
    const limiter = new FixedWindowRateLimiter(1, 60_000);
    expect(limiter.consume('first').allowed).toBe(true);
    expect(limiter.consume('first').allowed).toBe(false);
    expect(limiter.consume('second').allowed).toBe(true);
  });
});
