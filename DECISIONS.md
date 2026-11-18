# Architecture Decision Records (DECISIONS.md)

## ADR-001: Frontend Stack — React 19 + Vite + Tailwind CSS + React Router (No Next.js)

- **Background**: Need a fast, modular, browser-first SPA deployable seamlessly on Cloudflare Workers with rich IDE/chat surfaces (`assistant-ui`, Monaco Editor, xterm.js).
- **Candidates**: (1) Next.js on Cloudflare OpenNext, (2) React + Vite + React Router + `@cloudflare/vite-plugin`.
- **Decision**: React + Vite + Tailwind CSS + React Router + TanStack Query, bundled alongside Hono Worker via `@cloudflare/vite-plugin` and Workers Static Assets.
- **Rationale**: Official Cloudflare Vite React+Hono template runs natively on `workerd` without SSR adapter friction, yields faster builds, clean SPA routing, and avoids heavy framework forks.
- **Risks**: SEO/SSR is minimal (acceptable because this is an authenticated workspace app).
- **Replacement Cost**: Low-Medium (API is decoupled behind `/api/*`).

## ADR-002: Backend Runtime & Storage — Cloudflare Workers + Hono + D1 + R2 + Durable Objects

- **Background**: Need edge-native API, relational metadata, large object/artifact storage, and stateful long-running agent orchestration surviving browser disconnects.
- **Candidates**: (1) Node/Express + Postgres on VPS, (2) Cloudflare Workers + Hono + D1 + R2 + Durable Objects.
- **Decision**: Cloudflare Workers (`hono@4.x` + `zod`) + D1 + R2 + Durable Objects (`agents@0.33.x`).
- **Rationale**: Zero-ops scaling, SQLite-backed DOs for low-latency event streams & crash recovery, native R2 object storage, and local Miniflare/Wrangler parity.
- **Risks**: Worker CPU/memory limits for heavy builds (mitigated by offloading shell/builds to Cloudflare Sandbox Containers).
- **Replacement Cost**: Medium (DB & Storage wrapped behind `packages/database` repository interfaces).

## ADR-003: Model Integration — Native Provider SDKs & Capability Registry

