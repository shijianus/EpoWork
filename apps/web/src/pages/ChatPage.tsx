import type { ProviderId } from "@ai-workspace/contracts";
import { Badge, Button, Card, Skeleton, useToast } from "@ai-workspace/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, Check, Paperclip, Pencil, RefreshCw, Send, Square, X } from "lucide-react";
import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ConversationList, type ConversationSummary } from "../components/chat/ConversationList.js";
import { MarkdownRenderer } from "../components/chat/MarkdownRenderer.js";
import { ModelSelector, type CatalogModel } from "../components/chat/ModelSelector.js";
import { ToolCallCard, type ToolCallItem } from "../components/chat/ToolCallCard.js";
import { useChatStream } from "../hooks/useChatStream.js";
import { ApiClientError, apiRequest, getCsrfToken } from "../lib/api-client.js";

interface StoredAttachment {
  artifactId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

interface ChatMessageItem {
  id: string;
  role: "user" | "assistant" | "system";
  content: {
    text: string;
    reasoning?: string;
    attachments?: StoredAttachment[];
    toolCalls?: ToolCallItem[];
  };
  modelId: string | null;
  status: "streaming" | "completed" | "stopped" | "failed";
  seq: number;
  createdAt: string;
}

export function ChatPage() {
  const { id: routeConvId } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const { streaming, draft, streamError, setStreamError, runSseRequest, stop } = useChatStream();

  const [search, setSearch] = useState("");
  const [providerId, setProviderId] = useState<ProviderId>("openai");
  const [modelId, setModelId] = useState("gpt-6.1-sol");
  const [temperature, setTemperature] = useState(0.7);
  const [reasoningEffort, setReasoningEffort] = useState<"low" | "medium" | "high">("medium");
  const [enableWebSearch, setEnableWebSearch] = useState(false);

  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<StoredAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const modelsQuery = useQuery<{ models: CatalogModel[]; configuredProviders: string[] }>({
    queryKey: ["chat-models"],
    queryFn: () => apiRequest("/api/chat/models"),
  });

  const conversationsQuery = useQuery<{ conversations: ConversationSummary[] }>({
    queryKey: ["chat-conversations", search],
    queryFn: () =>
      apiRequest(`/api/chat/conversations${search ? `?q=${encodeURIComponent(search)}` : ""}`),
  });

  const activeConvId = routeConvId || conversationsQuery.data?.conversations[0]?.id;

  const detailQuery = useQuery<{
    conversation: ConversationSummary;
    messages: ChatMessageItem[];
  }>({
    queryKey: ["chat-conversation", activeConvId],
    enabled: Boolean(activeConvId),
    queryFn: () => apiRequest(`/api/chat/conversations/${activeConvId}`),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [detailQuery.data?.messages.length, draft?.text]);

  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ conversation: ConversationSummary }>("/api/chat/conversations", {
        method: "POST",
        body: JSON.stringify({ providerId, modelId }),
      }),
    onSuccess: async ({ conversation }) => {
      await queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
      navigate(`/chat/${conversation.id}`);
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      apiRequest(`/api/chat/conversations/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
      await queryClient.invalidateQueries({ queryKey: ["chat-conversation", activeConvId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/chat/conversations/${id}`, { method: "DELETE" }),
    onSuccess: async (_data, deletedId) => {
      await queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
      if (deletedId === activeConvId) {
        navigate("/chat", { replace: true });
      }
      notify("Conversation deleted", "info");
    },
  });

  const selectedModelMeta = modelsQuery.data?.models.find((m) => m.id === modelId);

