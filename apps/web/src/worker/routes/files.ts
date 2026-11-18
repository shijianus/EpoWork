import { ArtifactRepository } from "@ai-workspace/chat-core";
import { AppError } from "@ai-workspace/contracts";
import { StorageQuotaRepository, UserScopedR2Storage } from "@ai-workspace/database";
import { FREE_TIER_BUDGETS, createId } from "@ai-workspace/shared";
import { Hono } from "hono";
import { requireDb, requireStorage, type AppVariables, type WorkerEnv } from "../env.js";
import { requireAuth } from "../middleware/auth.js";

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/pdf",
]);

function sanitizeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() || "attachment";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "attachment";
}

export const fileRoutes = new Hono<{ Bindings: WorkerEnv; Variables: AppVariables }>();

fileRoutes.use("*", requireAuth);

fileRoutes.post("/upload", async (c) => {
  const user = c.get("user")!;
  const form = await c.req.formData();
  const file = form.get("file");
  const conversationId = form.get("conversationId")?.toString() || null;

  if (!(file instanceof File)) {
    throw new AppError("BAD_REQUEST", "Multipart field 'file' is required", 400);
  }

  const mimeType = file.type || "application/octet-stream";
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new AppError("BAD_REQUEST", `Unsupported file type: ${mimeType}`, 400);
  }

  if (file.size <= 0 || file.size > FREE_TIER_BUDGETS.MAX_CHAT_ATTACHMENT_BYTES) {
    throw new AppError(
      "BAD_REQUEST",
      `Attachment must be between 1 byte and ${Math.round(FREE_TIER_BUDGETS.MAX_CHAT_ATTACHMENT_BYTES / (1024 * 1024))} MB`,
      400,
    );
  }

  const db = requireDb(c.env);
  const bucket = requireStorage(c.env);
  const quotaRepo = new StorageQuotaRepository(db);
  const quota = await quotaRepo.checkQuota(user.id, file.size);
  if (!quota.ok) {
    throw new AppError("RATE_LIMITED", quota.reason, 429);
  }

  const safeName = sanitizeFilename(file.name);
  const relKey = `attachments/${createId("att")}_${safeName}`;
  const r2 = new UserScopedR2Storage(bucket);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const stored = await r2.putObject(user.id, relKey, bytes, mimeType);

  try {
    await quotaRepo.recordPut({
      userId: user.id,
      relativeKey: relKey,
      r2Key: stored.key,
      mimeType,
      sizeBytes: file.size,
    });
    const artifact = await new ArtifactRepository(db).create({
      userId: user.id,
      conversationId,
      kind: mimeType.startsWith("image/") ? "image" : "attachment",
      name: safeName,
      mimeType,
      sizeBytes: file.size,
      r2Key: stored.key,
    });

    return c.json(
      {
        artifact: {
          id: artifact.id,
          name: artifact.name,
          mimeType: artifact.mime_type,
          sizeBytes: artifact.size_bytes,
          createdAt: artifact.created_at,
        },
      },
      201,
    );
  } catch (err) {
    await r2.deleteObject(user.id, relKey).catch(() => undefined);
    throw err;
  }
});

fileRoutes.get("/:id", async (c) => {
  const user = c.get("user")!;
  const artifactId = c.req.param("id");
  const db = requireDb(c.env);
  const bucket = requireStorage(c.env);

  const artifact = await new ArtifactRepository(db).findByIdForUser(user.id, artifactId);
  if (!artifact) {
    throw new AppError("NOT_FOUND", "Attachment not found", 404);
  }

  const r2 = new UserScopedR2Storage(bucket);
  const prefix = `users/${user.id}/`;
  const relKey = artifact.r2_key.startsWith(prefix)
    ? artifact.r2_key.slice(prefix.length)
    : artifact.r2_key;
  const obj = await r2.getObject(user.id, relKey);
  if (!obj) {
    throw new AppError("NOT_FOUND", "Attachment binary missing", 404);
  }

  return new Response(await obj.arrayBuffer(), {
    status: 200,
    headers: {
      "Content-Type": artifact.mime_type,
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename="${artifact.name}"`,
    },
  });
});
