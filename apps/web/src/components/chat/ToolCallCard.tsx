import { Badge } from "@ai-workspace/ui";
import { ChevronDown, ChevronRight, Wrench } from "lucide-react";
import { useState } from "react";

export interface ToolCallItem {
  toolCallId: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  status: "running" | "completed" | "failed";
}

export function ToolCallCard({ toolCall }: { toolCall: ToolCallItem }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-2 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] text-xs">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between px-3 py-2 text-left cursor-pointer"
      >
        <span className="flex items-center gap-2 font-medium text-[var(--fg)]">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-[var(--fg-muted)]" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-[var(--fg-muted)]" />
          )}
          <Wrench className="h-3.5 w-3.5 text-[var(--accent)]" />
          <span className="font-mono">{toolCall.toolName}</span>
        </span>
        <Badge
          tone={
            toolCall.status === "completed"
              ? "success"
              : toolCall.status === "failed"
                ? "danger"
                : "accent"
          }
        >
          {toolCall.status}
        </Badge>
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-[var(--border)] p-3 font-mono text-[11px]">
          <div>
            <p className="mb-1 text-[var(--fg-muted)]">Input:</p>
            <pre className="overflow-x-auto rounded bg-[var(--surface)] p-2">
              {JSON.stringify(toolCall.input, null, 2)}
            </pre>
          </div>
          {toolCall.output !== undefined && (
            <div>
              <p className="mb-1 text-[var(--fg-muted)]">Output:</p>
              <pre className="overflow-x-auto rounded bg-[var(--surface)] p-2">
                {JSON.stringify(toolCall.output, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
