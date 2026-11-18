import { describe, expect, it } from "vitest";
import {
  AgentEventSchema,
  AppError,
  HealthResponseSchema,
  RunStatusSchema,
  UnsupportedCapabilityError,
} from "./index.js";

describe("contracts schemas", () => {
  it("validates AgentEvent payloads with monotonic sequence fields", () => {
    const parsed = AgentEventSchema.safeParse({
      id: "evt_1",
      runId: "run_1",
      seq: 0,
      timestamp: new Date().toISOString(),
      type: "run.started",
      payload: { harnessId: "native" },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects invalid RunStatus values", () => {
    expect(RunStatusSchema.safeParse("running").success).toBe(true);
    expect(RunStatusSchema.safeParse("unknown_status").success).toBe(false);
  });

  it("validates HealthResponse schema", () => {
    const res = HealthResponseSchema.safeParse({
      status: "ok",
      service: "ai-workspace-api",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
      checks: { worker: "ok", d1: "unconfigured", r2: "unconfigured" },
    });
    expect(res.success).toBe(true);
  });

  it("constructs typed AppError and UnsupportedCapabilityError", () => {
    const err = new UnsupportedCapabilityError("gitPush", "native");
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("UNSUPPORTED_CAPABILITY");
    expect(err.status).toBe(400);
  });
});
