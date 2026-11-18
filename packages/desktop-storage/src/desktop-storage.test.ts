import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConversationRepository, MessageRepository } from "@ai-workspace/chat-core";
import { afterEach, describe, expect, it } from "vitest";
import {
  DesktopCredentialVault,
  DesktopProjectRepository,
  DesktopRunRepository,
  LOCAL_DESKTOP_USER_ID,
  LocalFileBlobStore,
  createLocalAesFallbackAdapter,
  openDesktopSqlite,
} from "./index.js";

const tempDirs: string[] = [];
function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("desktop-storage SQLite repositories and encrypted credential vault", () => {
  it("applies all migrations into local SQLite and persists projects, conversations, and runs", async () => {
    const dir = makeTempDir("epocanvas-db-");
    const migrationsDir = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../infra/migrations",
    );
    const { db, close } = openDesktopSqlite(path.join(dir, "app.sqlite"), migrationsDir);

    try {
      const projects = new DesktopProjectRepository(db);
      const prj = await projects.createOrOpen({
        name: "My App",
        rootPath: path.join(dir, "my-app"),
        template: "react-vite",
      });
      expect((await projects.list())[0]?.id).toBe(prj.id);

      const convs = new ConversationRepository(db);
      const msgs = new MessageRepository(db);
      const conv = await convs.create({
        userId: LOCAL_DESKTOP_USER_ID,
        title: "Local Chat",
        providerId: "openai",
        modelId: "gpt-6.1-sol",
      });
      await msgs.append({
        userId: LOCAL_DESKTOP_USER_ID,
        conversationId: conv.id,
        role: "user",
        content: { text: "Hello offline DB" },
      });
      expect(await msgs.listByConversation(LOCAL_DESKTOP_USER_ID, conv.id)).toHaveLength(1);

      const runs = new DesktopRunRepository(db);
      const run = await runs.create({
        projectId: prj.id,
        harnessId: "native-local",
        modelId: "gpt-6.1-sol",
        prompt: "Create index.html",
      });
      await runs.appendEvent({
        id: "evt_1",
        runId: run.id,
        seq: 0,
        timestamp: new Date().toISOString(),
        type: "run.started",
        payload: { rootPath: prj.root_path },
      });
      expect(await runs.listEvents(run.id)).toHaveLength(1);
    } finally {
      close();
    }
  });

  it("encrypts provider API keys without writing plaintext to vault file", async () => {
    const dir = makeTempDir("epocanvas-vault-");
    const vaultPath = path.join(dir, "vault.json");
    const vault = new DesktopCredentialVault(vaultPath, createLocalAesFallbackAdapter("test-seed"));

    await vault.setKey("openai", "sk-proj-secret-desktop-1234");
    const rawFile = fs.readFileSync(vaultPath, "utf8");
    expect(rawFile).not.toContain("sk-proj-secret-desktop-1234");
    expect(await vault.getKey("openai")).toBe("sk-proj-secret-desktop-1234");
    expect(vault.listHints()[0]?.keyHint).toBe("sk-p...1234");

    expect(vault.deleteKey("openai")).toBe(true);
    expect(await vault.getKey("openai")).toBeNull();
  });

  it("stores and reads blobs locally via LocalFileBlobStore", async () => {
    const dir = makeTempDir("epocanvas-blobs-");
    const store = new LocalFileBlobStore(dir);
    await store.put("users/u1/test.txt", "hello-blob", {
      httpMetadata: { contentType: "text/plain" },
    });
    const obj = await store.get("users/u1/test.txt");
    expect(await obj?.text()).toBe("hello-blob");
  });
});
