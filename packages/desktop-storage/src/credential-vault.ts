import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { decryptSecret, encryptSecret } from "@ai-workspace/auth";
import type { ProviderId } from "@ai-workspace/contracts";
import { maskSecret } from "@ai-workspace/shared";

export interface CredentialCipherAdapter {
  readonly mode: "electron_safe_storage" | "local_aes_fallback";
  encrypt(plaintext: string, aad: string): Promise<{ payload: string; iv?: string }>;
  decrypt(payload: string, aad: string, iv?: string): Promise<string>;
}

/**
 * Uses OS-level DPAPI/Keychain via Electron's safeStorage API when available.
 */
export function createSafeStorageAdapter(safeStorage: {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(encrypted: Buffer): string;
}): CredentialCipherAdapter {
  if (safeStorage.isEncryptionAvailable()) {
    return {
      mode: "electron_safe_storage",
      async encrypt(plaintext) {
        const buf = safeStorage.encryptString(plaintext);
        return { payload: buf.toString("base64") };
      },
      async decrypt(payload) {
        return safeStorage.decryptString(Buffer.from(payload, "base64"));
      },
    };
  }
  return createLocalAesFallbackAdapter();
}

export function createLocalAesFallbackAdapter(seed?: string): CredentialCipherAdapter {
  const keyHex = crypto
    .createHash("sha256")
    .update(seed || `${process.platform}:${process.arch}:epocanvas-desktop-vault`)
    .digest("hex");

  return {
    mode: "local_aes_fallback",
    async encrypt(plaintext, aad) {
      const { ciphertext, iv } = await encryptSecret(plaintext, keyHex, aad);
      return { payload: ciphertext, iv };
    },
    async decrypt(payload, aad, iv) {
      if (!iv) throw new Error("Missing IV for local AES vault entry");
      return decryptSecret(payload, iv, keyHex, aad);
    },
  };
}

interface VaultEntry {
  providerId: ProviderId;
  mode: CredentialCipherAdapter["mode"];
  payload: string;
  iv?: string;
  keyHint: string;
  updatedAt: string;
}

type VaultFileMap = Partial<Record<ProviderId, VaultEntry>>;

/**
 * Local encrypted vault for BYOK provider API keys (Windows DPAPI via safeStorage on Windows hosts).
 */
export class DesktopCredentialVault {
  constructor(
    private readonly vaultPath: string,
    private readonly adapter: CredentialCipherAdapter,
  ) {}

  get mode() {
    return this.adapter.mode;
  }

  private readAll(): VaultFileMap {
    if (!fs.existsSync(this.vaultPath)) return {};
    try {
      return JSON.parse(fs.readFileSync(this.vaultPath, "utf8")) as VaultFileMap;
    } catch {
      return {};
    }
  }

  private writeAll(data: VaultFileMap): void {
    fs.mkdirSync(path.dirname(this.vaultPath), { recursive: true });
    fs.writeFileSync(this.vaultPath, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  async setKey(
    providerId: ProviderId,
    apiKey: string,
  ): Promise<{ providerId: ProviderId; keyHint: string; mode: string; updatedAt: string }> {
    const trimmed = apiKey.trim();
    const { payload, iv } = await this.adapter.encrypt(trimmed, `desktop:${providerId}`);
    const now = new Date().toISOString();
    const keyHint = maskSecret(trimmed);

    const all = this.readAll();
    all[providerId] = {
      providerId,
      mode: this.adapter.mode,
      payload,
      ...(iv ? { iv } : {}),
      keyHint,
      updatedAt: now,
    };
    this.writeAll(all);
    return { providerId, keyHint, mode: this.adapter.mode, updatedAt: now };
  }

  async getKey(providerId: ProviderId): Promise<string | null> {
    const all = this.readAll();
    const entry = all[providerId];
    if (!entry) return null;
    return this.adapter.decrypt(entry.payload, `desktop:${providerId}`, entry.iv);
  }

  deleteKey(providerId: ProviderId): boolean {
    const all = this.readAll();
    if (!all[providerId]) return false;
    delete all[providerId];
    this.writeAll(all);
    return true;
  }

  listHints(): Array<{ providerId: ProviderId; keyHint: string; mode: string; updatedAt: string }> {
    const all = this.readAll();
    return Object.values(all)
      .filter((e): e is VaultEntry => Boolean(e))
      .map((e) => ({
        providerId: e.providerId,
        keyHint: e.keyHint,
        mode: e.mode,
        updatedAt: e.updatedAt,
      }));
  }
}
