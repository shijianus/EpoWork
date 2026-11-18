# AI Workspace Platform — Product Specification

## 1. Overview

**AI Workspace Platform** is a browser-first, cloud-native, API-first, agent-powered, and extensible AI workspace web application built with an original brand identity, unified auth, model registry, project permissions, artifact storage, and agent task orchestration.

### Scope Boundaries (Phase 1 Web Platform)

- **In Scope**: Browser-accessible cloud web application covering `Chat`, `Work`, `Projects`, `Studio`, `Plugins`, `Automations`, and `Settings`.
- **Out of Scope**: Desktop client, mobile native apps, local device companion/bridge daemons.

## 2. Shared Platform Foundations

All modules share:

1. **Identity & Sessions**: User accounts, organizations/workspaces, session cookies, CSRF protection, rate limiting.
2. **Model & Capability Registry**: Native OpenAI, Anthropic, and Google Gemini adapters with explicit capability flags (`streaming`, `toolCalling`, `structuredOutput`, `imageInput`, `imageGeneration`, `fileInput`, `reasoningControl`, `contextWindow`).
3. **Storage & Artifacts**: Cloudflare D1 metadata, Durable Objects state/events, Cloudflare R2 attachments/media/backups.
4. **Permissions & Policy**: Strict per-user resource isolation, capability grants, and approval workflows for side-effecting operations.

## 3. Core Modules

### 3.1 Chat

- Multi-turn streaming conversations, Markdown, syntax-highlighted code blocks, KaTeX math.
- Model & parameter selection gated by Capability Registry.
- Conversation history, rename, delete, message edit, regenerate, stop generation (real upstream abort).
- File & image uploads (R2-backed), tool execution cards, web search extension, image generation tool, project context references, and **Chat → Work** task handoff.
- Chat does **not** have OS shell access by default.

### 3.2 Work

- Autonomous agent workspace powered by unified `AgentAdapter` + `AgentRun` + `AgentEvent` protocol.
- Supports Native Harness (`PiHarness` / API-driven loop) and optional Codex, Claude, Gemini adapters.
- Real cloud workspaces (Files, Shell, Processes, Logs, Diff, Preview, Artifacts) that keep running asynchronously after browser disconnect and resume cleanly via event sequence (`seq`) replay.
- Interactive approval panel for high-risk actions and **Work → Chat** result handoff.

### 3.3 Projects

- Cloud project lifecycle: blank/template creation, HTTPS Git import, file tree, Monaco Editor + Diff Editor, xterm.js cloud terminal, Git status/diff/commit, encrypted project env vars, live dev server preview (isolated origin), and R2 backup/restore.

### 3.4 Studio

- Multimodal media workspace starting with real API-driven image generation (`GPT Image 2.5` / `gemini-nano-banana-2.1` etc.), parameter controls, R2 persistence, generation history, download, project import, and Chat/Work tool integration.

### 3.5 Plugins & Automations

- Extensible registry for `mcp_tool`, `agent_skill`, `mcp_app`, `platform_app`, `model_provider`, and `media_provider`.
- Manifest validation, scoped permissions, MCP Client discovery/execution, `SKILL.md` loader, audit logging, and real example plugin(s).
- Automations is staged as a roadmap navigation item until scheduled/webhook workflows are implemented (clearly marked, never fake buttons).

### 3.6 Settings

- Profile, theme (`system`/`light`/`dark`), default model preferences, encrypted BYOK provider API key management (masked display, rotation, deletion), and quota/usage overview.
