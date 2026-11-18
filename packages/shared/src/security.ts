/**
 * Security validators for SSRF protection and workspace filesystem path containment.
 */

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.goog",
  "169.254.169.254",
]);

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map((segment) => Number(segment));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isPrivateIPv6(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd")
  ) {
    return true;
  }
  // IPv4-mapped IPv6 e.g. ::ffff:127.0.0.1
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    if (isPrivateIPv4(mapped)) return true;
  }
  return false;
}

/**
 * Validates that a user-supplied URL is safe for outbound server requests (blocks private IPs & non-HTTP schemes).
 */
export function validateOutboundUrl(
  rawUrl: string,
): { ok: true; url: URL } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "Invalid URL format" };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: `Disallowed URL protocol: ${parsed.protocol}` };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, reason: "Embedded URL credentials are not allowed" };
  }

  const host = parsed.hostname.toLowerCase();
  if (!host) {
    return { ok: false, reason: "Missing hostname" };
  }

  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, reason: `Blocked internal hostname: ${host}` };
  }

  if (isPrivateIPv4(host) || isPrivateIPv6(host)) {
    return { ok: false, reason: `Blocked private IP address: ${host}` };
  }

  return { ok: true, url: parsed };
}

/**
 * Normalizes a workspace-relative path and rejects traversal attempts, null bytes, or absolute escapes.
 */
export function sanitizeWorkspacePath(
  inputPath: string,
): { ok: true; path: string } | { ok: false; reason: string } {
  if (!inputPath || inputPath.includes("\0")) {
    return { ok: false, reason: "Empty or invalid path" };
  }

  const slashNormalized = inputPath.replace(/\\/g, "/");
  if (slashNormalized.startsWith("/") || /^[A-Za-z]:/.test(slashNormalized)) {
    return { ok: false, reason: "Absolute paths are not allowed" };
  }

  const segments = slashNormalized.split("/").filter((s) => s.length > 0 && s !== ".");
  if (segments.length === 0) {
    return { ok: true, path: "." };
  }

  for (const segment of segments) {
    if (segment === "..") {
      return { ok: false, reason: "Path traversal ('..') is not allowed" };
    }
  }

  return { ok: true, path: segments.join("/") };
}
