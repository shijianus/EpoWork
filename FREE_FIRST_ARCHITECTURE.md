# Free-First Architecture & Capability Matrix (`FREE_FIRST_ARCHITECTURE.md`)

## 1. Core Principle

Maximize personal usability on **Cloudflare Workers Free ($0/month)** without provisioning paid Cloudflare infrastructure unless explicitly approved by the user. The only expected variable cost is the user's own voluntary usage of external AI model APIs (OpenAI, Anthropic, Google Gemini) via encrypted BYOK keys.

---

## 2. Cloudflare Free Tier Hard Limits vs. Paid Features (Verified)

| Primitive                                         | Workers Free Limit                                                           | Workers Paid ($5/mo+)     | Platform Policy                                                 |
| :------------------------------------------------ | :--------------------------------------------------------------------------- | :------------------------ | :-------------------------------------------------------------- |
| **Worker Requests**                               | 100,000 req / day                                                            | 10M included / mo         | Supported on Free                                               |
| **Worker CPU Time**                               | **10 ms active CPU / request**                                               | 30s default (up to 5 min) | Hard design constraint for Auth, JSON, SSE                      |
| **Worker Memory**                                 | 128 MB / isolate                                                             | 128 MB / isolate          | Streaming byte caps required on uploads                         |
| **Worker Subrequests**                            | 50 / request                                                                 | 10,000 / request          | Native model calls = 1 subrequest (+ tool loop via DO)          |
| **D1 Storage**                                    | 5 GB total (500 MB / DB)                                                     | 5 GB included             | Hard pagination + archive limits                                |
| **D1 Reads / Writes**                             | **5M rows read / day, 100k rows written / day**                              | 25B read / 50M write / mo | Throttle session `touch()`, index all queries                   |
| **R2 Standard Storage**                           | **10 GB / mo**, 1M Class A, 10M Class B, Free egress                         | $0.015/GB-mo              | Per-user soft/hard quota (e.g. 500 MB) + orphan cleanup         |
| **Durable Objects (SQLite)**                      | **Available on Free**: 5 GB storage, 100k req/day, 13k GB-s/day, 100 classes | Higher volume             | Use **SQLite-backed DOs** (`new_sqlite_classes`) for AgentRunDO |
| **Durable Objects (KV backend)**                  | **Not on Free**                                                              | Available                 | Forbidden; use SQLite-backed DOs only                           |
| **Cloudflare Containers / `@cloudflare/sandbox`** | **Unavailable (Paid plan required)**                                         | Paid                      | **Disabled by default** (`ENABLE_PAID_SANDBOX=false`)           |
| **Dynamic Workers**                               | **Unavailable (Paid plan required)**                                         | Paid ($5/mo + usage)      | **Disabled by default**                                         |

---

## 3. Free / Paid Capability Matrix

| Feature / Module                    | Free Tier Mode (`WORKERS_PLAN=free`)                                                                                                                                                                    | Paid / VPS Mode (`ENABLE_PAID_SANDBOX=true`)                                                                          | Notes                                              |
| :---------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------- |
| **Auth, Sessions, Encrypted BYOK**  | **Full** (10ms-safe peppered PBKDF2 + D1 rate limits)                                                                                                                                                   | **Full** (higher PBKDF2 iters optional)                                                                               | Never exceeds 10ms CPU                             |
| **Chat (P2)**                       | **Full** (OpenAI, Anthropic, Gemini native SSE streaming, Markdown/KaTeX, R2 attachments, tool cards)                                                                                                   | **Full**                                                                                                              | Pure Worker streaming (`fetch` -> SSE passthrough) |
| **Work Lite (P3 Free)**             | **Full**: SQLite-backed `AgentRunDO` + `PiHarness` / Native API loop + DO-SQLite virtual workspace (`read_file`, `write_file`, `edit_file`, `list_files`, `grep_files`) + Approval + Event `seq` resume | **Full**                                                                                                              | **NOT a Linux shell**; no `bash`/`git`/`npm`       |
| **Full Sandbox Work (P4 Paid/VPS)** | **Disabled** (returns `UnsupportedCapabilityError`)                                                                                                                                                     | **Full**: `@cloudflare/sandbox` Containers or `VpsSandboxProvider` (Linux shell, `git`, `pnpm`, builds, live preview) | Strictly gated behind explicit approval & flag     |
| **Projects (P5)**                   | Metadata + R2-backed virtual file tree & Monaco Editor (no shell/dev preview without Sandbox)                                                                                                           | Full Git clone/diff/commit, xterm.js shell, live dev server preview                                                   | Capability-negotiated in UI                        |
| **Studio (P7)**                     | **Full** (BYOK OpenAI/Google image API -> R2 persistence)                                                                                                                                               | **Full**                                                                                                              | Subject to per-user R2 & quota caps                |
| **Plugins & MCP (P8)**              | **Full** (Remote HTTP/SSE MCP Client + SSRF guard + `SKILL.md` loader)                                                                                                                                  | **Full** (+ local stdio MCP in Sandbox)                                                                               | Least-privilege manifest enforcement               |

---

## 4. Application Hard Budgets (Free-First Protection)

Implemented in `packages/shared/src/budgets.ts`:

- **CPU Budget**: Password hashing on Free tier uses server-peppered PBKDF2-SHA256 at `10_000` iterations (`~2.8 ms` measured vs `10 ms` limit) instead of unpeppered `100_000` iterations (`~24-29 ms`, which triggers Error 1102 on Free tier).
- **D1 Write Budget**:
  - Session `last_seen_at` updates throttled to at most once every **5 minutes** (`300,000 ms`) per session.
  - Persistent auth rate limits stored in D1 `rate_limits` with opportunistic expiry pruning.
  - All list queries require bounded `LIMIT <= 100`.
- **R2 Upload & Capacity Budget**:
  - Pre-read `Content-Length` rejection + streaming byte counter (prevents 128 MB isolate OOM!).
  - Single chat attachment max: **5 MB**; general object max: **10 MB**.
  - Per-user cumulative R2 storage cap: **250 MB** default (`MAX_USER_STORAGE_BYTES`), tracked in D1 `user_storage_usage` / `artifacts` with atomic rollback cleanup on D1 failure.
- **Agent Execution Budget**:
  - Default max steps per Work Lite run: **12** (hard cap **25**); per-run token budget cap enforced by `ExecutionPolicy`.
