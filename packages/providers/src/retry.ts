/**
 * Controlled exponential backoff retry helper for transient upstream provider errors (429 / 502 / 503 / 504).
 * Never retries 4xx auth/validation errors or AbortError cancellations.
 */

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  signal?: AbortSignal;
}

export function isRetryableProviderError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if (err instanceof Error && err.name === "AbortError") return false;
  const maybeStatus =
    (err as { statusCode?: number; status?: number }).statusCode ??
    (err as { status?: number }).status;
  if (typeof maybeStatus === "number") {
    return maybeStatus === 429 || maybeStatus === 502 || maybeStatus === 503 || maybeStatus === 504;
  }
  const msg = err instanceof Error ? err.message.toLowerCase() : "";
  return msg.includes("timeout") || msg.includes("econnreset") || msg.includes("rate limit");
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = Math.min(3, Math.max(0, options.maxRetries ?? 2));
  const baseDelayMs = options.baseDelayMs ?? 300;

  let attempt = 0;
  while (true) {
    if (options.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxRetries || !isRetryableProviderError(err)) {
        throw err;
      }
      const jitter = Math.floor(Math.random() * 100);
      const delay = baseDelayMs * 2 ** attempt + jitter;
      attempt += 1;
      await sleepWithAbort(delay, options.signal);
    }
  }
}
