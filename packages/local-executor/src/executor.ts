import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { AgentToolExecutor } from "@ai-workspace/agent-core";
import { redactString } from "@ai-workspace/shared";
import { resolveInsideProject } from "./path-guard.js";

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", ".wrangler", "release"]);
const MAX_CMD_OUTPUT_BYTES = 256 * 1024;
const SENSITIVE_ENV_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "CLOUDFLARE_API_TOKEN",
  "ENCRYPTION_MASTER_KEY",
  "SESSION_SECRET",
  "PASSWORD_PEPPER",
];

function buildSafeChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of SENSITIVE_ENV_KEYS) {
    delete env[key];
  }
  return env;
}

function runSpawn(
  file: string,
  args: string[],
  cwd: string,
  options: { shell?: boolean; timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      shell: options.shell ?? false,
      env: buildSafeChildEnv(),
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs ?? 60_000);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_CMD_OUTPUT_BYTES) {
        stdout += chunk.toString("utf8");
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_CMD_OUTPUT_BYTES) {
        stderr += chunk.toString("utf8");
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const safeOut = redactString(stdout.slice(0, MAX_CMD_OUTPUT_BYTES));
      const safeErr = redactString(stderr.slice(0, MAX_CMD_OUTPUT_BYTES));
      if (timedOut) {
        resolve({
          stdout: safeOut,
          stderr: `${safeErr}\n[Timed out after ${options.timeoutMs ?? 60_000}ms]`.trim(),
          exitCode: 124,
        });
      } else {
        resolve({ stdout: safeOut, stderr: safeErr, exitCode: code ?? 1 });
      }
    });
  });
}

export class LocalProjectExecutor implements AgentToolExecutor {
  readonly rootPath: string;

  constructor(projectRoot: string) {
    if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
      throw new Error(`Project directory does not exist: ${projectRoot}`);
    }
    this.rootPath = fs.realpathSync(projectRoot);
  }

  async listFiles(dir = "."): Promise<string[]> {
    const startDir = resolveInsideProject(this.rootPath, dir);
    if (!fs.existsSync(startDir)) return [];
    const results: string[] = [];

    const walk = (current: string) => {
      if (results.length >= 1_500) return;
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          results.push(path.relative(this.rootPath, full).replace(/\\/g, "/"));
        }
      }
    };

    walk(startDir);
    return results.sort();
  }

  async readFile(relPath: string): Promise<string> {
    const target = resolveInsideProject(this.rootPath, relPath);
    return fs.readFileSync(target, "utf8");
  }

  async writeFile(relPath: string, content: string): Promise<{ created: boolean; bytes: number }> {
    const target = resolveInsideProject(this.rootPath, relPath);
    const created = !fs.existsSync(target);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
    return { created, bytes: Buffer.byteLength(content, "utf8") };
  }

  async deleteFile(relPath: string): Promise<{ deleted: boolean }> {
    const target = resolveInsideProject(this.rootPath, relPath);
    if (!fs.existsSync(target)) return { deleted: false };
    fs.unlinkSync(target);
    return { deleted: true };
  }

  async grepFiles(
    pattern: string,
    dir = ".",
  ): Promise<Array<{ path: string; line: number; text: string }>> {
    const files = await this.listFiles(dir);
    const matches: Array<{ path: string; line: number; text: string }> = [];
    for (const rel of files) {
      if (matches.length >= 100) break;
      const full = resolveInsideProject(this.rootPath, rel);
      const stat = fs.statSync(full);
      if (stat.size > 512 * 1024) continue;
      const content = fs.readFileSync(full, "utf8");
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? "";
        if (line.includes(pattern)) {
          matches.push({ path: rel, line: i + 1, text: line.slice(0, 240) });
          if (matches.length >= 100) break;
        }
      }
    }
    return matches;
  }

  async gitStatus(): Promise<{ stdout: string; clean: boolean }> {
    const res = await runSpawn("git", ["status", "--porcelain"], this.rootPath, {
      timeoutMs: 15_000,
    });
    return { stdout: res.stdout, clean: res.stdout.trim().length === 0 };
  }

  async gitDiff(relPath?: string): Promise<string> {
    const args = ["diff"];
    if (relPath) {
      resolveInsideProject(this.rootPath, relPath);
      args.push("--", relPath);
    }
    const res = await runSpawn("git", args, this.rootPath, { timeoutMs: 15_000 });
    return res.stdout;
  }

  async gitCommit(message: string): Promise<{ stdout: string; exitCode: number }> {
    const addRes = await runSpawn("git", ["add", "-A"], this.rootPath, { timeoutMs: 15_000 });
    if (addRes.exitCode !== 0) {
      return { stdout: addRes.stderr || addRes.stdout, exitCode: addRes.exitCode };
    }
    const commitRes = await runSpawn("git", ["commit", "-m", message], this.rootPath, {
      timeoutMs: 15_000,
    });
    return {
      stdout: `${commitRes.stdout}\n${commitRes.stderr}`.trim(),
      exitCode: commitRes.exitCode,
    };
  }

  async execCommand(
    command: string,
    timeoutMs = 60_000,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const shellExe = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
    const shellArgs = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-c", command];
    return runSpawn(shellExe, shellArgs, this.rootPath, { shell: false, timeoutMs });
  }
}

