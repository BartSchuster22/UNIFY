export class FixedWindowRateLimiter {
  readonly #entries = new Map<string, { startedAt: number; count: number }>();
  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Rate limit must be positive');
  }

  consume(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = this.now();
    const current = this.#entries.get(key);
    if (!current || now - current.startedAt >= this.windowMs) {
      this.#entries.set(key, { startedAt: now, count: 1 });
      this.prune(now);
      return { allowed: true, retryAfterSeconds: 0 };
    }
    current.count += 1;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((this.windowMs - (now - current.startedAt)) / 1000),
    );
    return { allowed: current.count <= this.limit, retryAfterSeconds };
  }

  private prune(now: number): void {
    if (this.#entries.size < 10_000) return;
    for (const [key, entry] of this.#entries) {
      if (now - entry.startedAt >= this.windowMs) this.#entries.delete(key);
    }
  }
}
