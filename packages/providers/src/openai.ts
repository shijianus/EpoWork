import { createOpenAI } from "@ai-sdk/openai";
import type { NativeProviderAdapter } from "./types.js";

export class OpenAINativeAdapter implements NativeProviderAdapter {
  readonly providerId = "openai" as const;

  createLanguageModel(modelId: string, apiKey: string) {
    const openai = createOpenAI({ apiKey });
    return openai(modelId);
  }

  async listRemoteModels(apiKey: string, signal?: AbortSignal): Promise<string[]> {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
    if (!res.ok) {
      throw new Error(`OpenAI /models returned HTTP ${res.status}`);
    }
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    return (body.data ?? []).map((m) => m.id).sort();
  }
}
