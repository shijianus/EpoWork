import type { ProviderId } from "@ai-workspace/contracts";
import type { LanguageModel, ModelMessage, ToolSet } from "ai";

export interface ProviderStreamRequest {
  modelId: string;
  apiKey: string;
  systemPrompt?: string;
  messages: ModelMessage[];
  temperature?: number | null;
  maxTokens?: number | null;
  reasoningEffort?: "low" | "medium" | "high" | null;
  tools?: ToolSet;
  signal?: AbortSignal;
}

export type NormalizedStreamEvent =
  | { type: "text-delta"; delta: string }
  | { type: "reasoning-delta"; delta: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
  | { type: "tool-result"; toolCallId: string; toolName: string; output: unknown }
  | {
      type: "finish";
      finishReason: string;
      usage: { inputTokens: number; outputTokens: number; reasoningTokens: number };
    };

export interface NativeProviderAdapter {
  readonly providerId: ProviderId;
  createLanguageModel(modelId: string, apiKey: string): LanguageModel;
  listRemoteModels?(apiKey: string, signal?: AbortSignal): Promise<string[]>;
}
