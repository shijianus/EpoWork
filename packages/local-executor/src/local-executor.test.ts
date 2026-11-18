import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalProjectExecutor, resolveInsideProject, scaffoldLocalProject } from "./index.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("local-executor path confinement, project scaffolding, git and shell execution", () => {
  it("blocks path traversal, absolute escapes, and symlink escapes outside project root", () => {
    const root = makeTempDir("epocanvas-proj-");
    const outside = makeTempDir("epocanvas-outside-");
    fs.writeFileSync(path.join(outside, "secret.txt"), "top-secret");
    fs.symlinkSync(outside, path.join(root, "escape-link"));

    expect(() => resolveInsideProject(root, "../secret.txt")).toThrow();
    expect(() => resolveInsideProject(root, "/etc/passwd")).toThrow();
    expect(() => resolveInsideProject(root, "escape-link/secret.txt")).toThrow();
    expect(resolveInsideProject(root, "src/index.ts")).toBe(
      path.join(fs.realpathSync(root), "src/index.ts"),
    );
  });

  it("scaffolds a project, edits real files, runs real build command, and strips secret env vars", async () => {
    const root = makeTempDir("epocanvas-node-");
    await scaffoldLocalProject(root, "Demo App", "node-ts");

    const executor = new LocalProjectExecutor(root);
    const files = await executor.listFiles();
    expect(files).toContain("package.json");
    expect(files).toContain("src/index.mjs");

    await executor.writeFile("src/hello.txt", "hello local desktop");
    expect(await executor.readFile("src/hello.txt")).toBe("hello local desktop");

    const grep = await executor.grepFiles("hello local desktop");
    expect(grep).toHaveLength(1);
    expect(grep[0]?.path).toBe("src/hello.txt");

    // Run real build script inside project directory
    const buildRes = await executor.execCommand("npm run build");
    expect(buildRes.exitCode).toBe(0);
    expect(buildRes.stdout).toContain("Build check OK");

    // Ensure sensitive parent env vars are stripped from child shell
    process.env.OPENAI_API_KEY = "sk-should-never-leak-to-child";
    const envRes = await executor.execCommand(
      "node -e \"console.log(process.env.OPENAI_API_KEY || 'STRIPPED')\"",
    );
    delete process.env.OPENAI_API_KEY;
    expect(envRes.stdout.trim()).toBe("STRIPPED");

    const gitStatus = await executor.gitStatus();
    expect(gitStatus.clean).toBe(false);
  });
});
