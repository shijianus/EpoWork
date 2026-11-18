import {
  RateLimiter,
  dummyPasswordCheck,
  generateRandomToken,
  hashPassword,
  sha256Hex,
  verifyPassword,
} from "@ai-workspace/auth";
import { AppError } from "@ai-workspace/contracts";
import {
  AuditLogRepository,
  RateLimitRepository,
  SessionRepository,
  UserRepository,
  type UserRow,
} from "@ai-workspace/database";
import { Hono, type Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import {
  getPasswordPepper,
  getPbkdf2Iterations,
  requireDb,
  type AppVariables,
  type WorkerEnv,
} from "../env.js";
import { SESSION_COOKIE_NAME, requireAuth } from "../middleware/auth.js";

const authRateLimiterL1 = new RateLimiter(20, 60_000, 2_000);
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

const RegisterSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(80),
});

const LoginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
});

export function toPublicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    themePreference: user.theme_preference,
    createdAt: user.created_at,
  };
}

function getClientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "local";
}

function assertAllowedOrigin(c: {
  req: { header: (name: string) => string | undefined; url: string };
  env: WorkerEnv | undefined;
}) {
  const origin = c.req.header("origin");
  if (!origin) return;
  const configured = c.env?.APP_ORIGIN;
  if (configured && origin === configured) return;
  const reqOrigin = new URL(c.req.url).origin;
  if (origin === reqOrigin) return;
  if (
    c.env?.APP_ENV !== "production" &&
    (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:"))
  ) {
    return;
  }
  throw new AppError("FORBIDDEN", "Cross-origin auth request rejected", 403);
}

async function enforceAuthRateLimit(
  bucketKey: string,
  db: ReturnType<typeof requireDb>,
): Promise<void> {
  if (!authRateLimiterL1.check(bucketKey).allowed) {
    throw new AppError("RATE_LIMITED", "Too many auth attempts. Please wait a minute.", 429);
  }
  const d1Limiter = new RateLimitRepository(db);
  const res = await d1Limiter.checkAndIncrement(bucketKey, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!res.allowed) {
    throw new AppError("RATE_LIMITED", "Too many auth attempts. Please wait a minute.", 429);
  }
}

function setSessionCookie(
  c: Context<{ Bindings: WorkerEnv; Variables: AppVariables }>,
  token: string,
  expiresAt: Date,
) {
  const proto = c.req.header("x-forwarded-proto");
  const isHttps = c.req.url.startsWith("https://") || proto === "https";
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: "Lax",
    path: "/",
    expires: expiresAt,
  });
}

export const authRoutes = new Hono<{ Bindings: WorkerEnv; Variables: AppVariables }>();

authRoutes.post("/register", async (c) => {
  assertAllowedOrigin(c);
  const ip = getClientIp(c);
  const db = requireDb(c.env);
  await enforceAuthRateLimit(`reg:${ip}`, db);

  const input = RegisterSchema.parse(await c.req.json());
  const users = new UserRepository(db);
  const sessions = new SessionRepository(db);
  const audits = new AuditLogRepository(db);

  const existing = await users.findByEmail(input.email);
  if (existing) {
    throw new AppError("CONFLICT", "An account with this email already exists", 409);
  }

  const pepper = getPasswordPepper(c.env, c.req.url);
  const iterations = getPbkdf2Iterations(c.env);
  const { hash, salt } = await hashPassword(input.password, { iterations, pepper });
  const user = await users.create({
    email: input.email,
    displayName: input.displayName,
    passwordHash: hash,
    passwordSalt: salt,
  });

  const rawToken = generateRandomToken(32);
  const tokenHash = await sha256Hex(rawToken);
  const csrfToken = generateRandomToken(24);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await sessions.create({
    userId: user.id,
    tokenHash,
    csrfToken,
    userAgent: c.req.header("user-agent") ?? null,
    ipAddress: ip,
    expiresAt: expiresAt.toISOString(),
  });

  await audits.record({
    userId: user.id,
    action: "auth.register",
    resourceType: "user",
    resourceId: user.id,
    outcome: "success",
    ipAddress: ip,
  });

  setSessionCookie(c, rawToken, expiresAt);
  return c.json({ user: toPublicUser(user), csrfToken }, 201);
});

authRoutes.post("/login", async (c) => {
  assertAllowedOrigin(c);
  const ip = getClientIp(c);
  const db = requireDb(c.env);
  await enforceAuthRateLimit(`login:${ip}`, db);

  const input = LoginSchema.parse(await c.req.json());
  const users = new UserRepository(db);
  const sessions = new SessionRepository(db);
  const audits = new AuditLogRepository(db);
  const pepper = getPasswordPepper(c.env, c.req.url);
  const iterations = getPbkdf2Iterations(c.env);

  const user = await users.findByEmail(input.email);
  if (!user) {
    // Mitigate timing-based account enumeration while staying inside 10ms Free CPU budget
    await dummyPasswordCheck(input.password, { iterations, pepper });
    await audits.record({
      userId: null,
      action: "auth.login",
      resourceType: "session",
      outcome: "denied",
      metadata: { reason: "unknown_email" },
      ipAddress: ip,
    });
    throw new AppError("UNAUTHORIZED", "Invalid email or password", 401);
  }

  const valid = await verifyPassword(
    input.password,
    user.password_hash,
    user.password_salt,
    pepper,
  );
  if (!valid) {
    await audits.record({
      userId: user.id,
      action: "auth.login",
      resourceType: "session",
      outcome: "denied",
      metadata: { reason: "invalid_password" },
      ipAddress: ip,
    });
    throw new AppError("UNAUTHORIZED", "Invalid email or password", 401);
  }

  const rawToken = generateRandomToken(32);
  const tokenHash = await sha256Hex(rawToken);
  const csrfToken = generateRandomToken(24);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await sessions.create({
    userId: user.id,
    tokenHash,
    csrfToken,
    userAgent: c.req.header("user-agent") ?? null,
    ipAddress: ip,
    expiresAt: expiresAt.toISOString(),
  });

  // Opportunistic cleanup of expired sessions & rate limit buckets
  await sessions.pruneExpired();
  await new RateLimitRepository(db).pruneExpired();

  await audits.record({
    userId: user.id,
    action: "auth.login",
    resourceType: "session",
    outcome: "success",
    ipAddress: ip,
  });

  setSessionCookie(c, rawToken, expiresAt);
  return c.json({ user: toPublicUser(user), csrfToken });
});

authRoutes.post("/logout", requireAuth, async (c) => {
  const db = requireDb(c.env);
  const session = c.get("session")!;
  const user = c.get("user")!;
  const sessions = new SessionRepository(db);
  const audits = new AuditLogRepository(db);

  await sessions.deleteById(session.id);
  await audits.record({
    userId: user.id,
    action: "auth.logout",
    resourceType: "session",
    resourceId: session.id,
    outcome: "success",
    ipAddress: getClientIp(c),
  });

  deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
  return c.json({ ok: true });
});

authRoutes.get("/me", requireAuth, (c) => {
  const user = c.get("user")!;
  const session = c.get("session")!;
  return c.json({
    user: toPublicUser(user),
    csrfToken: session.csrf_token,
  });
});
