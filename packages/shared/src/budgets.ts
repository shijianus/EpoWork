/**
 * Hard application budgets designed to stay comfortably within Cloudflare Workers Free limits:
 * - Workers Free: 10 ms active CPU / request, 128 MB isolate RAM, 100k req/day
 * - D1 Free: 5M rows read/day, 100k rows written/day, 500 MB/DB
 * - R2 Free: 10 GB-month storage, 1M Class A ops/mo, 10M Class B ops/mo
 */

export const FREE_TIER_BUDGETS = {
  /** Workers Free 10ms CPU cap: 10k peppered PBKDF2 iters runs in ~2.8ms vs ~26ms at 100k */
  FREE_PBKDF2_ITERATIONS: 10_000,
  PAID_PBKDF2_ITERATIONS: 100_000,

  /** Throttle session `last_seen_at` D1 updates to once every 5 minutes */
  SESSION_TOUCH_INTERVAL_MS: 5 * 60 * 1000,

  /** R2 single upload caps (checked via Content-Length + streaming byte counter) */
  MAX_CHAT_ATTACHMENT_BYTES: 5 * 1024 * 1024, // 5 MB
  MAX_OBJECT_UPLOAD_BYTES: 10 * 1024 * 1024, // 10 MB

  /** Per-user cumulative R2 storage budget (250 MB default on Free tier) */
  MAX_USER_STORAGE_BYTES: 250 * 1024 * 1024,
  MAX_USER_STORAGE_OBJECTS: 2_000,

  /** Bounded D1 query page sizes */
  MAX_LIST_LIMIT: 100,
  DEFAULT_LIST_LIMIT: 30,

  /** Bounded Work Lite agent execution budgets */
  WORK_LITE_DEFAULT_MAX_STEPS: 12,
  WORK_LITE_HARD_MAX_STEPS: 25,
  WORK_LITE_DEFAULT_TOKEN_BUDGET: 100_000,
} as const;
