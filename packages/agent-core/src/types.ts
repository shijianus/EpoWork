import type { AgentEvent, ProviderId, RunStatus } from "@ai-workspace/contracts";

export type AgentExecutionMode = "local_desktop" | "work_lite" | "sandbox_work";

export type ToolRiskLevel = "read" | "write" | "exec" | "git_write" | "external";

export interface AgentCapabilities {
  executionMode: AgentExecutionMode;
  streaming: boolean;
  fileTools: boolean;
  gitRead: boolean;
  gitWrite: boolean;
  shellExec: boolean;
  approvals: boolean;
  cancel: boolean;
  resume: boolean;
}

export interface AgentToolExecutor {
  readonly rootPath: string;
  listFiles(dir?: string): Promise<string[]>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<{ created: boolean; bytes: number }>;
  deleteFile(path: string): Promise<{ deleted: boolean }>;
  grepFiles(
    pattern: string,
    dir?: string,
  ): Promise<Array<{ path: string; line: number; text: string }>>;
  gitStatus(): Promise<{ stdout: string; clean: boolean }>;
  gitDiff(path?: string): Promise<string>;
  gitCommit(message: string): Promise<{ stdout: string; exitCode: number }>;
  execCommand(
    command: string,
    timeoutMs?: number,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export interface ApprovalRequest {
  id: string;
  runId: string;
  toolName: string;
  riskLevel: ToolRiskLevel;
  summary: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  createdAt: string;
}

export type ApprovalDecision = "approve_once" | "reject";

export interface StartAgentRunInput {
  runId: string;
  projectId: string;
  providerId: ProviderId;
  modelId: string;
  apiKey: string;
  prompt: string;
  maxSteps?: number;
  tokenBudget?: number;
  signal?: AbortSignal;
  onEvent: (event: AgentEvent) => Promise<void> | void;
}

export interface AgentRunResult {
  runId: string;
  status: RunStatus;
  finalMessage: string;
  inputTokens: number;
  outputTokens: number;
  errorMessage?: string;
}

export interface AgentAdapter {
  readonly id: string;
  capabilities(): AgentCapabilities;
  run(input: StartAgentRunInput): Promise<AgentRunResult>;
}
