import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { decryptSecret } from "@ai-workspace/auth";
import type { D1DatabaseLike, D1PreparedStatementLike, R2BucketLike } from "@ai-workspace/database";
import { describe, expect, it } from "vitest";
import { createWorkerApp, type WorkerEnv } from "../../apps/web/src/worker/index.js";

const TEST_MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function createTestEnv(): { env: WorkerEnv; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const migrationSql = readFileSync(
    resolve(__dirname, "../../infra/migrations/0001_initial.sql"),
    "utf8",
  );
  const migration2Sql = readFileSync(
    resolve(__dirname, "../../infra/migrations/0002_free_tier_budgets.sql"),
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

  const db: D1DatabaseLike = {
    prepare: (query: string) => makeStmt(query),
  };

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
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        r2Store.delete(k);
      }
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
    sqlite,
    env: {
      APP_ENV: "test",
      ENCRYPTION_MASTER_KEY: TEST_MASTER_KEY,
      DB: db as WorkerEnv["DB"],
      STORAGE: storage as WorkerEnv["STORAGE"],
    },
  };
}

function extractSessionCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/aiw_session=([^;]+)/);
  if (!match) {
    throw new Error(`Missing aiw_session cookie in: ${setCookie}`);
  }
  return `aiw_session=${match[1]}`;
}

