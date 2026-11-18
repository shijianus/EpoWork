# Security Architecture & Policy (SECURITY.md)

## 1. Credential & Secret Management

- **Zero Client Secrets**: Model API keys, Cloudflare tokens, and session signing keys never ship to the browser bundle or API responses.
- **Encrypted BYOK Storage**: User-provided provider API keys are encrypted server-side using WebCrypto AES-256-GCM with a server-managed `ENCRYPTION_MASTER_KEY` (per-record random 96-bit IV + AAD bound to `userId` and `providerId`). Database stores ciphertext only; UI displays masked hints (e.g. `sk-...a1b2`).
- **Session Token Hashing**: Raw session tokens live only in `HttpOnly; Secure; SameSite=Lax` cookies; D1 `sessions` stores only the SHA-256 digest.
- **Sandbox Egress Isolation**: API keys are never written to Sandbox disk or long-lived container env files; Worker/Egress injects credentials only on approved outbound requests.

## 2. Authentication, Authorization & Tenant Isolation

- **Password Hashing (Free-First 10ms CPU Safe)**: Self-describing format `v2:pbkdf2_sha256:<iterations>:<peppered>:<hash>`. On Workers Free (`WORKERS_PLAN=free`), passwords are HMAC-SHA256 pre-peppered with a server-side `PASSWORD_PEPPER` secret (never stored in D1) and hashed with PBKDF2-SHA256 at `10,000` iterations + 16-byte random salt (`~2.8 ms` CPU, safe under the 10 ms Workers Free limit). Legacy `100,000`-iteration hashes remain verifiable. Unknown-email logins execute a dummy PBKDF2 check to prevent timing-based account enumeration.
- **Persistent Rate Limiting**: Auth endpoints enforce both bounded in-memory L1 limiting and D1-backed persistent rate limiting (`rate_limits` table) so limits survive isolate evictions and cannot leak isolate memory.
- **CSRF & CORS Protection**: State-changing authenticated endpoints require `X-CSRF-Token` matching the session's `csrf_token` alongside `SameSite=Lax`. Unauthenticated auth routes (`/api/auth/login`, `/api/auth/register`) validate `Origin` when present. `http://localhost:*` CORS origins are strictly disabled when `APP_ENV=production`.
- **Session Write Throttling**: `last_seen_at` updates are throttled to once per 5 minutes to protect D1 Free write quotas (`100k/day`).
- **Master Key Fail-Closed Policy**: `ENCRYPTION_MASTER_KEY` never silently falls back to an all-zero dev key outside explicit local/test environments (`APP_ENV === "test"` or explicit `ALLOW_INSECURE_DEV_KEY=1` on localhost).
- **Strict Resource Ownership**: Every D1 query, R2 key (`users/{userId}/...`), Durable Object routing check, and Preview token validates `resource.userId === auth.userId` (or explicit organization membership). Cross-tenant IDs return `403`/`404` consistently.

## 3. Sandbox & Execution Security

- **Path Traversal Prevention**: All file operations canonicalize relative paths and reject `..`, null bytes, and escapes outside `/workspace`.
- **Execution Policy & Approvals**:
  - `read`: auto-allowed in bound workspace.
  - `write`: allowed within workspace; outside-workspace denied.
  - `exec` (safe build/test) vs `exec_privileged` / `git_push` / `deploy` / `external_api_write`: gated by `ApprovalManager` with idempotency keys so restarts never replay side effects.
- **No Host/Docker Socket Exposure**: Neither Cloudflare Sandbox nor optional P10 VPS containers may mount Docker sockets or host credentials.

## 4. Network, SSRF & Upload Protections

- **SSRF Guard**: Outbound URLs (Git import, MCP server registration, web fetch, preview proxy) parse IP/hostname and block `localhost`, `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`, `fc00::/7`, `fe80::/10`, and non-`http(s):` schemes.
- **Preview Isolation**: Live previews use isolated origins/subdomains or signed single-use tokens without main app cookies, and explicitly report `expired` once the sandbox stops.
- **File Uploads**: Enforce max byte limits, MIME allowlists, safe filename sanitization, and `Content-Disposition: attachment` / `X-Content-Type-Options: nosniff` on untrusted downloads.

## 5. Prompt Injection & Plugin Isolation

- External web pages, repository files, MCP tool outputs, and `SKILL.md` contents are marked as untrusted data (`role: tool` / delimited user context) and never treated as system policy.
- Plugins declare explicit least-privilege capabilities in their Zod-validated Manifest; arbitrary third-party JS never runs in the main app's privileged context.

## 6. Log Redaction & Audit Trail

- `packages/shared/src/logger.ts` automatically scrubs `Authorization`, `Cookie`, `Set-Cookie`, `x-api-key`, `sk-*`, `AIza*`, and bearer tokens before emitting structured logs.
- Security-sensitive actions (login, failed login, key creation/deletion, approval decisions, plugin install/enable/disable, denied access) write to `audit_logs`.
