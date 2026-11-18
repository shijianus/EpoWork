import { describe, expect, it } from "vitest";
import {
  maskSecret,
  redactString,
  redactValue,
  sanitizeWorkspacePath,
  validateOutboundUrl,
} from "./index.js";

describe("shared security utilities", () => {
  it("redacts API keys, bearer tokens, and sensitive header keys", () => {
    expect(redactString("Authorization: Bearer abc.def.ghi")).toBe("Authorization: [REDACTED]");
    expect(redactString("using key sk-proj-1234567890abcdef")).toBe("using key [REDACTED]");
    expect(redactString("google key AIzaSyD-9876543210abcdefghij")).toBe("google key [REDACTED]");

    const redacted = redactValue({
      authorization: "Bearer secret",
      cookie: "sid=123",
      nested: { apiKey: "sk-1234567890abcdef", safe: "ok" },
    }) as Record<string, unknown>;

    expect(redacted.authorization).toBe("[REDACTED]");
    expect(redacted.cookie).toBe("[REDACTED]");
    expect((redacted.nested as Record<string, unknown>).apiKey).toBe("[REDACTED]");
    expect((redacted.nested as Record<string, unknown>).safe).toBe("ok");
  });

  it("blocks private IPs, metadata hosts, and non-HTTP schemes for SSRF defense", () => {
    expect(validateOutboundUrl("https://github.com/org/repo").ok).toBe(true);
    expect(validateOutboundUrl("http://127.0.0.1:8080").ok).toBe(false);
    expect(validateOutboundUrl("http://169.254.169.254/latest/meta-data").ok).toBe(false);
    expect(validateOutboundUrl("http://10.0.0.5/internal").ok).toBe(false);
    expect(validateOutboundUrl("http://[::1]:3000").ok).toBe(false);
    expect(validateOutboundUrl("file:///etc/passwd").ok).toBe(false);
    expect(validateOutboundUrl("https://user:pass@example.com").ok).toBe(false);
  });

  it("sanitizes relative workspace paths and rejects traversal", () => {
    expect(sanitizeWorkspacePath("src/app/index.ts")).toEqual({
      ok: true,
      path: "src/app/index.ts",
    });
    expect(sanitizeWorkspacePath("./src//main.ts")).toEqual({ ok: true, path: "src/main.ts" });
    expect(sanitizeWorkspacePath("../etc/passwd").ok).toBe(false);
    expect(sanitizeWorkspacePath("src/../../secret").ok).toBe(false);
    expect(sanitizeWorkspacePath("/etc/passwd").ok).toBe(false);
    expect(sanitizeWorkspacePath("foo\0bar").ok).toBe(false);
  });

  it("masks secrets safely", () => {
    expect(maskSecret("sk-proj-1234567890abcd")).toBe("sk-p...abcd");
    expect(maskSecret("short")).toBe("****");
  });
});
