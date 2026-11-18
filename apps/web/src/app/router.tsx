import { Skeleton } from "@ai-workspace/ui";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell.js";
import { useAuth } from "../hooks/useAuth.js";
import { ChatPage } from "../pages/ChatPage.js";
import { LoginPage } from "../pages/LoginPage.js";
import { ModuleStagePage } from "../pages/ModuleStagePage.js";
import { RegisterPage } from "../pages/RegisterPage.js";
import { SettingsPage } from "../pages/SettingsPage.js";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-6">
        <div className="w-full max-w-md space-y-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/chat" replace />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="chat/:id" element={<ChatPage />} />
          <Route
            path="work"
            element={
              <ModuleStagePage
                title="Work Agent Platform"
                phase="Phase P3–P4"
                summary="Asynchronous cloud agent runs backed by Durable Objects, PiHarness, and Cloudflare Sandbox."
                deliverables={[
                  "Unified AgentAdapter & monotonic seq event timeline",
                  "Cloud Linux workspace with real file edits & shell execution",
                  "Interactive high-risk tool approval panel",
                  "Crash-safe resume after closing browser",
                ]}
              />
            }
          />
          <Route
            path="projects"
            element={
              <ModuleStagePage
                title="Projects IDE"
                phase="Phase P5"
                summary="Cloud projects with Monaco Editor, xterm.js terminal, Git diff/commit, and isolated dev previews."
                deliverables={[
                  "Blank/template creation & safe HTTPS Git import",
                  "Interactive file tree + Monaco Editor + Diff Editor",
                  "Real streaming xterm.js cloud terminal",
                  "Isolated live dev server preview & R2 backups",
                ]}
              />
            }
          />
          <Route
            path="studio"
            element={
              <ModuleStagePage
                title="Media Studio"
                phase="Phase P7"
                summary="API-driven multimodal generation workspace with R2 persistence and project asset import."
                deliverables={[
                  "Real image generation across OpenAI & Google Imagen/Gemini",
                  "Model-specific parameter controls & generation history",
                  "Import generated assets directly into Projects",
                ]}
              />
            }
          />
          <Route
            path="plugins"
            element={
              <ModuleStagePage
                title="Plugins, MCP & Skills"
                phase="Phase P8"
                summary="Extensible plugin registry, MCP client discovery, Agent Skills loader, and least-privilege permissions."
                deliverables={[
                  "Zod-validated Plugin Manifests & scoped permissions",
                  "Remote MCP Server client with SSRF protection",
                  "SKILL.md loader & real example MCP tool",
                ]}
              />
            }
          />
          <Route
            path="automations"
            element={
              <ModuleStagePage
                title="Automations"
                phase="Roadmap"
                summary="Scheduled workflows and webhook triggers built on Cloudflare Workflows."
                deliverables={[
                  "Cron & webhook-triggered Work runs",
                  "Signed webhook verification & quota enforcement",
                ]}
              />
            }
          />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/settings" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
