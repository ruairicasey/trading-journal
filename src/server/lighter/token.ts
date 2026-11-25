/**
 * Lighter read-only tokens: `ro:{account_index}:{single|all}:{expiry_unix}:{random_hex}` (docs: API keys guide).
 * Anything else is refused before it is stored or sent: a normal auth token or an API key can do more than read.
 */
import { decryptToken, encryptToken } from "../ctrader/crypto";

const LABEL = "lighter-token-v1";
const RO = /^ro:(\d{1,15}):(single|all):(\d{9,11}):([0-9a-fA-F]{8,256})$/;

export type ReadOnlyToken = { accountIndex: number; scope: "single" | "all"; expiresAt: number };

export function parseReadOnlyToken(raw: string): ReadOnlyToken | null {
  const m = RO.exec(raw.trim());
  if (!m) return null;
  const accountIndex = Number(m[1]);
  if (!Number.isSafeInteger(accountIndex) || accountIndex <= 0) return null;
  return { accountIndex, scope: m[2] as "single" | "all", expiresAt: Number(m[3]) * 1000 };
}

export const sealToken = (raw: string, secret: string) => encryptToken(raw.trim(), secret, LABEL);

export function openToken(enc: string, secret: string): string {
  try {
    return decryptToken(enc, secret, LABEL);
  } catch {
    throw new Error(
      "The stored Lighter token can't be read (was AUTH_SECRET changed?). Paste the token again.",
    );
  }
}
