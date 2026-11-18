import type { AgentEvent, RunStatus } from "@ai-workspace/contracts";
import type { D1DatabaseLike } from "@ai-workspace/database";
import { createId } from "@ai-workspace/shared";
import { LOCAL_DESKTOP_USER_ID } from "./sqlite-db.js";

export interface DesktopProjectRow {
  id: string;
  name: string;
  root_path: string;
  template: string;
  created_at: string;
  updated_at: string;
}

export interface DesktopRunRow {
  id: string;
  user_id: string;
  project_id: string | null;
  harness_id: string;
  model_id: string;
  status: RunStatus;
  prompt: string;
  error_message: string | null;
  input_tokens: number;
  output_tokens: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

export class DesktopProjectRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async list(): Promise<DesktopProjectRow[]> {
    const res = await this.db
      .prepare("SELECT * FROM desktop_projects ORDER BY updated_at DESC LIMIT 100")
      .all<DesktopProjectRow>();
    return res.results;
  }

  async findById(id: string): Promise<DesktopProjectRow | null> {
    return this.db
      .prepare("SELECT * FROM desktop_projects WHERE id = ? LIMIT 1")
      .bind(id)
      .first<DesktopProjectRow>();
  }

  async createOrOpen(input: {
    name: string;
    rootPath: string;
    template?: string;
  }): Promise<DesktopProjectRow> {
    const existing = await this.db
      .prepare("SELECT * FROM desktop_projects WHERE root_path = ? LIMIT 1")
      .bind(input.rootPath)
      .first<DesktopProjectRow>();
    if (existing) return existing;

    const id = createId("prj");
    const now = new Date().toISOString();
    const template = input.template ?? "blank";
    await this.db
      .prepare(
        `INSERT INTO desktop_projects (id, name, root_path, template, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, input.name.trim(), input.rootPath, template, now, now)
      .run();

    return {
      id,
      name: input.name.trim(),
      root_path: input.rootPath,
      template,
      created_at: now,
      updated_at: now,
    };
  }

  async remove(id: string): Promise<boolean> {
    const res = await this.db.prepare("DELETE FROM desktop_projects WHERE id = ?").bind(id).run();
    return (res.meta?.changes ?? 0) > 0;
  }
}

export class DesktopRunRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async create(input: {
    id?: string;
    projectId: string;
    harnessId: string;
    modelId: string;
    prompt: string;
  }): Promise<DesktopRunRow> {
    const id = input.id ?? createId("run");
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO runs (id, user_id, project_id, workspace_id, conversation_id, harness_id, model_id, provider_session_id, status, prompt, input_tokens, output_tokens, started_at, created_at, updated_at)
         VALUES (?, ?, ?, NULL, NULL, ?, ?, NULL, 'running', ?, 0, 0, ?, ?, ?)`,
      )
      .bind(
        id,
        LOCAL_DESKTOP_USER_ID,
        input.projectId,
        input.harnessId,
        input.modelId,
        input.prompt,
        now,
        now,
        now,
      )
      .run();

    return {
      id,
      user_id: LOCAL_DESKTOP_USER_ID,
      project_id: input.projectId,
      harness_id: input.harnessId,
      model_id: input.modelId,
      status: "running",
      prompt: input.prompt,
      error_message: null,
      input_tokens: 0,
      output_tokens: 0,
      started_at: now,
      ended_at: null,
      created_at: now,
      updated_at: now,
    };
  }

  async updateStatus(
    runId: string,
    updates: {
      status: RunStatus;
      errorMessage?: string | null;
      inputTokens?: number;
      outputTokens?: number;
    },
  ): Promise<void> {
    const now = new Date().toISOString();
    const isTerminal = ["completed", "failed", "cancelled"].includes(updates.status);
    await this.db
      .prepare(
        `UPDATE runs
         SET status = ?, error_message = ?, input_tokens = COALESCE(?, input_tokens), output_tokens = COALESCE(?, output_tokens), ended_at = COALESCE(?, ended_at), updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        updates.status,
        updates.errorMessage ?? null,
        updates.inputTokens ?? null,
        updates.outputTokens ?? null,
        isTerminal ? now : null,
        now,
        runId,
      )
      .run();
  }

  async appendEvent(event: AgentEvent): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO run_events (id, run_id, user_id, seq, type, payload_json, provider_raw_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
      )
      .bind(
        event.id,
        event.runId,
        LOCAL_DESKTOP_USER_ID,
        event.seq,
        event.type,
        JSON.stringify(event.payload),
        event.timestamp,
      )
      .run();
  }

  async list(limit = 50): Promise<DesktopRunRow[]> {
    const res = await this.db
      .prepare("SELECT * FROM runs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
      .bind(LOCAL_DESKTOP_USER_ID, limit)
      .all<DesktopRunRow>();
    return res.results;
  }

  async findById(runId: string): Promise<DesktopRunRow | null> {
    return this.db
      .prepare("SELECT * FROM runs WHERE id = ? AND user_id = ? LIMIT 1")
      .bind(runId, LOCAL_DESKTOP_USER_ID)
      .first<DesktopRunRow>();
  }

  async listEvents(runId: string, afterSeq = -1): Promise<AgentEvent[]> {
    const res = await this.db
      .prepare(
        "SELECT * FROM run_events WHERE run_id = ? AND user_id = ? AND seq > ? ORDER BY seq ASC LIMIT 1000",
      )
      .bind(runId, LOCAL_DESKTOP_USER_ID, afterSeq)
      .all<{
        id: string;
        run_id: string;
        seq: number;
        type: AgentEvent["type"];
        payload_json: string;
        created_at: string;
      }>();
    return res.results.map((r) => ({
      id: r.id,
      runId: r.run_id,
      seq: r.seq,
      timestamp: r.created_at,
      type: r.type,
      payload: JSON.parse(r.payload_json) as Record<string, unknown>,
    }));
  }
}
