# AGENTS.md — Coding Agent Session & Continuity Protocol

## 1. Mandatory Session Startup Checklist

Before editing code in any new or resumed session:

1. Read `AGENTS.md` (this file).
2. Read `CHECKLIST.log` (single authoritative source of truth; `CHECKIST.log` is only a compatibility pointer).
3. Read the latest entries in `IMPLEMENTATION_LOG.md` and `TEST_REPORT.md`.
4. Run `git status` and inspect recent changes.
5. Identify the highest-priority `IN_PROGRESS` or unblocked `TODO` task in `CHECKLIST.log`.
6. Never re-implement tasks already marked `VERIFIED` unless fixing a newly discovered regression.

## 2. Repository Structure (Progressive Monorepo)

```
apps/
  desktop/            # Electron + React + Vite Local-first Desktop app (Windows EXE)
  web/                # Optional Cloudflare Web: React + Vite SPA + Hono Worker (src/worker)
packages/
  shared/             # Logger (redaction), URL/path validators, budgets, IDs
  contracts/          # Zod schemas, ApiError, Run/Event/Model/Plugin contracts
  database/           # D1/SQLite repository helpers, R2 storage
  auth/               # PBKDF2, session hashing, AES-GCM key crypto, rate limiter
  ui/                 # Shared React brand design system components
  model-registry/     # Verified model IDs & capability matrix
  providers/          # Native OpenAI / Anthropic / Google Gemini adapters
  chat-core/          # Runtime-agnostic Chat service, streaming, usage tracking
  agent-core/         # Runtime-agnostic AgentAdapter, ExecutionPolicy, ApprovalManager, NativeAgentLoop
  local-executor/     # Isolated Node process executor (bounded FS, Git, Shell)
  desktop-storage/    # Local node:sqlite adapter, Windows DPAPI/safeStorage vault, local blob store
  agent-native/       # (Future CF Web) PiHarness DO integration
  sandbox/            # (Paid CF / VPS) SandboxProvider + CloudflareSandboxProvider
```

## 3. Standard Commands

- `pnpm install` — Install all workspace dependencies
- `pnpm typecheck` — Run TypeScript strict typecheck across all packages/apps
- `pnpm lint` — Run ESLint across repository
- `pnpm format:check` — Check Prettier formatting
- `pnpm test` — Run Vitest unit & integration test suites
- `pnpm test:e2e` — Run Playwright Desktop Electron E2E tests
- `pnpm build` — Build web and desktop bundles
- `pnpm build:desktop` — Build Electron renderer + main/preload/executor bundles
- `pnpm package:win` — Package Windows NSIS `.exe` installer via electron-builder
- `pnpm dev` — Start local Vite + Cloudflare Worker dev environment
- `pnpm dev:desktop` — Start Desktop Vite renderer dev server

## 4. Strict Engineering Rules & Prohibitions

- **Truthful Verification**: Only mark a task `VERIFIED` in `CHECKLIST.log` when code exists, dependencies are installed, typecheck passes, and real tests/checks were executed and observed passing after the final edit.
- **No Fake Implementations**: Never fake chat responses, fake terminal output, static HTML previews, clickable no-op buttons, or claim Mock tests prove real external APIs work.
- **Compliance & Approval Gates**:
  - Never deploy to production, create paid Cloudflare resources, use real API keys, or perform irreversible external actions without explicit user approval.
  - Never extract/forward personal CLI subscription OAuth tokens.
  - Never expose API keys to frontend bundles or logs.
- **End-of-Turn / Interruption Discipline**: Before stopping, always update `CHECKLIST.log`, append to `IMPLEMENTATION_LOG.md`, and update `TEST_REPORT.md` with exact commands and observed outputs.
