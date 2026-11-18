import { ToastProvider } from "@ai-workspace/ui";
import { Briefcase, FolderGit2, Layers, MessageSquare, Moon, Settings, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { ChatView } from "./views/ChatView.js";
import { ProjectsView } from "./views/ProjectsView.js";
import { SettingsView } from "./views/SettingsView.js";
import { WorkView } from "./views/WorkView.js";

type TabId = "chat" | "work" | "projects" | "settings";

const TABS: Array<{ id: TabId; label: string; Icon: typeof MessageSquare }> = [
  { id: "chat", label: "Chat", Icon: MessageSquare },
  { id: "work", label: "Work", Icon: Briefcase },
  { id: "projects", label: "Projects", Icon: FolderGit2 },
  { id: "settings", label: "Settings", Icon: Settings },
];

export function App() {
  const [tab, setTab] = useState<TabId>("chat");
  const [dark, setDark] = useState(true);
  const [workProjectId, setWorkProjectId] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  return (
    <ToastProvider>
      <div className="flex h-screen bg-[var(--bg)] text-[var(--fg)]">
        <aside className="flex w-52 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)]">
          <div className="flex h-13 items-center justify-between border-b border-[var(--border)] px-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--accent-fg)]">
                <Layers className="h-4 w-4" />
              </div>
              <span className="text-sm font-semibold">EpoCanvas</span>
            </div>
            <button
              type="button"
              aria-label="Toggle theme"
              onClick={() => setDark((d) => !d)}
              className="rounded-md p-1.5 text-[var(--fg-muted)] hover:bg-[var(--surface-hover)] cursor-pointer"
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>

          <nav aria-label="Desktop navigation" className="flex-1 space-y-1 p-2">
            {TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors cursor-pointer ${
                  tab === id
                    ? "bg-[var(--accent)]/12 text-[var(--accent)]"
                    : "text-[var(--fg-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{label}</span>
              </button>
            ))}
          </nav>

          <div className="border-t border-[var(--border)] p-3 text-[11px] text-[var(--fg-subtle)]">
            Local-first Desktop Mode
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-hidden">
          {tab === "chat" && (
            <ChatView key={refreshTick} onOpenSettings={() => setTab("settings")} />
          )}
          {tab === "work" && <WorkView initialProjectId={workProjectId} />}
          {tab === "projects" && (
            <ProjectsView
              onOpenInWork={(pid) => {
                setWorkProjectId(pid);
                setTab("work");
              }}
            />
          )}
          {tab === "settings" && (
            <div className="h-full overflow-y-auto p-6">
              <SettingsView onUpdated={() => setRefreshTick((t) => t + 1)} />
            </div>
          )}
        </main>
      </div>
    </ToastProvider>
  );
}