describe("P1 auth, settings, encrypted BYOK keys, and tenant-isolated R2 API", () => {
  it("blocks unauthenticated access to protected routes", async () => {
    const app = createWorkerApp();
    const { env } = createTestEnv();

    for (const path of ["/api/auth/me", "/api/settings", "/api/storage/objects"]) {
      const res = await app.request(path, {}, env);
      expect(res.status).toBe(401);
    }
  });

  it("supports register, login, CSRF enforcement, encrypted API key lifecycle, and logout", async () => {
    const app = createWorkerApp();
    const { env, sqlite } = createTestEnv();

    // Register User A
    const regRes = await app.request(
      "/api/auth/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "alice@example.com",
          password: "strong-password-123",
          displayName: "Alice",
        }),
      },
      env,
    );
    expect(regRes.status).toBe(201);
    const regData = (await regRes.json()) as {
      user: { id: string; email: string };
      csrfToken: string;
    };
    const cookieA = extractSessionCookie(regRes);
    const csrfA = regData.csrfToken;

    // Duplicate registration fails with 409
    const dupRes = await app.request(
      "/api/auth/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "alice@example.com",
          password: "strong-password-123",
          displayName: "Alice2",
        }),
      },
      env,
    );
    expect(dupRes.status).toBe(409);

    // Mutating request without CSRF token is rejected (403)
    const missingCsrfRes = await app.request(
      "/api/settings/profile",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookieA },
        body: JSON.stringify({ displayName: "Alice Updated" }),
      },
      env,
    );
    expect(missingCsrfRes.status).toBe(403);

    // Mutating request with valid CSRF updates profile
    const profileRes = await app.request(
      "/api/settings/profile",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookieA, "X-CSRF-Token": csrfA },
        body: JSON.stringify({ displayName: "Alice Updated", themePreference: "dark" }),
      },
      env,
    );
    expect(profileRes.status).toBe(200);

    // Save OpenAI BYOK key
    const rawApiKey = "sk-proj-my-real-secret-value-9876";
    const putKeyRes = await app.request(
      "/api/settings/providers/openai",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookieA, "X-CSRF-Token": csrfA },
        body: JSON.stringify({ apiKey: rawApiKey }),
      },
      env,
    );
    expect(putKeyRes.status).toBe(200);
    const putKeyJson = (await putKeyRes.json()) as { provider: { keyHint: string } };
    expect(putKeyJson.provider.keyHint).toBe("sk-p...9876");

    // Verify DB does NOT store plaintext key and decryptSecret recovers original key
    const dbRow = sqlite
      .prepare("SELECT encrypted_api_key, key_iv FROM provider_connections WHERE user_id = ?")
      .get(regData.user.id) as { encrypted_api_key: string; key_iv: string };
    expect(dbRow.encrypted_api_key).not.toContain(rawApiKey);
    const decrypted = await decryptSecret(
      dbRow.encrypted_api_key,
      dbRow.key_iv,
      TEST_MASTER_KEY,
      `${regData.user.id}:openai`,
    );
    expect(decrypted).toBe(rawApiKey);

    // GET /api/settings returns masked hint only, never raw key
    const settingsRes = await app.request("/api/settings", { headers: { Cookie: cookieA } }, env);
    expect(settingsRes.status).toBe(200);
    const settingsText = await settingsRes.text();
    expect(settingsText).not.toContain(rawApiKey);
    expect(settingsText).toContain("sk-p...9876");

    // Register User B and verify isolation (User B sees 0 providers & cannot read User A's R2 objects)
    const regBRes = await app.request(
      "/api/auth/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "bob@example.com",
          password: "bob-password-123",
          displayName: "Bob",
        }),
      },
      env,
    );
    const regBData = (await regBRes.json()) as { csrfToken: string };
    const cookieB = extractSessionCookie(regBRes);

    // User A uploads R2 object
    const putObjRes = await app.request(
      "/api/storage/objects/notes/plan.txt",
      {
        method: "PUT",
        headers: { "Content-Type": "text/plain", Cookie: cookieA, "X-CSRF-Token": csrfA },
        body: "alice confidential plan",
      },
      env,
    );
    expect(putObjRes.status).toBe(201);

    // User B requesting same relative path gets 404 (isolated under users/<bobId>/...)
    const bobGetRes = await app.request(
      "/api/storage/objects/notes/plan.txt",
      { headers: { Cookie: cookieB } },
      env,
    );
    expect(bobGetRes.status).toBe(404);

    // User B traversal attempt is rejected
    const bobTravRes = await app.request(
      `/api/storage/objects/..%2F${regData.user.id}%2Fnotes%2Fplan.txt`,
      { headers: { Cookie: cookieB } },
      env,
    );
    expect(bobTravRes.status).toBe(400);

    // User B settings show 0 providers
    const bobSettingsRes = await app.request(
      "/api/settings",
      { headers: { Cookie: cookieB } },
      env,
    );
    const bobSettings = (await bobSettingsRes.json()) as { providers: unknown[] };
    expect(bobSettings.providers).toHaveLength(0);

    // Delete key for User A
    const delKeyRes = await app.request(
      "/api/settings/providers/openai",
      { method: "DELETE", headers: { Cookie: cookieA, "X-CSRF-Token": csrfA } },
      env,
    );
    expect(delKeyRes.status).toBe(200);

    // Logout User A -> subsequent /api/auth/me returns 401
    const logoutRes = await app.request(
      "/api/auth/logout",
      { method: "POST", headers: { Cookie: cookieA, "X-CSRF-Token": csrfA } },
      env,
    );
    expect(logoutRes.status).toBe(200);

    const afterLogoutRes = await app.request("/api/auth/me", { headers: { Cookie: cookieA } }, env);
    expect(afterLogoutRes.status).toBe(401);

    // Wrong password login fails with 401, valid password login succeeds
    const badLoginRes = await app.request(
      "/api/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "bob@example.com", password: "wrong" }),
      },
      env,
    );
    expect(badLoginRes.status).toBe(401);

    const goodLoginRes = await app.request(
      "/api/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "bob@example.com", password: "bob-password-123" }),
      },
      env,
    );
    expect(goodLoginRes.status).toBe(200);
    expect(regBData.csrfToken).toBeTruthy();
  });

  it("enforces Free-tier budgets: upload size cap, R2 quota tracking & delete cleanup, and fail-closed production secrets", async () => {
    const app = createWorkerApp();
    const { env } = createTestEnv();

    const regRes = await app.request(
      "/api/auth/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "quota@example.com",
          password: "quota-password-123",
          displayName: "Quota User",
        }),
      },
      env,
    );
    const { csrfToken } = (await regRes.json()) as { csrfToken: string };
    const cookie = extractSessionCookie(regRes);

    // Oversized Content-Length (> 10 MB) is rejected immediately before buffering
    const tooLargeRes = await app.request(
      "/api/storage/objects/huge.bin",
      {
        method: "PUT",
        headers: {
          Cookie: cookie,
          "X-CSRF-Token": csrfToken,
          "Content-Length": String(11 * 1024 * 1024),
        },
        body: "small-body-with-huge-declared-length",
      },
      env,
    );
    expect(tooLargeRes.status).toBe(400);

    // Upload tracks usage in D1 and delete decrements usage
    const putRes = await app.request(
      "/api/storage/objects/doc.txt",
      {
        method: "PUT",
        headers: { Cookie: cookie, "X-CSRF-Token": csrfToken, "Content-Type": "text/plain" },
        body: "1234567890",
      },
      env,
    );
    expect(putRes.status).toBe(201);

    const list1 = (await (
      await app.request("/api/storage/objects", { headers: { Cookie: cookie } }, env)
    ).json()) as { usage: { totalBytes: number; objectCount: number } };
    expect(list1.usage.totalBytes).toBe(10);
    expect(list1.usage.objectCount).toBe(1);

    await app.request(
      "/api/storage/objects/doc.txt",
      { method: "DELETE", headers: { Cookie: cookie, "X-CSRF-Token": csrfToken } },
      env,
    );
    const list2 = (await (
      await app.request("/api/storage/objects", { headers: { Cookie: cookie } }, env)
    ).json()) as { usage: { totalBytes: number; objectCount: number } };
    expect(list2.usage.totalBytes).toBe(0);
    expect(list2.usage.objectCount).toBe(0);

    // Non-local production env without ENCRYPTION_MASTER_KEY fails closed (500)
    const prodEnv: WorkerEnv = { ...env, APP_ENV: "production", ENCRYPTION_MASTER_KEY: undefined };
    const failClosedRes = await app.request(
      "https://workspace.example.com/api/settings/providers/openai",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrfToken },
        body: JSON.stringify({ apiKey: "sk-proj-should-fail-closed" }),
      },
      prodEnv,
    );
    expect(failClosedRes.status).toBe(500);
  });
});
