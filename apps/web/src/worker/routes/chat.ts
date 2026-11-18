import {
  ArtifactRepository,
  ChatService,
  ConversationRepository,
  MessageRepository,
  UsageRepository,
} from "@ai-workspace/chat-core";
import { AppError, ProviderIdSchema } from "@ai-workspace/contracts";
import {
  ProviderConnectionRepository,
  StorageQuotaRepository,
  UserScopedR2Storage,
} from "@ai-workspace/database";
import { listModels } from "@ai-workspace/model-registry";
import { Hono } from "hono";
import { z } from "zod";
import {
  getEncryptionMasterKey,
  requireDb,
  requireStorage,
  type AppVariables,
  type WorkerEnv,
} from "../env.js";
import { requireAuth } from "../middleware/auth.js";

const CreateConversationSchema = z.object({
  title: z.string().max(120).optional(),
  providerId: ProviderIdSchema.default("openai"),
  modelId: z.string().min(1).max(120).default("gpt-6.1-sol"),
  systemPrompt: z.string().max(8_000).nullable().optional(),
  projectId: z.string().max(64).nullable().optional(),
});

const UpdateConversationSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  providerId: ProviderIdSchema.optional(),
  modelId: z.string().min(1).max(120).optional(),
  systemPrompt: z.string().max(8_000).nullable().optional(),
});

const SendMessageSchema = z.object({
  prompt: z.string().min(1).max(100_000),
  providerId: ProviderIdSchema.optional(),
  modelId: z.string().min(1).max(120).optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
  maxTokens: z.number().int().min(1).max(128_000).nullable().optional(),
  reasoningEffort: z.enum(["low", "medium", "high"]).nullable().optional(),
  systemPrompt: z.string().max(8_000).nullable().optional(),
  attachmentIds: z.array(z.string()).max(6).optional(),
  enableWebSearch: z.boolean().optional(),
});

const EditMessageSchema = z.object({
  text: z.string().min(1).max(100_000),
  providerId: ProviderIdSchema.optional(),
  modelId: z.string().min(1).max(120).optional(),
  enableWebSearch: z.boolean().optional(),
});

const RegenerateSchema = z.object({
  providerId: ProviderIdSchema.optional(),
  modelId: z.string().min(1).max(120).optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
  reasoningEffort: z.enum(["low", "medium", "high"]).nullable().optional(),
  enableWebSearch: z.boolean().optional(),
});

function createSseResponse(streamGen: AsyncGenerator<unknown>, signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      try {
        for await (const event of streamGen) {
          if (signal.aborted) break;
          send(event);
        }
      } catch (err) {
        if (!signal.aborted) {
          send({
            type: "error",
            code: err instanceof AppError ? err.code : "UPSTREAM_ERROR",
            message: err instanceof Error ? err.message : "Streaming error",
          });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export const chatRoutes = new Hono<{ Bindings: WorkerEnv; Variables: AppVariables }>();

chatRoutes.use("*", requireAuth);

chatRoutes.get("/models", async (c) => {
  const user = c.get("user")!;
  const db = requireDb(c.env);
  const connections = await new ProviderConnectionRepository(db).listByUser(user.id);
  const configuredProviders = new Set<string>(connections.map((conn) => conn.provider_id));
  if (c.env?.OPENAI_API_KEY) configuredProviders.add("openai");
  if (c.env?.ANTHROPIC_API_KEY) configuredProviders.add("anthropic");
  if (c.env?.GEMINI_API_KEY) configuredProviders.add("google");

  return c.json({
    models: listModels().map((m) => ({
      ...m,
      configured: configuredProviders.has(m.providerId),
    })),
    configuredProviders: [...configuredProviders],
  });
});

chatRoutes.get("/usage", async (c) => {
  const user = c.get("user")!;
  const db = requireDb(c.env);
  const records = await new UsageRepository(db).listByUser(user.id, 50);
  return c.json({ records });
});

chatRoutes.get("/conversations", async (c) => {
  const user = c.get("user")!;
  const q = c.req.query("q");
  const db = requireDb(c.env);
  const conversations = await new ConversationRepository(db).listByUser(user.id, { query: q });
  return c.json({ conversations });
});

chatRoutes.post("/conversations", async (c) => {
  const user = c.get("user")!;
  const input = CreateConversationSchema.parse(await c.req.json());
  const db = requireDb(c.env);
  const conversation = await new ConversationRepository(db).create({
    userId: user.id,
    title: input.title ?? "New Chat",
    providerId: input.providerId,
    modelId: input.modelId,
    systemPrompt: input.systemPrompt,
    projectId: input.projectId,
  });
  return c.json({ conversation }, 201);
});

chatRoutes.get("/conversations/:id", async (c) => {
  const user = c.get("user")!;
  const conversationId = c.req.param("id");
  const db = requireDb(c.env);
  const conv = await new ConversationRepository(db).findByIdForUser(user.id, conversationId);
  if (!conv) {
    throw new AppError("NOT_FOUND", "Conversation not found", 404);
  }
  const messages = await new MessageRepository(db).listByConversation(user.id, conversationId);
  return c.json({
    conversation: conv,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: JSON.parse(m.content_json),
      modelId: m.model_id,
      status: m.status,
      seq: m.seq,
      createdAt: m.created_at,
    })),
  });
});

chatRoutes.patch("/conversations/:id", async (c) => {
  const user = c.get("user")!;
  const conversationId = c.req.param("id");
  const input = UpdateConversationSchema.parse(await c.req.json());
  const db = requireDb(c.env);
  const updated = await new ConversationRepository(db).updateForUser(
    user.id,
    conversationId,
    input,
  );
  if (!updated) {
    throw new AppError("NOT_FOUND", "Conversation not found", 404);
  }
  return c.json({ conversation: updated });
});

