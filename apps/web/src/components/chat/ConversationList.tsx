import { Button, Input } from "@ai-workspace/ui";
import { Check, MessageSquarePlus, Pencil, Search, Trash2, X } from "lucide-react";
import { useState } from "react";

export interface ConversationSummary {
  id: string;
  title: string;
  provider_id: string;
  model_id: string;
  updated_at: string;
}

interface ConversationListProps {
  conversations: ConversationSummary[];
  activeId?: string;
  search: string;
  onSearchChange: (q: string) => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

export function ConversationList({
  conversations,
  activeId,
  search,
  onSearchChange,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: ConversationListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  return (
    <div className="flex h-full flex-col border-r border-[var(--border)] bg-[var(--surface)]">
      <div className="space-y-2 border-b border-[var(--border)] p-3">
        <Button size="sm" className="w-full" onClick={onCreate}>
          <MessageSquarePlus className="h-3.5 w-3.5" />
          <span>New Chat</span>
        </Button>
        <div className="relative">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 h-3.5 w-3.5 text-[var(--fg-subtle)]" />
          <Input
            aria-label="Search conversations"
            placeholder="Search history..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {conversations.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-[var(--fg-muted)]">
            No conversations yet.
          </p>
        ) : (
          conversations.map((conv) => {
            const active = conv.id === activeId;
            const isEditing = editingId === conv.id;
            return (
              <div
                key={conv.id}
                className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs ${
                  active
                    ? "bg-[var(--accent)]/12 text-[var(--accent)]"
                    : "text-[var(--fg-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]"
                }`}
              >
                {isEditing ? (
                  <div className="flex flex-1 items-center gap-1">
                    <input
                      aria-label="Rename conversation"
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && draftTitle.trim()) {
                          onRename(conv.id, draftTitle.trim());
                          setEditingId(null);
                        } else if (e.key === "Escape") {
                          setEditingId(null);
                        }
                      }}
                      className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 text-xs text-[var(--fg)]"
                      autoFocus
                    />
                    <button
                      type="button"
                      aria-label="Save title"
                      onClick={() => {
                        if (draftTitle.trim()) {
                          onRename(conv.id, draftTitle.trim());
                        }
                        setEditingId(null);
                      }}
                      className="p-0.5 text-emerald-400 cursor-pointer"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Cancel rename"
                      onClick={() => setEditingId(null)}
                      className="p-0.5 text-[var(--fg-subtle)] cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => onSelect(conv.id)}
                      className="min-w-0 flex-1 truncate text-left font-medium cursor-pointer"
                    >
                      {conv.title}
                    </button>
                    <button
                      type="button"
                      aria-label={`Rename ${conv.title}`}
                      onClick={() => {
                        setEditingId(conv.id);
                        setDraftTitle(conv.title);
                      }}
                      className="hidden rounded p-1 hover:bg-[var(--surface)] group-hover:inline-flex cursor-pointer"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${conv.title}`}
                      onClick={() => onDelete(conv.id)}
                      className="hidden rounded p-1 text-rose-400 hover:bg-[var(--surface)] group-hover:inline-flex cursor-pointer"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
