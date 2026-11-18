import type { ApiErrorPayload, ErrorCode } from "@ai-workspace/contracts";

let csrfTokenStore: string | null = null;

export function setCsrfToken(token: string | null) {
  csrfTokenStore = token;
}

export function getCsrfToken(): string | null {
  return csrfTokenStore;
}

export class ApiClientError extends Error {
  readonly code: ErrorCode | "NETWORK_ERROR";
  readonly status: number;
  readonly requestId?: string;

  constructor(
    message: string,
    code: ErrorCode | "NETWORK_ERROR",
    status: number,
    requestId?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body && typeof init.body === "string") {
    headers.set("Content-Type", "application/json");
  }
  const method = (init.method ?? "GET").toUpperCase();
  if (csrfTokenStore && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    headers.set("X-CSRF-Token", csrfTokenStore);
  }

  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers,
      credentials: "include",
    });
  } catch {
    throw new ApiClientError(
      "Unable to reach the workspace API. Check your connection.",
      "NETWORK_ERROR",
      0,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");

  if (!response.ok) {
    if (isJson) {
      const errBody = (await response.json()) as Partial<ApiErrorPayload>;
      if (errBody.error) {
        throw new ApiClientError(
          errBody.error.message,
          errBody.error.code,
          response.status,
          errBody.error.requestId,
        );
      }
    }
    throw new ApiClientError(
      `Request failed with status ${response.status}`,
      "INTERNAL_ERROR",
      response.status,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
