import type { AgentEvent, ProviderId } from "@ai-workspace/contracts";
import { contextBridge, ipcRenderer } from "electron";

export interface DesktopBridge {
  getInfo(): Promise<{
    appVersion: string;
    platform: string;
    vaultMode: string;
    dbPath: string;
  }>;
  settings: {
    get(): Promise<{
      vaultMode: string;
      providers: Array<{
        providerId: ProviderId;
        keyHint: string;
        mode: string;
        updatedAt: string;
      }>;
      modelPreferences: {
        defaultProviderId: ProviderId;
        defaultModelId: string;
        temperature: number | null;
        reasoningEffort: "low" | "medium" | "high" | null;
      };
    }>;
    saveApiKey(
      providerId: ProviderId,
      apiKey: string,
    ): Promise<{ providerId: ProviderId; keyHint: string }>;
    deleteApiKey(providerId: ProviderId): Promise<{ ok: boolean }>;
    saveModelPreferences(input: {
      defaultProviderId: ProviderId;
      defaultModelId: string;
      temperature?: number | null;
      reasoningEffort?: "low" | "medium" | "high" | null;
    }): Promise<{ ok: boolean }>;
  };
  chat: {
    models(): Promise<{
      models: Array<{
        id: string;
        providerId: ProviderId;
        displayName: string;
        description?: string;
        supportsTemperature: boolean;
        capabilities: {
          streaming: boolean;
          toolCalling: boolean;
          imageInput: boolean;
          reasoningControl: boolean;
          contextWindow: number;
        };
        configured: boolean;
      }>;
    }>;
    listConversations(q?: string): Promise<{
      conversations: Array<{
        id: string;
        title: string;
        provider_id: string;
        model_id: string;
        updated_at: string;
      }>;
    }>;
    createConversation(input: {
      title?: string;
      providerId: ProviderId;
      modelId: string;
    }): Promise<{
      conversation: { id: string; title: string; provider_id: string; model_id: string };
    }>;
    getConversation(id: string): Promise<{
      conversation: { id: string; title: string; provider_id: string; model_id: string };
      messages: Array<{
        id: string;
        role: "user" | "assistant" | "system";
        content: { text: string; reasoning?: string };
        modelId: string | null;
        status: string;
        seq: number;
        createdAt: string;
      }>;
    }>;
    renameConversation(id: string, title: string): Promise<{ ok: boolean }>;
    deleteConversation(id: string): Promise<{ ok: boolean }>;
    sendMessage(input: {
      conversationId: string;
      prompt: string;
      providerId?: ProviderId;
      modelId?: string;
      temperature?: number | null;
      reasoningEffort?: "low" | "medium" | "high" | null;
      enableWebSearch?: boolean;
    }): Promise<{ streamId: string }>;
    stopStream(streamId: string): Promise<{ ok: boolean }>;
    onStreamEvent(
      listener: (payload: {
        streamId: string;
        conversationId: string;
        event: {
          type: string;
          messageId?: string;
          delta?: string;
          toolCallId?: string;
          toolName?: string;
          input?: unknown;
          output?: unknown;
          message?: string;
          status?: string;
        };
      }) => void,
    ): () => void;
  };
  projects: {
    list(): Promise<{
      projects: Array<{
        id: string;
        name: string;
        root_path: string;
        template: string;
        updated_at: string;
      }>;
    }>;
    pickDirectory(): Promise<{ path: string | null }>;
    create(input: {
      name: string;
      rootPath: string;
      template: "blank" | "node-ts" | "react-vite";
    }): Promise<{
      project: { id: string; name: string; root_path: string; template: string };
    }>;
    remove(id: string): Promise<{ ok: boolean }>;
    listFiles(projectId: string): Promise<{ files: string[] }>;
    readFile(projectId: string, relPath: string): Promise<{ content: string }>;
    writeFile(projectId: string, relPath: string, content: string): Promise<{ ok: boolean }>;
    gitStatus(projectId: string): Promise<{ stdout: string; clean: boolean }>;
    gitDiff(projectId: string, relPath?: string): Promise<{ diff: string }>;
    execBuild(
      projectId: string,
      command: string,
    ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  };
  work: {
    listRuns(): Promise<{
      runs: Array<{
        id: string;
        project_id: string | null;
        model_id: string;
        status: string;
        prompt: string;
        error_message: string | null;
        created_at: string;
      }>;
    }>;
    getRun(runId: string): Promise<{
      run: {
        id: string;
        project_id: string | null;
        model_id: string;
        status: string;
        prompt: string;
        error_message: string | null;
      };
      events: AgentEvent[];
    }>;
    startRun(input: {
      projectId: string;
      providerId: ProviderId;
      modelId: string;
      prompt: string;
      requireApprovalForWrites?: boolean;
    }): Promise<{ runId: string }>;
    approve(approvalId: string, decision: "approve_once" | "reject"): Promise<{ ok: boolean }>;
    cancel(runId: string): Promise<{ ok: boolean }>;
    onWorkEvent(listener: (event: AgentEvent) => void): () => void;
  };
}

const bridge: DesktopBridge = {
  getInfo: () => ipcRenderer.invoke("app:getInfo"),
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    saveApiKey: (providerId, apiKey) =>
      ipcRenderer.invoke("settings:saveApiKey", { providerId, apiKey }),
    deleteApiKey: (providerId) => ipcRenderer.invoke("settings:deleteApiKey", { providerId }),
    saveModelPreferences: (input) => ipcRenderer.invoke("settings:saveModelPreferences", input),
  },
  chat: {
    models: () => ipcRenderer.invoke("chat:models"),
    listConversations: (q) => ipcRenderer.invoke("chat:listConversations", { q }),
    createConversation: (input) => ipcRenderer.invoke("chat:createConversation", input),
    getConversation: (id) => ipcRenderer.invoke("chat:getConversation", { id }),
    renameConversation: (id, title) => ipcRenderer.invoke("chat:renameConversation", { id, title }),
    deleteConversation: (id) => ipcRenderer.invoke("chat:deleteConversation", { id }),
    sendMessage: (input) => ipcRenderer.invoke("chat:sendMessage", input),
    stopStream: (streamId) => ipcRenderer.invoke("chat:stopStream", { streamId }),
    onStreamEvent: (listener) => {
      const wrapped = (
        _ev: Electron.IpcRendererEvent,
        payload: Parameters<DesktopBridge["chat"]["onStreamEvent"]>[0] extends (p: infer P) => void
          ? P
          : never,
      ) => listener(payload);
      ipcRenderer.on("chat:stream", wrapped);
      return () => ipcRenderer.removeListener("chat:stream", wrapped);
    },
  },
  projects: {
    list: () => ipcRenderer.invoke("projects:list"),
    pickDirectory: () => ipcRenderer.invoke("projects:pickDirectory"),
    create: (input) => ipcRenderer.invoke("projects:create", input),
    remove: (id) => ipcRenderer.invoke("projects:remove", { id }),
    listFiles: (projectId) => ipcRenderer.invoke("projects:listFiles", { projectId }),
    readFile: (projectId, relPath) =>
      ipcRenderer.invoke("projects:readFile", { projectId, relPath }),
    writeFile: (projectId, relPath, content) =>
      ipcRenderer.invoke("projects:writeFile", { projectId, relPath, content }),
    gitStatus: (projectId) => ipcRenderer.invoke("projects:gitStatus", { projectId }),
    gitDiff: (projectId, relPath) => ipcRenderer.invoke("projects:gitDiff", { projectId, relPath }),
    execBuild: (projectId, command) =>
      ipcRenderer.invoke("projects:execBuild", { projectId, command }),
  },
  work: {
    listRuns: () => ipcRenderer.invoke("work:listRuns"),
    getRun: (runId) => ipcRenderer.invoke("work:getRun", { runId }),
    startRun: (input) => ipcRenderer.invoke("work:startRun", input),
    approve: (approvalId, decision) => ipcRenderer.invoke("work:approve", { approvalId, decision }),
    cancel: (runId) => ipcRenderer.invoke("work:cancel", { runId }),
    onWorkEvent: (listener) => {
      const wrapped = (_ev: Electron.IpcRendererEvent, event: AgentEvent) => listener(event);
      ipcRenderer.on("work:event", wrapped);
      return () => ipcRenderer.removeListener("work:event", wrapped);
    },
  },
};

contextBridge.exposeInMainWorld("epocanvas", bridge);
