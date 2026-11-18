import { useCallback, useRef, useState } from "react";
import { getCsrfToken } from "../lib/api-client.js";
import type { ToolCallItem } from "../components/chat/ToolCallCard.js";

export interface StreamingDraft {
  messageId: string | null;
  text: string;
  reasoning: string;
  toolCalls: ToolCallItem[];
}

export function useChatStream() {
  const [streaming, setStreaming] = useState(false);
  const [draft, setDraft] = useState<StreamingDraft | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const runSseRequest = useCallback(
    async (
      url: string,
      method: "POST" | "PATCH",
      body: Record<string, unknown>,
      onComplete: () => Promise<void> | void,
    ) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setStreaming(true);
      setStreamError(null);
      setDraft({ messageId: null, text: "", reasoning: "", toolCalls: [] });

      try {
        const csrf = getCsrfToken();
        const res = await fetch(url, {
          method,
          credentials: "include",
          signal: ac.signal,
          headers: {
            "Content-Type": "application/json",
            ...(csrf ? { "X-CSRF-Token": csrf } : {}),
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const errJson = (await res.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          throw new Error(errJson?.error?.message || `HTTP ${res.status}`);
        }

        if (!res.body) {
          throw new Error("Empty streaming response body");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const line = frame.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            const event = JSON.parse(line.slice(6)) as {
              type: string;
              messageId?: string;
              delta?: string;
              toolCallId?: string;
              toolName?: string;
              input?: unknown;
              output?: unknown;
              message?: string;
            };

            if (event.type === "message.started") {
              setDraft((prev) => ({
                messageId: event.messageId ?? null,
                text: prev?.text ?? "",
                reasoning: prev?.reasoning ?? "",
                toolCalls: prev?.toolCalls ?? [],
              }));
            } else if (event.type === "message.delta" && event.delta) {
              setDraft((prev) => (prev ? { ...prev, text: prev.text + event.delta } : prev));
            } else if (event.type === "reasoning.delta" && event.delta) {
              setDraft((prev) =>
                prev ? { ...prev, reasoning: prev.reasoning + event.delta } : prev,
              );
            } else if (event.type === "tool.call" && event.toolCallId && event.toolName) {
              setDraft((prev) =>
                prev
                  ? {
                      ...prev,
                      toolCalls: [
                        ...prev.toolCalls,
                        {
                          toolCallId: event.toolCallId!,
                          toolName: event.toolName!,
                          input: event.input,
                          status: "running",
                        },
                      ],
                    }
                  : prev,
              );
            } else if (event.type === "tool.result" && event.toolCallId) {
              setDraft((prev) =>
                prev
                  ? {
                      ...prev,
                      toolCalls: prev.toolCalls.map((tc) =>
                        tc.toolCallId === event.toolCallId
                          ? { ...tc, output: event.output, status: "completed" }
                          : tc,
                      ),
                    }
                  : prev,
              );
            } else if (event.type === "error") {
              setStreamError(event.message || "Generation failed");
            }
          }
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setStreamError(err instanceof Error ? err.message : "Streaming request failed");
        }
      } finally {
        setStreaming(false);
        setDraft(null);
        await onComplete();
      }
    },
    [],
  );

  return { streaming, draft, streamError, setStreamError, runSseRequest, stop };
}
