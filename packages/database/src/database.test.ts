import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AuditLogRepository,
  ProviderConnectionRepository,
  UserRepository,
  UserScopedR2Storage,
  type D1DatabaseLike,
  type D1PreparedStatementLike,
  type R2BucketLike,
} from "./index.js";

function createSqliteD1(): D1DatabaseLike {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const migrationSql = readFileSync(
    resolve(__dirname, "../../../infra/migrations/0001_initial.sql"),
    "utf8",
  );
  const migration2Sql = readFileSync(
    resolve(__dirname, "../../../infra/migrations/0002_free_tier_budgets.sql"),
    "utf8",
  );
  sqlite.exec(migrationSql);
  sqlite.exec(migration2Sql);

  const makeStmt = (sql: string, params: unknown[] = []): D1PreparedStatementLike => ({
    bind: (...values: unknown[]) => makeStmt(sql, values),
    first: async <T>(colName?: string): Promise<T | null> => {
      const row = sqlite.prepare(sql).get(...(params as never[])) as
        Record<string, unknown> | undefined;
      if (!row) return null;
      if (colName) return (row[colName] as T) ?? null;
      return row as T;
    },
    all: async <T>() => {
      const rows = sqlite.prepare(sql).all(...(params as never[])) as T[];
      return { results: rows };
    },
    run: async () => {
      const info = sqlite.prepare(sql).run(...(params as never[]));
      return { success: true, meta: { changes: Number(info.changes) } };
    },
  });

  return {
    prepare: (query: string) => makeStmt(query),
  };
}

function createMemoryR2(): R2BucketLike {
  const store = new Map<string, { bytes: Uint8Array; contentType?: string; uploaded: Date }>();
  return {
    async put(key, value, options) {
      const bytes =
        typeof value === "string"
          ? new TextEncoder().encode(value)
          : value instanceof Uint8Array
            ? value
            : new Uint8Array(value);
      store.set(key, {
        bytes,
        contentType: options?.httpMetadata?.contentType,
        uploaded: new Date(),
      });
    },
    async get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      return {
        key,
        size: entry.bytes.byteLength,
        httpMetadata: { contentType: entry.contentType },
        async arrayBuffer() {
          return entry.bytes.slice().buffer;
        },
        async text() {
          return new TextDecoder().decode(entry.bytes);
        },
      };
    },
    async delete(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        store.delete(k);
      }
    },
    async list(options) {
      const prefix = options?.prefix ?? "";
      const objects = [...store.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([key, v]) => ({ key, size: v.bytes.byteLength, uploaded: v.uploaded }));
      return { objects };
    },
  };
}

describe("database repositories and R2 isolation", () => {
  it("applies 0001_initial.sql and isolates provider connections by userId", async () => {
    const db = createSqliteD1();
    const users = new UserRepository(db);
    const providers = new ProviderConnectionRepository(db);
    const audits = new AuditLogRepository(db);

    const u1 = await users.create({
      email: "Alice@Example.com",
      displayName: "Alice",
      passwordHash: "hash1",
      passwordSalt: "salt1",
    });
    const u2 = await users.create({
      email: "bob@example.com",
      displayName: "Bob",
      passwordHash: "hash2",
      passwordSalt: "salt2",
    });

    expect(u1.email).toBe("alice@example.com");

    await providers.upsert({
      userId: u1.id,
      providerId: "openai",
      encryptedApiKey: "cipher1",
      keyIv: "iv1",
      keyHint: "sk-p...1111",
    });

    expect(await providers.listByUser(u1.id)).toHaveLength(1);
    expect(await providers.listByUser(u2.id)).toHaveLength(0);
    // User 2 cannot delete User 1's provider key
    expect(await providers.deleteByUserAndProvider(u2.id, "openai")).toBe(false);
    expect(await providers.listByUser(u1.id)).toHaveLength(1);

    await audits.record({
      userId: u1.id,
      action: "provider.upsert",
      resourceType: "provider_connection",
      outcome: "success",
      metadata: { apiKey: "sk-proj-secret1234567890", providerId: "openai" },
    });
    const logs = await audits.listByUser(u1.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.metadata_json).not.toContain("sk-proj-secret");
  });

  it("enforces per-user key prefix isolation in UserScopedR2Storage", async () => {
    const storage = new UserScopedR2Storage(createMemoryR2());
    await storage.putObject("usr_a", "notes/hello.txt", "secret-a", "text/plain");
    await storage.putObject("usr_b", "notes/hello.txt", "secret-b", "text/plain");

    const objA = await storage.getObject("usr_a", "notes/hello.txt");
    const objB = await storage.getObject("usr_b", "notes/hello.txt");
    expect(await objA?.text()).toBe("secret-a");
    expect(await objB?.text()).toBe("secret-b");

    await expect(storage.getObject("usr_a", "../usr_b/notes/hello.txt")).rejects.toThrow();
    expect(await storage.listObjects("usr_a")).toHaveLength(1);
  });
});
