import type { ProviderId } from "@ai-workspace/contracts";
import { Badge, Button, Card, Input, useToast } from "@ai-workspace/ui";
import { KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const PROVIDERS: Array<{ id: ProviderId; label: string; defaultModel: string }> = [
  { id: "openai", label: "OpenAI", defaultModel: "gpt-6.1-sol" },
  { id: "anthropic", label: "Anthropic", defaultModel: "claude-sonnet-5-5" },
  { id: "google", label: "Google Gemini", defaultModel: "gemini-4-hydrogen" },
];

export function SettingsView({ onUpdated }: { onUpdated?: () => void }) {
  const { notify } = useToast();
  const [vaultMode, setVaultMode] = useState("...");
  const [dbPath, setDbPath] = useState("");
  const [savedHints, setSavedHints] = useState<
    Record<string, { keyHint: string; mode: string; updatedAt: string }>
  >({});
  const [drafts, setDrafts] = useState<Record<ProviderId, string>>({
    openai: "",
    anthropic: "",
    google: "",
  });
  const [defaultProvider, setDefaultProvider] = useState<ProviderId>("openai");
  const [defaultModel, setDefaultModel] = useState("gpt-6.1-sol");

  const load = useCallback(async () => {
    const [info, settings] = await Promise.all([
      window.epocanvas.getInfo(),
      window.epocanvas.settings.get(),
    ]);
    setVaultMode(settings.vaultMode);
    setDbPath(info.dbPath);
    const map: Record<string, { keyHint: string; mode: string; updatedAt: string }> = {};
    for (const p of settings.providers) {
      map[p.providerId] = { keyHint: p.keyHint, mode: p.mode, updatedAt: p.updatedAt };
    }
    setSavedHints(map);
    setDefaultProvider(settings.modelPreferences.defaultProviderId);
    setDefaultModel(settings.modelPreferences.defaultModelId);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([window.epocanvas.getInfo(), window.epocanvas.settings.get()])
      .then(([info, settings]) => {
        if (!active) return;
        setVaultMode(settings.vaultMode);
        setDbPath(info.dbPath);
        const map: Record<string, { keyHint: string; mode: string; updatedAt: string }> = {};
        for (const p of settings.providers) {
          map[p.providerId] = { keyHint: p.keyHint, mode: p.mode, updatedAt: p.updatedAt };
        }
        setSavedHints(map);
        setDefaultProvider(settings.modelPreferences.defaultProviderId);
        setDefaultModel(settings.modelPreferences.defaultModelId);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const handleSaveKey = async (providerId: ProviderId) => {
    const key = drafts[providerId].trim();
    if (key.length < 8) return;
    await window.epocanvas.settings.saveApiKey(providerId, key);
    setDrafts((prev) => ({ ...prev, [providerId]: "" }));
    await load();
    onUpdated?.();
    notify(`${providerId} API key encrypted in OS vault`, "success");
  };

  const handleDeleteKey = async (providerId: ProviderId) => {
    await window.epocanvas.settings.deleteApiKey(providerId);
    await load();
    onUpdated?.();
    notify(`${providerId} API key removed`, "info");
  };

  const handleSavePrefs = async () => {
    await window.epocanvas.settings.saveModelPreferences({
      defaultProviderId: defaultProvider,
      defaultModelId: defaultModel,
    });
    notify("Default model preferences saved", "success");
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <KeyRound className="h-4 w-4 text-[var(--accent)]" />
              API Key Vault (Local-First)
            </h2>
            <p className="mt-1 text-xs text-[var(--fg-muted)]">
              Encrypted with Electron safeStorage (Windows DPAPI) or local AES-256-GCM. Keys never
              enter the Renderer process.
            </p>
          </div>
          <Badge tone="success">
            <ShieldCheck className="h-3 w-3" />
            {vaultMode}
          </Badge>
        </div>

        <div className="mt-4 space-y-3">
          {PROVIDERS.map(({ id, label }) => {
            const saved = savedHints[id];
            return (
              <div
                key={id}
                className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3.5 sm:flex-row sm:items-end"
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
                    placeholder={saved ? "Paste new key to rotate..." : `Paste ${label} API key...`}
                    value={drafts[id]}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [id]: e.target.value }))}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    disabled={drafts[id].trim().length < 8}
                    onClick={() => void handleSaveKey(id)}
                  >
                    {saved ? "Rotate" : "Save"}
                  </Button>
                  {saved && (
                    <Button
                      size="sm"
                      variant="danger"
                      aria-label={`Delete ${label} key`}
                      onClick={() => void handleDeleteKey(id)}
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

      <Card className="p-5">
        <h2 className="text-base font-semibold">Default Model & Local Storage Diagnostics</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="desktop-default-provider" className="text-xs text-[var(--fg-muted)]">
              Default Provider
            </label>
            <select
              id="desktop-default-provider"
              value={defaultProvider}
              onChange={(e) => {
                const pid = e.target.value as ProviderId;
                setDefaultProvider(pid);
                const found = PROVIDERS.find((p) => p.id === pid);
                if (found) setDefaultModel(found.defaultModel);
              }}
              className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <Input
            label="Default Model ID"
            value={defaultModel}
            onChange={(e) => setDefaultModel(e.target.value)}
          />
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="truncate text-[11px] font-mono text-[var(--fg-subtle)]" title={dbPath}>
            SQLite DB: {dbPath}
          </span>
          <Button size="sm" onClick={() => void handleSavePrefs()}>
            Save Preferences
          </Button>
        </div>
      </Card>
    </div>
  );
}
