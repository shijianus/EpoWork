import { AppError, type ProviderId } from "@ai-workspace/contracts";
import type { D1DatabaseLike } from "@ai-workspace/database";
import { FREE_TIER_BUDGETS, createId } from "@ai-workspace/shared";
import type {
  ArtifactRow,
  ConversationRow,
  MessageRow,
  StoredMessageContent,
  UsageRecordRow,
} from "./types.js";

export class ConversationRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async create(input: {
    userId: string;
    title: string;
    providerId: ProviderId;
    modelId: string;
    projectId?: string | null;
    systemPrompt?: string | null;
  }): Promise<ConversationRow> {
    const id = createId("cnv");
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO conversations (id, user_id, project_id, title, model_id, provider_id, system_prompt, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.userId,
        input.projectId ?? null,
        input.title.trim() || "New Chat",
        input.modelId,
        input.providerId,
        input.systemPrompt ?? null,
        now,
        now,
      )
      .run();

    return {
      id,
      user_id: input.userId,
      project_id: input.projectId ?? null,
      title: input.title.trim() || "New Chat",
      model_id: input.modelId,
      provider_id: input.providerId,
      system_prompt: input.systemPrompt ?? null,
      created_at: now,
      updated_at: now,
    };
  }

  async findByIdForUser(userId: string, conversationId: string): Promise<ConversationRow | null> {
    return this.db
      .prepare("SELECT * FROM conversations WHERE id = ? AND user_id = ? LIMIT 1")
      .bind(conversationId, userId)
      .first<ConversationRow>();
  }

  async listByUser(
    userId: string,
    options: { query?: string; limit?: number } = {},
  ): Promise<ConversationRow[]> {
    const safeLimit = Math.min(FREE_TIER_BUDGETS.MAX_LIST_LIMIT, Math.max(1, options.limit ?? 50));
    const search = options.query?.trim();
    if (search) {
      const pattern = `%${search}%`;
      const res = await this.db
        .prepare(
          `SELECT * FROM conversations
           WHERE user_id = ? AND title LIKE ?
           ORDER BY updated_at DESC LIMIT ?`,
        )
        .bind(userId, pattern, safeLimit)
        .all<ConversationRow>();
      return res.results;
    }

    const res = await this.db
      .prepare("SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?")
      .bind(userId, safeLimit)
      .all<ConversationRow>();
    return res.results;
  }

  async updateForUser(
    userId: string,
    conversationId: string,
    updates: {
      title?: string;
      providerId?: ProviderId;
      modelId?: string;
      systemPrompt?: string | null;
    },
  ): Promise<ConversationRow | null> {
    const existing = await this.findByIdForUser(userId, conversationId);
    if (!existing) return null;
    const now = new Date().toISOString();
    const nextTitle =
      updates.title !== undefined ? updates.title.trim() || existing.title : existing.title;
    const nextProvider = updates.providerId ?? existing.provider_id;
    const nextModel = updates.modelId ?? existing.model_id;
    const nextSystem =
      updates.systemPrompt !== undefined ? updates.systemPrompt : existing.system_prompt;

    await this.db
      .prepare(
        `UPDATE conversations
         SET title = ?, provider_id = ?, model_id = ?, system_prompt = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
      )
      .bind(nextTitle, nextProvider, nextModel, nextSystem, now, conversationId, userId)
      .run();

    return {
      ...existing,
      title: nextTitle,
      provider_id: nextProvider,
      model_id: nextModel,
      system_prompt: nextSystem,
      updated_at: now,
    };
  }

  async touch(userId: string, conversationId: string): Promise<void> {
    await this.db
      .prepare("UPDATE conversations SET updated_at = ? WHERE id = ? AND user_id = ?")
      .bind(new Date().toISOString(), conversationId, userId)
      .run();
  }

  async deleteForUser(userId: string, conversationId: string): Promise<boolean> {
    const res = await this.db
      .prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?")
      .bind(conversationId, userId)
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }
}

export class MessageRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async listByConversation(userId: string, conversationId: string): Promise<MessageRow[]> {
    const res = await this.db
      .prepare(
        `SELECT * FROM messages
         WHERE conversation_id = ? AND user_id = ?
         ORDER BY seq ASC LIMIT ?`,
      )
      .bind(conversationId, userId, FREE_TIER_BUDGETS.MAX_LIST_LIMIT)
      .all<MessageRow>();
    return res.results;
  }

  async getNextSeq(userId: string, conversationId: string): Promise<number> {
    const row = await this.db
      .prepare("SELECT MAX(seq) AS max_seq FROM messages WHERE conversation_id = ? AND user_id = ?")
      .bind(conversationId, userId)
      .first<{ max_seq: number | null }>();
    return (row?.max_seq ?? 0) + 1;
  }

  async append(input: {
    userId: string;
    conversationId: string;
    role: "user" | "assistant" | "system";
    content: StoredMessageContent;
    modelId?: string | null;
    status?: "streaming" | "completed" | "stopped" | "failed";
  }): Promise<MessageRow> {
    const id = createId("msg");
    const seq = await this.getNextSeq(input.userId, input.conversationId);
    const now = new Date().toISOString();
    const status = input.status ?? "completed";
    const contentJson = JSON.stringify(input.content);

    await this.db
      .prepare(
        `INSERT INTO messages (id, conversation_id, user_id, role, content_json, model_id, status, seq, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.conversationId,
        input.userId,
        input.role,
        contentJson,
        input.modelId ?? null,
        status,
        seq,
        now,
      )
      .run();

    return {
      id,
      conversation_id: input.conversationId,
      user_id: input.userId,
      role: input.role,
      content_json: contentJson,
      model_id: input.modelId ?? null,
      status,
      seq,
      created_at: now,
    };
  }

  async updateContentAndStatus(
    userId: string,
    messageId: string,
    content: StoredMessageContent,
    status: "streaming" | "completed" | "stopped" | "failed",
  ): Promise<void> {
    await this.db
      .prepare("UPDATE messages SET content_json = ?, status = ? WHERE id = ? AND user_id = ?")
      .bind(JSON.stringify(content), status, messageId, userId)
      .run();
  }

  /**
   * Edits a user message and truncates all subsequent messages in the conversation so regeneration is clean.
   */
  async editUserMessageAndTruncateAfter(
    userId: string,
    conversationId: string,
    messageId: string,
    newText: string,
  ): Promise<MessageRow> {
    const target = await this.db
      .prepare(
        "SELECT * FROM messages WHERE id = ? AND conversation_id = ? AND user_id = ? LIMIT 1",
      )
      .bind(messageId, conversationId, userId)
      .first<MessageRow>();

    if (!target) {
      throw new AppError("NOT_FOUND", "Message not found", 404);
    }
    if (target.role !== "user") {
      throw new AppError("BAD_REQUEST", "Only user messages can be edited", 400);
    }

    const parsed = JSON.parse(target.content_json) as StoredMessageContent;
    const updatedContent: StoredMessageContent = { ...parsed, text: newText };

    await this.db
      .prepare("UPDATE messages SET content_json = ? WHERE id = ? AND user_id = ?")
      .bind(JSON.stringify(updatedContent), messageId, userId)
      .run();

    await this.db
      .prepare("DELETE FROM messages WHERE conversation_id = ? AND user_id = ? AND seq > ?")
      .bind(conversationId, userId, target.seq)
      .run();

    return { ...target, content_json: JSON.stringify(updatedContent) };
  }

  async removeTrailingAssistantMessages(userId: string, conversationId: string): Promise<void> {
    const rows = await this.listByConversation(userId, conversationId);
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const row = rows[i];
      if (!row || row.role === "user") break;
      await this.db
        .prepare("DELETE FROM messages WHERE id = ? AND user_id = ?")
        .bind(row.id, userId)
        .run();
    }
  }
}

