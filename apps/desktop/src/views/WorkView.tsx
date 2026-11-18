import type { AgentEvent, ProviderId } from "@ai-workspace/contracts";
import { Badge, Button, Card, useToast } from "@ai-workspace/ui";
import { Check, Play, ShieldAlert, Square, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { MarkdownView } from "../components/MarkdownView.js";

interface ProjectItem {
  id: string;
  name: string;
  root_path: string;
}

interface RunSummary {
  id: string;
  project_id: string | null;
  model_id: string;
  status: string;
  prompt: string;
  error_message: string | null;
}

export function WorkView({ initialProjectId }: { initialProjectId?: string | null }) {
  const { notify } = useToast();
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [projectId, setProjectId] = useState<string>(initialProjectId || "");
  const [models, setModels] = useState<
    Array<{ id: string; providerId: ProviderId; displayName: string; configured: boolean }>
  >([]);
  const [providerId, setProviderId] = useState<ProviderId>("openai");
  const [modelId, setModelId] = useState("gpt-6.1-sol");
  const [prompt, setPrompt] = useState("");
  const [requireWriteApproval, setRequireWriteApproval] = useState(false);

  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);

  const loadInitial = useCallback(async () => {
    const [pRes, mRes, rRes] = await Promise.all([
      window.epocanvas.projects.list(),
      window.epocanvas.chat.models(),
      window.epocanvas.work.listRuns(),
    ]);
    setProjects(pRes.projects);
    setProjectId((prev) => prev || initialProjectId || pRes.projects[0]?.id || "");
    setModels(mRes.models);
    setRuns(rRes.runs);
    setActiveRunId((prev) => prev ?? rRes.runs[0]?.id ?? null);
  }, [initialProjectId]);

  useEffect(() => {
    let active = true;
    Promise.all([
      window.epocanvas.projects.list(),
      window.epocanvas.chat.models(),
      window.epocanvas.work.listRuns(),
    ])
      .then(([pRes, mRes, rRes]) => {
        if (!active) return;
        setProjects(pRes.projects);
        setProjectId((prev) => prev || initialProjectId || pRes.projects[0]?.id || "");
        setModels(mRes.models);
        setRuns(rRes.runs);
        setActiveRunId((prev) => prev ?? rRes.runs[0]?.id ?? null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [initialProjectId]);

  useEffect(() => {
    let active = true;
    if (!activeRunId) return;
    window.epocanvas.work
      .getRun(activeRunId)
      .then((res) => {
        if (active) setEvents(res.events);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [activeRunId]);

  useEffect(() => {
    const off = window.epocanvas.work.onWorkEvent((ev) => {
      if (ev.runId === activeRunId) {
        setEvents((prev) => (prev.some((p) => p.id === ev.id) ? prev : [...prev, ev]));
      }
      if (
        ev.type === "run.completed" ||
        ev.type === "run.failed" ||
        ev.type === "run.cancelled" ||
        ev.type === "approval.required" ||
        ev.type === "approval.resolved"
      ) {
        void loadInitial();
      }
    });
    return off;
  }, [activeRunId, loadInitial]);

  const handleStart = async () => {
    if (!projectId || !prompt.trim()) return;
    try {
      const { runId } = await window.epocanvas.work.startRun({
        projectId,
        providerId,
        modelId,
        prompt: prompt.trim(),
        requireApprovalForWrites: requireWriteApproval,
      });
      setPrompt("");
      await loadInitial();
      setActiveRunId(runId);
      setEvents([]);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to start Work run", "error");
    }
  };

  const activeRun = runs.find((r) => r.id === activeRunId);
  const resolvedApprovals = new Set(
    events.filter((e) => e.type === "approval.resolved").map((e) => String(e.payload.approvalId)),
  );
  const pendingApprovals = events.filter(
    (e) => e.type === "approval.required" && !resolvedApprovals.has(String(e.payload.approvalId)),
  );
  const assistantOutput = events
    .filter((e) => e.type === "message.delta")
    .map((e) => String(e.payload.delta ?? ""))
    .join("");

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-64 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] p-3">
        <p className="mb-2 text-xs font-semibold uppercase text-[var(--fg-muted)]">
          Work Runs ({runs.length})
        </p>
        <div className="flex-1 space-y-1.5 overflow-y-auto">
          {runs.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setActiveRunId(r.id)}
              className={`block w-full rounded-lg border p-2 text-left text-xs cursor-pointer ${
                r.id === activeRunId
                  ? "border-[var(--accent)] bg-[var(--accent)]/10"
                  : "border-[var(--border)] hover:bg-[var(--surface-hover)]"
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <Badge
                  tone={
                    r.status === "completed"
                      ? "success"
                      : r.status === "failed"
                        ? "danger"
                        : r.status === "waiting_approval"
                          ? "warning"
                          : "accent"
                  }
                >
                  {r.status}
                </Badge>
                <span className="truncate text-[10px] text-[var(--fg-subtle)]">{r.model_id}</span>
              </div>
              <p className="mt-1 truncate font-medium text-[var(--fg)]">{r.prompt}</p>
            </button>
          ))}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="space-y-2 border-b border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Target project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="h-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs font-medium"
            >
              <option value="">Select project...</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.root_path})
                </option>
              ))}
            </select>

            <select
              aria-label="Agent model"
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
                  {m.displayName} {m.configured ? "" : "(No Key)"}
                </option>
              ))}
            </select>

            <label className="flex items-center gap-1.5 text-xs text-[var(--fg-muted)] cursor-pointer">
              <input
                type="checkbox"
                checked={requireWriteApproval}
                onChange={(e) => setRequireWriteApproval(e.target.checked)}
              />
              Approve every file write
            </label>
          </div>

          <div className="flex gap-2">
            <input
              aria-label="Agent task prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the coding task (e.g. 'Update src/index.mjs and run npm run build')..."
              className="h-9 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-sm"
            />
            {activeRun &&
            (activeRun.status === "running" || activeRun.status === "waiting_approval") ? (
              <Button
                variant="danger"
                size="sm"
                onClick={() => void window.epocanvas.work.cancel(activeRun.id)}
              >
                <Square className="h-3.5 w-3.5" /> Cancel
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={!projectId || !prompt.trim()}
                onClick={() => void handleStart()}
              >
                <Play className="h-3.5 w-3.5" /> Start Agent Run
              </Button>
            )}
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {pendingApprovals.map((ev) => {
            const approvalId = String(ev.payload.approvalId);
            return (
              <Card key={ev.id} className="border-amber-500/40 bg-amber-500/10 p-4 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-1.5 font-semibold text-amber-300">
                      <ShieldAlert className="h-4 w-4" />
                      Approval Required: {String(ev.payload.toolName)} (
                      {String(ev.payload.riskLevel)})
                    </p>
                    <p className="mt-1 text-[var(--fg)]">{String(ev.payload.summary)}</p>
                    <pre className="mt-2 overflow-x-auto rounded bg-black/30 p-2 font-mono text-[11px]">
                      {JSON.stringify(ev.payload.payload, null, 2)}
                    </pre>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      onClick={() => void window.epocanvas.work.approve(approvalId, "approve_once")}
                    >
                      <Check className="h-3.5 w-3.5" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => void window.epocanvas.work.approve(approvalId, "reject")}
                    >
                      <X className="h-3.5 w-3.5" /> Reject
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}

          {assistantOutput && (
            <Card className="p-4">
              <p className="mb-1.5 text-xs font-semibold uppercase text-[var(--fg-muted)]">
                Agent Summary
              </p>
              <MarkdownView content={assistantOutput} />
            </Card>
          )}

          <Card className="p-4">
            <p className="mb-2 text-xs font-semibold uppercase text-[var(--fg-muted)]">
              Execution Timeline ({events.length} events)
            </p>
            {events.length === 0 ? (
              <p className="text-xs text-[var(--fg-muted)]">
                Start a run inside a local project to watch real-time tool &amp; build events.
              </p>
            ) : (
              <div className="space-y-1.5 font-mono text-[11px]">
                {events
                  .filter((e) => e.type !== "message.delta")
                  .map((ev) => (
                    <div
                      key={ev.id}
                      className="rounded border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-1.5"
                    >
                      <span className="text-[var(--fg-subtle)]">#{ev.seq}</span>{" "}
                      <span className="font-semibold text-[var(--accent)]">{ev.type}</span>{" "}
                      <span className="text-[var(--fg-muted)]">
                        {JSON.stringify(ev.payload).slice(0, 300)}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
