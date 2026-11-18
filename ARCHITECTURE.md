# System Architecture — AI Workspace Platform

## 1. High-Level Cloudflare-First Topology

```
Browser (React 19 + Vite + Tailwind + assistant-ui / Monaco / xterm)
   │  HTTPS / SSE / WebSocket
   ▼
Cloudflare Worker + Hono API Gateway (apps/web/src/worker)
   ├── Auth & CSRF & Rate Limit Middleware
   ├── Business Routes (/api/auth, /api/chat, /api/work, /api/projects, /api/studio, /api/plugins, /api/settings)
   ├── Cloudflare D1 (Relational metadata, users, projects, runs, messages, audit_logs)
   ├── Cloudflare R2 (Attachments, generated media, artifacts, workspace backups)
   ├── Durable Objects: AgentRunDO (agents SDK / PiHarness / SQLite event store / WS fanout)
   ├── Cloudflare Computer (@cloudflare/computer DO SQLite workspace for lightweight state)
   ├── Cloudflare Sandbox / Containers (@cloudflare/sandbox Linux shell, git, build, dev preview)
   └── Native Model Providers (OpenAI, Anthropic, Google Gemini via official/Vercel AI SDK)
         └── Optional P10: VPS Executor Pool (VpsSandboxProvider via signed private control API)
```

## 2. Service & Package Responsibilities

Packages are introduced progressively per development phase (no circular dependencies):

- `packages/shared`: Logger with secret redaction, SSRF/path validators, ID generators, retry utilities.
- `packages/contracts`: Shared Zod schemas and TypeScript types (`ApiError`, `Run`, `AgentEvent`, `ModelCapability`, `PluginManifest`).
- `packages/database`: D1 query helpers, migration runner, R2 storage abstraction. (P1)
- `packages/auth`: PBKDF2 password hashing, SHA-256 session token hashing, AES-GCM API key encryption, ownership guards. (P1)
- `packages/model-registry`: Verified model catalog and capability negotiation matrix. (P2)
- `packages/providers`: Native OpenAI, Anthropic, Google Gemini adapters. (P2)
- `packages/chat-core`: Conversation persistence, streaming orchestration, usage tracking. (P2)
- `packages/agent-core`: `AgentAdapter`, `HarnessRegistry`, `RunManager`, `SessionManager`, `ToolRegistry`, `ApprovalManager`, `ExecutionPolicy`, `EventStream`. (P3)
- `packages/agent-native`: API-key-driven Native Harness + `PiHarness` DO integration. (P3)
- `packages/sandbox`: `SandboxProvider` interface + `CloudflareSandboxProvider` (+ future `VpsSandboxProvider`). (P4)
- `packages/projects`: Templates, Git operations, dev server & backup/restore. (P5)
- `packages/agent-codex`, `packages/agent-claude`, `packages/agent-gemini`: Multi-harness adapters. (P6)
- `packages/media`: Studio image generation service & provider registry. (P7)
- `packages/mcp`, `packages/plugin-sdk`: MCP client, discovery, Skills loader, permission enforcement. (P8)

Dependency direction: `apps/web` → feature packages (`chat-core`, `agent-*`, `projects`, `media`, `mcp`) → core packages (`agent-core`, `sandbox`, `providers`, `database`, `auth`) → `contracts` → `shared`.

## 3. Data Flow & Agent Run Lifecycle

1. User creates a Run via `POST /api/runs` (validated by Zod, scoped by `userId` & `projectId`).
2. Worker inserts index row in D1 `runs` (`status = 'queued'`) and dispatches to `AgentRunDO` keyed by `runId`.
3. `AgentRunDO` transitions `queued -> starting -> running`, initializes selected `AgentAdapter` via `HarnessRegistry` + `CapabilityNegotiation`, and opens/restores workspace.
4. Every step emits monotonically increasing `AgentEvent` (`id`, `runId`, `seq`, `timestamp`, `type`, `payload`, `providerRaw`), persisted to DO SQLite immediately and broadcast over WebSocket/SSE.
5. High-risk tools (`exec`, `git_push`, `external_write`, `deploy`) trigger `approval.required` and transition run to `waiting_approval`. Approval resolution (`POST /api/approvals/:id`) is idempotent.
6. Client reconnects with `?afterSeq=N` to replay missed events from DO SQLite or archived D1 `run_events` / R2 logs.

## 4. Event Stream Protocol

Core unified events:

- `message.started` | `message.delta` | `message.completed`
- `tool.started` | `tool.output` | `tool.completed` | `tool.failed`
- `plan.updated`
- `file.created` | `file.modified` | `file.deleted`
- `approval.required` | `approval.resolved`
- `artifact.created`
- `run.started` | `run.progress` | `run.completed` | `run.failed` | `run.cancelled`

## 5. Project Persistence & Sandbox Lifecycle

- **Distinction**: `@cloudflare/computer` provides lightweight DO-SQLite file workspaces; `@cloudflare/sandbox` provides real Linux containers for shell, git, build, and preview.
- **No Single Point of Ephemeral Loss**: Container disks are ephemeral; persistent state lives in **Git + R2 archives + D1 metadata**.
- **Lifecycle**: `createWorkspace` (restores from R2 if existing) → active execution / preview → periodic or post-run `snapshot` / R2 sync → idle timeout / `destroy` (marks preview expired).

## 6. Security Boundaries

- Browser never receives model API keys or Cloudflare credentials.
- Tenant isolation enforced server-side on every D1 query, R2 key prefix (`users/<userId>/...`), DO stub, and preview proxy.
- Untrusted web/project/skill text is wrapped as data and cannot elevate execution policy or bypass `ApprovalManager`.
- Preview runs on isolated origin/token without sharing main session cookies and enforces SSRF/private-IP blocking.

## 7. API Provider Structure

- Native Vercel AI SDK providers (`@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`) + official provider SDKs where specialized features (e.g. image generation, live `/models` discovery, managed agent APIs) require native endpoints.
- Never forced through third-party OpenAI-compatible reverse proxies.

## 8. Optional VPS Extension (P10)

If Cloudflare Sandbox hits resource/runtime limits, `VpsSandboxProvider` implements the exact same `SandboxProvider` interface over signed private Worker-to-VPS APIs, syncing workspace state via R2 with non-privileged container isolation (zero Docker socket exposure).
