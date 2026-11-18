import { FREE_TIER_BUDGETS } from "@ai-workspace/shared";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error("Invalid hex key material");
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Constant-time byte/string comparison to prevent timing side-channels. */
export function constantTimeEqual(a: string, b: string): boolean {
  const bytesA = encoder.encode(a);
  const bytesB = encoder.encode(b);
  if (bytesA.length !== bytesB.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < bytesA.length; i += 1) {
    diff |= (bytesA[i] ?? 0) ^ (bytesB[i] ?? 0);
  }
  return diff === 0;
}

/** Generates a cryptographically secure random URL-safe hex token. */
export function generateRandomToken(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return bytesToHex(bytes);
}

/** Computes SHA-256 hex digest (used for storing session token hashes in D1). */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

async function applyPepper(password: string, pepper?: string): Promise<Uint8Array> {
  if (!pepper) {
    return encoder.encode(password);
  }
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", hmacKey, encoder.encode(password));
  return new Uint8Array(sig);
}

async function derivePbkdf2(
  secretBytes: Uint8Array,
  saltBytes: Uint8Array,
  iterations: number,
): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    secretBytes.buffer as ArrayBuffer,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes.buffer as ArrayBuffer,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  return bytesToBase64(new Uint8Array(derived));
}

export interface PasswordHashOptions {
  /** Defaults to FREE_PBKDF2_ITERATIONS (10_000, ~2.8ms CPU) to stay within Workers Free 10ms limit. */
  iterations?: number;
  /** Optional server-side pepper secret (isolated from D1 database). */
  pepper?: string;
}

/**
 * Hashes a password with optional HMAC-SHA256 server pepper + PBKDF2-SHA256 + 16-byte random salt.
 * Produces self-describing format `v2:pbkdf2_sha256:<iterations>:<peppered01>:<hashB64>`.
 */
export async function hashPassword(
  password: string,
  options: PasswordHashOptions = {},
): Promise<{ hash: string; salt: string }> {
  const iterations = Math.min(
    100_000,
    Math.max(10_000, options.iterations ?? FREE_TIER_BUDGETS.FREE_PBKDF2_ITERATIONS),
  );
  const peppered = Boolean(options.pepper);
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const secretBytes = await applyPepper(password, options.pepper);
  const derivedB64 = await derivePbkdf2(secretBytes, saltBytes, iterations);

  return {
    hash: `v2:pbkdf2_sha256:${iterations}:${peppered ? 1 : 0}:${derivedB64}`,
    salt: bytesToBase64(saltBytes),
  };
}

/**
 * Verifies a password against either v2 self-describing hashes or legacy v1 plain-base64 (100k iter) hashes.
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
  saltB64: string,
  pepper?: string,
): Promise<boolean> {
  const saltBytes = base64ToBytes(saltB64);

  if (storedHash.startsWith("v2:pbkdf2_sha256:")) {
    const parts = storedHash.split(":");
    if (parts.length !== 5) return false;
    const iterations = Number.parseInt(parts[2] ?? "", 10);
    const pepperFlag = parts[3];
    const expectedB64 = parts[4] ?? "";
    if (!Number.isFinite(iterations) || iterations < 1_000 || iterations > 100_000) {
      return false;
    }
    if (pepperFlag === "1" && !pepper) {
      return false;
    }
    const secretBytes = await applyPepper(password, pepperFlag === "1" ? pepper : undefined);
    const actualB64 = await derivePbkdf2(secretBytes, saltBytes, iterations);
    return constantTimeEqual(actualB64, expectedB64);
  }

  // Legacy v1 format (100,000 iterations without pepper)
  const actualB64 = await derivePbkdf2(encoder.encode(password), saltBytes, 100_000);
  return constantTimeEqual(actualB64, storedHash);
}

/**
 * Performs dummy PBKDF2 work on unknown-email login attempts to mitigate timing-based account enumeration.
 */
export async function dummyPasswordCheck(
  password: string,
  options: PasswordHashOptions = {},
): Promise<void> {
  const iterations = Math.min(
    100_000,
    Math.max(10_000, options.iterations ?? FREE_TIER_BUDGETS.FREE_PBKDF2_ITERATIONS),
  );
  const saltBytes = new Uint8Array(16);
  const secretBytes = await applyPepper(password, options.pepper);
  await derivePbkdf2(secretBytes, saltBytes, iterations);
}

async function importAesKey(masterKeyHex: string) {
  const raw = hexToBytes(masterKeyHex);
  if (raw.byteLength !== 32) {
    throw new Error("ENCRYPTION_MASTER_KEY must be a 32-byte (64 hex chars) key");
  }
  return crypto.subtle.importKey("raw", raw.buffer as ArrayBuffer, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Encrypts a sensitive API key with AES-256-GCM and AAD bound to tenant context (e.g. `userId:providerId`).
 * Prefixed with `v1:` for future master-key rotation support.
 */
export async function encryptSecret(
  plaintext: string,
  masterKeyHex: string,
  aad: string,
): Promise<{ ciphertext: string; iv: string }> {
  const key = await importAesKey(masterKeyHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: encoder.encode(aad),
    },
    key,
    encoder.encode(plaintext),
  );
  return {
    ciphertext: `v1:${bytesToBase64(new Uint8Array(encrypted))}`,
    iv: bytesToBase64(iv),
  };
}

/** Decrypts an AES-256-GCM ciphertext verifying AAD matches the expected tenant/provider binding. */
export async function decryptSecret(
  ciphertextStored: string,
  ivB64: string,
  masterKeyHex: string,
  aad: string,
): Promise<string> {
  const key = await importAesKey(masterKeyHex);
  const iv = base64ToBytes(ivB64);
  const rawB64 = ciphertextStored.startsWith("v1:") ? ciphertextStored.slice(3) : ciphertextStored;
  const ciphertext = base64ToBytes(rawB64);
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv.buffer as ArrayBuffer,
      additionalData: encoder.encode(aad),
    },
    key,
    ciphertext.buffer as ArrayBuffer,
  );
  return decoder.decode(decrypted);
}
