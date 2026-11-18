import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    main: "electron/main.ts",
    preload: "electron/preload.ts",
    "executor-host": "electron/executor-host.ts",
  },
  outDir: "dist/electron",
  format: ["cjs"],
  platform: "node",
  target: "node22",
  sourcemap: true,
  clean: true,
  outExtension: () => ({ js: ".cjs" }),
  external: ["electron", "node:sqlite"],
  noExternal: [/^(?!electron$|node:).+/],
  esbuildPlugins: [
    {
      name: "keep-electron-external",
      setup(build) {
        build.onResolve({ filter: /^electron$/ }, () => ({
          path: "electron",
          external: true,
        }));
      },
    },
  ],
  onSuccess: async () => {
    const srcMigrations = path.resolve(__dirname, "../../infra/migrations");
    const destMigrations = path.resolve(__dirname, "dist/migrations");
    fs.mkdirSync(destMigrations, { recursive: true });
    for (const file of fs.readdirSync(srcMigrations)) {
      if (file.endsWith(".sql")) {
        fs.copyFileSync(path.join(srcMigrations, file), path.join(destMigrations, file));
      }
    }
  },
});
