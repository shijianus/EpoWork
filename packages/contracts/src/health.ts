import { z } from "zod";

export const HealthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  service: z.string(),
  version: z.string(),
  timestamp: z.string().datetime(),
  checks: z.object({
    worker: z.literal("ok"),
    d1: z.enum(["ok", "unconfigured", "error"]),
    r2: z.enum(["ok", "unconfigured", "error"]),
  }),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
