import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@ai-workspace/shared": resolve(__dirname, "packages/shared/src/index.ts"),
      "@ai-workspace/contracts": resolve(__dirname, "packages/contracts/src/index.ts"),
      "@ai-workspace/database": resolve(__dirname, "packages/database/src/index.ts"),
      "@ai-workspace/auth": resolve(__dirname, "packages/auth/src/index.ts"),
      "@ai-workspace/ui": resolve(__dirname, "packages/ui/src/index.ts"),
      "@ai-workspace/model-registry": resolve(__dirname, "packages/model-registry/src/index.ts"),
      "@ai-workspace/providers": resolve(__dirname, "packages/providers/src/index.ts"),
      "@ai-workspace/chat-core": resolve(__dirname, "packages/chat-core/src/index.ts"),
      "@ai-workspace/agent-core": resolve(__dirname, "packages/agent-core/src/index.ts"),
      "@ai-workspace/local-executor": resolve(__dirname, "packages/local-executor/src/index.ts"),
      "@ai-workspace/desktop-storage": resolve(__dirname, "packages/desktop-storage/src/index.ts"),
    },
  },
  test: {
    globals: false,
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.wrangler/**",
      "**/release/**",
      "tests/e2e/**",
    ],
  },
});
