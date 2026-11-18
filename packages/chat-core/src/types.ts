import type { ProviderId } from "@ai-workspace/contracts";

export interface StoredAttachmentRef {
  artifactId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

export interface StoredToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  status: "running" | "completed" | "failed";
}

export interface StoredMessageContent {
  text: string;
  reasoning?: string;
  attachments?: StoredAttachmentRef[];
  toolCalls?: StoredToolCall[];
}

export interface ConversationRow {
  id: string;
  user_id: string;
  project_id: string | null;
  title: string;
  model_id: string;
  provider_id: string;
  system_prompt: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  user_id: string;
  role: "user" | "assistant" | "system";
  content_json: string;
  model_id: string | null;
  status: "streaming" | "completed" | "stopped" | "failed";
  seq: number;
  created_at: string;
}

export interface ArtifactRow {
  id: string;
  user_id: string;
  project_id: string | null;
  run_id: string | null;
  conversation_id: string | null;
  kind: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  r2_key: string;
  created_at: string;
}

export interface UsageRecordRow {
  id: string;
  user_id: string;
  provider_id: string;
  model_id: string;
  operation_type: string;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  latency_ms: number | null;
  created_at: string;
}

export interface StreamChatInput {
  userId: string;
  conversationId: string;
  prompt: string;
  providerId?: ProviderId;
  modelId?: string;
  temperature?: number | null;
  maxTokens?: number | null;
  reasoningEffort?: "low" | "medium" | "high" | null;
  systemPrompt?: string | null;
  attachmentIds?: string[];
  enableWebSearch?: boolean;
  masterKeyHex: string;
  envFallbackKeys?: Partial<Record<ProviderId, string>>;
  signal?: AbortSignal;
}

export type ChatSseEvent =
  | { type: "message.started"; messageId: string; conversationId: string; modelId: string }
  | { type: "message.delta"; delta: string }
  | { type: "reasoning.delta"; delta: string }
  | { type: "tool.call"; toolCallId: string; toolName: string; input: unknown }
  | { type: "tool.result"; toolCallId: string; toolName: string; output: unknown }
  | {
      type: "message.completed";
      messageId: string;
      status: "completed" | "stopped";
      usage: { inputTokens: number; outputTokens: number; reasoningTokens: number };
    }
  | { type: "error"; code: string; message: string };
