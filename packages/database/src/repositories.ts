import { FREE_TIER_BUDGETS, createId, redactValue } from "@ai-workspace/shared";
import type { D1DatabaseLike } from "./types.js";

export interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  password_salt: string;
  theme_preference: "system" | "light" | "dark";
  created_at: string;
  updated_at: string;
}

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  csrf_token: string;
  user_agent: string | null;
  ip_address: string | null;
  expires_at: string;
  created_at: string;
  last_seen_at: string;
}

export interface ProviderConnectionRow {
  id: string;
  user_id: string;
  provider_id: string;
  encrypted_api_key: string;
  key_iv: string;
  key_hint: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ModelPreferencesRow {
  user_id: string;
  default_provider_id: string;
  default_model_id: string;
  temperature: number | null;
  max_tokens: number | null;
  reasoning_effort: string | null;
  updated_at: string;
}

export interface AuditLogRow {
  id: string;
  user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  outcome: string;
  metadata_json: string | null;
  ip_address: string | null;
  created_at: string;
}

export class UserRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async findByEmail(email: string): Promise<UserRow | null> {
    return this.db
      .prepare("SELECT * FROM users WHERE email = ? LIMIT 1")
      .bind(email.trim().toLowerCase())
      .first<UserRow>();
  }

  async findById(id: string): Promise<UserRow | null> {
    return this.db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").bind(id).first<UserRow>();
  }

  async create(input: {
    email: string;
    displayName: string;
    passwordHash: string;
    passwordSalt: string;
  }): Promise<UserRow> {
    const now = new Date().toISOString();
    const id = createId("usr");
    const email = input.email.trim().toLowerCase();

    await this.db
      .prepare(
        `INSERT INTO users (id, email, display_name, password_hash, password_salt, theme_preference, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'system', ?, ?)`,
      )
      .bind(id, email, input.displayName.trim(), input.passwordHash, input.passwordSalt, now, now)
      .run();

    return {
      id,
      email,
      display_name: input.displayName.trim(),
      password_hash: input.passwordHash,
      password_salt: input.passwordSalt,
      theme_preference: "system",
      created_at: now,
      updated_at: now,
    };
  }

  async updateProfile(
    userId: string,
    updates: { displayName?: string; themePreference?: "system" | "light" | "dark" },
  ): Promise<UserRow | null> {
    const existing = await this.findById(userId);
    if (!existing) return null;
    const now = new Date().toISOString();
    const nextName = updates.displayName?.trim() || existing.display_name;
    const nextTheme = updates.themePreference ?? existing.theme_preference;

    await this.db
      .prepare(
        "UPDATE users SET display_name = ?, theme_preference = ?, updated_at = ? WHERE id = ?",
      )
      .bind(nextName, nextTheme, now, userId)
      .run();

    return { ...existing, display_name: nextName, theme_preference: nextTheme, updated_at: now };
  }
}

export class SessionRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async create(input: {
    userId: string;
    tokenHash: string;
    csrfToken: string;
    userAgent: string | null;
    ipAddress: string | null;
    expiresAt: string;
  }): Promise<SessionRow> {
    const id = createId("ses");
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO sessions (id, user_id, token_hash, csrf_token, user_agent, ip_address, expires_at, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.userId,
        input.tokenHash,
        input.csrfToken,
        input.userAgent,
        input.ipAddress,
        input.expiresAt,
        now,
        now,
      )
      .run();

    return {
      id,
      user_id: input.userId,
      token_hash: input.tokenHash,
      csrf_token: input.csrfToken,
      user_agent: input.userAgent,
      ip_address: input.ipAddress,
      expires_at: input.expiresAt,
      created_at: now,
      last_seen_at: now,
    };
  }

  async findValidByTokenHash(tokenHash: string): Promise<SessionRow | null> {
    const row = await this.db
      .prepare("SELECT * FROM sessions WHERE token_hash = ? LIMIT 1")
      .bind(tokenHash)
      .first<SessionRow>();
    if (!row) return null;
    if (Date.parse(row.expires_at) <= Date.now()) {
      await this.deleteById(row.id);
      return null;
    }
    return row;
  }

  async touch(sessionId: string): Promise<void> {
    await this.db
      .prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), sessionId)
      .run();
  }

  /**
   * Throttles `last_seen_at` D1 writes so normal read/poll requests don't burn D1 Free write quota (100k/day).
   */
  async touchIfStale(
    sessionId: string,
    lastSeenAtIso: string,
    minIntervalMs = FREE_TIER_BUDGETS.SESSION_TOUCH_INTERVAL_MS,
  ): Promise<boolean> {
    const elapsed = Date.now() - Date.parse(lastSeenAtIso);
    if (Number.isFinite(elapsed) && elapsed < minIntervalMs) {
      return false;
    }
    await this.touch(sessionId);
    return true;
  }

  async pruneExpired(nowIso = new Date().toISOString()): Promise<number> {
    const res = await this.db
      .prepare("DELETE FROM sessions WHERE expires_at <= ?")
      .bind(nowIso)
      .run();
    return res.meta?.changes ?? 0;
  }

  async deleteById(sessionId: string): Promise<void> {
    await this.db.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
  }

  async deleteByTokenHash(tokenHash: string): Promise<void> {
    await this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
  }
}

