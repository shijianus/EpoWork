import { z } from "zod";

export const ProviderIdSchema = z.enum(["openai", "anthropic", "google"]);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

export const ModelCapabilitiesSchema = z.object({
  streaming: z.boolean(),
  toolCalling: z.boolean(),
  structuredOutput: z.boolean(),
  imageInput: z.boolean(),
  imageGeneration: z.boolean(),
  fileInput: z.boolean(),
  reasoningControl: z.boolean(),
  contextWindow: z.number().int().positive(),
});

export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;

export const ModelDefinitionSchema = z.object({
  id: z.string().min(1),
  providerId: ProviderIdSchema,
  displayName: z.string().min(1),
  description: z.string().optional(),
  capabilities: ModelCapabilitiesSchema,
});

export type ModelDefinition = z.infer<typeof ModelDefinitionSchema>;
