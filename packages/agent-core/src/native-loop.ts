import type { AgentEvent, AgentEventType } from "@ai-workspace/contracts";
import { ProviderRegistry, withTransientRetry } from "@ai-workspace/providers";
import { createId } from "@ai-workspace/shared";
import { stepCountIs, streamText, tool, type ToolSet } from "ai";
import { z } from "zod";
import { ApprovalManager } from "./approval-manager.js";
import { ExecutionPolicy } from "./policy.js";
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentRunResult,
  AgentToolExecutor,
  StartAgentRunInput,
} from "./types.js";

export interface NativeAgentLoopOptions {
  executor: AgentToolExecutor;
  policy?: ExecutionPolicy;
  approvals?: ApprovalManager;
  providers?: ProviderRegistry;
}

/**
 * Runtime-agnostic API-driven Agent Harness.
 * Uses native OpenAI/Anthropic/Gemini providers with policy-gated tools and monotonic AgentEvent emission.
 */
export class NativeAgentLoop implements AgentAdapter {
  readonly id = "native-local";
  private readonly executor: AgentToolExecutor;
  private readonly policy: ExecutionPolicy;
  private readonly approvals: ApprovalManager;
  private readonly providers: ProviderRegistry;

  constructor(options: NativeAgentLoopOptions) {
    this.executor = options.executor;
    this.policy = options.policy ?? new ExecutionPolicy();
    this.approvals = options.approvals ?? new ApprovalManager();
    this.providers = options.providers ?? new ProviderRegistry();
  }

  capabilities(): AgentCapabilities {
    return {
      executionMode: "local_desktop",
      streaming: true,
      fileTools: true,
      gitRead: true,
      gitWrite: true,
      shellExec: true,
      approvals: true,
      cancel: true,
      resume: false,
    };
  }

