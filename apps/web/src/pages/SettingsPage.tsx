import type { ProviderId } from "@ai-workspace/contracts";
import { Badge, Button, Card, Input, Skeleton, useToast } from "@ai-workspace/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useAuth, type AuthUser } from "../hooks/useAuth.js";
import { ApiClientError, apiRequest } from "../lib/api-client.js";
import { useTheme, type ThemeMode } from "../stores/theme.js";

interface SettingsPayload {
  user: AuthUser;
  modelPreferences: {
    defaultProviderId: ProviderId;
    defaultModelId: string;
    temperature: number | null;
    maxTokens: number | null;
    reasoningEffort: "low" | "medium" | "high" | null;
    updatedAt: string;
  };
  providers: Array<{
    id: string;
    providerId: ProviderId;
    keyHint: string;
    status: string;
    updatedAt: string;
  }>;
}

interface AuditLogsPayload {
  logs: Array<{
    id: string;
    action: string;
    resourceType: string;
    resourceId: string | null;
    outcome: string;
    createdAt: string;
  }>;
}

const PROVIDER_META: Array<{ id: ProviderId; label: string; defaultModel: string }> = [
  { id: "openai", label: "OpenAI", defaultModel: "gpt-6.1-sol" },
  { id: "anthropic", label: "Anthropic", defaultModel: "claude-sonnet-5-5" },
  { id: "google", label: "Google Gemini", defaultModel: "gemini-4-hydrogen" },
];

