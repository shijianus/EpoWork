import fs from "node:fs";
import path from "node:path";
import type { R2BucketLike, R2ObjectBodyLike } from "@ai-workspace/database";

/**
 * Local filesystem implementation of `R2BucketLike` so `ChatService` attachments work offline on Desktop.
 */
export class LocalFileBlobStore implements R2BucketLike {
  constructor(private readonly baseDir: string) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  private resolveSafe(key: string): string {
    const normalized = key.replace(/\\/g, "/").replace(/^\/+/, "");
    const target = path.resolve(this.baseDir, normalized);
    const rel = path.relative(path.resolve(this.baseDir), target);
    if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      throw new Error("Blob key escapes base directory");
    }
    return target;
  }

  async put(
    key: string,
    value: ArrayBuffer | Uint8Array | string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<void> {
    const target = this.resolveSafe(key);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const buf =
      typeof value === "string"
        ? Buffer.from(value, "utf8")
        : value instanceof Uint8Array
          ? Buffer.from(value)
          : Buffer.from(new Uint8Array(value));
    fs.writeFileSync(target, buf);
    if (options?.httpMetadata?.contentType) {
      fs.writeFileSync(
        `${target}.meta.json`,
        JSON.stringify({ contentType: options.httpMetadata.contentType }),
      );
    }
  }

  async get(key: string): Promise<R2ObjectBodyLike | null> {
    const target = this.resolveSafe(key);
    if (!fs.existsSync(target)) return null;
    const bytes = fs.readFileSync(target);
    let contentType: string | undefined;
    if (fs.existsSync(`${target}.meta.json`)) {
      try {
        contentType = (
          JSON.parse(fs.readFileSync(`${target}.meta.json`, "utf8")) as { contentType?: string }
        ).contentType;
      } catch {
        contentType = undefined;
      }
    }
    return {
      key,
      size: bytes.byteLength,
      httpMetadata: { contentType },
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
      async text() {
        return bytes.toString("utf8");
      },
    };
  }

  async delete(keys: string | string[]): Promise<void> {
    for (const k of Array.isArray(keys) ? keys : [keys]) {
      const target = this.resolveSafe(k);
      if (fs.existsSync(target)) fs.unlinkSync(target);
      if (fs.existsSync(`${target}.meta.json`)) fs.unlinkSync(`${target}.meta.json`);
    }
  }

  async list(options?: { prefix?: string; limit?: number }) {
    const prefix = options?.prefix ?? "";
    const results: Array<{ key: string; size: number; uploaded: Date }> = [];
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (!entry.name.endsWith(".meta.json")) {
          const rel = path.relative(this.baseDir, full).replace(/\\/g, "/");
          if (rel.startsWith(prefix)) {
            const st = fs.statSync(full);
            results.push({ key: rel, size: st.size, uploaded: st.mtime });
          }
        }
      }
    };
    walk(this.baseDir);
    return { objects: results.slice(0, options?.limit ?? 100) };
  }
}
