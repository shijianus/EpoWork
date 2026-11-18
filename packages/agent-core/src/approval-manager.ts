import { createId } from "@ai-workspace/shared";
import type { ApprovalDecision, ApprovalRequest, ToolRiskLevel } from "./types.js";

interface PendingEntry {
  request: ApprovalRequest;
  resolve: (decision: ApprovalDecision) => void;
  reject: (reason?: unknown) => void;
}

/**
 * Coordinates interactive approval pauses with idempotency protection so restarts/retries never double-apply side effects.
 */
export class ApprovalManager {
  private readonly pending = new Map<string, PendingEntry>();
  private readonly resolvedByIdempotencyKey = new Map<string, ApprovalDecision>();

  requestApproval(
    input: {
      runId: string;
      toolName: string;
      riskLevel: ToolRiskLevel;
      summary: string;
      payload: Record<string, unknown>;
      idempotencyKey: string;
      signal?: AbortSignal;
    },
    onCreated: (req: ApprovalRequest) => Promise<void> | void,
  ): Promise<{ request: ApprovalRequest; decision: ApprovalDecision }> {
    const cached = this.resolvedByIdempotencyKey.get(input.idempotencyKey);
    const request: ApprovalRequest = {
      id: createId("apr"),
      runId: input.runId,
      toolName: input.toolName,
      riskLevel: input.riskLevel,
      summary: input.summary,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      createdAt: new Date().toISOString(),
    };

    if (cached) {
      return Promise.resolve({ request, decision: cached });
    }

    return new Promise((resolve, reject) => {
      if (input.signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }

      const onAbort = () => {
        this.pending.delete(request.id);
        reject(new DOMException("Aborted", "AbortError"));
      };
      input.signal?.addEventListener("abort", onAbort, { once: true });

      this.pending.set(request.id, {
        request,
        resolve: (decision) => {
          input.signal?.removeEventListener("abort", onAbort);
          this.resolvedByIdempotencyKey.set(input.idempotencyKey, decision);
          resolve({ request, decision });
        },
        reject: (err) => {
          input.signal?.removeEventListener("abort", onAbort);
          reject(err);
        },
      });

      Promise.resolve(onCreated(request)).catch((err) => {
        this.pending.delete(request.id);
        input.signal?.removeEventListener("abort", onAbort);
        reject(err);
      });
    });
  }

  resolve(approvalId: string, decision: ApprovalDecision): ApprovalRequest | null {
    const entry = this.pending.get(approvalId);
    if (!entry) return null;
    this.pending.delete(approvalId);
    entry.resolve(decision);
    return entry.request;
  }

  rejectAllForRun(runId: string): void {
    for (const [id, entry] of this.pending.entries()) {
      if (entry.request.runId === runId) {
        this.pending.delete(id);
        entry.resolve("reject");
      }
    }
  }

  listPending(runId?: string): ApprovalRequest[] {
    const all = [...this.pending.values()].map((p) => p.request);
    return runId ? all.filter((r) => r.runId === runId) : all;
  }
}
