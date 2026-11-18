import { AppError } from "@ai-workspace/contracts";
import { sanitizeWorkspacePath } from "@ai-workspace/shared";
import type { R2BucketLike, R2ObjectBodyLike } from "./types.js";

/**
 * Enforces per-user key prefix isolation (`users/<userId>/...`) for all R2 reads, writes, and deletes.
 */
export class UserScopedR2Storage {
  constructor(private readonly bucket: R2BucketLike) {}

  buildUserKey(userId: string, relativeKey: string): string {
    if (!userId || userId.includes("/") || userId.includes("..")) {
      throw new AppError("FORBIDDEN", "Invalid user scope for storage access", 403);
    }
    const sanitized = sanitizeWorkspacePath(relativeKey);
    if (!sanitized.ok || sanitized.path === ".") {
      throw new AppError("BAD_REQUEST", "Invalid object key path", 400);
    }
    return `users/${userId}/${sanitized.path}`;
  }

  async putObject(
    userId: string,
    relativeKey: string,
    body: ArrayBuffer | Uint8Array | string,
    contentType = "application/octet-stream",
  ): Promise<{ key: string }> {
    const key = this.buildUserKey(userId, relativeKey);
    await this.bucket.put(key, body, {
      httpMetadata: { contentType },
      customMetadata: { userId },
    });
    return { key };
  }

  async getObject(userId: string, relativeKey: string): Promise<R2ObjectBodyLike | null> {
    const key = this.buildUserKey(userId, relativeKey);
    return this.bucket.get(key);
  }

  async deleteObject(userId: string, relativeKey: string): Promise<void> {
    const key = this.buildUserKey(userId, relativeKey);
    await this.bucket.delete(key);
  }

  async listObjects(userId: string, subPrefix = "", limit = 100) {
    const cleanSub = subPrefix ? sanitizeWorkspacePath(subPrefix) : { ok: true as const, path: "" };
    if (!cleanSub.ok) {
      throw new AppError("BAD_REQUEST", "Invalid prefix", 400);
    }
    const prefix =
      cleanSub.path && cleanSub.path !== "."
        ? `users/${userId}/${cleanSub.path}`
        : `users/${userId}/`;
    const result = await this.bucket.list({ prefix, limit });
    return result.objects.map((obj) => ({
      relativeKey: obj.key.slice(`users/${userId}/`.length),
      size: obj.size,
      uploaded: obj.uploaded.toISOString(),
    }));
  }
}