export class ProviderConnectionRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async listByUser(userId: string): Promise<ProviderConnectionRow[]> {
    const res = await this.db
      .prepare("SELECT * FROM provider_connections WHERE user_id = ? ORDER BY provider_id ASC")
      .bind(userId)
      .all<ProviderConnectionRow>();
    return res.results;
  }

  async findByUserAndProvider(
    userId: string,
    providerId: string,
  ): Promise<ProviderConnectionRow | null> {
    return this.db
      .prepare("SELECT * FROM provider_connections WHERE user_id = ? AND provider_id = ? LIMIT 1")
      .bind(userId, providerId)
      .first<ProviderConnectionRow>();
  }

  async upsert(input: {
    userId: string;
    providerId: string;
    encryptedApiKey: string;
    keyIv: string;
    keyHint: string;
  }): Promise<ProviderConnectionRow> {
    const now = new Date().toISOString();
    const existing = await this.findByUserAndProvider(input.userId, input.providerId);
    if (existing) {
      await this.db
        .prepare(
          `UPDATE provider_connections
           SET encrypted_api_key = ?, key_iv = ?, key_hint = ?, status = 'active', updated_at = ?
           WHERE id = ? AND user_id = ?`,
        )
        .bind(input.encryptedApiKey, input.keyIv, input.keyHint, now, existing.id, input.userId)
        .run();
      return {
        ...existing,
        encrypted_api_key: input.encryptedApiKey,
        key_iv: input.keyIv,
        key_hint: input.keyHint,
        status: "active",
        updated_at: now,
      };
    }

    const id = createId("prv");
    await this.db
      .prepare(
        `INSERT INTO provider_connections (id, user_id, provider_id, encrypted_api_key, key_iv, key_hint, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      )
      .bind(
        id,
        input.userId,
        input.providerId,
        input.encryptedApiKey,
        input.keyIv,
        input.keyHint,
        now,
        now,
      )
      .run();

    return {
      id,
      user_id: input.userId,
      provider_id: input.providerId,
      encrypted_api_key: input.encryptedApiKey,
      key_iv: input.keyIv,
      key_hint: input.keyHint,
      status: "active",
      created_at: now,
      updated_at: now,
    };
  }

  async deleteByUserAndProvider(userId: string, providerId: string): Promise<boolean> {
    const res = await this.db
      .prepare("DELETE FROM provider_connections WHERE user_id = ? AND provider_id = ?")
      .bind(userId, providerId)
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }
}

export class ModelPreferencesRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async getOrDefault(userId: string): Promise<ModelPreferencesRow> {
    const row = await this.db
      .prepare("SELECT * FROM model_preferences WHERE user_id = ? LIMIT 1")
      .bind(userId)
      .first<ModelPreferencesRow>();
    if (row) return row;

    return {
      user_id: userId,
      default_provider_id: "openai",
      default_model_id: "gpt-6.1-sol",
      temperature: 0.7,
      max_tokens: null,
      reasoning_effort: "medium",
      updated_at: new Date().toISOString(),
    };
  }

  async upsert(
    userId: string,
    input: {
      defaultProviderId: string;
      defaultModelId: string;
      temperature?: number | null;
      maxTokens?: number | null;
      reasoningEffort?: string | null;
    },
  ): Promise<ModelPreferencesRow> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO model_preferences (user_id, default_provider_id, default_model_id, temperature, max_tokens, reasoning_effort, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           default_provider_id = excluded.default_provider_id,
           default_model_id = excluded.default_model_id,
           temperature = excluded.temperature,
           max_tokens = excluded.max_tokens,
           reasoning_effort = excluded.reasoning_effort,
           updated_at = excluded.updated_at`,
      )
      .bind(
        userId,
        input.defaultProviderId,
        input.defaultModelId,
        input.temperature ?? null,
        input.maxTokens ?? null,
        input.reasoningEffort ?? null,
        now,
      )
      .run();

    return {
      user_id: userId,
      default_provider_id: input.defaultProviderId,
      default_model_id: input.defaultModelId,
      temperature: input.temperature ?? null,
      max_tokens: input.maxTokens ?? null,
      reasoning_effort: input.reasoningEffort ?? null,
      updated_at: now,
    };
  }
}

