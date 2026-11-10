/**
 * Login rate limiting stored in the database (works across serverless instances).
 * Keyed by HMAC(AUTH_SECRET, client IP): raw IPs are never stored.
 */
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";

export const MAX_ATTEMPTS = 8;
export const WINDOW_MS = 15 * 60_000;
export const LOCK_MS = 15 * 60_000;

export function attemptKey(ip: string, secret: string) {
  return createHmac("sha256", secret).update(`login:${ip}`).digest("base64url");
}

/** Returns ms until the caller may try again (0 = allowed now). */
export async function lockedFor(db: DB, key: string, now = Date.now()) {
  const row = await db.query.authAttempts.findFirst({ where: eq(s.authAttempts.key, key) });
  return row?.lockedUntil && row.lockedUntil > now ? row.lockedUntil - now : 0;
}

export async function recordFailure(db: DB, key: string, now = Date.now()) {
  const row = await db.query.authAttempts.findFirst({ where: eq(s.authAttempts.key, key) });
  const fresh = !row || now - row.windowStart > WINDOW_MS;
  const count = fresh ? 1 : row.count + 1;
  const lockedUntil = count >= MAX_ATTEMPTS ? now + LOCK_MS : null;
  await db
    .insert(s.authAttempts)
    .values({ key, count, windowStart: fresh ? now : row.windowStart, lockedUntil })
    .onConflictDoUpdate({
      target: s.authAttempts.key,
      set: { count, windowStart: fresh ? now : row!.windowStart, lockedUntil },
    });
  return { count, locked: lockedUntil !== null };
}

export async function clearFailures(db: DB, key: string) {
  await db.delete(s.authAttempts).where(eq(s.authAttempts.key, key));
}
