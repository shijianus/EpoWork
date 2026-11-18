# Deployment & Operations Guide (DEPLOYMENT.md)

## 1. Prerequisites

- **Node.js**: `>= 22.18.0`
- **pnpm**: `>= 10.x`
- **Git**: `>= 2.40`
- **Wrangler**: Installed locally as workspace devDependency (`pnpm exec wrangler`)
- **Cloudflare Account** (only required for remote deployment; local development runs via Vite + Miniflare/Wrangler local bindings without remote cost)

## 2. Dependency Installation

```bash
pnpm install
```

## 3. Local Development

Copy environment template (never commit `.env` or `.dev.vars`):

```bash
cp .env.example .dev.vars
```

Run local typecheck, lint, tests, and dev server:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm dev
```

## 4. D1 & R2 Initialization (Local vs Remote)

### Local (Zero Cloud Cost)

Migrations in `infra/migrations/` are applied locally via Wrangler/D1 local state:

```bash
pnpm db:migrate:local
```

### Remote Cloudflare Provisioning (Requires Explicit User Approval)

> **WARNING**: Creating remote D1, R2, Containers, or deploying Workers requires explicit user approval and valid `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`.

1. Create D1 database: `pnpm exec wrangler d1 create ai-workspace-db`
2. Create R2 bucket: `pnpm exec wrangler r2 bucket create ai-workspace-storage`
3. Update `apps/web/wrangler.jsonc` with returned `database_id`.
4. Apply remote migrations: `pnpm exec wrangler d1 migrations apply ai-workspace-db --remote`

## 5. Secrets Configuration

Set secrets via Wrangler (never in `wrangler.jsonc` or git):

```bash
pnpm exec wrangler secret put SESSION_SECRET
pnpm exec wrangler secret put ENCRYPTION_MASTER_KEY
# Optional platform-level default keys (users can also configure BYOK in Settings):
pnpm exec wrangler secret put OPENAI_API_KEY
pnpm exec wrangler secret put ANTHROPIC_API_KEY
pnpm exec wrangler secret put GEMINI_API_KEY
```

## 6. Deployment & Verification

Dry-run bundle check:

```bash
pnpm build
pnpm --filter @ai-workspace/web exec wrangler deploy --dry-run
```

Actual deployment (only after user approval):

```bash
pnpm --filter @ai-workspace/web exec wrangler deploy
```

## 7. Rollback Procedure

1. List deployments: `pnpm exec wrangler deployments list`
2. Roll back Worker code: `pnpm exec wrangler rollback <DEPLOYMENT_ID>`
3. Never drop user tables to fix migrations; apply forward-fix additive SQL migrations.

## 8. Monitoring & Troubleshooting

- Live Worker tail logs (redacted): `pnpm exec wrangler tail`
- Health endpoint: `GET /api/health` returns `{ status: "ok", version, timestamp, checks }`.
