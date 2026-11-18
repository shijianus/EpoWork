import { AppError, type ProviderId } from "@ai-workspace/contracts";
import { getModelById } from "@ai-workspace/model-registry";
import { stepCountIs, streamText } from "ai";
import { AnthropicNativeAdapter } from "./anthropic.js";
import { GoogleNativeAdapter } from "./google.js";
import { OpenAINativeAdapter } from "./openai.js";
import { withTransientRetry } from "./retry.js";
import type {
  NativeProviderAdapter,
  NormalizedStreamEvent,
  ProviderStreamRequest,
} from "./types.js";

export class ProviderRegistry {
  private readonly adapters = new Map<ProviderId, NativeProviderAdapter>();

  constructor() {
    this.register(new OpenAINativeAdapter());
    this.register(new AnthropicNativeAdapter());
    this.register(new GoogleNativeAdapter());
  }

  register(adapter: NativeProviderAdapter): void {
    this.adapters.set(adapter.providerId, adapter);
  }

  get(providerId: ProviderId): NativeProviderAdapter {
    const adapter = this.adapters.get(providerId);
    if (!adapter) {
      throw new AppError("BAD_REQUEST", `Unsupported provider: ${providerId}`, 400);
    }
    return adapter;
  }

  async *streamChat(
    providerId: ProviderId,
    req: ProviderStreamRequest,
  ): AsyncGenerator<NormalizedStreamEvent> {
    const adapter = this.get(providerId);
    const modelMeta = getModelById(req.modelId);
    const model = adapter.createLanguageModel(req.modelId, req.apiKey);

    const supportsTemperature = modelMeta?.supportsTemperature ?? true;
    const supportsTools = modelMeta?.capabilities.toolCalling ?? true;
    const maxOut = req.maxTokens ?? modelMeta?.maxOutputTokens;

    const result = await withTransientRetry(
      async () =>
        streamText({
          model,
          system: req.systemPrompt,
          messages: req.messages,
          ...(supportsTemperature && typeof req.temperature === "number"
            ? { temperature: req.temperature }
            : {}),
          ...(typeof maxOut === "number" ? { maxOutputTokens: maxOut } : {}),
          ...(supportsTools && req.tools ? { tools: req.tools, stopWhen: stepCountIs(5) } : {}),
          abortSignal: req.signal,
        }),
      { maxRetries: 2, signal: req.signal },
    );

    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        yield { type: "text-delta", delta: part.text };
      } else if (part.type === "reasoning-delta") {
        yield { type: "reasoning-delta", delta: part.text };
      } else if (part.type === "tool-call") {
        yield {
          type: "tool-call",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input,
        };
      } else if (part.type === "tool-result") {
        yield {
          type: "tool-result",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output: part.output,
        };
      } else if (part.type === "finish") {
        yield {
          type: "finish",
          finishReason: part.finishReason,
          usage: {
            inputTokens: part.totalUsage.inputTokens ?? 0,
            outputTokens: part.totalUsage.outputTokens ?? 0,
            reasoningTokens: part.totalUsage.outputTokenDetails?.reasoningTokens ?? 0,
          },
        };
      } else if (part.type === "error") {
        throw part.error instanceof Error ? part.error : new Error(String(part.error));
      }
    }
  }
}
