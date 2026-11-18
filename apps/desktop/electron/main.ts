import { fork, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ExecutionPolicy } from "@ai-workspace/agent-core";
import {
  ConversationRepository,
  MessageRepository,
  UsageRepository,
  buildChatTools,
} from "@ai-workspace/chat-core";
import { ProviderIdSchema, type AgentEvent, type ProviderId } from "@ai-workspace/contracts";
import { ModelPreferencesRepository } from "@ai-workspace/database";
import {
  DesktopCredentialVault,
  DesktopProjectRepository,
  DesktopRunRepository,
  LOCAL_DESKTOP_USER_ID,
  LocalFileBlobStore,
  createSafeStorageAdapter,
  openDesktopSqlite,
} from "@ai-workspace/desktop-storage";
import {
  LocalProjectExecutor,
  scaffoldLocalProject,
  type WorkerInboundMessage,
  type WorkerOutboundMessage,
} from "@ai-workspace/local-executor";
import { listModels } from "@ai-workspace/model-registry";
import { ProviderRegistry } from "@ai-workspace/providers";
import { createId, createLogger } from "@ai-workspace/shared";
import { BrowserWindow, app, dialog, ipcMain, safeStorage } from "electron";
import { z } from "zod";

const logger = createLogger({ component: "desktop-main" });

let mainWindow: BrowserWindow | null = null;
let executorChild: ChildProcess | null = null;
const chatAborts = new Map<string, AbortController>();

