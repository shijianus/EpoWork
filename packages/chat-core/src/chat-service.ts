import { decryptSecret } from "@ai-workspace/auth";
import { AppError, type ProviderId } from "@ai-workspace/contracts";
import {
  ProviderConnectionRepository,
  UserScopedR2Storage,
  type D1DatabaseLike,
  type R2BucketLike,
} from "@ai-workspace/database";
import { assertModelCapability } from "@ai-workspace/model-registry";
import { ProviderRegistry } from "@ai-workspace/providers";
import type { ModelMessage } from "ai";
import {
  ArtifactRepository,
  ConversationRepository,
  MessageRepository,
  UsageRepository,
} from "./repository.js";
import { buildChatTools } from "./tools.js";
import type {
  ChatSseEvent,
  StoredAttachmentRef,
  StoredMessageContent,
  StoredToolCall,
  StreamChatInput,
} from "./types.js";

function uint8ToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export class ChatService {
  private readonly conversations: ConversationRepository;
  private readonly messages: MessageRepository;
  private readonly artifacts: ArtifactRepository;
  private readonly usage: UsageRepository;
  private readonly providerKeys: ProviderConnectionRepository;
  private readonly r2: UserScopedR2Storage;

  constructor(
    db: D1DatabaseLike,
    bucket: R2BucketLike,
    private readonly providers = new ProviderRegistry(),
  ) {
    this.conversations = new ConversationRepository(db);
    this.messages = new MessageRepository(db);
    this.artifacts = new ArtifactRepository(db);
    this.usage = new UsageRepository(db);
    this.providerKeys = new ProviderConnectionRepository(db);
    this.r2 = new UserScopedR2Storage(bucket);
  }

  async resolveApiKey(
    userId: string,
    providerId: ProviderId,
    masterKeyHex: string,
    envFallbackKeys?: Partial<Record<ProviderId, string>>,
  ): Promise<string> {
    const conn = await this.providerKeys.findByUserAndProvider(userId, providerId);
    if (conn) {
      return decryptSecret(
        conn.encrypted_api_key,
        conn.key_iv,
        masterKeyHex,
        `${userId}:${providerId}`,
      );
    }
    const envKey = envFallbackKeys?.[providerId]?.trim();
    if (envKey) return envKey;

    throw new AppError(
      "BAD_REQUEST",
      `No API key configured for provider "${providerId}". Add your key in Settings.`,
      400,
    );
  }

  private async toModelMessages(
    userId: string,
    historyRows: Awaited<ReturnType<MessageRepository["listByConversation"]>>,
  ): Promise<ModelMessage[]> {
    const modelMessages: ModelMessage[] = [];

    for (const row of historyRows) {
      if (row.role === "system") continue;
      const parsed = JSON.parse(row.content_json) as StoredMessageContent;

      if (row.role === "assistant") {
        if (parsed.text) {
          modelMessages.push({ role: "assistant", content: parsed.text });
        }
        continue;
      }

      const attachments = parsed.attachments ?? [];
      if (attachments.length === 0) {
        modelMessages.push({ role: "user", content: parsed.text });
        continue;
      }

      const parts: Array<
        | { type: "text"; text: string }
        | { type: "image"; image: string; mediaType?: string }
        | { type: "file"; data: string; mediaType: string }
      > = [];

      if (parsed.text) {
        parts.push({ type: "text", text: parsed.text });
      }

      for (const att of attachments) {
        const artifact = await this.artifacts.findByIdForUser(userId, att.artifactId);
        if (!artifact) continue;
        const prefix = `users/${userId}/`;
        const relKey = artifact.r2_key.startsWith(prefix)
          ? artifact.r2_key.slice(prefix.length)
          : artifact.r2_key;
        const obj = await this.r2.getObject(userId, relKey);
        if (!obj) continue;
        const bytes = new Uint8Array(await obj.arrayBuffer());
        if (att.mimeType.startsWith("image/")) {
          parts.push({
            type: "image",
            image: uint8ToBase64(bytes),
            mediaType: att.mimeType,
          });
        } else if (att.mimeType.startsWith("text/") || att.mimeType === "application/json") {
          const decoded = new TextDecoder().decode(bytes).slice(0, 20_000);
          parts.push({
            type: "text",
            text: `\n[Attached file: ${att.name}]\n\`\`\`\n${decoded}\n\`\`\``,
          });
        } else {
          parts.push({
            type: "file",
            data: uint8ToBase64(bytes),
            mediaType: att.mimeType,
          });
        }
      }

      modelMessages.push({ role: "user", content: parts });
    }

    return modelMessages;
  }

  async *streamTurn(
    input: StreamChatInput & { skipUserAppend?: boolean },
  ): AsyncGenerator<ChatSseEvent> {
    const conv = await this.conversations.findByIdForUser(input.userId, input.conversationId);
    if (!conv) {
      throw new AppError("NOT_FOUND", "Conversation not found", 404);
    }

    const providerId = (input.providerId ?? conv.provider_id) as ProviderId;
    const modelId = input.modelId ?? conv.model_id;
    const apiKey = await this.resolveApiKey(
      input.userId,
      providerId,
      input.masterKeyHex,
      input.envFallbackKeys,
    );

    const attachmentRefs: StoredAttachmentRef[] = [];
    if (input.attachmentIds && input.attachmentIds.length > 0) {
      const rows = await this.artifacts.listByIdsForUser(input.userId, input.attachmentIds);
      for (const row of rows) {
        if (row.mime_type.startsWith("image/")) {
          assertModelCapability(modelId, "imageInput");
        } else if (!row.mime_type.startsWith("text/") && row.mime_type !== "application/json") {
          assertModelCapability(modelId, "fileInput");
        }
        attachmentRefs.push({
          artifactId: row.id,
          name: row.name,
          mimeType: row.mime_type,
          sizeBytes: row.size_bytes,
        });
      }
    }

    if (!input.skipUserAppend) {
      await this.messages.append({
        userId: input.userId,
        conversationId: conv.id,
        role: "user",
        content: {
          text: input.prompt,
          ...(attachmentRefs.length > 0 ? { attachments: attachmentRefs } : {}),
        },
        status: "completed",
      });
    }

    // Update conversation title automatically on first turn
    if (conv.title === "New Chat" && input.prompt.trim().length > 0) {
      const autoTitle = input.prompt.trim().slice(0, 60);
      await this.conversations.updateForUser(input.userId, conv.id, {
        title: autoTitle,
        providerId,
        modelId,
      });
    } else if (providerId !== conv.provider_id || modelId !== conv.model_id) {
      await this.conversations.updateForUser(input.userId, conv.id, { providerId, modelId });
    }

    const history = await this.messages.listByConversation(input.userId, conv.id);
    const modelMessages = await this.toModelMessages(input.userId, history);

    const assistantMsg = await this.messages.append({
      userId: input.userId,
      conversationId: conv.id,
      role: "assistant",
      content: { text: "" },
      modelId,
      status: "streaming",
    });

    yield {
      type: "message.started",
      messageId: assistantMsg.id,
      conversationId: conv.id,
      modelId,
    };

    const startedAt = Date.now();
    let accumulatedText = "";
    let accumulatedReasoning = "";
    const toolCalls: StoredToolCall[] = [];
    let usageTotals = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
    let finalStatus: "completed" | "stopped" | "failed" = "completed";

    try {
      const tools = buildChatTools({ enableWebSearch: input.enableWebSearch });
      for await (const chunk of this.providers.streamChat(providerId, {
        modelId,
        apiKey,
        systemPrompt: input.systemPrompt ?? conv.system_prompt ?? undefined,
        messages: modelMessages,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        reasoningEffort: input.reasoningEffort,
        tools,
        signal: input.signal,
      })) {
        if (chunk.type === "text-delta") {
          accumulatedText += chunk.delta;
          yield { type: "message.delta", delta: chunk.delta };
        } else if (chunk.type === "reasoning-delta") {
          accumulatedReasoning += chunk.delta;
          yield { type: "reasoning.delta", delta: chunk.delta };
        } else if (chunk.type === "tool-call") {
          toolCalls.push({
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            input: chunk.input,
            status: "running",
          });
          yield {
            type: "tool.call",
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            input: chunk.input,
          };
        } else if (chunk.type === "tool-result") {
          const existing = toolCalls.find((tc) => tc.toolCallId === chunk.toolCallId);
          if (existing) {
            existing.output = chunk.output;
            existing.status = "completed";
          }
          yield {
            type: "tool.result",
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            output: chunk.output,
          };
        } else if (chunk.type === "finish") {
          usageTotals = chunk.usage;
        }
      }
    } catch (err) {
      if (input.signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
        finalStatus = "stopped";
      } else {
        finalStatus = "failed";
        await this.messages.updateContentAndStatus(
          input.userId,
          assistantMsg.id,
          {
            text: accumulatedText,
            ...(accumulatedReasoning ? { reasoning: accumulatedReasoning } : {}),
            ...(toolCalls.length > 0 ? { toolCalls } : {}),
          },
          "failed",
        );
        yield {
          type: "error",
          code: err instanceof AppError ? err.code : "UPSTREAM_ERROR",
          message: err instanceof Error ? err.message : "Model generation failed",
        };
        return;
      }
    }

    await this.messages.updateContentAndStatus(
      input.userId,
      assistantMsg.id,
      {
        text: accumulatedText,
        ...(accumulatedReasoning ? { reasoning: accumulatedReasoning } : {}),
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      },
      finalStatus === "stopped" ? "stopped" : "completed",
    );
    await this.conversations.touch(input.userId, conv.id);

    await this.usage.record({
      userId: input.userId,
      providerId,
      modelId,
      operationType: "chat",
      inputTokens: usageTotals.inputTokens,
      outputTokens: usageTotals.outputTokens,
      reasoningTokens: usageTotals.reasoningTokens,
      latencyMs: Date.now() - startedAt,
    });

    yield {
      type: "message.completed",
      messageId: assistantMsg.id,
      status: finalStatus === "stopped" ? "stopped" : "completed",
      usage: usageTotals,
    };
  }
}
