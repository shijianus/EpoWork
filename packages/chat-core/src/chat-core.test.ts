import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { encryptSecret, hashPassword } from "@ai-workspace/auth";
import {
  ProviderConnectionRepository,
  UserRepository,
  type D1DatabaseLike,
  type D1PreparedStatementLike,
  type R2BucketLike,
} from "@ai-workspace/database";
import { ProviderRegistry, type NormalizedStreamEvent } from "@ai-workspace/providers";
import { describe, expect, it } from "vitest";
import {
  ChatService,
  ConversationRepository,
  MessageRepository,
  UsageRepository,
} from "./index.js";

const TEST_MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function createSqliteD1(): D1DatabaseLike {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const __dirname = dirname(fileURLToPath(import.meta.url));
  sqlite.exec(
    readFileSync(resolve(__dirname, "../../../infra/migrations/0001_initial.sql"), "utf8"),
  );
  sqlite.exec(
    readFileSync(
      resolve(__dirname, "../../../infra/migrations/0002_free_tier_budgets.sql"),
      "utf8",
    ),
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

  return { prepare: (q: string) => makeStmt(q) };
}

function createMemoryR2(): R2BucketLike {
  const map = new Map<string, Uint8Array>();
  return {
    async put(key, val) {
      map.set(
        key,
        typeof val === "string"
          ? new TextEncoder().encode(val)
          : val instanceof Uint8Array
            ? val
            : new Uint8Array(val),
      );
    },
    async get(key) {
      const bytes = map.get(key);
      if (!bytes) return null;
      return {
        key,
        size: bytes.byteLength,
        async arrayBuffer() {
          return bytes.slice().buffer;
        },
        async text() {
          return new TextDecoder().decode(bytes);
        },
      };
    },
    async delete(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) map.delete(k);
    },
    async list() {
      return { objects: [] };
    },
  };
}

describe("chat-core persistence, isolation, streaming, edit & stop", () => {
  it("isolates conversations across users, edits messages with truncation, and records stopped partial turns + usage", async () => {
    const db = createSqliteD1();
    const r2 = createMemoryR2();
    const users = new UserRepository(db);
    const { hash, salt } = await hashPassword("secret-pass-123");
    const alice = await users.create({
      email: "alice@example.com",
      displayName: "Alice",
      passwordHash: hash,
      passwordSalt: salt,
    });
    const bob = await users.create({
      email: "bob@example.com",
      displayName: "Bob",
      passwordHash: hash,
      passwordSalt: salt,
    });

    const providerRepo = new ProviderConnectionRepository(db);
    const enc = await encryptSecret("sk-test-key-1234", TEST_MASTER_KEY, `${alice.id}:openai`);
    await providerRepo.upsert({
      userId: alice.id,
      providerId: "openai",
      encryptedApiKey: enc.ciphertext,
      keyIv: enc.iv,
      keyHint: "sk-t...1234",
    });

    // Controlled deterministic ProviderRegistry subclass for unit testing stream lifecycle & abort
    class FakeStreamProviderRegistry extends ProviderRegistry {
      override async *streamChat(
        _providerId: "openai" | "anthropic" | "google",
        req: { signal?: AbortSignal },
      ): AsyncGenerator<NormalizedStreamEvent> {
        yield { type: "text-delta", delta: "Hello " };
        if (req.signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        yield { type: "text-delta", delta: "world!" };
        yield {
          type: "finish",
          finishReason: "stop",
          usage: { inputTokens: 12, outputTokens: 8, reasoningTokens: 0 },
        };
      }
    }

    const convRepo = new ConversationRepository(db);
    const msgRepo = new MessageRepository(db);
    const usageRepo = new UsageRepository(db);
    const chat = new ChatService(db, r2, new FakeStreamProviderRegistry());

    const conv = await convRepo.create({
      userId: alice.id,
      title: "New Chat",
      providerId: "openai",
      modelId: "gpt-6.1-sol",
    });

    // Bob cannot read or delete Alice's conversation
    expect(await convRepo.findByIdForUser(bob.id, conv.id)).toBeNull();
    expect(await convRepo.deleteForUser(bob.id, conv.id)).toBe(false);

    // Run turn 1
    const events1 = [];
    for await (const ev of chat.streamTurn({
      userId: alice.id,
      conversationId: conv.id,
      prompt: "Say hello world",
      masterKeyHex: TEST_MASTER_KEY,
    })) {
      events1.push(ev);
    }
    expect(events1.some((e) => e.type === "message.completed" && e.status === "completed")).toBe(
      true,
    );

    const msgsAfter1 = await msgRepo.listByConversation(alice.id, conv.id);
    expect(msgsAfter1).toHaveLength(2);
    expect(JSON.parse(msgsAfter1[1]!.content_json).text).toBe("Hello world!");
    expect((await usageRepo.listByUser(alice.id)).length).toBe(1);

    // Edit user message -> truncates assistant message
    const edited = await msgRepo.editUserMessageAndTruncateAfter(
      alice.id,
      conv.id,
      msgsAfter1[0]!.id,
      "Edited prompt",
    );
    expect(JSON.parse(edited.content_json).text).toBe("Edited prompt");
    expect(await msgRepo.listByConversation(alice.id, conv.id)).toHaveLength(1);

    // Stop generation mid-stream saves partial text with status "stopped"
    const ac = new AbortController();
    const events2 = [];
    for await (const ev of chat.streamTurn({
      userId: alice.id,
      conversationId: conv.id,
      prompt: "Edited prompt",
      skipUserAppend: true,
      signal: ac.signal,
      masterKeyHex: TEST_MASTER_KEY,
    })) {
      events2.push(ev);
      if (ev.type === "message.delta") {
        ac.abort();
      }
    }
    expect(events2.some((e) => e.type === "message.completed" && e.status === "stopped")).toBe(
      true,
    );
    const msgsAfterStop = await msgRepo.listByConversation(alice.id, conv.id);
    expect(msgsAfterStop[1]?.status).toBe("stopped");
    expect(JSON.parse(msgsAfterStop[1]!.content_json).text).toBe("Hello ");
  });
});
