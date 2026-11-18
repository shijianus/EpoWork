import { describe, expect, it } from "vitest";
import { app } from "./index.js";

describe("worker api baseline", () => {
  it("returns 200 and structured health status on GET /api/health", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBeTruthy();

    const body = (await res.json()) as {
      status: string;
      service: string;
      checks: { worker: string; d1: string; r2: string };
    };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("ai-workspace-api");
    expect(body.checks.worker).toBe("ok");
  });

  it("returns structured JSON 404 for unknown API routes", async () => {
    const res = await app.request("/api/non-existent");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.requestId).toBeTruthy();
  });
});
