import { encryptSecret } from "@ai-workspace/auth";
import { AppError, ProviderIdSchema } from "@ai-workspace/contracts";
import {
  AuditLogRepository,
  ModelPreferencesRepository,
  ProviderConnectionRepository,
  UserRepository,
} from "@ai-workspace/database";
import { maskSecret } from "@ai-workspace/shared";
import { Hono } from "hono";
import { z } from "zod";
import { getEncryptionMasterKey, requireDb, type AppVariables, type WorkerEnv } from "../env.js";
import { requireAuth } from "../middleware/auth.js";
import { toPublicUser } from "./auth.js";

const UpdateProfileSchema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  themePreference: z.enum(["system", "light", "dark"]).optional(),
});

const UpdateModelPreferencesSchema = z.object({
  defaultProviderId: ProviderIdSchema,
  defaultModelId: z.string().min(1).max(120),
  temperature: z.number().min(0).max(2).nullable().optional(),
  maxTokens: z.number().int().min(1).max(200_000).nullable().optional(),
  reasoningEffort: z.enum(["low", "medium", "high"]).nullable().optional(),
});

const UpsertProviderKeySchema = z.object({
  apiKey: z.string().min(8).max(512),
});

export const settingsRoutes = new Hono<{ Bindings: WorkerEnv; Variables: AppVariables }>();

settingsRoutes.use("*", requireAuth);

settingsRoutes.get("/", async (c) => {
  const user = c.get("user")!;
  const db = requireDb(c.env);
  const providersRepo = new ProviderConnectionRepository(db);
  const prefsRepo = new ModelPreferencesRepository(db);

  const [connections, modelPreferences] = await Promise.all([
    providersRepo.listByUser(user.id),
    prefsRepo.getOrDefault(user.id),
  ]);

  return c.json({
    user: toPublicUser(user),
    modelPreferences: {
      defaultProviderId: modelPreferences.default_provider_id,
      defaultModelId: modelPreferences.default_model_id,
      temperature: modelPreferences.temperature,
      maxTokens: modelPreferences.max_tokens,
      reasoningEffort: modelPreferences.reasoning_effort,
      updatedAt: modelPreferences.updated_at,
    },
    providers: connections.map((conn) => ({
      id: conn.id,
      providerId: conn.provider_id,
      keyHint: conn.key_hint,
      status: conn.status,
      updatedAt: conn.updated_at,
    })),
  });
});

settingsRoutes.patch("/profile", async (c) => {
  const user = c.get("user")!;
  const input = UpdateProfileSchema.parse(await c.req.json());
  const db = requireDb(c.env);
  const users = new UserRepository(db);
  const audits = new AuditLogRepository(db);

  const updated = await users.updateProfile(user.id, input);
  if (!updated) {
    throw new AppError("NOT_FOUND", "User not found", 404);
  }

  await audits.record({
    userId: user.id,
    action: "settings.profile.update",
    resourceType: "user",
    resourceId: user.id,
    outcome: "success",
  });

  return c.json({ user: toPublicUser(updated) });
});

settingsRoutes.put("/model-preferences", async (c) => {
  const user = c.get("user")!;
  const input = UpdateModelPreferencesSchema.parse(await c.req.json());
  const db = requireDb(c.env);
  const prefsRepo = new ModelPreferencesRepository(db);

  const saved = await prefsRepo.upsert(user.id, input);
  return c.json({
    modelPreferences: {
      defaultProviderId: saved.default_provider_id,
      defaultModelId: saved.default_model_id,
      temperature: saved.temperature,
      maxTokens: saved.max_tokens,
      reasoningEffort: saved.reasoning_effort,
      updatedAt: saved.updated_at,
    },
  });
});

settingsRoutes.put("/providers/:providerId", async (c) => {
  const user = c.get("user")!;
  const providerId = ProviderIdSchema.parse(c.req.param("providerId"));
  const input = UpsertProviderKeySchema.parse(await c.req.json());
  const db = requireDb(c.env);
  const masterKey = getEncryptionMasterKey(c.env, c.req.url);

  const aad = `${user.id}:${providerId}`;
  const { ciphertext, iv } = await encryptSecret(input.apiKey.trim(), masterKey, aad);
  const keyHint = maskSecret(input.apiKey.trim());

  const repo = new ProviderConnectionRepository(db);
  const audits = new AuditLogRepository(db);
  const saved = await repo.upsert({
    userId: user.id,
    providerId,
    encryptedApiKey: ciphertext,
    keyIv: iv,
    keyHint,
  });

  await audits.record({
    userId: user.id,
    action: "settings.provider_key.upsert",
    resourceType: "provider_connection",
    resourceId: saved.id,
    outcome: "success",
    metadata: { providerId, keyHint },
  });

  return c.json({
    provider: {
      id: saved.id,
      providerId: saved.provider_id,
      keyHint: saved.key_hint,
      status: saved.status,
      updatedAt: saved.updated_at,
    },
  });
});

settingsRoutes.delete("/providers/:providerId", async (c) => {
  const user = c.get("user")!;
  const providerId = ProviderIdSchema.parse(c.req.param("providerId"));
  const db = requireDb(c.env);
  const repo = new ProviderConnectionRepository(db);
  const audits = new AuditLogRepository(db);

  const deleted = await repo.deleteByUserAndProvider(user.id, providerId);
  if (!deleted) {
    throw new AppError("NOT_FOUND", `No saved key for provider ${providerId}`, 404);
  }

  await audits.record({
    userId: user.id,
    action: "settings.provider_key.delete",
    resourceType: "provider_connection",
    outcome: "success",
    metadata: { providerId },
  });

  return c.json({ ok: true });
});

settingsRoutes.get("/audit-logs", async (c) => {
  const user = c.get("user")!;
  const db = requireDb(c.env);
  const audits = new AuditLogRepository(db);
  const rows = await audits.listByUser(user.id, 30);
  return c.json({
    logs: rows.map((row) => ({
      id: row.id,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      outcome: row.outcome,
      createdAt: row.created_at,
    })),
  });
});