  async run(input: StartAgentRunInput): Promise<AgentRunResult> {
    let seq = 0;
    const emit = async (type: AgentEventType, payload: Record<string, unknown>) => {
      const event: AgentEvent = {
        id: createId("evt"),
        runId: input.runId,
        seq,
        timestamp: new Date().toISOString(),
        type,
        payload,
      };
      seq += 1;
      await input.onEvent(event);
    };

    await emit("run.started", {
      harnessId: this.id,
      projectId: input.projectId,
      modelId: input.modelId,
      rootPath: this.executor.rootPath,
    });

    const maxSteps = Math.min(25, Math.max(1, input.maxSteps ?? 12));
    const tokenBudget = input.tokenBudget ?? 150_000;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let finalMessage = "";
    let stepIndex = 0;

    const runGuardedTool = async <T>(
      toolName: string,
      args: Record<string, unknown>,
      fn: () => Promise<T>,
    ): Promise<T | { ok: false; blocked: true; reason: string }> => {
      stepIndex += 1;
      const callId = createId("tcl");
      await emit("tool.started", { toolCallId: callId, toolName, args });

      const decision = this.policy.evaluate(toolName, args);
      if (decision.action === "deny") {
        await emit("tool.failed", { toolCallId: callId, toolName, error: decision.reason });
        return { ok: false, blocked: true, reason: decision.reason };
      }

      if (decision.action === "require_approval") {
        const idempotencyKey = `${input.runId}:${stepIndex}:${toolName}:${JSON.stringify(args)}`;
        const { request, decision: userDecision } = await this.approvals.requestApproval(
          {
            runId: input.runId,
            toolName,
            riskLevel: decision.riskLevel,
            summary: decision.reason,
            payload: args,
            idempotencyKey,
            signal: input.signal,
          },
          async (req) => {
            await emit("approval.required", {
              approvalId: req.id,
              toolName: req.toolName,
              riskLevel: req.riskLevel,
              summary: req.summary,
              payload: req.payload,
            });
          },
        );

        await emit("approval.resolved", {
          approvalId: request.id,
          decision: userDecision,
        });

        if (userDecision === "reject") {
          const reason = `User rejected ${toolName}`;
          await emit("tool.failed", { toolCallId: callId, toolName, error: reason });
          return { ok: false, blocked: true, reason };
        }
      }

      try {
        const output = await fn();
        await emit("tool.completed", { toolCallId: callId, toolName, output });
        return output;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await emit("tool.failed", { toolCallId: callId, toolName, error: message });
        throw err;
      }
    };

    const tools: ToolSet = {
      list_files: tool({
        description: "List relative file paths inside the bound project directory.",
        inputSchema: z.object({
          dir: z.string().optional().describe("Optional relative subdirectory"),
        }),
        execute: ({ dir }) =>
          runGuardedTool("list_files", { dir: dir ?? "." }, async () => {
            const files = await this.executor.listFiles(dir);
            return { files: files.slice(0, 300), total: files.length };
          }),
      }),

      read_file: tool({
        description: "Read UTF-8 text contents of a project file.",
        inputSchema: z.object({
          path: z.string().min(1).describe("Relative path inside project"),
        }),
        execute: ({ path }) =>
          runGuardedTool("read_file", { path }, async () => {
            const content = await this.executor.readFile(path);
            return { path, content: content.slice(0, 40_000) };
          }),
      }),

      grep_files: tool({
        description: "Search for a text pattern across project files.",
        inputSchema: z.object({
          pattern: z.string().min(1),
          dir: z.string().optional(),
        }),
        execute: ({ pattern, dir }) =>
          runGuardedTool("grep_files", { pattern, dir: dir ?? "." }, async () => {
            const matches = await this.executor.grepFiles(pattern, dir);
            return { matches: matches.slice(0, 80) };
          }),
      }),

      write_file: tool({
        description: "Create or overwrite a file inside the bound project directory.",
        inputSchema: z.object({
          path: z.string().min(1),
          content: z.string(),
        }),
        execute: ({ path, content }) =>
          runGuardedTool("write_file", { path, bytes: content.length }, async () => {
            const res = await this.executor.writeFile(path, content);
            await emit(res.created ? "file.created" : "file.modified", {
              path,
              bytes: res.bytes,
            });
            return res;
          }),
      }),

      delete_file: tool({
        description: "Delete a file inside the project directory (requires approval).",
        inputSchema: z.object({
          path: z.string().min(1),
        }),
        execute: ({ path }) =>
          runGuardedTool("delete_file", { path }, async () => {
            const res = await this.executor.deleteFile(path);
            if (res.deleted) {
              await emit("file.deleted", { path });
            }
            return res;
          }),
      }),

      git_status: tool({
        description: "Run git status inside the bound project directory.",
        inputSchema: z.object({}),
        execute: () => runGuardedTool("git_status", {}, () => this.executor.gitStatus()),
      }),

      git_diff: tool({
        description: "Inspect git diff for the project or a specific relative file path.",
        inputSchema: z.object({ path: z.string().optional() }),
        execute: ({ path }) =>
          runGuardedTool("git_diff", { path }, async () => ({
            diff: await this.executor.gitDiff(path),
          })),
      }),

      git_commit: tool({
        description: "Stage all changes and create a local Git commit (requires approval).",
        inputSchema: z.object({ message: z.string().min(1).max(200) }),
        execute: ({ message }) =>
          runGuardedTool("git_commit", { message }, () => this.executor.gitCommit(message)),
      }),

      run_command: tool({
        description:
          "Execute a build, test, or lint command inside the bound project directory (requires approval).",
        inputSchema: z.object({
          command: z.string().min(1).max(500),
        }),
        execute: ({ command }) =>
          runGuardedTool("run_command", { command }, () =>
            this.executor.execCommand(command, 60_000),
          ),
      }),
    };

    try {
      const adapter = this.providers.get(input.providerId);
      const model = adapter.createLanguageModel(input.modelId, input.apiKey);

      await emit("message.started", { modelId: input.modelId });

      const result = await withTransientRetry(
        async () =>
          streamText({
            model,
            system: [
              "You are EpoCanvas Work Agent operating inside a bounded local project workspace.",
              `Project root: ${this.executor.rootPath}`,
              "Inspect files before editing. Keep changes minimal, clean, and verified with build/test commands.",
              "Never attempt to bypass path boundaries or execute destructive system-wide commands.",
            ].join("\n"),
            messages: [{ role: "user", content: input.prompt }],
            tools,
            stopWhen: stepCountIs(maxSteps),
            abortSignal: input.signal,
          }),
        { maxRetries: 2, signal: input.signal },
      );

      for await (const part of result.fullStream) {
        if (input.signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        if (part.type === "text-delta") {
          finalMessage += part.text;
          await emit("message.delta", { delta: part.text });
        } else if (part.type === "finish") {
          totalInputTokens = part.totalUsage.inputTokens ?? 0;
          totalOutputTokens = part.totalUsage.outputTokens ?? 0;
          if (totalInputTokens + totalOutputTokens > tokenBudget) {
            throw new Error(`Run exceeded token budget (${tokenBudget})`);
          }
        } else if (part.type === "error") {
          throw part.error instanceof Error ? part.error : new Error(String(part.error));
        }
      }

      await emit("message.completed", { text: finalMessage });
      await emit("run.completed", {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
      });

      return {
        runId: input.runId,
        status: "completed",
        finalMessage,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
      };
    } catch (err) {
      if (input.signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
        await emit("run.cancelled", { reason: "Cancelled by user" });
        return {
          runId: input.runId,
          status: "cancelled",
          finalMessage,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
        };
      }
      const message = err instanceof Error ? err.message : String(err);
      await emit("run.failed", { error: message });
      return {
        runId: input.runId,
        status: "failed",
        finalMessage,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        errorMessage: message,
      };
    }
  }
}
