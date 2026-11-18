import { AppError } from "@ai-workspace/contracts";
import type { D1DatabaseLike, R2BucketLike, SessionRow, UserRow } from "@ai-workspace/database";
import { FREE_TIER_BUDGETS } from "@ai-workspace/shared";

export interface WorkerEnv {
  APP_ENV?: string;
  APP_ORIGIN?: string;
  WORKERS_PLAN?: "free" | "paid";
  ENABLE_PAID_SANDBOX?: string;
  SESSION_SECRET?: string;
  PASSWORD_PEPPER?: string;
  ENCRYPTION_MASTER_KEY?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  DB?: D1Database & D1DatabaseLike;
  STORAGE?: R2Bucket & R2BucketLike;
}

export interface AppVariables {
  requestId: string;
  user: UserRow | null;
  session: SessionRow | null;
}

const DEV_FALLBACK_MASTER_KEY = "0000000000000000000000000000000000000000000000000000000000000000";
const DEV_FALLBACK_PEPPER = "dev-only-local-pepper-change-in-secrets";

function isLocalhostRequest(requestUrl?: string): boolean {
  if (!requestUrl) return false;
  try {
    const host = new URL(requestUrl).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

export function requireDb(env: WorkerEnv | undefined): D1DatabaseLike {
  if (!env?.DB) {
    throw new AppError("INTERNAL_ERROR", "D1 database binding is not configured", 500);
  }
  return env.DB;
}

export function requireStorage(env: WorkerEnv | undefined): R2BucketLike {
  if (!env?.STORAGE) {
    throw new AppError("INTERNAL_ERROR", "R2 storage binding is not configured", 500);
  }
  return env.STORAGE;
}

/**
 * Fail-closed master key lookup: only allows the dev fallback in explicit tests or local localhost dev.
 */
export function getEncryptionMasterKey(env: WorkerEnv | undefined, requestUrl?: string): string {
  const configured = env?.ENCRYPTION_MASTER_KEY?.trim();
  if (configured) {
    return configured;
  }
  const allowDevFallback =
    env?.APP_ENV === "test" || (env?.APP_ENV === "development" && isLocalhostRequest(requestUrl));
  if (allowDevFallback) {
    return DEV_FALLBACK_MASTER_KEY;
  }
  throw new AppError(
    "INTERNAL_ERROR",
    "ENCRYPTION_MASTER_KEY secret must be configured in non-local environments",
    500,
  );
}

/**
 * Server-side password pepper (stored in Worker secrets, isolated from D1 database).
 */
export function getPasswordPepper(env: WorkerEnv | undefined, requestUrl?: string): string {
  const configured = env?.PASSWORD_PEPPER?.trim() || env?.SESSION_SECRET?.trim();
  if (configured) {
    return configured;
  }
  const allowDevFallback =
    env?.APP_ENV === "test" || (env?.APP_ENV === "development" && isLocalhostRequest(requestUrl));
  if (allowDevFallback) {
    return DEV_FALLBACK_PEPPER;
  }
  throw new AppError(
    "INTERNAL_ERROR",
    "PASSWORD_PEPPER or SESSION_SECRET must be configured in non-local environments",
    500,
  );
}

export function getPbkdf2Iterations(env: WorkerEnv | undefined): number {
  return env?.WORKERS_PLAN === "paid"
    ? FREE_TIER_BUDGETS.PAID_PBKDF2_ITERATIONS
    : FREE_TIER_BUDGETS.FREE_PBKDF2_ITERATIONS;
}

export function isPaidSandboxEnabled(env: WorkerEnv | undefined): boolean {
  return env?.WORKERS_PLAN === "paid" && env?.ENABLE_PAID_SANDBOX === "true";
}
