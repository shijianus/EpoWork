import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { NativeProviderAdapter } from "./types.js";

export class GoogleNativeAdapter implements NativeProviderAdapter {
  readonly providerId = "google" as const;

  createLanguageModel(modelId: string, apiKey: string) {
    const google = createGoogleGenerativeAI({ apiKey });
    return google(modelId);
  }

  async listRemoteModels(apiKey: string, signal?: AbortSignal): Promise<string[]> {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
      headers: { "x-goog-api-key": apiKey },
      signal,
    });
    if (!res.ok) {
      throw new Error(`Google /models returned HTTP ${res.status}`);
    }
    const body = (await res.json()) as { models?: Array<{ name: string }> };
    return (body.models ?? []).map((m) => m.name.replace(/^models\//, "")).sort();
  }
}
