import { createAnthropic } from "@ai-sdk/anthropic";
import type { NativeProviderAdapter } from "./types.js";

export class AnthropicNativeAdapter implements NativeProviderAdapter {
  readonly providerId = "anthropic" as const;

  createLanguageModel(modelId: string, apiKey: string) {
    const anthropic = createAnthropic({ apiKey });
    return anthropic(modelId);
  }

  async listRemoteModels(apiKey: string, signal?: AbortSignal): Promise<string[]> {
    const res = await fetch("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      signal,
    });
    if (!res.ok) {
      throw new Error(`Anthropic /models returned HTTP ${res.status}`);
    }
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    return (body.data ?? []).map((m) => m.id).sort();
  }
}
