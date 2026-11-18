/**
 * Bounded L1 isolate rate limiter (caps memory usage via expired-bucket pruning & maxEntries eviction).
 * For multi-isolate persistence on Cloudflare Workers Free, pair with D1 `RateLimitRepository`.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
    private readonly maxEntries = 2_000,
  ) {}

  private prune(now: number) {
    for (const [k, entry] of this.buckets) {
      if (entry.resetAt <= now) {
        this.buckets.delete(k);
      }
    }
    while (this.buckets.size >= this.maxEntries) {
      const oldestKey = this.buckets.keys().next().value;
      if (oldestKey === undefined) break;
      this.buckets.delete(oldestKey);
    }
  }

  check(key: string, now = Date.now()): { allowed: boolean; remaining: number; resetAt: number } {
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      if (this.buckets.size >= this.maxEntries) {
        this.prune(now);
      }
      const resetAt = now + this.windowMs;
      this.buckets.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: Math.max(0, this.maxRequests - 1), resetAt };
    }

    if (existing.count >= this.maxRequests) {
      return { allowed: false, remaining: 0, resetAt: existing.resetAt };
    }

    existing.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, this.maxRequests - existing.count),
      resetAt: existing.resetAt,
    };
  }

  get size(): number {
    return this.buckets.size;
  }
}
