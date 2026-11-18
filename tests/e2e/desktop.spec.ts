import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

test("Desktop Electron E2E: sandboxed renderer, encrypted key vault, local project create/edit/build", async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "epocanvas-e2e-userdata-"));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "epocanvas-e2e-project-"));

  const electronApp = await electron.launch({
    args: ["--no-sandbox", "--disable-gpu", path.resolve("apps/desktop/dist/electron/main.cjs")],
    env: {
      ...process.env,
      EPOCANVAS_USER_DATA: userDataDir,
    },
  });

  try {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    // 1. Verify Renderer isolation (no Node/require exposure)
    const isolation = await page.evaluate(() => ({
      hasNodeProcess: typeof (window as unknown as { process?: unknown }).process !== "undefined",
      hasRequire: typeof (window as unknown as { require?: unknown }).require !== "undefined",
      hasBridge: typeof window.epocanvas === "object",
    }));
    expect(isolation.hasNodeProcess).toBe(false);
    expect(isolation.hasRequire).toBe(false);
    expect(isolation.hasBridge).toBe(true);

    // 2. Settings: save encrypted API key and verify masked hint & no plaintext on disk
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("OpenAI API key").fill("sk-test-e2e-secret-9876");
    await page.getByRole("button", { name: "Save", exact: true }).first().click();
    await expect(page.getByText("Configured · sk-t...9876")).toBeVisible();

    const vaultContent = fs.readFileSync(path.join(userDataDir, "vault.json"), "utf8");
    expect(vaultContent).not.toContain("sk-test-e2e-secret-9876");

    // 3. Chat: verify model recognizes configured key
    await page.getByRole("button", { name: "Chat" }).click();
    await expect(page.getByText("Key ready")).toBeVisible();

    // 4. Projects: create real local project, edit file, save, and run real build command
    await page.getByRole("button", { name: "Projects" }).click();
    await page.getByRole("button", { name: /New \/ Open Project/i }).click();
    await page.getByLabel("Project name").fill("E2E Local App");
    await page.getByLabel("Local directory path").fill(projectDir);
    await page.getByRole("dialog").getByRole("button", { name: "Create Project" }).click();

    await expect(page.getByRole("button", { name: "src/index.mjs" })).toBeVisible();
    await page.getByRole("button", { name: "src/index.mjs" }).click();
    const editor = page.locator("textarea").first();
    await editor.fill('console.log("E2E Edited OK");\n');
    await page.getByRole("button", { name: "Save" }).click();

    await page.getByRole("button", { name: "Run Build" }).click();
    await expect(page.getByText("Exit 0")).toBeVisible();
    await expect(page.getByText("Build check OK")).toBeVisible();

    // 5. Work tab: project appears in target selector
    await page.getByRole("button", { name: "Run Agent in Project" }).click();
    await expect(page.getByLabel("Target project")).toContainText("E2E Local App");
  } finally {
    await electronApp.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
