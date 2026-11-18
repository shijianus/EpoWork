import { constantTimeEqual, sha256Hex } from "@ai-workspace/auth";
import { AppError } from "@ai-workspace/contracts";
import { SessionRepository, UserRepository } from "@ai-workspace/database";
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { requireDb, type AppVariables, type WorkerEnv } from "../env.js";

export const SESSION_COOKIE_NAME = "aiw_session";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Resolves the current session & user from the HttpOnly session cookie (if present).
 */
export const resolveSession: MiddlewareHandler<{
  Bindings: WorkerEnv;
  Variables: AppVariables;
}> = async (c, next) => {
  c.set("user", null);
  c.set("session", null);

  const rawToken = getCookie(c, SESSION_COOKIE_NAME);
  if (rawToken && c.env?.DB) {
    const db = requireDb(c.env);
    const tokenHash = await sha256Hex(rawToken);
    const sessions = new SessionRepository(db);
    const session = await sessions.findValidByTokenHash(tokenHash);
    if (session) {
      const users = new UserRepository(db);
      const user = await users.findById(session.user_id);
      if (user) {
        c.set("session", session);
        c.set("user", user);
        await sessions.touchIfStale(session.id, session.last_seen_at);
      }
    }
  }

  await next();
};

/**
 * Rejects unauthenticated requests with 401 and enforces CSRF token header on state-changing requests.
 */
export const requireAuth: MiddlewareHandler<{
  Bindings: WorkerEnv;
  Variables: AppVariables;
}> = async (c, next) => {
  const user = c.get("user");
  const session = c.get("session");
  if (!user || !session) {
    throw new AppError("UNAUTHORIZED", "Authentication required", 401);
  }

  if (MUTATING_METHODS.has(c.req.method.toUpperCase())) {
    const csrfHeader = c.req.header("x-csrf-token") ?? "";
    if (!csrfHeader || !constantTimeEqual(csrfHeader, session.csrf_token)) {
      throw new AppError("FORBIDDEN", "Invalid or missing CSRF token", 403);
    }
  }

  await next();
};
