import { AppError } from "@ai-workspace/contracts";
import { StorageQuotaRepository, UserScopedR2Storage } from "@ai-workspace/database";
import { FREE_TIER_BUDGETS } from "@ai-workspace/shared";
import { Hono } from "hono";
import { requireDb, requireStorage, type AppVariables, type WorkerEnv } from "../env.js";
import { requireAuth } from "../middleware/auth.js";

/**
 * Reads a request stream with a hard byte ceiling BEFORE buffering to prevent 128 MB isolate OOM.
 */
async function readBodyWithByteLimit(request: Request, maxBytes: number): Promise<Uint8Array> {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const declared = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new AppError(
        "BAD_REQUEST",
        `Object exceeds ${Math.round(maxBytes / (1024 * 1024))} MB size limit`,
        400,
      );
    }
  }

  if (!request.body) {
    return new Uint8Array(0);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new AppError(
          "BAD_REQUEST",
          `Object exceeds ${Math.round(maxBytes / (1024 * 1024))} MB size limit`,
          400,
        );
      }
      chunks.push(value);
    }
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export const storageRoutes = new Hono<{ Bindings: WorkerEnv; Variables: AppVariables }>();

storageRoutes.use("*", requireAuth);

storageRoutes.get("/objects", async (c) => {
  const user = c.get("user")!;
  const db = requireDb(c.env);
  const quotaRepo = new StorageQuotaRepository(db);
  const [objects, usage] = await Promise.all([
    quotaRepo.listObjects(user.id),
    quotaRepo.getUsage(user.id),
  ]);
  return c.json({
    objects: objects.map((obj) => ({
      relativeKey: obj.relative_key,
      mimeType: obj.mime_type,
      size: obj.size_bytes,
      createdAt: obj.created_at,
    })),
    usage: {
      totalBytes: usage.totalBytes,
      objectCount: usage.objectCount,
      maxBytes: FREE_TIER_BUDGETS.MAX_USER_STORAGE_BYTES,
      maxObjects: FREE_TIER_BUDGETS.MAX_USER_STORAGE_OBJECTS,
    },
  });
});

storageRoutes.put("/objects/:key{.+}", async (c) => {
  const user = c.get("user")!;
  const relativeKey = c.req.param("key");
  const contentType = c.req.header("content-type") || "application/octet-stream";

  const bytes = await readBodyWithByteLimit(c.req.raw, FREE_TIER_BUDGETS.MAX_OBJECT_UPLOAD_BYTES);

  const db = requireDb(c.env);
  const storage = new UserScopedR2Storage(requireStorage(c.env));
  const quotaRepo = new StorageQuotaRepository(db);

  // Validate key path before quota/DB checks
  storage.buildUserKey(user.id, relativeKey);

  const existing = await quotaRepo.getObjectMeta(user.id, relativeKey);
  const quotaCheck = await quotaRepo.checkQuota(
    user.id,
    bytes.byteLength,
    existing?.size_bytes ?? 0,
  );
  if (!quotaCheck.ok) {
    throw new AppError("RATE_LIMITED", quotaCheck.reason, 429);
  }

  const stored = await storage.putObject(user.id, relativeKey, bytes, contentType);
  try {
    await quotaRepo.recordPut({
      userId: user.id,
      relativeKey,
      r2Key: stored.key,
      mimeType: contentType,
      sizeBytes: bytes.byteLength,
    });
  } catch (err) {
    // Rollback R2 object if D1 metadata write fails to avoid leaked quota / orphaned blobs
    await storage.deleteObject(user.id, relativeKey).catch(() => undefined);
    throw err;
  }

  return c.json({ ok: true, key: relativeKey, size: bytes.byteLength, scopedKey: stored.key }, 201);
});

storageRoutes.get("/objects/:key{.+}", async (c) => {
  const user = c.get("user")!;
  const relativeKey = c.req.param("key");
  const storage = new UserScopedR2Storage(requireStorage(c.env));
  const obj = await storage.getObject(user.id, relativeKey);
  if (!obj) {
    throw new AppError("NOT_FOUND", "Object not found", 404);
  }

  const data = await obj.arrayBuffer();
  return new Response(data, {
    status: 200,
    headers: {
      "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "attachment",
    },
  });
});

storageRoutes.delete("/objects/:key{.+}", async (c) => {
  const user = c.get("user")!;
  const relativeKey = c.req.param("key");
  const db = requireDb(c.env);
  const storage = new UserScopedR2Storage(requireStorage(c.env));
  const quotaRepo = new StorageQuotaRepository(db);

  await storage.deleteObject(user.id, relativeKey);
  await quotaRepo.recordDelete(user.id, relativeKey);
  return c.json({ ok: true });
});