function resolveMigrationsDir(): string {
  const candidates = [
    path.join(app.getAppPath(), "dist/migrations"),
    path.resolve(__dirname, "../migrations"),
    path.resolve(__dirname, "../../../infra/migrations"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  throw new Error(`Migrations directory not found. Checked: ${candidates.join(", ")}`);
}

function resolveExecutorHostPath(): string {
  const packaged = path.join(__dirname, "executor-host.cjs");
  if (fs.existsSync(packaged)) return packaged;
  throw new Error(`Executor host bundle missing at ${packaged}`);
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "EpoCanvas AI Workspace",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  // Block untrusted external window creation & navigation from Renderer
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    const allowedDev = process.env.VITE_DEV_SERVER_URL;
    if (allowedDev && url.startsWith(allowedDev)) return;
    if (url.startsWith("file://")) return;
    event.preventDefault();
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  return win;
}

app.whenReady().then(() => {
  const userDataDir = process.env.EPOCANVAS_USER_DATA || app.getPath("userData");
  fs.mkdirSync(userDataDir, { recursive: true });

  const dbPath = path.join(userDataDir, "epocanvas.sqlite");
  const { db, close: closeDb } = openDesktopSqlite(dbPath, resolveMigrationsDir());
  const vault = new DesktopCredentialVault(
    path.join(userDataDir, "vault.json"),
    createSafeStorageAdapter(safeStorage),
  );
  // Keep blob store initialized for future desktop attachments parity
  new LocalFileBlobStore(path.join(userDataDir, "blobs"));

  const prefsRepo = new ModelPreferencesRepository(db);
  const convRepo = new ConversationRepository(db);
  const msgRepo = new MessageRepository(db);
  const usageRepo = new UsageRepository(db);
  const projectRepo = new DesktopProjectRepository(db);
  const runRepo = new DesktopRunRepository(db);
  const providers = new ProviderRegistry();

  const ensureExecutorChild = (): ChildProcess => {
    if (executorChild && !executorChild.killed && executorChild.connected) {
      return executorChild;
    }
    const hostPath = resolveExecutorHostPath();
    const child = fork(hostPath, ["process-host"], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });

    child.on("message", async (msg: WorkerOutboundMessage) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "event") {
        await runRepo.appendEvent(msg.event);
        if (msg.event.type === "approval.required") {
          await runRepo.updateStatus(msg.event.runId, { status: "waiting_approval" });
        } else if (msg.event.type === "approval.resolved") {
          await runRepo.updateStatus(msg.event.runId, { status: "running" });
        }
        mainWindow?.webContents.send("work:event", msg.event);
      } else if (msg.type === "done") {
        await runRepo.updateStatus(msg.result.runId, {
          status: msg.result.status,
          errorMessage: msg.result.errorMessage ?? null,
          inputTokens: msg.result.inputTokens,
          outputTokens: msg.result.outputTokens,
        });
      } else if (msg.type === "error") {
        await runRepo.updateStatus(msg.runId, {
          status: "failed",
          errorMessage: msg.message,
        });
        const failEvent: AgentEvent = {
          id: createId("evt"),
          runId: msg.runId,
          seq: 9999,
          timestamp: new Date().toISOString(),
          type: "run.failed",
          payload: { error: msg.message },
        };
        mainWindow?.webContents.send("work:event", failEvent);
      }
    });

    child.on("exit", (code) => {
      logger.info("LocalExecutor child exited", { code });
      executorChild = null;
    });

    executorChild = child;
    return child;
  };

  async function resolveDesktopApiKey(providerId: ProviderId): Promise<string> {
    const saved = await vault.getKey(providerId);
    if (saved) return saved;
    const envMap: Record<ProviderId, string | undefined> = {
      openai: process.env.OPENAI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      google: process.env.GEMINI_API_KEY,
    };
    const fromEnv = envMap[providerId]?.trim();
    if (fromEnv) return fromEnv;
    throw new Error(`No API key configured for ${providerId}. Add it in Settings.`);
  }

  // --- App & Settings IPC ---
  ipcMain.handle("app:getInfo", () => ({
    appVersion: app.getVersion(),
    platform: process.platform,
    vaultMode: vault.mode,
    dbPath,
  }));

  ipcMain.handle("settings:get", async () => {
    const prefs = await prefsRepo.getOrDefault(LOCAL_DESKTOP_USER_ID);
    return {
      vaultMode: vault.mode,
      providers: vault.listHints(),
      modelPreferences: {
        defaultProviderId: prefs.default_provider_id as ProviderId,
        defaultModelId: prefs.default_model_id,
        temperature: prefs.temperature,
        reasoningEffort: prefs.reasoning_effort as "low" | "medium" | "high" | null,
      },
    };
  });

  ipcMain.handle("settings:saveApiKey", async (_ev, raw) => {
    const { providerId, apiKey } = z
      .object({ providerId: ProviderIdSchema, apiKey: z.string().min(8).max(512) })
      .parse(raw);
    const saved = await vault.setKey(providerId, apiKey);
    return { providerId: saved.providerId, keyHint: saved.keyHint };
  });

  ipcMain.handle("settings:deleteApiKey", (_ev, raw) => {
    const { providerId } = z.object({ providerId: ProviderIdSchema }).parse(raw);
    return { ok: vault.deleteKey(providerId) };
  });

  ipcMain.handle("settings:saveModelPreferences", async (_ev, raw) => {
    const input = z
      .object({
        defaultProviderId: ProviderIdSchema,
        defaultModelId: z.string().min(1).max(120),
        temperature: z.number().min(0).max(2).nullable().optional(),
        reasoningEffort: z.enum(["low", "medium", "high"]).nullable().optional(),
      })
      .parse(raw);
    await prefsRepo.upsert(LOCAL_DESKTOP_USER_ID, input);
    return { ok: true };
  });

  // --- Chat IPC ---
  ipcMain.handle("chat:models", async () => {
    const configured = new Set<string>(vault.listHints().map((h) => h.providerId));
    if (process.env.OPENAI_API_KEY) configured.add("openai");
    if (process.env.ANTHROPIC_API_KEY) configured.add("anthropic");
    if (process.env.GEMINI_API_KEY) configured.add("google");
    return {
      models: listModels().map((m) => ({
        ...m,
        configured: configured.has(m.providerId),
      })),
    };
  });

  ipcMain.handle("chat:listConversations", async (_ev, raw) => {
    const { q } = z.object({ q: z.string().optional() }).parse(raw ?? {});
    const conversations = await convRepo.listByUser(LOCAL_DESKTOP_USER_ID, { query: q });
    return { conversations };
  });

  ipcMain.handle("chat:createConversation", async (_ev, raw) => {
    const input = z
      .object({
        title: z.string().max(120).optional(),
        providerId: ProviderIdSchema.default("openai"),
        modelId: z.string().min(1).max(120).default("gpt-6.1-sol"),
      })
      .parse(raw ?? {});
    const conversation = await convRepo.create({
      userId: LOCAL_DESKTOP_USER_ID,
      title: input.title ?? "New Chat",
      providerId: input.providerId,
      modelId: input.modelId,
    });
    return { conversation };
  });

  ipcMain.handle("chat:getConversation", async (_ev, raw) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(raw);
    const conversation = await convRepo.findByIdForUser(LOCAL_DESKTOP_USER_ID, id);
    if (!conversation) throw new Error("Conversation not found");
    const messages = await msgRepo.listByConversation(LOCAL_DESKTOP_USER_ID, id);
    return {
      conversation,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: JSON.parse(m.content_json),
        modelId: m.model_id,
        status: m.status,
        seq: m.seq,
        createdAt: m.created_at,
      })),
    };
  });

  ipcMain.handle("chat:renameConversation", async (_ev, raw) => {
    const { id, title } = z
      .object({ id: z.string().min(1), title: z.string().min(1).max(120) })
      .parse(raw);
    await convRepo.updateForUser(LOCAL_DESKTOP_USER_ID, id, { title });
    return { ok: true };
  });

  ipcMain.handle("chat:deleteConversation", async (_ev, raw) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(raw);
    await convRepo.deleteForUser(LOCAL_DESKTOP_USER_ID, id);
    return { ok: true };
  });

  ipcMain.handle("chat:stopStream", (_ev, raw) => {
    const { streamId } = z.object({ streamId: z.string().min(1) }).parse(raw);
    chatAborts.get(streamId)?.abort();
    return { ok: true };
  });

  ipcMain.handle("chat:sendMessage", async (_ev, raw) => {
    const input = z
      .object({
        conversationId: z.string().min(1),
        prompt: z.string().min(1).max(100_000),
        providerId: ProviderIdSchema.optional(),
        modelId: z.string().min(1).max(120).optional(),
        temperature: z.number().min(0).max(2).nullable().optional(),
        reasoningEffort: z.enum(["low", "medium", "high"]).nullable().optional(),
        enableWebSearch: z.boolean().optional(),
      })
      .parse(raw);

    const conv = await convRepo.findByIdForUser(LOCAL_DESKTOP_USER_ID, input.conversationId);
    if (!conv) throw new Error("Conversation not found");

    const providerId = (input.providerId ?? conv.provider_id) as ProviderId;
    const modelId = input.modelId ?? conv.model_id;
    const apiKey = await resolveDesktopApiKey(providerId);

    const streamId = createId("str");
    const ac = new AbortController();
    chatAborts.set(streamId, ac);

    void (async () => {
      const sendStream = (event: Record<string, unknown>) => {
        mainWindow?.webContents.send("chat:stream", {
          streamId,
          conversationId: conv.id,
          event,
        });
      };

      try {
        await msgRepo.append({
          userId: LOCAL_DESKTOP_USER_ID,
          conversationId: conv.id,
          role: "user",
          content: { text: input.prompt },
          status: "completed",
        });

        if (conv.title === "New Chat") {
          await convRepo.updateForUser(LOCAL_DESKTOP_USER_ID, conv.id, {
            title: input.prompt.trim().slice(0, 60),
            providerId,
            modelId,
          });
        }

        const history = await msgRepo.listByConversation(LOCAL_DESKTOP_USER_ID, conv.id);
        const modelMessages = history
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: (JSON.parse(m.content_json) as { text: string }).text,
          }));

        const assistantMsg = await msgRepo.append({
          userId: LOCAL_DESKTOP_USER_ID,
          conversationId: conv.id,
          role: "assistant",
          content: { text: "" },
          modelId,
          status: "streaming",
        });

        sendStream({ type: "message.started", messageId: assistantMsg.id });

        let text = "";
        let reasoning = "";
        let usage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
        let stopped = false;
        const startedAt = Date.now();

        try {
          for await (const part of providers.streamChat(providerId, {
            modelId,
            apiKey,
            messages: modelMessages,
            temperature: input.temperature,
            reasoningEffort: input.reasoningEffort,
            tools: buildChatTools({ enableWebSearch: input.enableWebSearch }),
            signal: ac.signal,
          })) {
            if (part.type === "text-delta") {
              text += part.delta;
              sendStream({ type: "message.delta", delta: part.delta });
            } else if (part.type === "reasoning-delta") {
              reasoning += part.delta;
              sendStream({ type: "reasoning.delta", delta: part.delta });
            } else if (part.type === "tool-call") {
              sendStream({
                type: "tool.call",
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                input: part.input,
              });
            } else if (part.type === "tool-result") {
              sendStream({
                type: "tool.result",
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                output: part.output,
              });
            } else if (part.type === "finish") {
              usage = part.usage;
            }
          }
        } catch (err) {
          if (ac.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
            stopped = true;
          } else {
            await msgRepo.updateContentAndStatus(
              LOCAL_DESKTOP_USER_ID,
              assistantMsg.id,
              { text, ...(reasoning ? { reasoning } : {}) },
              "failed",
            );
            sendStream({
              type: "error",
              message: err instanceof Error ? err.message : String(err),
            });
            return;
          }
        }

        const status = stopped ? "stopped" : "completed";
        await msgRepo.updateContentAndStatus(
          LOCAL_DESKTOP_USER_ID,
          assistantMsg.id,
          { text, ...(reasoning ? { reasoning } : {}) },
          status,
        );
        await convRepo.touch(LOCAL_DESKTOP_USER_ID, conv.id);
        await usageRepo.record({
          userId: LOCAL_DESKTOP_USER_ID,
          providerId,
          modelId,
          operationType: "chat",
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          reasoningTokens: usage.reasoningTokens,
          latencyMs: Date.now() - startedAt,
        });
        sendStream({ type: "message.completed", messageId: assistantMsg.id, status });
      } finally {
        chatAborts.delete(streamId);
      }
    })();

    return { streamId };
  });

  // --- Projects IPC ---
  ipcMain.handle("projects:list", async () => ({
    projects: await projectRepo.list(),
  }));

  ipcMain.handle("projects:pickDirectory", async () => {
    const res = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
    });
    return { path: res.canceled ? null : (res.filePaths[0] ?? null) };
  });

  ipcMain.handle("projects:create", async (_ev, raw) => {
    const input = z
      .object({
        name: z.string().min(1).max(120),
        rootPath: z.string().min(1),
        template: z.enum(["blank", "node-ts", "react-vite"]).default("node-ts"),
      })
      .parse(raw);

    await scaffoldLocalProject(input.rootPath, input.name, input.template);
    const project = await projectRepo.createOrOpen(input);
    return { project };
  });

  ipcMain.handle("projects:remove", async (_ev, raw) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(raw);
    return { ok: await projectRepo.remove(id) };
  });

  ipcMain.handle("projects:listFiles", async (_ev, raw) => {
    const { projectId } = z.object({ projectId: z.string().min(1) }).parse(raw);
    const prj = await projectRepo.findById(projectId);
    if (!prj) throw new Error("Project not found");
    const exec = new LocalProjectExecutor(prj.root_path);
    return { files: await exec.listFiles() };
  });

  ipcMain.handle("projects:readFile", async (_ev, raw) => {
    const { projectId, relPath } = z
      .object({ projectId: z.string().min(1), relPath: z.string().min(1) })
      .parse(raw);
    const prj = await projectRepo.findById(projectId);
    if (!prj) throw new Error("Project not found");
    const exec = new LocalProjectExecutor(prj.root_path);
    return { content: await exec.readFile(relPath) };
  });

  ipcMain.handle("projects:writeFile", async (_ev, raw) => {
    const { projectId, relPath, content } = z
      .object({ projectId: z.string().min(1), relPath: z.string().min(1), content: z.string() })
      .parse(raw);
    const prj = await projectRepo.findById(projectId);
    if (!prj) throw new Error("Project not found");
    const exec = new LocalProjectExecutor(prj.root_path);
    await exec.writeFile(relPath, content);
    return { ok: true };
  });

  ipcMain.handle("projects:gitStatus", async (_ev, raw) => {
    const { projectId } = z.object({ projectId: z.string().min(1) }).parse(raw);
    const prj = await projectRepo.findById(projectId);
    if (!prj) throw new Error("Project not found");
    const exec = new LocalProjectExecutor(prj.root_path);
    return exec.gitStatus();
  });

  ipcMain.handle("projects:gitDiff", async (_ev, raw) => {
    const { projectId, relPath } = z
      .object({ projectId: z.string().min(1), relPath: z.string().optional() })
      .parse(raw);
    const prj = await projectRepo.findById(projectId);
    if (!prj) throw new Error("Project not found");
    const exec = new LocalProjectExecutor(prj.root_path);
    return { diff: await exec.gitDiff(relPath) };
  });

  ipcMain.handle("projects:execBuild", async (_ev, raw) => {
    const { projectId, command } = z
      .object({ projectId: z.string().min(1), command: z.string().min(1).max(300) })
      .parse(raw);
    const prj = await projectRepo.findById(projectId);
    if (!prj) throw new Error("Project not found");
    const decision = new ExecutionPolicy().evaluate("run_command", { command });
    if (decision.action === "deny") {
      throw new Error(decision.reason);
    }
    const exec = new LocalProjectExecutor(prj.root_path);
    return exec.execCommand(command, 90_000);
  });

  // --- Work Agent IPC (runs in isolated LocalExecutor child process) ---
  ipcMain.handle("work:listRuns", async () => ({
    runs: await runRepo.list(),
  }));

  ipcMain.handle("work:getRun", async (_ev, raw) => {
    const { runId } = z.object({ runId: z.string().min(1) }).parse(raw);
    const run = await runRepo.findById(runId);
    if (!run) throw new Error("Run not found");
    const events = await runRepo.listEvents(runId);
    return { run, events };
  });

  ipcMain.handle("work:startRun", async (_ev, raw) => {
    const input = z
      .object({
        projectId: z.string().min(1),
        providerId: ProviderIdSchema,
        modelId: z.string().min(1),
        prompt: z.string().min(1).max(50_000),
        requireApprovalForWrites: z.boolean().optional(),
      })
      .parse(raw);

    const prj = await projectRepo.findById(input.projectId);
    if (!prj) throw new Error("Project not found");
    const apiKey = await resolveDesktopApiKey(input.providerId);
    const run = await runRepo.create({
      projectId: prj.id,
      harnessId: "native-local",
      modelId: input.modelId,
      prompt: input.prompt,
    });

    const child = ensureExecutorChild();
    const msg: WorkerInboundMessage = {
      type: "start",
      runId: run.id,
      projectId: prj.id,
      projectRoot: prj.root_path,
      providerId: input.providerId,
      modelId: input.modelId,
      apiKey,
      prompt: input.prompt,
      requireApprovalForWrites: input.requireApprovalForWrites,
    };
    child.send(msg);
    return { runId: run.id };
  });

  ipcMain.handle("work:approve", (_ev, raw) => {
    const { approvalId, decision } = z
      .object({ approvalId: z.string().min(1), decision: z.enum(["approve_once", "reject"]) })
      .parse(raw);
    const child = ensureExecutorChild();
    child.send({ type: "approve", approvalId, decision } satisfies WorkerInboundMessage);
    return { ok: true };
  });

  ipcMain.handle("work:cancel", async (_ev, raw) => {
    const { runId } = z.object({ runId: z.string().min(1) }).parse(raw);
    const child = ensureExecutorChild();
    child.send({ type: "cancel", runId } satisfies WorkerInboundMessage);
    await runRepo.updateStatus(runId, { status: "cancelled" });
    return { ok: true };
  });

  mainWindow = createWindow();

  app.on("before-quit", () => {
    executorChild?.kill();
    closeDb();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
});
