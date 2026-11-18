import { z } from "zod";

export const ErrorCodeSchema = z.enum([
  "BAD_REQUEST",
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "UNSUPPORTED_CAPABILITY",
  "APPROVAL_REQUIRED",
  "UPSTREAM_ERROR",
  "INTERNAL_ERROR",
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});

export type ApiErrorPayload = z.infer<typeof ApiErrorSchema>;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class UnsupportedCapabilityError extends AppError {
  constructor(capability: string, engineId: string) {
    super(
      "UNSUPPORTED_CAPABILITY",
      `Engine "${engineId}" does not support capability "${capability}"`,
      400,
      { capability, engineId },
    );
    this.name = "UnsupportedCapabilityError";
  }
}
