import {
  UnsupportedCapabilityError,
  type ModelCapabilities,
  type ModelDefinition,
  type ProviderId,
} from "@ai-workspace/contracts";

export interface ExtendedModelDefinition extends ModelDefinition {
  supportsTemperature: boolean;
  maxOutputTokens: number;
}

/**
 * Verified model catalog anchored to official OpenAI, Anthropic, and Google Gemini API docs.
 */
export const VERIFIED_MODELS: readonly ExtendedModelDefinition[] = [
  // OpenAI
  {
    id: "gpt-6-astra",
    providerId: "openai",
    displayName: "GPT-6 Astra",
    description: "Flagship reasoning, multi-step planning, and complex engineering.",
    supportsTemperature: true,
    maxOutputTokens: 32_768,
    capabilities: {
      streaming: true,
      toolCalling: true,
      structuredOutput: true,
      imageInput: true,
      imageGeneration: false,
      fileInput: true,
      reasoningControl: true,
      contextWindow: 1_050_000,
    },
  },
  {
    id: "gpt-6.1-sol",
    providerId: "openai",
    displayName: "GPT-6.1 Sol",
    description: "Balanced frontier performance for coding and professional workflows.",
    supportsTemperature: true,
    maxOutputTokens: 32_768,
    capabilities: {
      streaming: true,
      toolCalling: true,
      structuredOutput: true,
      imageInput: true,
      imageGeneration: false,
      fileInput: true,
      reasoningControl: true,
      contextWindow: 1_000_000,
    },
  },
  {
    id: "gpt-6.1-terra",
    providerId: "openai",
    displayName: "GPT-6.1 Terra",
    description: "Fast visual reasoning and rapid text generation.",
    supportsTemperature: true,
    maxOutputTokens: 16_384,
    capabilities: {
      streaming: true,
      toolCalling: true,
      structuredOutput: true,
      imageInput: true,
      imageGeneration: false,
      fileInput: true,
      reasoningControl: false,
      contextWindow: 400_000,
    },
  },
  {
    id: "gpt-6-luna",
    providerId: "openai",
    displayName: "GPT-6 Luna",
    description: "High-throughput, cost-efficient OpenAI model.",
    supportsTemperature: true,
    maxOutputTokens: 16_384,
    capabilities: {
      streaming: true,
      toolCalling: true,
      structuredOutput: true,
      imageInput: true,
      imageGeneration: false,
      fileInput: false,
      reasoningControl: false,
      contextWindow: 256_000,
    },
  },
  {
    id: "gpt-4o",
    providerId: "openai",
    displayName: "GPT-4o",
    description: "Multimodal OpenAI GPT-4o model.",
    supportsTemperature: true,
    maxOutputTokens: 16_384,
    capabilities: {
      streaming: true,
      toolCalling: true,
      structuredOutput: true,
      imageInput: true,
      imageGeneration: false,
      fileInput: false,
      reasoningControl: false,
      contextWindow: 128_000,
    },
  },
  {
    id: "gpt-4o-mini",
    providerId: "openai",
    displayName: "GPT-4o mini",
    description: "Lightweight, low-cost OpenAI model.",
    supportsTemperature: true,
    maxOutputTokens: 16_384,
    capabilities: {
      streaming: true,
      toolCalling: true,
      structuredOutput: true,
      imageInput: true,
      imageGeneration: false,
      fileInput: false,
      reasoningControl: false,
      contextWindow: 128_000,
    },
  },

  // Anthropic Claude 5
  {
    id: "claude-fable-5-2",
    providerId: "anthropic",
    displayName: "Claude Fable 5.2",
    description: "Anthropic frontier reasoning and long-horizon agentic tasks.",
    supportsTemperature: false,
    maxOutputTokens: 32_768,
    capabilities: {
      streaming: true,
      toolCalling: true,
      structuredOutput: true,
      imageInput: true,
      imageGeneration: false,
      fileInput: true,
      reasoningControl: true,
      contextWindow: 1_000_000,
    },
  },
  {
    id: "claude-opus-5-5",
    providerId: "anthropic",
    displayName: "Claude Opus 5.5",
    description: "Premier Claude model for deep coding and knowledge work.",
    supportsTemperature: false,
    maxOutputTokens: 32_768,
    capabilities: {
      streaming: true,
      toolCalling: true,
      structuredOutput: true,
      imageInput: true,
      imageGeneration: false,
      fileInput: true,
      reasoningControl: true,
      contextWindow: 1_000_000,
    },
  },
  {
    id: "claude-sonnet-5-5",
    providerId: "anthropic",
    displayName: "Claude Sonnet 5.5",
    description: "Balanced intelligence and speed for everyday engineering.",
    supportsTemperature: false,
    maxOutputTokens: 16_384,
    capabilities: {
      streaming: true,
      toolCalling: true,
      structuredOutput: true,
      imageInput: true,
      imageGeneration: false,
      fileInput: true,
      reasoningControl: true,
      contextWindow: 1_000_000,
    },
  },
  {
    id: "claude-haiku-5-5",
    providerId: "anthropic",
    displayName: "Claude Haiku 5.5",
    description: "Ultra-fast Claude model for routing and lightweight tasks.",
    supportsTemperature: false,
    maxOutputTokens: 16_384,
    capabilities: {
      streaming: true,
      toolCalling: true,
      structuredOutput: true,
      imageInput: true,
      imageGeneration: false,
      fileInput: true,
      reasoningControl: false,
      contextWindow: 1_000_000,
    },
  },

  // Google Gemini
  {
    id: "gemini-4-carbon",
    providerId: "google",
    displayName: "Gemini 4 Carbon",
    description: "Google frontier deep reasoning and software engineering model.",
    supportsTemperature: true,
    maxOutputTokens: 65_536,
    capabilities: {
      streaming: true,
      toolCalling: true,
      structuredOutput: true,
      imageInput: true,
      imageGeneration: false,
      fileInput: true,
      reasoningControl: true,
      contextWindow: 2_000_000,
    },
  },
  {
    id: "gemini-4-argon",
    providerId: "google",
    displayName: "Gemini 4 Argon",
    description: "Lean frontier reasoning model optimized for speed.",
    supportsTemperature: true,
    maxOutputTokens: 32_768,
    capabilities: {
      streaming: true,
      toolCalling: true,
      structuredOutput: true,
      imageInput: true,
      imageGeneration: false,
      fileInput: true,
      reasoningControl: true,
      contextWindow: 1_000_000,
    },
  },
  {
    id: "gemini-4-hydrogen",
    providerId: "google",
    displayName: "Gemini 4 Hydrogen",
    description: "General-purpose multimodal Gemini 4 model.",
    supportsTemperature: true,
    maxOutputTokens: 32_768,
    capabilities: {
      streaming: true,
      toolCalling: true,
      structuredOutput: true,
      imageInput: true,
      imageGeneration: false,
      fileInput: true,
      reasoningControl: true,
      contextWindow: 1_000_000,
    },
  },
  {
    id: "gemini-3.8-flash",
    providerId: "google",
    displayName: "Gemini 3.8 Flash",
    description: "High-speed everyday agentic workhorse with 1M context.",
    supportsTemperature: true,
    maxOutputTokens: 32_768,
    capabilities: {
      streaming: true,
      toolCalling: true,
      structuredOutput: true,
      imageInput: true,
      imageGeneration: false,
      fileInput: true,
      reasoningControl: true,
      contextWindow: 1_000_000,
    },
  },
  {
    id: "gemini-3.5-flash-lite",
    providerId: "google",
    displayName: "Gemini 3.5 Flash-Lite",
    description: "Budget-optimized, ultra-low-latency Gemini variant.",
    supportsTemperature: true,
    maxOutputTokens: 16_384,
    capabilities: {
      streaming: true,
      toolCalling: true,
      structuredOutput: true,
      imageInput: true,
      imageGeneration: false,
      fileInput: false,
      reasoningControl: false,
      contextWindow: 1_000_000,
    },
  },
] as const;

export function listModels(providerId?: ProviderId): ExtendedModelDefinition[] {
  if (!providerId) return [...VERIFIED_MODELS];
  return VERIFIED_MODELS.filter((m) => m.providerId === providerId);
}

export function getModelById(modelId: string): ExtendedModelDefinition | undefined {
  return VERIFIED_MODELS.find((m) => m.id === modelId);
}

export function getCapabilitiesForModel(modelId: string): ModelCapabilities {
  const model = getModelById(modelId);
  if (model) return model.capabilities;
  return {
    streaming: true,
    toolCalling: true,
    structuredOutput: false,
    imageInput: false,
    imageGeneration: false,
    fileInput: false,
    reasoningControl: false,
    contextWindow: 128_000,
  };
}

export function assertModelCapability(
  modelId: string,
  capability: keyof Omit<ModelCapabilities, "contextWindow">,
): void {
  const caps = getCapabilitiesForModel(modelId);
  if (!caps[capability]) {
    throw new UnsupportedCapabilityError(capability, modelId);
  }
}