export type StarterTemplateId = "blank" | "node-ts" | "react-vite";

export async function scaffoldLocalProject(
  projectRoot: string,
  name: string,
  template: StarterTemplateId,
): Promise<void> {
  fs.mkdirSync(projectRoot, { recursive: true });
  const executor = new LocalProjectExecutor(projectRoot);

  if (template === "blank") {
    await executor.writeFile("README.md", `# ${name}\n\nCreated with EpoCanvas Desktop.\n`);
  } else if (template === "node-ts") {
    await executor.writeFile(
      "package.json",
      JSON.stringify(
        {
          name: name.toLowerCase().replace(/[^a-z0-9-]/g, "-") || "local-app",
          version: "0.1.0",
          type: "module",
          scripts: {
            build: "node -e \"console.log('Build check OK')\"",
            start: "node src/index.mjs",
          },
        },
        null,
        2,
      ),
    );
    await executor.writeFile(
      "src/index.mjs",
      `export function greet(target = "World") {\n  return \`Hello, \${target}!\`;\n}\n\nconsole.log(greet());\n`,
    );
  } else if (template === "react-vite") {
    await executor.writeFile(
      "package.json",
      JSON.stringify(
        {
          name: name.toLowerCase().replace(/[^a-z0-9-]/g, "-") || "react-app",
          version: "0.1.0",
          type: "module",
          scripts: {
            dev: "vite",
            build: "vite build",
          },
          dependencies: {
            react: "^19.0.0",
            "react-dom": "^19.0.0",
          },
          devDependencies: {
            "@vitejs/plugin-react": "^5.0.0",
            vite: "^7.0.0",
          },
        },
        null,
        2,
      ),
    );
    await executor.writeFile(
      "index.html",
      `<!doctype html>\n<html>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.jsx"></script>\n  </body>\n</html>\n`,
    );
    await executor.writeFile(
      "src/main.jsx",
      `import { createRoot } from "react-dom/client";\nimport { App } from "./App.jsx";\ncreateRoot(document.getElementById("root")).render(<App />);\n`,
    );
    await executor.writeFile(
      "src/App.jsx",
      `export function App() {\n  return <main style={{ padding: 24 }}><h1>${name}</h1></main>;\n}\n`,
    );
  }

  // Initialize git repo if git is available and .git does not exist
  if (!fs.existsSync(path.join(projectRoot, ".git"))) {
    await runSpawn("git", ["init"], projectRoot, { timeoutMs: 10_000 }).catch(() => undefined);
  }
}
