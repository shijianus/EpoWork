import type { ProviderId } from "@ai-workspace/contracts";
import { Badge, Button, Card, useToast } from "@ai-workspace/ui";
import { MessageSquarePlus, Send, Square, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { MarkdownView } from "../components/MarkdownView.js";

interface DesktopModel {
  id: string;
  providerId: ProviderId;
  displayName: string;
  supportsTemperature: boolean;
  configured: boolean;
}

interface ConvItem {
  id: string;
  title: string;
  provider_id: string;
  model_id: string;
}

interface MsgItem {
  id: string;
  role: "user" | "assistant" | "system";
  content: { text: string; reasoning?: string };
  modelId: string | null;
  status: string;
}

export function ChatView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { notify } = useToast();
  const [models, setModels] = useState<DesktopModel[]>([]);
  const [providerId, setProviderId] = useState<ProviderId>("openai");
  const [modelId, setModelId] = useState("gpt-6.1-sol");
  const [conversations, setConversations] = useState<ConvItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MsgItem[]>([]);
  const [prompt, setPrompt] = useState("");
  const [streamId, setStreamId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const loadMeta = useCallback(async () => {
    const [mRes, cRes] = await Promise.all([
      window.epocanvas.chat.models(),
      window.epocanvas.chat.listConversations(),
    ]);
    setModels(mRes.models);
    setConversations(cRes.conversations);
    setActiveId((prev) => prev ?? cRes.conversations[0]?.id ?? null);
  }, []);

  const loadMessages = useCallback(async (id: string) => {
    const detail = await window.epocanvas.chat.getConversation(id);
    setMessages(detail.messages);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([window.epocanvas.chat.models(), window.epocanvas.chat.listConversations()])
      .then(([mRes, cRes]) => {
        if (!active) return;
        setModels(mRes.models);
        setConversations(cRes.conversations);
        setActiveId((prev) => prev ?? cRes.conversations[0]?.id ?? null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!activeId) return;
    window.epocanvas.chat
      .getConversation(activeId)
      .then((detail) => {
        if (active) setMessages(detail.messages);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, draftText]);

  useEffect(() => {
    const off = window.epocanvas.chat.onStreamEvent((payload) => {
      const ev = payload.event;
      if (ev.type === "message.started") {
        setDraftText("");
      } else if (ev.type === "message.delta" && ev.delta) {
        setDraftText((prev) => (prev ?? "") + ev.delta);
      } else if (ev.type === "error") {
        setErrorMsg(ev.message || "Model error");
        setStreamId(null);
        setDraftText(null);
        void loadMessages(payload.conversationId);
      } else if (ev.type === "message.completed") {
        setStreamId(null);
        setDraftText(null);
        void loadMessages(payload.conversationId);
        void loadMeta();
      }
    });
    return off;
  }, [loadMessages, loadMeta]);

  const handleNewChat = async () => {
    const { conversation } = await window.epocanvas.chat.createConversation({
      providerId,
      modelId,
    });
    await loadMeta();
    setActiveId(conversation.id);
  };

  const handleDelete = async (id: string) => {
    await window.epocanvas.chat.deleteConversation(id);
    if (activeId === id) {
      setActiveId(null);
      setMessages([]);
    }
    await loadMeta();
  };

  const handleSend = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = prompt.trim();
    if (!text || streamId) return;
    setErrorMsg(null);

    try {
      let targetId = activeId;
      if (!targetId) {
        const created = await window.epocanvas.chat.createConversation({ providerId, modelId });
        targetId = created.conversation.id;
        setActiveId(targetId);
      }
      setPrompt("");
      setMessages((prev) => [
        ...prev,
        {
          id: `local_${Date.now()}`,
          role: "user",
          content: { text },
          modelId: null,
          status: "completed",
        },
      ]);
      const res = await window.epocanvas.chat.sendMessage({
        conversationId: targetId,
        prompt: text,
        providerId,
        modelId,
      });
      setStreamId(res.streamId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send message";
      setErrorMsg(msg);
      notify(msg, "error");
    }
  };

  const selectedModel = models.find((m) => m.id === modelId);

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] p-2.5">
        <Button size="sm" className="mb-2 w-full" onClick={() => void handleNewChat()}>
          <MessageSquarePlus className="h-3.5 w-3.5" />
          New Chat
        </Button>
        <div className="flex-1 space-y-1 overflow-y-auto">
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center justify-between rounded-lg px-2 py-1.5 text-xs ${
                c.id === activeId
                  ? "bg-[var(--accent)]/12 text-[var(--accent)]"
                  : "text-[var(--fg-muted)] hover:bg-[var(--surface-hover)]"
              }`}
            >
              <button
                type="button"
                onClick={() => setActiveId(c.id)}
                className="min-w-0 flex-1 truncate text-left font-medium cursor-pointer"
              >
                {c.title}
              </button>
              <button
                type="button"
                aria-label={`Delete ${c.title}`}
                onClick={() => void handleDelete(c.id)}
                className="hidden p-1 text-rose-400 group-hover:inline-flex cursor-pointer"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2">
          <div className="flex items-center gap-2">
            <select
              aria-label="Select model"
              value={modelId}
              onChange={(e) => {
                const picked = models.find((m) => m.id === e.target.value);
                if (picked) {
                  setProviderId(picked.providerId);
                  setModelId(picked.id);
                }
              }}
              className="h-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs font-medium"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} ({m.providerId}) {m.configured ? "" : "- No Key"}
                </option>
              ))}
            </select>
            {selectedModel && (
              <Badge tone={selectedModel.configured ? "success" : "warning"}>
                {selectedModel.configured ? "Key ready" : "Configure API Key"}
              </Badge>
            )}
            {selectedModel && !selectedModel.configured && (
              <Button size="sm" variant="ghost" onClick={onOpenSettings}>
                Open Settings
              </Button>
            )}
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 && draftText === null ? (
            <div className="mx-auto mt-16 max-w-md text-center text-xs text-[var(--fg-muted)]">
              <p className="text-sm font-semibold text-[var(--fg)]">Local-First Native Chat</p>
              <p className="mt-1.5">
                Conversations are persisted in your local SQLite database and encrypted keys stay
                inside the OS credential vault.
              </p>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-3">
              {messages.map((m) => (
                <Card
                  key={m.id}
                  className={`p-3.5 ${
                    m.role === "user"
                      ? "ml-auto max-w-[85%] bg-[var(--accent)]/10 border-[var(--accent)]/25"
                      : ""
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between text-[11px] text-[var(--fg-muted)]">
                    <span className="font-semibold uppercase">
                      {m.role === "user" ? "You" : m.modelId || "Assistant"}
                    </span>
                    {m.status === "stopped" && <Badge tone="warning">Stopped</Badge>}
                  </div>
                  <MarkdownView content={m.content.text} />
                </Card>
              ))}
              {draftText !== null && (
                <Card className="p-3.5">
                  <div className="mb-1 flex items-center justify-between text-[11px] text-[var(--fg-muted)]">
                    <span className="font-semibold uppercase">{modelId}</span>
                    <Badge tone="accent">Streaming</Badge>
                  </div>
                  <MarkdownView content={draftText || "..."} />
                </Card>
              )}
              {errorMsg && (
                <div
                  role="alert"
                  className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-400"
                >
                  {errorMsg}
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <form
          onSubmit={handleSend}
          className="border-t border-[var(--border)] bg-[var(--surface)] p-3"
        >
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <textarea
              rows={2}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder="Send a message... (Enter to send)"
              className="flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm focus:border-[var(--accent)] focus:outline-none"
            />
            {streamId ? (
              <Button
                type="button"
                variant="danger"
                onClick={() => void window.epocanvas.chat.stopStream(streamId)}
              >
                <Square className="h-4 w-4" /> Stop
              </Button>
            ) : (
              <Button type="submit" disabled={!prompt.trim()}>
                <Send className="h-4 w-4" /> Send
              </Button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
