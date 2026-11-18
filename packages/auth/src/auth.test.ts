import { describe, expect, it } from "vitest";
import {
  RateLimiter,
  constantTimeEqual,
  decryptSecret,
  dummyPasswordCheck,
  encryptSecret,
  hashPassword,
  sha256Hex,
  verifyPassword,
} from "./index.js";

const TEST_MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const TEST_PEPPER = "test-server-pepper-secret";

describe("auth cryptography and rate limiting", () => {
  it("hashes and verifies peppered v2 passwords within 10ms-safe budget", async () => {
    const { hash, salt } = await hashPassword("correct-horse-battery-staple", {
      iterations: 10_000,
      pepper: TEST_PEPPER,
    });
    expect(hash.startsWith("v2:pbkdf2_sha256:10000:1:")).toBe(true);
    expect(await verifyPassword("correct-horse-battery-staple", hash, salt, TEST_PEPPER)).toBe(
      true,
    );
    expect(await verifyPassword("wrong-password", hash, salt, TEST_PEPPER)).toBe(false);
    // Missing or wrong pepper must fail verification
    expect(await verifyPassword("correct-horse-battery-staple", hash, salt)).toBe(false);
    expect(await verifyPassword("correct-horse-battery-staple", hash, salt, "wrong-pepper")).toBe(
      false,
    );

    await expect(
      dummyPasswordCheck("any-password", { iterations: 10_000, pepper: TEST_PEPPER }),
    ).resolves.toBeUndefined();
  });

  it("encrypts and decrypts versioned v1 API keys with AES-256-GCM bound to AAD", async () => {
    const apiKey = "sk-proj-test-secret-value-12345";
    const { ciphertext, iv } = await encryptSecret(apiKey, TEST_MASTER_KEY, "usr_1:openai");

    expect(ciphertext.startsWith("v1:")).toBe(true);
    expect(ciphertext).not.toContain(apiKey);
    const decrypted = await decryptSecret(ciphertext, iv, TEST_MASTER_KEY, "usr_1:openai");
    expect(decrypted).toBe(apiKey);

    await expect(decryptSecret(ciphertext, iv, TEST_MASTER_KEY, "usr_2:openai")).rejects.toThrow();
  });

  it("computes deterministic SHA-256 digests and constant-time equality", async () => {
    const d1 = await sha256Hex("session-token-1");
    const d2 = await sha256Hex("session-token-1");
    expect(d1).toBe(d2);
    expect(d1).toHaveLength(64);
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
  });

  it("enforces rate limits and bounds map size against memory leaks", () => {
    const limiter = new RateLimiter(2, 1000, 3);
    expect(limiter.check("ip:1", 100).allowed).toBe(true);
    expect(limiter.check("ip:1", 200).allowed).toBe(true);
    expect(limiter.check("ip:1", 300).allowed).toBe(false);
    expect(limiter.check("ip:1", 1200).allowed).toBe(true);

    limiter.check("ip:2", 1200);
    limiter.check("ip:3", 1200);
    limiter.check("ip:4", 1200);
    expect(limiter.size).toBeLessThanOrEqual(3);
  });
});
