import { Button, Card } from "@ai-workspace/ui";
import { AlertTriangle } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || "Unexpected application error" };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Application ErrorBoundary caught error", error, info.componentStack);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-6">
          <Card className="max-w-md p-6">
            <div className="mb-3 flex items-center gap-2 text-rose-500">
              <AlertTriangle className="h-5 w-5" />
              <h2 className="text-base font-semibold">Something went wrong</h2>
            </div>
            <p className="mb-4 text-sm text-[var(--fg-muted)]">{this.state.message}</p>
            <Button onClick={() => window.location.reload()}>Reload Workspace</Button>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}