export class ArtifactRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async create(input: {
    userId: string;
    conversationId?: string | null;
    projectId?: string | null;
    runId?: string | null;
    kind: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    r2Key: string;
  }): Promise<ArtifactRow> {
    const id = createId("art");
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO artifacts (id, user_id, project_id, run_id, conversation_id, kind, name, mime_type, size_bytes, r2_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.userId,
        input.projectId ?? null,
        input.runId ?? null,
        input.conversationId ?? null,
        input.kind,
        input.name,
        input.mimeType,
        input.sizeBytes,
        input.r2Key,
        now,
      )
      .run();

    return {
      id,
      user_id: input.userId,
      project_id: input.projectId ?? null,
      run_id: input.runId ?? null,
      conversation_id: input.conversationId ?? null,
      kind: input.kind,
      name: input.name,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      r2_key: input.r2Key,
      created_at: now,
    };
  }

  async findByIdForUser(userId: string, artifactId: string): Promise<ArtifactRow | null> {
    return this.db
      .prepare("SELECT * FROM artifacts WHERE id = ? AND user_id = ? LIMIT 1")
      .bind(artifactId, userId)
      .first<ArtifactRow>();
  }

  async listByIdsForUser(userId: string, artifactIds: string[]): Promise<ArtifactRow[]> {
    const results: ArtifactRow[] = [];
    for (const id of artifactIds.slice(0, 10)) {
      const row = await this.findByIdForUser(userId, id);
      if (row) results.push(row);
    }
    return results;
  }

  async listByConversation(userId: string, conversationId: string): Promise<ArtifactRow[]> {
    const res = await this.db
      .prepare("SELECT * FROM artifacts WHERE user_id = ? AND conversation_id = ?")
      .bind(userId, conversationId)
      .all<ArtifactRow>();
    return res.results;
  }

  async deleteByIdForUser(userId: string, artifactId: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM artifacts WHERE id = ? AND user_id = ?")
      .bind(artifactId, userId)
      .run();
  }
}

export class UsageRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async record(input: {
    userId: string;
    providerId: ProviderId;
    modelId: string;
    operationType: "chat" | "work" | "studio";
    inputTokens: number;
    outputTokens: number;
    reasoningTokens?: number;
    latencyMs?: number;
  }): Promise<UsageRecordRow> {
    const id = createId("usg");
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO usage_records (id, user_id, provider_id, model_id, operation_type, input_tokens, output_tokens, reasoning_tokens, latency_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.userId,
        input.providerId,
        input.modelId,
        input.operationType,
        input.inputTokens,
        input.outputTokens,
        input.reasoningTokens ?? 0,
        input.latencyMs ?? null,
        now,
      )
      .run();

    return {
      id,
      user_id: input.userId,
      provider_id: input.providerId,
      model_id: input.modelId,
      operation_type: input.operationType,
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
      reasoning_tokens: input.reasoningTokens ?? 0,
      latency_ms: input.latencyMs ?? null,
      created_at: now,
    };
  }

  async listByUser(userId: string, limit = 30): Promise<UsageRecordRow[]> {
    const safeLimit = Math.min(FREE_TIER_BUDGETS.MAX_LIST_LIMIT, Math.max(1, limit));
    const res = await this.db
      .prepare("SELECT * FROM usage_records WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
      .bind(userId, safeLimit)
      .all<UsageRecordRow>();
    return res.results;
  }
}
