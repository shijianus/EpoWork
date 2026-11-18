/**
 * Secret-redacting structured logger for Edge Workers and Node services.
 * Ensures API keys, cookies, authorization headers, and session tokens never reach logs.
 */

const SENSITIVE_KEY_PATTERN =
  /^(authorization|cookie|set-cookie|x-api-key|api[_-]?key|secret|token|password|session[_-]?token|encryption[_-]?master[_-]?key|access[_-]?token|refresh[_-]?token)$/i;

const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /\bsk-(?:proj-|ant-|live-)?[A-Za-z0-9_-]{12,}\b/g,
  /\bAIza[0-9A-Za-z\-_]{20,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
];

/** Redacts known credential patterns inside arbitrary strings. */
export function redactString(input: string): string {
  let output = input;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    output = output.replace(pattern, "[REDACTED]");
  }
  return output;
}

/** Recursively redacts sensitive keys and secret patterns in log metadata. */
export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return "[TRUNCATED]";
  }
  if (typeof value === "string") {
    return redactString(value);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = redactValue(val, depth + 1);
    }
  }
  return sanitized;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  requestId?: string;
  meta?: Record<string, unknown>;
}

/** Creates a structured logger that scrubs secrets on every log call. */
export function createLogger(context?: { requestId?: string; component?: string }) {
  const emit = (level: LogLevel, message: string, meta?: Record<string, unknown>) => {
    const entry: LogEntry = {
      level,
      message: redactString(message),
      timestamp: new Date().toISOString(),
      ...(context?.requestId ? { requestId: context.requestId } : {}),
      meta: {
        ...(context?.component ? { component: context.component } : {}),
        ...(meta ? (redactValue(meta) as Record<string, unknown>) : {}),
      },
    };
    const serialized = JSON.stringify(entry);
    if (level === "error") {
      console.error(serialized);
    } else if (level === "warn") {
      console.warn(serialized);
    } else {
      console.info(serialized);
    }
  };

  return {
    debug: (message: string, meta?: Record<string, unknown>) => emit("debug", message, meta),
    info: (message: string, meta?: Record<string, unknown>) => emit("info", message, meta),
    warn: (message: string, meta?: Record<string, unknown>) => emit("warn", message, meta),
    error: (message: string, meta?: Record<string, unknown>) => emit("error", message, meta),
  };
}