export class AuditLogRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async record(input: {
    userId: string | null;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    outcome: "success" | "denied" | "error";
    metadata?: Record<string, unknown>;
    ipAddress?: string | null;
  }): Promise<void> {
    const id = createId("aud");
    const now = new Date().toISOString();
    const safeMeta = input.metadata ? JSON.stringify(redactValue(input.metadata)) : null;

    await this.db
      .prepare(
        `INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, outcome, metadata_json, ip_address, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.userId,
        input.action,
        input.resourceType,
        input.resourceId ?? null,
        input.outcome,
        safeMeta,
        input.ipAddress ?? null,
        now,
      )
      .run();
  }

  async listByUser(
    userId: string,
    limit = FREE_TIER_BUDGETS.DEFAULT_LIST_LIMIT,
  ): Promise<AuditLogRow[]> {
    const safeLimit = Math.min(FREE_TIER_BUDGETS.MAX_LIST_LIMIT, Math.max(1, limit));
    const res = await this.db
      .prepare("SELECT * FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
      .bind(userId, safeLimit)
      .all<AuditLogRow>();
    return res.results;
  }
}

export class RateLimitRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async checkAndIncrement(
    bucketKey: string,
    maxRequests: number,
    windowMs: number,
    now = Date.now(),
  ): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const existing = await this.db
      .prepare("SELECT count, reset_at FROM rate_limits WHERE bucket_key = ? LIMIT 1")
      .bind(bucketKey)
      .first<{ count: number; reset_at: number }>();

    if (!existing || existing.reset_at <= now) {
      const resetAt = now + windowMs;
      await this.db
        .prepare(
          `INSERT INTO rate_limits (bucket_key, count, reset_at)
           VALUES (?, 1, ?)
           ON CONFLICT(bucket_key) DO UPDATE SET count = 1, reset_at = excluded.reset_at`,
        )
        .bind(bucketKey, resetAt)
        .run();
      return { allowed: true, remaining: Math.max(0, maxRequests - 1), resetAt };
    }

    if (existing.count >= maxRequests) {
      return { allowed: false, remaining: 0, resetAt: existing.reset_at };
    }

    const nextCount = existing.count + 1;
    await this.db
      .prepare("UPDATE rate_limits SET count = ? WHERE bucket_key = ?")
      .bind(nextCount, bucketKey)
      .run();

    return {
      allowed: true,
      remaining: Math.max(0, maxRequests - nextCount),
      resetAt: existing.reset_at,
    };
  }

  async pruneExpired(now = Date.now()): Promise<number> {
    const res = await this.db
      .prepare("DELETE FROM rate_limits WHERE reset_at <= ?")
      .bind(now)
      .run();
    return res.meta?.changes ?? 0;
  }
}

export interface StorageObjectRow {
  id: string;
  user_id: string;
  relative_key: string;
  r2_key: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

export class StorageQuotaRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async getUsage(userId: string): Promise<{ totalBytes: number; objectCount: number }> {
    const row = await this.db
      .prepare("SELECT total_bytes, object_count FROM user_storage_usage WHERE user_id = ? LIMIT 1")
      .bind(userId)
      .first<{ total_bytes: number; object_count: number }>();
    return {
      totalBytes: row?.total_bytes ?? 0,
      objectCount: row?.object_count ?? 0,
    };
  }

  async getObjectMeta(userId: string, relativeKey: string): Promise<StorageObjectRow | null> {
    return this.db
      .prepare("SELECT * FROM storage_objects WHERE user_id = ? AND relative_key = ? LIMIT 1")
      .bind(userId, relativeKey)
      .first<StorageObjectRow>();
  }

  async listObjects(
    userId: string,
    limit = FREE_TIER_BUDGETS.MAX_LIST_LIMIT,
  ): Promise<StorageObjectRow[]> {
    const safeLimit = Math.min(FREE_TIER_BUDGETS.MAX_LIST_LIMIT, Math.max(1, limit));
    const res = await this.db
      .prepare("SELECT * FROM storage_objects WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
      .bind(userId, safeLimit)
      .all<StorageObjectRow>();
    return res.results;
  }

  async checkQuota(
    userId: string,
    incomingBytes: number,
    existingBytes = 0,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const usage = await this.getUsage(userId);
    const projectedBytes = Math.max(0, usage.totalBytes - existingBytes + incomingBytes);
    const projectedCount = existingBytes > 0 ? usage.objectCount : usage.objectCount + 1;

    if (projectedBytes > FREE_TIER_BUDGETS.MAX_USER_STORAGE_BYTES) {
      return {
        ok: false,
        reason: `Storage quota exceeded (max ${Math.round(FREE_TIER_BUDGETS.MAX_USER_STORAGE_BYTES / (1024 * 1024))} MB per user)`,
      };
    }
    if (projectedCount > FREE_TIER_BUDGETS.MAX_USER_STORAGE_OBJECTS) {
      return {
        ok: false,
        reason: `Object count quota exceeded (max ${FREE_TIER_BUDGETS.MAX_USER_STORAGE_OBJECTS} objects per user)`,
      };
    }
    return { ok: true };
  }

  async recordPut(input: {
    userId: string;
    relativeKey: string;
    r2Key: string;
    mimeType: string;
    sizeBytes: number;
  }): Promise<StorageObjectRow> {
    const now = new Date().toISOString();
    const existing = await this.getObjectMeta(input.userId, input.relativeKey);
    const deltaBytes = input.sizeBytes - (existing?.size_bytes ?? 0);
    const deltaCount = existing ? 0 : 1;
    const id = existing?.id ?? createId("obj");

    await this.db
      .prepare(
        `INSERT INTO storage_objects (id, user_id, relative_key, r2_key, mime_type, size_bytes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, relative_key) DO UPDATE SET
           r2_key = excluded.r2_key,
           mime_type = excluded.mime_type,
           size_bytes = excluded.size_bytes,
           created_at = excluded.created_at`,
      )
      .bind(id, input.userId, input.relativeKey, input.r2Key, input.mimeType, input.sizeBytes, now)
      .run();

    await this.db
      .prepare(
        `INSERT INTO user_storage_usage (user_id, total_bytes, object_count, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           total_bytes = MAX(0, user_storage_usage.total_bytes + ?),
           object_count = MAX(0, user_storage_usage.object_count + ?),
           updated_at = excluded.updated_at`,
      )
      .bind(input.userId, Math.max(0, input.sizeBytes), 1, now, deltaBytes, deltaCount)
      .run();

    return {
      id,
      user_id: input.userId,
      relative_key: input.relativeKey,
      r2_key: input.r2Key,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      created_at: now,
    };
  }

  async recordDelete(userId: string, relativeKey: string): Promise<boolean> {
    const existing = await this.getObjectMeta(userId, relativeKey);
    if (!existing) return false;

    await this.db
      .prepare("DELETE FROM storage_objects WHERE id = ? AND user_id = ?")
      .bind(existing.id, userId)
      .run();

    const now = new Date().toISOString();
    await this.db
      .prepare(
        `UPDATE user_storage_usage
         SET total_bytes = MAX(0, total_bytes - ?),
             object_count = MAX(0, object_count - 1),
             updated_at = ?
         WHERE user_id = ?`,
      )
      .bind(existing.size_bytes, now, userId)
      .run();

    return true;
  }
}