chatRoutes.delete("/conversations/:id", async (c) => {
  const user = c.get("user")!;
  const conversationId = c.req.param("id");
  const db = requireDb(c.env);
  const artifactsRepo = new ArtifactRepository(db);
  const linkedArtifacts = await artifactsRepo.listByConversation(user.id, conversationId);

  const deleted = await new ConversationRepository(db).deleteForUser(user.id, conversationId);
  if (!deleted) {
    throw new AppError("NOT_FOUND", "Conversation not found", 404);
  }

  // Clean up R2 attachments & quota tracking linked to this conversation
  if (c.env?.STORAGE && linkedArtifacts.length > 0) {
    const r2 = new UserScopedR2Storage(requireStorage(c.env));
    const quota = new StorageQuotaRepository(db);
    const prefix = `users/${user.id}/`;
    for (const art of linkedArtifacts) {
      const relKey = art.r2_key.startsWith(prefix) ? art.r2_key.slice(prefix.length) : art.r2_key;
      await r2.deleteObject(user.id, relKey).catch(() => undefined);
      await quota.recordDelete(user.id, relKey).catch(() => undefined);
      await artifactsRepo.deleteByIdForUser(user.id, art.id).catch(() => undefined);
    }
  }

  return c.json({ ok: true });
});

chatRoutes.post("/conversations/:id/messages", async (c) => {
  const user = c.get("user")!;
  const conversationId = c.req.param("id");
  const input = SendMessageSchema.parse(await c.req.json());
  const db = requireDb(c.env);
  const bucket = requireStorage(c.env);
  const masterKeyHex = getEncryptionMasterKey(c.env, c.req.url);

  const chat = new ChatService(db, bucket);
  const gen = chat.streamTurn({
    userId: user.id,
    conversationId,
    prompt: input.prompt,
    providerId: input.providerId,
    modelId: input.modelId,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    reasoningEffort: input.reasoningEffort,
    systemPrompt: input.systemPrompt,
    attachmentIds: input.attachmentIds,
    enableWebSearch: input.enableWebSearch,
    masterKeyHex,
    envFallbackKeys: {
      openai: c.env?.OPENAI_API_KEY,
      anthropic: c.env?.ANTHROPIC_API_KEY,
      google: c.env?.GEMINI_API_KEY,
    },
    signal: c.req.raw.signal,
  });

  return createSseResponse(gen, c.req.raw.signal);
});

chatRoutes.patch("/conversations/:id/messages/:messageId", async (c) => {
  const user = c.get("user")!;
  const conversationId = c.req.param("id");
  const messageId = c.req.param("messageId");
  const input = EditMessageSchema.parse(await c.req.json());
  const db = requireDb(c.env);
  const bucket = requireStorage(c.env);

  const conv = await new ConversationRepository(db).findByIdForUser(user.id, conversationId);
  if (!conv) {
    throw new AppError("NOT_FOUND", "Conversation not found", 404);
  }

  await new MessageRepository(db).editUserMessageAndTruncateAfter(
    user.id,
    conversationId,
    messageId,
    input.text,
  );

  const chat = new ChatService(db, bucket);
  const gen = chat.streamTurn({
    userId: user.id,
    conversationId,
    prompt: input.text,
    skipUserAppend: true,
    providerId: input.providerId,
    modelId: input.modelId,
    enableWebSearch: input.enableWebSearch,
    masterKeyHex: getEncryptionMasterKey(c.env, c.req.url),
    envFallbackKeys: {
      openai: c.env?.OPENAI_API_KEY,
      anthropic: c.env?.ANTHROPIC_API_KEY,
      google: c.env?.GEMINI_API_KEY,
    },
    signal: c.req.raw.signal,
  });

  return createSseResponse(gen, c.req.raw.signal);
});

chatRoutes.post("/conversations/:id/regenerate", async (c) => {
  const user = c.get("user")!;
  const conversationId = c.req.param("id");
  const input = RegenerateSchema.parse(await c.req.json().catch(() => ({})));
  const db = requireDb(c.env);
  const bucket = requireStorage(c.env);

  const conv = await new ConversationRepository(db).findByIdForUser(user.id, conversationId);
  if (!conv) {
    throw new AppError("NOT_FOUND", "Conversation not found", 404);
  }

  const msgRepo = new MessageRepository(db);
  await msgRepo.removeTrailingAssistantMessages(user.id, conversationId);
  const remaining = await msgRepo.listByConversation(user.id, conversationId);
  const lastUser = [...remaining].reverse().find((m) => m.role === "user");
  if (!lastUser) {
    throw new AppError("BAD_REQUEST", "No user prompt found to regenerate", 400);
  }
  const parsed = JSON.parse(lastUser.content_json) as { text: string };

  const chat = new ChatService(db, bucket);
  const gen = chat.streamTurn({
    userId: user.id,
    conversationId,
    prompt: parsed.text,
    skipUserAppend: true,
    providerId: input.providerId,
    modelId: input.modelId,
    temperature: input.temperature,
    reasoningEffort: input.reasoningEffort,
    enableWebSearch: input.enableWebSearch,
    masterKeyHex: getEncryptionMasterKey(c.env, c.req.url),
    envFallbackKeys: {
      openai: c.env?.OPENAI_API_KEY,
      anthropic: c.env?.ANTHROPIC_API_KEY,
      google: c.env?.GEMINI_API_KEY,
    },
    signal: c.req.raw.signal,
  });

  return createSseResponse(gen, c.req.raw.signal);
});
