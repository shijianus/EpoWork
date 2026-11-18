import type { HealthResponse } from "@ai-workspace/contracts";
import { Badge, Button, Dialog, Input } from "@ai-workspace/ui";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Bell,
  Blocks,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  FolderGit2,
  Image as ImageIcon,
  Layers,
  LogOut,
  Menu,
  MessageSquare,
  Search,
  Settings,
  Workflow,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth.js";
import { apiRequest } from "../../lib/api-client.js";
import { ThemeToggle } from "./ThemeToggle.js";

interface NavItem {
  to: string;
  label: string;
  Icon: typeof MessageSquare;
  stage?: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/chat", label: "Chat", Icon: MessageSquare, stage: "P2" },
  { to: "/work", label: "Work", Icon: Briefcase, stage: "P4" },
  { to: "/projects", label: "Projects", Icon: FolderGit2, stage: "P5" },
  { to: "/studio", label: "Studio", Icon: ImageIcon, stage: "P7" },
  { to: "/plugins", label: "Plugins", Icon: Blocks, stage: "P8" },
  { to: "/automations", label: "Automations", Icon: Workflow, stage: "Plan" },
  { to: "/settings", label: "Settings", Icon: Settings },
];

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [alertsOpen, setAlertsOpen] = useState(false);

  const healthQuery = useQuery<HealthResponse>({
    queryKey: ["health"],
    queryFn: () => apiRequest<HealthResponse>("/api/health"),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const currentTitle = useMemo(() => {
    const found = NAV_ITEMS.find((item) => location.pathname.startsWith(item.to));
    return found?.label ?? "Workspace";
  }, [location.pathname]);

  const filteredNav = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return NAV_ITEMS;
    return NAV_ITEMS.filter((item) => item.label.toLowerCase().includes(q));
  }, [searchQuery]);

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const renderNavLinks = (isMobile = false) => (
    <nav aria-label="Primary navigation" className="flex flex-1 flex-col gap-1 px-2 py-3">
      {NAV_ITEMS.map(({ to, label, Icon, stage }) => (
        <NavLink
          key={to}
          to={to}
          onClick={() => {
            if (isMobile) setMobileOpen(false);
          }}
          className={({ isActive }) =>
            `flex items-center justify-between rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
              isActive
                ? "bg-[var(--accent)]/12 text-[var(--accent)]"
                : "text-[var(--fg-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]"
            }`
          }
        >
          <span className="flex items-center gap-2.5">
            <Icon className="h-4 w-4 shrink-0" />
            {(!collapsed || isMobile) && <span>{label}</span>}
          </span>
          {(!collapsed || isMobile) && stage && (
            <Badge tone="neutral" className="text-[10px]">
              {stage}
            </Badge>
          )}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      {/* Desktop Sidebar */}
      <aside
        className={`hidden border-r border-[var(--border)] bg-[var(--surface)] transition-all md:flex md:flex-col ${
          collapsed ? "w-16" : "w-60"
        }`}
      >
        <div className="flex h-14 items-center justify-between border-b border-[var(--border)] px-3">
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--accent-fg)]">
              <Layers className="h-4 w-4" />
            </div>
            {!collapsed && (
              <span className="truncate text-sm font-semibold tracking-tight">EpoCanvas</span>
            )}
          </div>
          <button
            type="button"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setCollapsed((c) => !c)}
            className="rounded-md p-1 text-[var(--fg-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)] cursor-pointer"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        {renderNavLinks(false)}

        <div className="border-t border-[var(--border)] p-3">
          {!collapsed && user && (
            <div className="mb-2 truncate px-1">
              <p className="truncate text-xs font-medium text-[var(--fg)]">{user.displayName}</p>
              <p className="truncate text-[11px] text-[var(--fg-muted)]">{user.email}</p>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="w-full justify-start"
            title="Sign out"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!collapsed && <span>Sign out</span>}
          </Button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="fixed inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="relative z-50 flex w-64 flex-col border-r border-[var(--border)] bg-[var(--surface)]">
            <div className="flex h-14 items-center justify-between border-b border-[var(--border)] px-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--accent-fg)]">
                  <Layers className="h-4 w-4" />
                </div>
                <span className="text-sm font-semibold">EpoCanvas</span>
              </div>
              <button
                type="button"
                aria-label="Close navigation menu"
                onClick={() => setMobileOpen(false)}
                className="rounded-md p-1 text-[var(--fg-muted)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {renderNavLinks(true)}
            <div className="border-t border-[var(--border)] p-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                className="w-full justify-start"
              >
                <LogOut className="h-4 w-4" />
                <span>Sign out</span>
              </Button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Open navigation menu"
              onClick={() => setMobileOpen(true)}
              className="rounded-md p-1.5 text-[var(--fg-muted)] hover:bg-[var(--surface-hover)] md:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="text-sm font-semibold tracking-tight">{currentTitle}</h1>
            {healthQuery.data && (
              <Badge
                tone={healthQuery.data.status === "ok" ? "success" : "warning"}
                className="hidden sm:inline-flex"
              >
                <Activity className="h-3 w-3" />
                API {healthQuery.data.status}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setSearchOpen(true)}
              className="hidden sm:inline-flex"
            >
              <Search className="h-3.5 w-3.5" />
              <span>Quick Jump</span>
              <kbd className="ml-1 rounded border border-[var(--border)] px-1 text-[10px] text-[var(--fg-subtle)]">
                ⌘K
              </kbd>
            </Button>
            <button
              type="button"
              aria-label="Workspace notifications"
              onClick={() => setAlertsOpen(true)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--fg-muted)] hover:text-[var(--fg)] cursor-pointer"
            >
              <Bell className="h-4 w-4" />
            </button>
            <ThemeToggle />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>

      {/* Quick Jump Modal */}
      <Dialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        title="Quick Navigation"
        description="Jump directly to any workspace module"
      >
        <div className="space-y-3">
          <Input
            placeholder="Filter modules..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
          <div className="flex flex-col gap-1">
            {filteredNav.map(({ to, label, Icon, stage }) => (
              <button
                key={to}
                type="button"
                onClick={() => {
                  navigate(to);
                  setSearchOpen(false);
                  setSearchQuery("");
                }}
                className="flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--surface-hover)] cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-[var(--fg-muted)]" />
                  {label}
                </span>
                {stage && <Badge tone="neutral">{stage}</Badge>}
              </button>
            ))}
          </div>
        </div>
      </Dialog>

      {/* Notifications & System Status Modal */}
      <Dialog
        open={alertsOpen}
        onClose={() => setAlertsOpen(false)}
        title="Notifications & Approvals"
        description="Pending approvals and platform status"
      >
        <div className="space-y-3 text-sm text-[var(--fg-muted)]">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
            <p className="font-medium text-[var(--fg)]">Pending Agent Approvals: 0</p>
            <p className="mt-1 text-xs">
              Approval prompts from autonomous Work runs will appear here once Phase P3–P4 is
              active.
            </p>
          </div>
          {healthQuery.data && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-3 text-xs">
              Worker: {healthQuery.data.checks.worker} · D1: {healthQuery.data.checks.d1} · R2:{" "}
              {healthQuery.data.checks.r2}
            </div>
          )}
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" onClick={() => setAlertsOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