  const uploadFile = async (file: File) => {
    if (
      file.type.startsWith("image/") &&
      selectedModelMeta &&
      !selectedModelMeta.capabilities.imageInput
    ) {
      notify(`${selectedModelMeta.displayName} does not support image input`, "error");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      if (activeConvId) form.append("conversationId", activeConvId);
      const csrf = getCsrfToken();
      const res = await fetch("/api/files/upload", {
        method: "POST",
        credentials: "include",
        headers: csrf ? { "X-CSRF-Token": csrf } : {},
        body: form,
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(err?.error?.message || `Upload failed (${res.status})`);
      }
      const { artifact } = (await res.json()) as {
        artifact: { id: string; name: string; mimeType: string; sizeBytes: number };
      };
      setAttachments((prev) => [
        ...prev,
        {
          artifactId: artifact.id,
          name: artifact.name,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.sizeBytes,
        },
      ]);
      notify(`Attached ${artifact.name}`, "success");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Upload failed", "error");
    } finally {
      setUploading(false);
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items);
    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          void uploadFile(file);
        }
      }
    }
  };

  const refreshActiveConversation = async (convId: string) => {
    await queryClient.invalidateQueries({ queryKey: ["chat-conversation", convId] });
    await queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
  };

  const handleSend = async (e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || streaming) return;

    try {
      let targetId = activeConvId;
      if (!targetId) {
        const created = await apiRequest<{ conversation: ConversationSummary }>(
          "/api/chat/conversations",
          {
            method: "POST",
            body: JSON.stringify({ providerId, modelId }),
          },
        );
        targetId = created.conversation.id;
        navigate(`/chat/${targetId}`, { replace: true });
      }

      const attachmentIds = attachments.map((a) => a.artifactId);
      setPrompt("");
      setAttachments([]);

      await runSseRequest(
        `/api/chat/conversations/${targetId}/messages`,
        "POST",
        {
          prompt: trimmed,
          providerId,
          modelId,
          temperature,
          reasoningEffort,
          attachmentIds,
          enableWebSearch,
        },
        () => refreshActiveConversation(targetId!),
      );
    } catch (err) {
      setStreamError(err instanceof ApiClientError ? err.message : "Failed to send message");
    }
  };

  const handleEditSave = async (messageId: string) => {
    if (!activeConvId || !editDraft.trim() || streaming) return;
    setEditingMessageId(null);
    await runSseRequest(
      `/api/chat/conversations/${activeConvId}/messages/${messageId}`,
      "PATCH",
      { text: editDraft.trim(), providerId, modelId, enableWebSearch },
      () => refreshActiveConversation(activeConvId),
    );
  };

  const handleRegenerate = async () => {
    if (!activeConvId || streaming) return;
    await runSseRequest(
      `/api/chat/conversations/${activeConvId}/regenerate`,
      "POST",
      { providerId, modelId, temperature, reasoningEffort, enableWebSearch },
      () => refreshActiveConversation(activeConvId),
    );
  };

  const messages = detailQuery.data?.messages ?? [];

  return (
    <div className="-m-4 flex h-[calc(100vh-3.5rem)] md:-m-6">
      <div className="hidden w-64 shrink-0 lg:block">
        <ConversationList
          conversations={conversationsQuery.data?.conversations ?? []}
          activeId={activeConvId}
          search={search}
          onSearchChange={setSearch}
          onSelect={(id) => navigate(`/chat/${id}`)}
          onCreate={() => createMutation.mutate()}
          onRename={(id, title) => renameMutation.mutate({ id, title })}
          onDelete={(id) => deleteMutation.mutate(id)}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2.5">
          <ModelSelector
            models={modelsQuery.data?.models ?? []}
            providerId={providerId}
            modelId={modelId}
            temperature={temperature}
            reasoningEffort={reasoningEffort}
            enableWebSearch={enableWebSearch}
            onSelectModel={(pid, mid) => {
              setProviderId(pid);
              setModelId(mid);
            }}
            onChangeTemperature={setTemperature}
            onChangeReasoningEffort={setReasoningEffort}
            onToggleWebSearch={setEnableWebSearch}
          />
          {activeConvId && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                navigate("/work", {
                  state: { fromConversationId: activeConvId, prompt },
                })
              }
            >
              <Briefcase className="h-3.5 w-3.5" />
              <span>Send to Work</span>
            </Button>
          )}
        </div>

        {/* Messages Area */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4 md:p-6">
          {detailQuery.isLoading ? (
            <div className="mx-auto max-w-3xl space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-24 w-3/4" />
            </div>
          ) : messages.length === 0 && !draft ? (
            <div className="mx-auto mt-12 max-w-xl text-center">
              <h2 className="text-lg font-semibold">Start a Native Multi-Model Chat</h2>
              <p className="mt-2 text-xs text-[var(--fg-muted)]">
                Switch seamlessly between OpenAI, Anthropic Claude, and Google Gemini using your
                encrypted BYOK keys from Settings.
              </p>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-4">
              {messages.map((msg, idx) => {
                const isLastAssistant =
                  msg.role === "assistant" && idx === messages.length - 1 && !streaming;
                return (
                  <Card
                    key={msg.id}
                    className={`p-4 ${
                      msg.role === "user"
                        ? "ml-auto max-w-[85%] bg-[var(--accent)]/10 border-[var(--accent)]/25"
                        : "bg-[var(--surface)]"
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between text-[11px] text-[var(--fg-muted)]">
                      <span className="font-semibold uppercase tracking-wider">
                        {msg.role === "user" ? "You" : msg.modelId || "Assistant"}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {msg.status === "stopped" && <Badge tone="warning">Stopped</Badge>}
                        {msg.status === "failed" && <Badge tone="danger">Failed</Badge>}
                        {msg.role === "user" && !streaming && (
                          <button
                            type="button"
                            aria-label="Edit message"
                            onClick={() => {
                              setEditingMessageId(msg.id);
                              setEditDraft(msg.content.text);
                            }}
                            className="rounded p-1 hover:bg-[var(--surface-hover)] cursor-pointer"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        )}
                        {isLastAssistant && (
                          <button
                            type="button"
                            aria-label="Regenerate response"
                            onClick={() => void handleRegenerate()}
                            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-[var(--surface-hover)] cursor-pointer"
                          >
                            <RefreshCw className="h-3 w-3" />
                            <span>Regenerate</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {msg.content.attachments && msg.content.attachments.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-2">
                        {msg.content.attachments.map((att) =>
                          att.mimeType.startsWith("image/") ? (
                            <img
                              key={att.artifactId}
                              src={`/api/files/${att.artifactId}`}
                              alt={att.name}
                              className="max-h-40 rounded-lg border border-[var(--border)] object-cover"
                            />
                          ) : (
                            <Badge key={att.artifactId} tone="neutral">
                              <Paperclip className="h-3 w-3" />
                              {att.name}
                            </Badge>
                          ),
                        )}
                      </div>
                    )}

                    {msg.content.reasoning && (
                      <details className="mb-2 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-xs text-[var(--fg-muted)]">
                        <summary className="cursor-pointer font-medium">Reasoning trace</summary>
                        <p className="mt-1.5 whitespace-pre-wrap">{msg.content.reasoning}</p>
                      </details>
                    )}

                    {msg.content.toolCalls?.map((tc) => (
                      <ToolCallCard key={tc.toolCallId} toolCall={tc} />
                    ))}

                    {editingMessageId === msg.id ? (
                      <div className="space-y-2">
                        <textarea
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          rows={3}
                          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-sm"
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingMessageId(null)}
                          >
                            <X className="h-3.5 w-3.5" /> Cancel
                          </Button>
                          <Button size="sm" onClick={() => void handleEditSave(msg.id)}>
                            <Check className="h-3.5 w-3.5" /> Save & Re-run
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <MarkdownRenderer content={msg.content.text} />
                    )}
                  </Card>
                );
              })}

              {draft && (
                <Card className="p-4">
                  <div className="mb-2 flex items-center justify-between text-[11px] text-[var(--fg-muted)]">
                    <span className="font-semibold uppercase tracking-wider">{modelId}</span>
                    <Badge tone="accent">Streaming</Badge>
                  </div>
                  {draft.reasoning && (
                    <div className="mb-2 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-2 text-xs text-[var(--fg-muted)]">
                      {draft.reasoning}
                    </div>
                  )}
                  {draft.toolCalls.map((tc) => (
                    <ToolCallCard key={tc.toolCallId} toolCall={tc} />
                  ))}
                  <MarkdownRenderer content={draft.text || "..."} />
                </Card>
              )}

              {streamError && (
                <div
                  role="alert"
                  className="flex items-center justify-between rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-400"
                >
                  <span>{streamError}</span>
                  <Button size="sm" variant="secondary" onClick={() => void handleRegenerate()}>
                    <RefreshCw className="h-3.5 w-3.5" /> Retry
                  </Button>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Composer */}
        <form
          onSubmit={handleSend}
          className="border-t border-[var(--border)] bg-[var(--surface)] p-3 md:p-4"
        >
          <div className="mx-auto max-w-3xl space-y-2">
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {attachments.map((att) => (
                  <Badge key={att.artifactId} tone="neutral" className="gap-1.5 py-1">
                    <span>{att.name}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${att.name}`}
                      onClick={() =>
                        setAttachments((prev) =>
                          prev.filter((a) => a.artifactId !== att.artifactId),
                        )
                      }
                      className="cursor-pointer"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            <div className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="image/*,.txt,.md,.json,.csv,.pdf"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadFile(file);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={uploading}
                aria-label="Attach file or image"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <textarea
                aria-label="Chat message input"
                rows={2}
                value={prompt}
                onPaste={handlePaste}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder="Ask anything... (Shift+Enter for newline, paste images supported)"
                className="min-h-[42px] flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] focus:border-[var(--accent)] focus:outline-none"
              />
              {streaming ? (
                <Button type="button" variant="danger" size="md" onClick={stop}>
                  <Square className="h-4 w-4" />
                  <span>Stop</span>
                </Button>
              ) : (
                <Button type="submit" size="md" disabled={!prompt.trim()}>
                  <Send className="h-4 w-4" />
                  <span>Send</span>
                </Button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
