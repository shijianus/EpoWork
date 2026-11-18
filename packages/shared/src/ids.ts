/** Generates a URL-safe prefixed unique ID using WebCrypto. */
export function createId(prefix?: string): string {
  const uuid = crypto.randomUUID().replace(/-/g, "");
  return prefix ? `${prefix}_${uuid}` : uuid;
}

/** Returns masked API key hint (e.g., "sk-p...9a2f") without exposing raw key material. */
export function maskSecret(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length <= 8) {
    return "****";
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}
