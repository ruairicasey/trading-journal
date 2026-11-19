/**
 * Encryption at rest for the cTrader tokens: AES-256-GCM with a key derived (HKDF-SHA256) from CTRADER_TOKEN_KEY.
 * Format: "v1." + base64url(iv[12] | tag[16] | ciphertext). Tampering or the wrong key makes decrypt throw.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const deriveKey = (secret: string) =>
  Buffer.from(hkdfSync("sha256", secret, "trading-journal", "ctrader-token-v1", 32));

export function encryptToken(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return "v1." + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
}

export function decryptToken(enc: string, secret: string): string {
  if (!enc.startsWith("v1.")) throw new Error("Unknown token format");
  const buf = Buffer.from(enc.slice(3), "base64url");
  if (buf.length < 29) throw new Error("Token is corrupt");
  const d = createDecipheriv("aes-256-gcm", deriveKey(secret), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  try {
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
  } catch {
    // never echo the ciphertext or key material
    throw new Error("Token could not be decrypted (was CTRADER_TOKEN_KEY changed?)");
  }
}
