import type { ModelCapabilities, ProviderId } from "@ai-workspace/contracts";
import { Badge, Button, Dialog } from "@ai-workspace/ui";
import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

export interface CatalogModel {
  id: string;
  providerId: ProviderId;
  displayName: string;
  description?: string;
  supportsTemperature: boolean;
  maxOutputTokens: number;
  capabilities: ModelCapabilities;
  configured: boolean;
}

interface ModelSelectorProps {
  models: CatalogModel[];
  providerId: ProviderId;
  modelId: string;
  temperature: number;
  reasoningEffort: "low" | "medium" | "high";
  enableWebSearch: boolean;
  onSelectModel: (providerId: ProviderId, modelId: string) => void;
  onChangeTemperature: (val: number) => void;
  onChangeReasoningEffort: (val: "low" | "medium" | "high") => void;
  onToggleWebSearch: (val: boolean) => void;
}

export function ModelSelector({
  models,
  providerId,
  modelId,
  temperature,
  reasoningEffort,
  enableWebSearch,
  onSelectModel,
  onChangeTemperature,
  onChangeReasoningEffort,
  onToggleWebSearch,
}: ModelSelectorProps) {
  const [paramsOpen, setParamsOpen] = useState(false);
  const current = models.find((m) => m.id === modelId) ?? models[0];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Select AI model"
        value={modelId}
        onChange={(e) => {
          const picked = models.find((m) => m.id === e.target.value);
          if (picked) {
            onSelectModel(picked.providerId, picked.id);
          }
        }}
        className="h-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs font-medium text-[var(--fg)]"
      >
        {(["openai", "anthropic", "google"] as const).map((pid) => {
          const group = models.filter((m) => m.providerId === pid);
          if (group.length === 0) return null;
          return (
            <optgroup key={pid} label={pid.toUpperCase()}>
              {group.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} {m.configured ? "" : "(No Key)"}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>

      {current && (
        <div className="hidden items-center gap-1 lg:flex">
          <Badge tone={current.configured ? "success" : "warning"}>
            {current.configured ? `${providerId} ready` : "Key missing"}
          </Badge>
          {current.capabilities.imageInput && <Badge tone="neutral">Vision</Badge>}
          {current.capabilities.toolCalling && <Badge tone="neutral">Tools</Badge>}
          {current.capabilities.reasoningControl && <Badge tone="neutral">Reasoning</Badge>}
        </div>
      )}

      {current && !current.configured && (
        <Link to="/settings" className="text-xs font-medium text-[var(--accent)] hover:underline">
          Add API key
        </Link>
      )}

      <Button variant="secondary" size="sm" onClick={() => setParamsOpen(true)}>
        <SlidersHorizontal className="h-3.5 w-3.5" />
        <span>Params</span>
      </Button>

      <Dialog
        open={paramsOpen}
        onClose={() => setParamsOpen(false)}
        title="Model Parameters & Capabilities"
        description={current?.description ?? "Configure generation parameters"}
      >
        <div className="space-y-4 text-xs">
          <div>
            <div className="mb-1 flex justify-between">
              <span className="font-medium text-[var(--fg)]">Temperature</span>
              <span className="text-[var(--fg-muted)]">
                {current?.supportsTemperature ? temperature.toFixed(1) : "Fixed by model"}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.1}
              disabled={!current?.supportsTemperature}
              value={temperature}
              onChange={(e) => onChangeTemperature(Number(e.target.value))}
              className="w-full"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="chat-reasoning" className="font-medium text-[var(--fg)]">
              Reasoning Effort
            </label>
            <select
              id="chat-reasoning"
              disabled={!current?.capabilities.reasoningControl}
              value={reasoningEffort}
              onChange={(e) => onChangeReasoningEffort(e.target.value as "low" | "medium" | "high")}
              className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-xs disabled:opacity-50"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>

          <label className="flex items-center justify-between rounded-lg border border-[var(--border)] p-3 cursor-pointer">
            <div>
              <p className="font-medium text-[var(--fg)]">Web Fetch / Search Tool</p>
              <p className="text-[11px] text-[var(--fg-muted)]">
                Allow model to fetch public HTTPS URLs (SSRF-guarded)
              </p>
            </div>
            <input
              type="checkbox"
              checked={enableWebSearch}
              onChange={(e) => onToggleWebSearch(e.target.checked)}
            />
          </label>

          <div className="flex justify-end">
            <Button size="sm" onClick={() => setParamsOpen(false)}>
              Done
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