- **Background**: Must directly support OpenAI, Anthropic, and Google Gemini without forcing third-party OpenAI-compatible proxies or fabricating model IDs.
- **Candidates**: (1) Single OpenAI-compatible proxy layer, (2) Vercel AI SDK (`ai@7.x`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`) + official provider SDK fallback.
- **Decision**: Option 2 with an explicit `CapabilityRegistry` verified against official Nov 2026 provider docs.
- **Rationale**: Preserves provider-native reasoning controls, multimodal parts, tool calling, and structured outputs while keeping a clean adapter interface.
- **Risks**: Rapid model deprecations (mitigated by dynamic `/models` discovery support in Provider Registry).
- **Replacement Cost**: Low (isolated inside `packages/providers` and `packages/model-registry`).

## ADR-004: Autonomous Agent Core & Pi Durable Integration

- **Background**: Platform must not couple business logic to any single agent SDK's internal session format.
- **Candidates**: (1) Direct hardcoding to Codex or Claude SDK, (2) Platform-owned `AgentAdapter` + unified `AgentEvent` protocol with `PiHarness` (`agents/harness/pi` + `@earendil-works/pi-durable`) & Native API loop.
- **Decision**: Option 2 — unified `AgentAdapter` with capability negotiation (`UnsupportedCapability`) and `seq`-ordered events stored in DO SQLite + archived to D1/R2.
- **Rationale**: Supports Native API-key execution from day one, survives browser close/DO eviction, and cleanly accommodates Codex/Claude/Gemini adapters in P6.
- **Risks**: Multi-harness event normalization complexity (mitigated by preserving `providerRaw`).
- **Replacement Cost**: Low (adapters are swappable plugins in `HarnessRegistry`).

## ADR-005: Execution Environments — Cloudflare Computer vs. Cloudflare Sandbox

- **Background**: Need both lightweight persistent agent scratchpads and full Linux environments for git, package install, builds, and live dev servers.
- **Candidates**: (1) Single VPS for everything, (2) `@cloudflare/computer` for DO-SQLite files + `@cloudflare/sandbox` (Containers) behind `SandboxProvider`, with R2/Git as durable source of truth.
- **Decision**: Option 2.
- **Rationale**: Keeps simple agent file edits fast and cheap while giving Work & Projects genuine POSIX Linux execution, isolated from host secrets via Worker egress.
- **Risks**: Container snapshots are ephemeral/bounded; mitigated by explicit R2 + Git persistence in `packages/sandbox`.
- **Replacement Cost**: Low (`SandboxProvider` interface allows swapping to `VpsSandboxProvider` in P10).

## ADR-006: Compliance & Credential Policy for Multi-Harness (Codex, Claude, Gemini)

- **Background**: Codex CLI, Claude Code, and Gemini CLI support local developer subscription logins as well as API keys.
- **Candidates**: (1) Forwarding user subscription OAuth tokens, (2) API-key-only cloud execution via Worker Egress injection + official APIs (`OpenAI Agents API`, `Claude Agent SDK`, `Gemini ACP` with `GEMINI_API_KEY`).
- **Decision**: Strict Option 2. Subscription OAuth token extraction/forwarding is explicitly prohibited.
- **Rationale**: Complies with provider Terms of Service and prevents credential leakage into untrusted sandboxes.
- **Risks**: Requires users/operators to supply valid API keys.
- **Replacement Cost**: N/A (policy mandate).

## ADR-007: Monorepo Package Strategy

- **Background**: Target architecture defines ~17 packages, but creating empty placeholder packages upfront slows iteration and adds noise.
- **Candidates**: (1) Scaffold all 17 empty packages on day one, (2) Progressive package creation by phase (`shared`, `contracts` in P0; `database`, `auth` in P1; etc.).
- **Decision**: Progressive pnpm workspace creation with strict acyclic dependency layering.
- **Rationale**: Every package in the repo contains real, tested code.
- **Replacement Cost**: Low.

## ADR-008: Free-First Cloudflare Deployment & Work Lite vs. Paid Sandbox Separation

- **Background**: Independent audit verified that Cloudflare Workers Free imposes a strict **10 ms CPU/request** cap, **100k D1 writes/day**, **10 GB R2/mo**, and **SQLite-backed Durable Objects** (`new_sqlite_classes`) on Free, whereas **Cloudflare Containers / `@cloudflare/sandbox`** and **Dynamic Workers** require **Workers Paid ($5/mo+)**. Additionally, local PBKDF2 benchmarks measured 100k iterations at ~24–29 ms CPU, which would breach the 10 ms Free CPU cap.
- **Candidates**:
  1. Require Workers Paid + Containers from day one.
  2. Enforce a Free-first architecture: Workers Free + D1 + R2 + SQLite-backed DOs, with server-peppered PBKDF2 (`10_000` iters, ~2.8 ms CPU) on Free, throttled D1 writes, streaming upload caps, and explicit separation between **Work Lite** (DO-SQLite virtual workspace, no shell) and **Full Sandbox Work** (Paid Containers / P10 VPS, disabled by default).
- **Decision**: Option 2.
- **Rationale**: Allows full personal usage of Auth, Settings, Native Multi-Model Chat, Work Lite (PiHarness + virtual files + approvals), Studio, and Remote MCP on $0/month Cloudflare infrastructure (paying only voluntary model API usage), while preserving clean `AgentAdapter` and `SandboxProvider` interfaces for future Paid/VPS upgrades without lying about capabilities.
- **Risks**: Work Lite cannot execute arbitrary Linux shell commands (`bash`, `git`, `npm`). Mitigated by explicit Capability Negotiation returning `UnsupportedCapabilityError` when Sandbox is disabled.
- **Replacement Cost**: Low (config flag `WORKERS_PLAN=paid` / `ENABLE_PAID_SANDBOX=true` + implementing `CloudflareSandboxProvider` / `VpsSandboxProvider` behind existing interfaces).

## ADR-009: Strategic Shift to Local-First Desktop (Windows EXE) + Optional Cloudflare Web

- **Background**: Requiring Cloudflare Paid Containers for real local filesystem, Git, and build shell workflows creates unnecessary infrastructure cost for personal desktop development. Meanwhile, core business logic (`contracts`, `model-registry`, `providers`, `chat-core`, `ui`) was already abstracted away from Cloudflare-proprietary APIs.
- **Candidates**:
  1. Continue prioritizing Cloudflare Pi Durable / Work Lite as the next milestone.
  2. Pivot primary delivery to **Local-first Electron Desktop (`apps/desktop`)** delivering a real Windows NSIS `.exe` while preserving `apps/web` as an optional Cloudflare Web surface.
- **Decision**: Option 2 — keep `apps/web` intact (no deletion, no forced paid deployment), decouple `packages/agent-core`, `packages/local-executor`, and `packages/desktop-storage` (`node:sqlite` + Electron `safeStorage` DPAPI), and run all local project FS/Git/Shell execution inside a separate Node child process (`executor-host`) with Electron `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- **Rationale**: Zero cloud hosting cost for local projects, direct native Windows DPAPI credential storage, real local Git/build/test execution, and maximum code reuse across Desktop and Web.
- **Risks**: Building Windows `.exe` on a Linux host via `electron-builder` cannot natively execute/verify the Windows NSIS GUI installer without a real Windows OS or Wine; Windows host install/launch verification must be explicitly tracked as `BLOCKED` until tested on Windows.
- **Replacement Cost**: Low (shared packages work identically in both Desktop and Web).
