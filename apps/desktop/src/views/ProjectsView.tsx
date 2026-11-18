import { Badge, Button, Card, Dialog, Input, useToast } from "@ai-workspace/ui";
import { Briefcase, FolderGit2, FolderPlus, Play, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface ProjectItem {
  id: string;
  name: string;
  root_path: string;
  template: string;
}

export function ProjectsView({ onOpenInWork }: { onOpenInWork: (projectId: string) => void }) {
  const { notify } = useToast();
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [gitDiff, setGitDiff] = useState("");
  const [buildCommand, setBuildCommand] = useState("npm run build");
  const [buildOutput, setBuildOutput] = useState<{
    exitCode: number;
    stdout: string;
    stderr: string;
  } | null>(null);
  const [building, setBuilding] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPath, setNewPath] = useState("");
  const [newTemplate, setNewTemplate] = useState<"blank" | "node-ts" | "react-vite">("node-ts");

  const loadProjects = useCallback(async () => {
    const res = await window.epocanvas.projects.list();
    setProjects(res.projects);
    setActiveId((prev) => prev ?? res.projects[0]?.id ?? null);
  }, []);

  const loadProjectFiles = useCallback(async (projectId: string) => {
    const [fRes, dRes] = await Promise.all([
      window.epocanvas.projects.listFiles(projectId),
      window.epocanvas.projects.gitDiff(projectId),
    ]);
    setFiles(fRes.files);
    setGitDiff(dRes.diff);
  }, []);

  useEffect(() => {
    let active = true;
    window.epocanvas.projects
      .list()
      .then((res) => {
        if (!active) return;
        setProjects(res.projects);
        setActiveId((prev) => prev ?? res.projects[0]?.id ?? null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!activeId) return;
    Promise.all([
      window.epocanvas.projects.listFiles(activeId),
      window.epocanvas.projects.gitDiff(activeId),
    ])
      .then(([fRes, dRes]) => {
        if (!active) return;
        setFiles(fRes.files);
        setGitDiff(dRes.diff);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [activeId]);

  const handleCreateProject = async () => {
    if (!newName.trim() || !newPath.trim()) return;
    const { project } = await window.epocanvas.projects.create({
      name: newName.trim(),
      rootPath: newPath.trim(),
      template: newTemplate,
    });
    setCreateOpen(false);
    setNewName("");
    setNewPath("");
    await loadProjects();
    setActiveId(project.id);
    notify(`Project "${project.name}" created`, "success");
  };

  const handleOpenFile = async (relPath: string) => {
    if (!activeId) return;
    const { content } = await window.epocanvas.projects.readFile(activeId, relPath);
    setSelectedFile(relPath);
    setFileContent(content);
    setDirty(false);
  };

  const handleSaveFile = async () => {
    if (!activeId || !selectedFile) return;
    await window.epocanvas.projects.writeFile(activeId, selectedFile, fileContent);
    setDirty(false);
    await loadProjectFiles(activeId);
    notify(`Saved ${selectedFile}`, "success");
  };

  const handleRunBuild = async () => {
    if (!activeId || !buildCommand.trim()) return;
    setBuilding(true);
    try {
      const res = await window.epocanvas.projects.execBuild(activeId, buildCommand.trim());
      setBuildOutput(res);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Build execution failed", "error");
    } finally {
      setBuilding(false);
    }
  };

  const activeProject = projects.find((p) => p.id === activeId);

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] p-2.5">
        <Button size="sm" className="mb-2 w-full" onClick={() => setCreateOpen(true)}>
          <FolderPlus className="h-3.5 w-3.5" />
          New / Open Project
        </Button>
        <div className="flex-1 space-y-1 overflow-y-auto">
          {projects.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setSelectedFile(null);
                setFileContent("");
                setDirty(false);
                setActiveId(p.id);
              }}
              className={`flex w-full flex-col rounded-lg px-2.5 py-2 text-left text-xs cursor-pointer ${
                p.id === activeId
                  ? "bg-[var(--accent)]/12 text-[var(--accent)]"
                  : "text-[var(--fg-muted)] hover:bg-[var(--surface-hover)]"
              }`}
            >
              <span className="truncate font-semibold">{p.name}</span>
              <span className="truncate text-[10px] opacity-75">{p.root_path}</span>
            </button>
          ))}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {!activeProject ? (
          <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
            <FolderGit2 className="mb-2 h-8 w-8 text-[var(--fg-subtle)]" />
            <p className="text-sm font-semibold">No Local Project Selected</p>
            <p className="mt-1 text-xs text-[var(--fg-muted)]">
              Create a real local project folder or open an existing directory on your machine.
            </p>
            <Button size="sm" className="mt-4" onClick={() => setCreateOpen(true)}>
              Create Project
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{activeProject.name}</span>
                <Badge tone="neutral">{activeProject.template}</Badge>
                <span className="hidden text-xs font-mono text-[var(--fg-subtle)] md:inline">
                  {activeProject.root_path}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onOpenInWork(activeProject.id)}
                >
                  <Briefcase className="h-3.5 w-3.5" />
                  Run Agent in Project
                </Button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-12">
              <div className="col-span-3 overflow-y-auto border-r border-[var(--border)] bg-[var(--surface)] p-2">
                <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase text-[var(--fg-muted)]">
                  Files ({files.length})
                </p>
                {files.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => void handleOpenFile(f)}
                    className={`block w-full truncate rounded px-2 py-1 text-left font-mono text-xs cursor-pointer ${
                      f === selectedFile
                        ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                        : "text-[var(--fg-muted)] hover:bg-[var(--surface-hover)]"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>

              <div className="col-span-9 flex min-h-0 flex-col">
                {selectedFile ? (
                  <>
                    <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5 text-xs">
                      <span className="font-mono">
                        {selectedFile} {dirty ? "*" : ""}
                      </span>
                      <Button size="sm" disabled={!dirty} onClick={() => void handleSaveFile()}>
                        <Save className="h-3.5 w-3.5" /> Save
                      </Button>
                    </div>
                    <textarea
                      value={fileContent}
                      onChange={(e) => {
                        setFileContent(e.target.value);
                        setDirty(true);
                      }}
                      className="min-h-0 flex-1 resize-none bg-[var(--bg)] p-3 font-mono text-xs focus:outline-none"
                    />
                  </>
                ) : (
                  <div className="flex flex-1 items-center justify-center text-xs text-[var(--fg-muted)]">
                    Select a file from the tree to inspect or edit.
                  </div>
                )}

                <div className="border-t border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="flex items-center gap-2">
                    <input
                      aria-label="Build command"
                      value={buildCommand}
                      onChange={(e) => setBuildCommand(e.target.value)}
                      className="h-8 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 font-mono text-xs"
                    />
                    <Button size="sm" loading={building} onClick={() => void handleRunBuild()}>
                      <Play className="h-3.5 w-3.5" /> Run Build
                    </Button>
                  </div>
                  {buildOutput && (
                    <Card className="mt-2 max-h-32 overflow-y-auto p-2.5 font-mono text-[11px]">
                      <Badge
                        tone={buildOutput.exitCode === 0 ? "success" : "danger"}
                        className="mb-1"
                      >
                        Exit {buildOutput.exitCode}
                      </Badge>
                      <pre className="whitespace-pre-wrap">
                        {buildOutput.stdout}
                        {buildOutput.stderr}
                      </pre>
                    </Card>
                  )}
                  {gitDiff && (
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer text-[var(--fg-muted)]">Git Diff</summary>
                      <pre className="mt-1 max-h-32 overflow-y-auto rounded bg-[var(--surface-elevated)] p-2 font-mono text-[11px]">
                        {gitDiff}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create or Open Local Project"
        description="Creates files on disk inside your chosen directory."
      >
        <div className="space-y-3">
          <Input
            label="Project name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="my-local-app"
          />
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label="Local directory path"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder="C:\Projects\my-local-app"
              />
            </div>
            <Button
              variant="secondary"
              size="md"
              onClick={async () => {
                const { path: picked } = await window.epocanvas.projects.pickDirectory();
                if (picked) setNewPath(picked);
              }}
            >
              Browse
            </Button>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="prj-template" className="text-xs font-medium text-[var(--fg-muted)]">
              Template
            </label>
            <select
              id="prj-template"
              value={newTemplate}
              onChange={(e) => setNewTemplate(e.target.value as "blank" | "node-ts" | "react-vite")}
              className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
            >
              <option value="node-ts">Node.js Starter (with build script)</option>
              <option value="react-vite">React + Vite Starter</option>
              <option value="blank">Blank Project</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!newName.trim() || !newPath.trim()}
              onClick={() => void handleCreateProject()}
            >
              Create Project
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
