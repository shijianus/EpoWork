import { Button, Card, Input, useToast } from "@ai-workspace/ui";
import { Layers } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.js";
import { ApiClientError } from "../lib/api-client.js";

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { notify } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) {
    const target = (location.state as { from?: string } | null)?.from || "/settings";
    return <Navigate to={target} replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login({ email, password });
      notify("Signed in successfully", "success");
      const target = (location.state as { from?: string } | null)?.from || "/settings";
      navigate(target, { replace: true });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to sign in");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--accent-fg)]">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold">Sign in to EpoCanvas</h1>
            <p className="text-xs text-[var(--fg-muted)]">Cloud-native AI Workspace</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400"
            >
              {error}
            </p>
          )}
          <Button type="submit" loading={submitting} className="w-full">
            Sign in
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-[var(--fg-muted)]">
          Need an account?{" "}
          <Link to="/register" className="font-medium text-[var(--accent)] hover:underline">
            Create one
          </Link>
        </p>
      </Card>
    </div>
  );
}
