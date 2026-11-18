import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { D1DatabaseLike, D1PreparedStatementLike, R2BucketLike } from "@ai-workspace/database";
import { describe, expect, it } from "vitest";
import { createWorkerApp, type WorkerEnv } from "../../apps/web/src/worker/index.js";

const TEST_MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function createTestEnv(): { env: WorkerEnv; r2Keys: () => string[] } {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const __dirname = dirname(fileURLToPath(import.meta.url));
  sqlite.exec(readFileSync(resolve(__dirname, "../../infra/migrations/0001_initial.sql"), "utf8"));
  sqlite.exec(
    readFileSync(resolve(__dirname, "../../infra/migrations/0002_free_tier_budgets.sql"), "utf8"),
  );

  const makeStmt = (sql: string, params: unknown[] = []): D1PreparedStatementLike => ({
    bind: (...values: unknown[]) => makeStmt(sql, values),
    first: async <T>(colName?: string): Promise<T | null> => {
      const row = sqlite.prepare(sql).get(...(params as never[])) as
        Record<string, unknown> | undefined;
      if (!row) return null;
      if (colName) return (row[colName] as T) ?? null;
      return row as T;
    },
    all: async <T>() => ({ results: sqlite.prepare(sql).all(...(params as never[])) as T[] }),
    run: async () => {
      const info = sqlite.prepare(sql).run(...(params as never[]));
      return { success: true, meta: { changes: Number(info.changes) } };
    },
  });

  const db: D1DatabaseLike = { prepare: (q: string) => makeStmt(q) };

  const r2Store = new Map<string, { bytes: Uint8Array; contentType?: string; uploaded: Date }>();
  const storage: R2BucketLike = {
    async put(key, value, options) {
      const bytes =
        typeof value === "string"
          ? new TextEncoder().encode(value)
          : value instanceof Uint8Array
            ? value
            : new Uint8Array(value);
      r2Store.set(key, {
        bytes,
        contentType: options?.httpMetadata?.contentType,
        uploaded: new Date(),
      });
    },
    async get(key) {
      const entry = r2Store.get(key);
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
      for (const k of Array.isArray(keys) ? keys : [keys]) r2Store.delete(k);
    },
    async list(options) {
      const prefix = options?.prefix ?? "";
      return {
        objects: [...r2Store.entries()]
          .filter(([k]) => k.startsWith(prefix))
          .map(([key, v]) => ({ key, size: v.bytes.byteLength, uploaded: v.uploaded })),
      };
    },
  };

  return {
    r2Keys: () => [...r2Store.keys()],
    env: {
      APP_ENV: "test",
      ENCRYPTION_MASTER_KEY: TEST_MASTER_KEY,
      DB: db as WorkerEnv["DB"],
      STORAGE: storage as WorkerEnv["STORAGE"],
    },
  };
}

function getCookie(res: Response): string {
  const m = (res.headers.get("set-cookie") ?? "").match(/aiw_session=([^;]+)/);
  if (!m) throw new Error("Missing session cookie");
  return `aiw_session=${m[1]}`;
}

describe("P2 chat HTTP routes, file uploads, and tenant isolation", () => {
  it("lists verified models, manages conversations, enforces file validation, and isolates users", async () => {
    const app = createWorkerApp();
    const { env, r2Keys } = createTestEnv();

    // Unauthenticated chat routes return 401
    expect((await app.request("/api/chat/models", {}, env)).status).toBe(401);

    // Register User A & User B
    const regA = await app.request(
      "/api/auth/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "chat-a@example.com",
          password: "password-1234",
          displayName: "Chat A",
        }),
      },
      env,
    );
    const cookieA = getCookie(regA);
    const csrfA = ((await regA.json()) as { csrfToken: string }).csrfToken;

    const regB = await app.request(
      "/api/auth/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "chat-b@example.com",
          password: "password-1234",
          displayName: "Chat B",
        }),
      },
      env,
    );
    const cookieB = getCookie(regB);
    const csrfB = ((await regB.json()) as { csrfToken: string }).csrfToken;

    // Models endpoint returns verified model list
    const modelsRes = await app.request("/api/chat/models", { headers: { Cookie: cookieA } }, env);
    expect(modelsRes.status).toBe(200);
    const modelsBody = (await modelsRes.json()) as { models: Array<{ id: string }> };
    expect(modelsBody.models.some((m) => m.id === "gpt-6.1-sol")).toBe(true);
    expect(modelsBody.models.some((m) => m.id === "claude-sonnet-5-5")).toBe(true);
    expect(modelsBody.models.some((m) => m.id === "gemini-4-hydrogen")).toBe(true);

    // Create & rename conversation
    const createRes = await app.request(
      "/api/chat/conversations",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieA, "X-CSRF-Token": csrfA },
        body: JSON.stringify({
          title: "Architecture Q&A",
          providerId: "openai",
          modelId: "gpt-6.1-sol",
        }),
      },
      env,
    );
    expect(createRes.status).toBe(201);
    const { conversation } = (await createRes.json()) as { conversation: { id: string } };

    // User B cannot view or delete User A's conversation
    expect(
      (
        await app.request(
          `/api/chat/conversations/${conversation.id}`,
          { headers: { Cookie: cookieB } },
          env,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(
          `/api/chat/conversations/${conversation.id}`,
          { method: "DELETE", headers: { Cookie: cookieB, "X-CSRF-Token": csrfB } },
          env,
        )
      ).status,
    ).toBe(404);

    // Reject disallowed MIME upload (e.g. application/x-msdownload)
    const badForm = new FormData();
    badForm.append("file", new File(["MZ"], "evil.exe", { type: "application/x-msdownload" }));
    const badUpload = await app.request(
      "/api/files/upload",
      { method: "POST", headers: { Cookie: cookieA, "X-CSRF-Token": csrfA }, body: badForm },
      env,
    );
    expect(badUpload.status).toBe(400);

    // Valid text attachment upload linked to conversation
    const goodForm = new FormData();
    goodForm.append("file", new File(["hello attachment"], "notes.txt", { type: "text/plain" }));
    goodForm.append("conversationId", conversation.id);
    const goodUpload = await app.request(
      "/api/files/upload",
      { method: "POST", headers: { Cookie: cookieA, "X-CSRF-Token": csrfA }, body: goodForm },
      env,
    );
    expect(goodUpload.status).toBe(201);
    const { artifact } = (await goodUpload.json()) as { artifact: { id: string } };
    expect(r2Keys().length).toBe(1);

    // User B cannot fetch User A's attachment
    expect(
      (await app.request(`/api/files/${artifact.id}`, { headers: { Cookie: cookieB } }, env))
        .status,
    ).toBe(404);

    // Sending message without provider API key returns explicit SSE error event (not 500 crash)
    const missingKeyRes = await app.request(
      `/api/chat/conversations/${conversation.id}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieA, "X-CSRF-Token": csrfA },
        body: JSON.stringify({ prompt: "Hello!" }),
      },
      env,
    );
    expect(missingKeyRes.status).toBe(200);
    const sseText = await missingKeyRes.text();
    expect(sseText).toContain("No API key configured for provider");

    // Deleting conversation cleans up linked R2 attachment blob
    const delRes = await app.request(
      `/api/chat/conversations/${conversation.id}`,
      { method: "DELETE", headers: { Cookie: cookieA, "X-CSRF-Token": csrfA } },
      env,
    );
    expect(delRes.status).toBe(200);
    expect(r2Keys().length).toBe(0);
  });
});
