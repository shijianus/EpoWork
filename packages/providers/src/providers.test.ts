import { describe, expect, it } from "vitest";
import { ProviderRegistry, isRetryableProviderError, withTransientRetry } from "./index.js";

describe("providers registry and retry policy", () => {
  it("registers native OpenAI, Anthropic, and Google adapters", () => {
    const registry = new ProviderRegistry();
    expect(registry.get("openai").providerId).toBe("openai");
    expect(registry.get("anthropic").providerId).toBe("anthropic");
    expect(registry.get("google").providerId).toBe("google");

    expect(registry.get("openai").createLanguageModel("gpt-6.1-sol", "sk-test")).toBeTruthy();
    expect(
      registry.get("anthropic").createLanguageModel("claude-sonnet-5-5", "sk-ant-test"),
    ).toBeTruthy();
    expect(
      registry.get("google").createLanguageModel("gemini-4-hydrogen", "AIzaTest"),
    ).toBeTruthy();
  });

  it("retries transient 503/429 errors up to maxRetries and never retries 401 or AbortError", async () => {
    let attempts = 0;
    const ok = await withTransientRetry(
      async () => {
        attempts += 1;
        if (attempts < 2) {
          const err = new Error("Service Unavailable") as Error & { statusCode: number };
          err.statusCode = 503;
          throw err;
        }
        return "recovered";
      },
      { maxRetries: 2, baseDelayMs: 5 },
    );
    expect(ok).toBe("recovered");
    expect(attempts).toBe(2);

    let authAttempts = 0;
    await expect(
      withTransientRetry(
        async () => {
          authAttempts += 1;
          const err = new Error("Unauthorized") as Error & { statusCode: number };
          err.statusCode = 401;
          throw err;
        },
        { maxRetries: 2, baseDelayMs: 5 },
      ),
    ).rejects.toThrow("Unauthorized");
    expect(authAttempts).toBe(1);
    expect(isRetryableProviderError(new DOMException("Aborted", "AbortError"))).toBe(false);
  });
});