export function SettingsPage() {
  const { refreshSession } = useAuth();
  const { setTheme } = useTheme();
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const settingsQuery = useQuery<SettingsPayload>({
    queryKey: ["settings"],
    queryFn: () => apiRequest<SettingsPayload>("/api/settings"),
  });

  const auditQuery = useQuery<AuditLogsPayload>({
    queryKey: ["audit-logs"],
    queryFn: () => apiRequest<AuditLogsPayload>("/api/settings/audit-logs"),
  });

  const [displayNameDraft, setDisplayNameDraft] = useState<string | null>(null);
  const [themePrefDraft, setThemePrefDraft] = useState<ThemeMode | null>(null);
  const [providerDraft, setProviderDraft] = useState<ProviderId | null>(null);
  const [modelDraft, setModelDraft] = useState<string | null>(null);
  const [effortDraft, setEffortDraft] = useState<"low" | "medium" | "high" | null>(null);
  const [keyDrafts, setKeyDrafts] = useState<Record<ProviderId, string>>({
    openai: "",
    anthropic: "",
    google: "",
  });

  const displayName = displayNameDraft ?? settingsQuery.data?.user.displayName ?? "";
  const themePref = themePrefDraft ?? settingsQuery.data?.user.themePreference ?? "system";
  const defaultProviderId =
    providerDraft ?? settingsQuery.data?.modelPreferences.defaultProviderId ?? "openai";
  const defaultModelId =
    modelDraft ?? settingsQuery.data?.modelPreferences.defaultModelId ?? "gpt-6.1-sol";
  const reasoningEffort =
    effortDraft ?? settingsQuery.data?.modelPreferences.reasoningEffort ?? "medium";

  const profileMutation = useMutation({
    mutationFn: (payload: { displayName: string; themePreference: ThemeMode }) =>
      apiRequest("/api/settings/profile", {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: async (_data, vars) => {
      setTheme(vars.themePreference);
      setDisplayNameDraft(null);
      setThemePrefDraft(null);
      await refreshSession();
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      await queryClient.invalidateQueries({ queryKey: ["audit-logs"] });
      notify("Profile saved", "success");
    },
    onError: (err) => {
      notify(err instanceof ApiClientError ? err.message : "Failed to save profile", "error");
    },
  });

  const prefsMutation = useMutation({
    mutationFn: (payload: {
      defaultProviderId: ProviderId;
      defaultModelId: string;
      reasoningEffort: "low" | "medium" | "high";
    }) =>
      apiRequest("/api/settings/model-preferences", {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: async () => {
      setProviderDraft(null);
      setModelDraft(null);
      setEffortDraft(null);
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      notify("Default model preferences updated", "success");
    },
    onError: (err) => {
      notify(
        err instanceof ApiClientError ? err.message : "Failed to save model preferences",
        "error",
      );
    },
  });

  const saveKeyMutation = useMutation({
    mutationFn: ({ providerId, apiKey }: { providerId: ProviderId; apiKey: string }) =>
      apiRequest(`/api/settings/providers/${providerId}`, {
        method: "PUT",
        body: JSON.stringify({ apiKey }),
      }),
    onSuccess: async (_data, vars) => {
      setKeyDrafts((prev) => ({ ...prev, [vars.providerId]: "" }));
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      await queryClient.invalidateQueries({ queryKey: ["audit-logs"] });
      notify(`${vars.providerId} API key encrypted and saved`, "success");
    },
    onError: (err) => {
      notify(err instanceof ApiClientError ? err.message : "Failed to save key", "error");
    },
  });

  const deleteKeyMutation = useMutation({
    mutationFn: (providerId: ProviderId) =>
      apiRequest(`/api/settings/providers/${providerId}`, { method: "DELETE" }),
    onSuccess: async (_data, providerId) => {
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      await queryClient.invalidateQueries({ queryKey: ["audit-logs"] });
      notify(`${providerId} API key removed`, "info");
    },
    onError: (err) => {
      notify(err instanceof ApiClientError ? err.message : "Failed to delete key", "error");
    },
  });

  if (settingsQuery.isLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const handleProfileSubmit = (e: FormEvent) => {
    e.preventDefault();
    profileMutation.mutate({ displayName, themePreference: themePref });
  };

  const handlePrefsSubmit = (e: FormEvent) => {
    e.preventDefault();
    prefsMutation.mutate({ defaultProviderId, defaultModelId, reasoningEffort });
  };

  const savedByProvider = new Map(
    (settingsQuery.data?.providers ?? []).map((p) => [p.providerId, p]),
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Profile & Theme */}
      <Card className="p-6">
        <h2 className="text-base font-semibold">Profile & Appearance</h2>
        <p className="mt-1 text-xs text-[var(--fg-muted)]">
          Manage your display name and synchronized workspace theme.
        </p>
        <form onSubmit={handleProfileSubmit} className="mt-4 grid gap-4 sm:grid-cols-2">
          <Input
            label="Display name"
            value={displayName}
            onChange={(e) => setDisplayNameDraft(e.target.value)}
            required
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="theme-select" className="text-xs font-medium text-[var(--fg-muted)]">
              Theme preference
            </label>
            <select
              id="theme-select"
              value={themePref}
              onChange={(e) => setThemePrefDraft(e.target.value as ThemeMode)}
              className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--fg)]"
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" loading={profileMutation.isPending}>
              Save Profile
            </Button>
          </div>
        </form>
      </Card>

      {/* Default Model Preferences */}
      <Card className="p-6">
        <h2 className="text-base font-semibold">Default Model Preferences</h2>
        <p className="mt-1 text-xs text-[var(--fg-muted)]">
          Used as the initial selection for Chat and Native Agent runs.
        </p>
        <form onSubmit={handlePrefsSubmit} className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="default-provider"
              className="text-xs font-medium text-[var(--fg-muted)]"
            >
              Default Provider
            </label>
            <select
              id="default-provider"
              value={defaultProviderId}
              onChange={(e) => {
                const next = e.target.value as ProviderId;
                setProviderDraft(next);
                const meta = PROVIDER_META.find((m) => m.id === next);
                if (meta) setModelDraft(meta.defaultModel);
              }}
              className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--fg)]"
            >
              {PROVIDER_META.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <Input
            label="Default Model ID"
            value={defaultModelId}
            onChange={(e) => setModelDraft(e.target.value)}
            required
          />
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="reasoning-effort"
              className="text-xs font-medium text-[var(--fg-muted)]"
            >
              Reasoning Effort
            </label>
            <select
              id="reasoning-effort"
              value={reasoningEffort}
              onChange={(e) => setEffortDraft(e.target.value as "low" | "medium" | "high")}
              className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--fg)]"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <div className="flex justify-end sm:col-span-3">
            <Button type="submit" loading={prefsMutation.isPending}>
              Save Preferences
            </Button>
          </div>
        </form>
      </Card>

      {/* Encrypted Provider API Keys */}
      <Card className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <KeyRound className="h-4 w-4 text-[var(--accent)]" />
              Provider API Keys (AES-256-GCM Encrypted)
            </h2>
            <p className="mt-1 text-xs text-[var(--fg-muted)]">
              Keys are encrypted server-side before storage and never returned to the browser.
            </p>
          </div>
          <Badge tone="success">
            <ShieldCheck className="h-3 w-3" />
            Zero-plaintext DB
          </Badge>
        </div>

        <div className="mt-4 space-y-4">
          {PROVIDER_META.map(({ id, label }) => {
            const saved = savedByProvider.get(id);
            const draft = keyDrafts[id];
            return (
              <div
                key={id}
                className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4 sm:flex-row sm:items-end"
              >
                <div className="flex-1 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{label}</span>
                    {saved ? (
                      <Badge tone="success">Configured · {saved.keyHint}</Badge>
                    ) : (
                      <Badge tone="neutral">Not configured</Badge>
                    )}
                  </div>
                  <Input
                    type="password"
                    aria-label={`${label} API key`}
                    placeholder={saved ? "Enter new key to rotate..." : `Paste ${label} API key...`}
                    value={draft}
                    onChange={(e) => setKeyDrafts((prev) => ({ ...prev, [id]: e.target.value }))}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    disabled={draft.trim().length < 8}
                    loading={saveKeyMutation.isPending}
                    onClick={() => saveKeyMutation.mutate({ providerId: id, apiKey: draft })}
                  >
                    {saved ? "Rotate Key" : "Save Key"}
                  </Button>
                  {saved && (
                    <Button
                      size="sm"
                      variant="danger"
                      aria-label={`Delete ${label} key`}
                      onClick={() => deleteKeyMutation.mutate(id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Security Audit Trail */}
      <Card className="p-6">
        <h2 className="text-base font-semibold">Recent Security Audit Events</h2>
        <p className="mt-1 text-xs text-[var(--fg-muted)]">
          Automatically redacted activity log scoped to your account.
        </p>
        <div className="mt-4 space-y-2">
          {auditQuery.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : (auditQuery.data?.logs.length ?? 0) === 0 ? (
            <p className="text-xs text-[var(--fg-muted)]">No audit events recorded yet.</p>
          ) : (
            auditQuery.data?.logs.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  <Badge tone={entry.outcome === "success" ? "success" : "danger"}>
                    {entry.outcome}
                  </Badge>
                  <span className="font-mono text-[var(--fg)]">{entry.action}</span>
                  <span className="text-[var(--fg-muted)]">{entry.resourceType}</span>
                </div>
                <span className="text-[var(--fg-subtle)]">
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
