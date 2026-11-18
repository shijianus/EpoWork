import { Badge, Button, Card } from "@ai-workspace/ui";
import { ArrowRight, CheckCircle2, Clock } from "lucide-react";
import { Link } from "react-router-dom";

interface ModuleStagePageProps {
  title: string;
  phase: string;
  summary: string;
  deliverables: string[];
}

export function ModuleStagePage({ title, phase, summary, deliverables }: ModuleStagePageProps) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card className="p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">{title}</h2>
              <Badge tone="accent">Scheduled: {phase}</Badge>
            </div>
            <p className="mt-1.5 text-sm text-[var(--fg-muted)]">{summary}</p>
          </div>
          <Clock className="h-6 w-6 shrink-0 text-[var(--fg-subtle)]" />
        </div>

        <div className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
          <p className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-[var(--fg-muted)]">
            Planned Capabilities
          </p>
          <ul className="space-y-2">
            {deliverables.map((item) => (
              <li key={item} className="flex items-center gap-2 text-sm text-[var(--fg)]">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--fg-subtle)]" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-[var(--border)] pt-4">
          <p className="text-xs text-[var(--fg-muted)]">
            Configure your Provider API keys now so models are ready as soon as {phase} lands.
          </p>
          <Link to="/settings">
            <Button size="sm" variant="secondary">
              Go to Settings
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
