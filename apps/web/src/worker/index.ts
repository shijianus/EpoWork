import { AppError, type HealthResponse } from "@ai-workspace/contracts";
import { createId, createLogger } from "@ai-workspace/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { ZodError } from "zod";
import type { AppVariables, WorkerEnv } from "./env.js";
import { resolveSession } from "./middleware/auth.js";
import { authRoutes } from "./routes/auth.js";
import { chatRoutes } from "./routes/chat.js";
import { fileRoutes } from "./routes/files.js";
import { settingsRoutes } from "./routes/settings.js";
import { storageRoutes } from "./routes/storage.js";

export type { AppVariables, WorkerEnv } from "./env.js";

export function createWorkerApp() {
  const app = new Hono<{ Bindings: WorkerEnv; Variables: AppVariables }>();

  app.use("*", async (c, next) => {
    const requestId = c.req.header("x-request-id") || createId("req");
    c.set("requestId", requestId);
    c.set("user", null);
    c.set("session", null);
    c.header("x-request-id", requestId);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    await next();
  });

  app.use(
    "/api/*",
    cors({
      origin: (origin, c) => {
        const configured = c.env?.APP_ORIGIN;
        if (!origin) return "";
        if (configured && origin === configured) return origin;
        if (
          c.env?.APP_ENV !== "production" &&
          (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:"))
        ) {
          return origin;
        }
        return "";
      },
      credentials: true,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-CSRF-Token", "X-Request-Id"],
    }),
  );

  app.use("/api/*", resolveSession);

  app.get("/api/health", async (c) => {
    let d1Status: "ok" | "unconfigured" | "error" = "unconfigured";
    if (c.env?.DB) {
      try {
        await c.env.DB.prepare("SELECT 1").first();
        d1Status = "ok";
      } catch {
        d1Status = "error";
      }
    }

    const r2Status: "ok" | "unconfigured" | "error" = c.env?.STORAGE ? "ok" : "unconfigured";

    const payload: HealthResponse = {
      status: d1Status === "error" ? "degraded" : "ok",
      service: "ai-workspace-api",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
      checks: {
        worker: "ok",
        d1: d1Status,
        r2: r2Status,
      },
    };

    return c.json(payload, payload.status === "ok" ? 200 : 503);
  });

  app.route("/api/auth", authRoutes);
  app.route("/api/chat", chatRoutes);
  app.route("/api/files", fileRoutes);
  app.route("/api/settings", settingsRoutes);
  app.route("/api/storage", storageRoutes);

  app.all("/api/*", (c) => {
    return c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: `API route not found: ${c.req.method} ${c.req.path}`,
          requestId: c.get("requestId"),
        },
      },
      404,
    );
  });

  app.onError((err, c) => {
    const requestId = c.get("requestId");
    const logger = createLogger({ requestId, component: "worker" });

    if (err instanceof AppError) {
      return c.json(
        {
          error: {
            code: err.code,
            message: err.message,
            requestId,
            ...(err.details !== undefined ? { details: err.details } : {}),
          },
        },
        err.status as 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502,
      );
    }

    if (err instanceof ZodError) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Request validation failed",
            requestId,
            details: err.flatten(),
          },
        },
        400,
      );
    }

    logger.error("Unhandled worker error", { error: err });
    return c.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected internal error occurred",
          requestId,
        },
      },
      500,
    );
  });

  return app;
}

export const app = createWorkerApp();

export default app;
