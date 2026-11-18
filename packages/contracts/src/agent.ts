import { z } from "zod";

export const RunStatusSchema = z.enum([
  "queued",
  "starting",
  "running",
  "waiting_approval",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);

export type RunStatus = z.infer<typeof RunStatusSchema>;

export const AgentEventTypeSchema = z.enum([
  "message.started",
  "message.delta",
  "message.completed",
  "tool.started",
  "tool.output",
  "tool.completed",
  "tool.failed",
  "plan.updated",
  "file.created",
  "file.modified",
  "file.deleted",
  "approval.required",
  "approval.resolved",
  "artifact.created",
  "run.started",
  "run.progress",
  "run.completed",
  "run.failed",
  "run.cancelled",
]);

export type AgentEventType = z.infer<typeof AgentEventTypeSchema>;

export const AgentEventSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
  type: AgentEventTypeSchema,
  payload: z.record(z.unknown()),
  providerRaw: z.unknown().optional(),
});

export type AgentEvent = z.infer<typeof AgentEventSchema>;

export const RunRecordSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  projectId: z.string().nullable(),
  workspaceId: z.string().nullable(),
  harnessId: z.string().min(1),
  modelId: z.string().min(1),
  providerSessionId: z.string().nullable(),
  status: RunStatusSchema,
  startedAt: z.string().datetime().nullable(),
  endedAt: z.string().datetime().nullable(),
  tokenUsage: z
    .object({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
    })
    .optional(),
  errorMessage: z.string().nullable().optional(),
});

export type RunRecord = z.infer<typeof RunRecordSchema>;
