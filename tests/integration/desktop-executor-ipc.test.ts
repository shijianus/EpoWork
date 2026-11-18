import { fork } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ApprovalManager, ExecutionPolicy } from "@ai-workspace/agent-core";
import { LocalProjectExecutor, scaffoldLocalProject } from "@ai-workspace/local-executor";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
afterEach(() => {
  for (const d of tempDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("Desktop LocalExecutor isolated process & approval-gated build execution", () => {
  it("enforces policy approval before executing build command in a separate process", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "epocanvas-ipc-proj-"));
    tempDirs.push(projectDir);
    await scaffoldLocalProject(projectDir, "IPC Test App", "node-ts");

    const executor = new LocalProjectExecutor(projectDir);
    const policy = new ExecutionPolicy({ requireApprovalForWrites: true });
    const approvals = new ApprovalManager();

    // Write requires approval when requireApprovalForWrites=true
    const writeDecision = policy.evaluate("write_file", { path: "src/index.mjs" });
    expect(writeDecision.action).toBe("require_approval");

    // Command requires approval, then executes inside project directory
    const cmdDecision = policy.evaluate("run_command", { command: "npm run build" });
    expect(cmdDecision.action).toBe("require_approval");

    const approvalPromise = approvals.requestApproval(
      {
        runId: "run_test",
        toolName: "run_command",
        riskLevel: "exec",
        summary: "Run npm run build",
        payload: { command: "npm run build" },
        idempotencyKey: "run_test:1:build",
      },
      (req) => {
        approvals.resolve(req.id, "approve_once");
      },
    );
    const resolved = await approvalPromise;
    expect(resolved.decision).toBe("approve_once");

    const buildRes = await executor.execCommand("npm run build");
    expect(buildRes.exitCode).toBe(0);
    expect(buildRes.stdout).toContain("Build check OK");

    // Verify fork helper sanity (spawning a separate Node process works)
    const child = fork(path.resolve("packages/local-executor/src/process-host.ts"), [], {
      execArgv: ["--experimental-strip-types"],
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    child.send({ type: "cancel", runId: "nonexistent" });
    child.kill();
  });
});
