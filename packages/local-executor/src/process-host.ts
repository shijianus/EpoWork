import {
  ApprovalManager,
  ExecutionPolicy,
  NativeAgentLoop,
  type AgentRunResult,
  type ApprovalDecision,
} from "@ai-workspace/agent-core";
import type { AgentEvent, ProviderId } from "@ai-workspace/contracts";
import { LocalProjectExecutor } from "./executor.js";

export type WorkerInboundMessage =
  | {
      type: "start";
      runId: string;
      projectId: string;
      projectRoot: string;
      providerId: ProviderId;
      modelId: string;
      apiKey: string;
      prompt: string;
      maxSteps?: number;
      requireApprovalForWrites?: boolean;
    }
  | { type: "approve"; approvalId: string; decision: ApprovalDecision }
  | { type: "cancel"; runId: string };

export type WorkerOutboundMessage =
  | { type: "event"; event: AgentEvent }
  | { type: "done"; result: AgentRunResult }
  | { type: "error"; runId: string; message: string };

/**
 * Isolated child-process host for LocalExecutor + NativeAgentLoop.
 * Keeps Node/Shell/Git execution completely separate from Electron Renderer and Main event loops.
 */
export function startWorkerMessageLoop() {
  const approvals = new ApprovalManager();
  const abortControllers = new Map<string, AbortController>();

  const send = (msg: WorkerOutboundMessage) => {
    if (typeof process.send === "function") {
      process.send(msg);
    }
  };

  process.on("message", async (msg: WorkerInboundMessage) => {
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "approve") {
      approvals.resolve(msg.approvalId, msg.decision);
      return;
    }

    if (msg.type === "cancel") {
      abortControllers.get(msg.runId)?.abort();
      approvals.rejectAllForRun(msg.runId);
      return;
    }

    if (msg.type === "start") {
      const ac = new AbortController();
      abortControllers.set(msg.runId, ac);
      try {
        const executor = new LocalProjectExecutor(msg.projectRoot);
        const policy = new ExecutionPolicy({
          requireApprovalForWrites: msg.requireApprovalForWrites ?? false,
        });
        const agent = new NativeAgentLoop({ executor, policy, approvals });
        const result = await agent.run({
          runId: msg.runId,
          projectId: msg.projectId,
          providerId: msg.providerId,
          modelId: msg.modelId,
          apiKey: msg.apiKey,
          prompt: msg.prompt,
          maxSteps: msg.maxSteps,
          signal: ac.signal,
          onEvent: (event) => {
            send({ type: "event", event });
          },
        });
        send({ type: "done", result });
      } catch (err) {
        send({
          type: "error",
          runId: msg.runId,
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        abortControllers.delete(msg.runId);
      }
    }
  });
}

// Execute immediately if spawned directly as a worker process
const isDirectEntry =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv.some((arg) => arg.includes("process-host"));
if (isDirectEntry && typeof process.send === "function") {
  startWorkerMessageLoop();
}
