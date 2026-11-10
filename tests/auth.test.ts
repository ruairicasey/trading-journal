import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { decideAccess, safeNext } from "@/server/auth/access";
import { readAuthEnv } from "@/server/auth/env";
import { bearerToken, hashPassword, safeEqual, verifyPassword } from "@/server/auth/password";
import { attemptKey, clearFailures, lockedFor, MAX_ATTEMPTS, recordFailure } from "@/server/auth/rate-limit";
import { createSessionToken, SESSION_TTL_SECONDS, verifySessionToken } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/bootstrap";
import { LocalStorage } from "@/server/storage/local";
import { assertSafeKey } from "@/server/storage/keys";
import { useTempDb } from "./helpers/db";

const SECRET = "x".repeat(48);
let HASH: string;

beforeAll(async () => {
  HASH = await hashPassword("correct horse battery");
});

describe("password hashing", () => {
  test("round-trips, rejects wrong and malformed input", async () => {
    expect(HASH).toMatch(/^scrypt:32768:8:1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    expect(HASH).not.toContain("$"); // Next's .env loader would expand `$…`
    expect(await verifyPassword("correct horse battery", HASH)).toBe(true);
    expect(await verifyPassword("wrong horse battery!", HASH)).toBe(false);
    expect(await verifyPassword("correct horse battery", undefined)).toBe(false);
    expect(await verifyPassword("correct horse battery", "scrypt:1:2")).toBe(false);
    expect(await verifyPassword("x", "plaintext-password")).toBe(false);
    await expect(hashPassword("short")).rejects.toThrow(/at least/);
  });

  test("bearer tokens compare in constant time and parse strictly", () => {
    expect(bearerToken("Bearer abc123")).toBe("abc123");
    expect(bearerToken("bearer   abc123 ")).toBe("abc123");
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken(null)).toBeNull();
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual(undefined, undefined)).toBe(false);
    expect(safeEqual("", "")).toBe(false);
  });
});

describe("session tokens", () => {
  test("valid token verifies; wrong secret, tampering and expiry fail", async () => {
    const t = await createSessionToken(SECRET);
    expect(await verifySessionToken(t, SECRET)).toBe(true);
    expect(await verifySessionToken(t, "y".repeat(48))).toBe(false);
    expect(await verifySessionToken(t.slice(0, -2) + "xx", SECRET)).toBe(false);
    expect(await verifySessionToken(undefined, SECRET)).toBe(false);
    expect(await verifySessionToken(t, undefined)).toBe(false);
    const later = Date.now() + (SESSION_TTL_SECONDS + 60) * 1000;
    expect(await verifySessionToken(t, SECRET, later)).toBe(false);
  });
});

describe("access rules (middleware)", () => {
  const prod = (extra: Record<string, string> = {}) =>
    readAuthEnv({ NODE_ENV: "production", AUTH_PASSWORD_HASH: HASH, AUTH_SECRET: SECRET, ...extra });

  test("local dev without a password is open", () => {
    const env = readAuthEnv({ NODE_ENV: "development" });
    expect(env.authEnabled).toBe(false);
    expect(decideAccess({ pathname: "/dashboard", hasSession: false, env })).toEqual({ action: "allow" });
  });

  test("setting a password locally turns auth on", () => {
    const env = readAuthEnv({ NODE_ENV: "development", AUTH_PASSWORD_HASH: HASH, AUTH_SECRET: SECRET });
    expect(decideAccess({ pathname: "/trades", hasSession: false, env }).action).toBe("redirect");
  });

  test("production fails closed when auth config is missing or weak", () => {
    for (const env of [
      readAuthEnv({ NODE_ENV: "production" }),
      readAuthEnv({ NODE_ENV: "production", AUTH_PASSWORD_HASH: HASH }),
      readAuthEnv({ NODE_ENV: "production", AUTH_PASSWORD_HASH: HASH, AUTH_SECRET: "short" }),
      readAuthEnv({ NODE_ENV: "production", AUTH_PASSWORD_HASH: "hunter2", AUTH_SECRET: SECRET }),
    ]) {
      for (const pathname of ["/", "/dashboard", "/login", "/api/sync", "/api/files/a.webp", "/api/sync/cron"]) {
        expect(decideAccess({ pathname, hasSession: true, env }).action).toBe("unavailable");
      }
    }
  });

  test("every page and API route needs a session; only the login and cron paths are public", () => {
    const env = prod();
    expect(decideAccess({ pathname: "/", hasSession: false, env })).toEqual({ action: "redirect", to: "/login?next=%2F" });
    expect(decideAccess({ pathname: "/trades", search: "?tab=open", hasSession: false, env })).toEqual({
      action: "redirect",
      to: "/login?next=%2Ftrades%3Ftab%3Dopen",
    });
    for (const p of ["/api/sync", "/api/files/screenshots/a.webp", "/api/auth/logout", "/api/anything"]) {
      expect(decideAccess({ pathname: p, hasSession: false, env })).toEqual({ action: "unauthorized" });
    }
    for (const p of ["/login", "/api/auth/login", "/api/sync/cron", "/robots.txt"]) {
      expect(decideAccess({ pathname: p, hasSession: false, env })).toEqual({ action: "allow" });
    }
    expect(decideAccess({ pathname: "/api/sync", hasSession: true, env })).toEqual({ action: "allow" });
    expect(decideAccess({ pathname: "/login", hasSession: true, env })).toEqual({ action: "redirect", to: "/dashboard" });
    // public-path prefix tricks don't open other routes
    expect(decideAccess({ pathname: "/loginx", hasSession: false, env }).action).toBe("redirect");
    expect(decideAccess({ pathname: "/api/sync/cronjob", hasSession: false, env }).action).toBe("unauthorized");
  });

  test("Vercel preview deployments never get data access", () => {
    const env = prod({ VERCEL_ENV: "preview" });
    expect(decideAccess({ pathname: "/dashboard", hasSession: true, env }).action).toBe("unavailable");
    expect(decideAccess({ pathname: "/api/sync/cron", hasSession: false, env }).action).toBe("unavailable");
  });

  test("login redirect targets are same-origin only", () => {
    expect(safeNext("/trades?x=1")).toBe("/trades?x=1");
    for (const bad of ["https://evil.test", "//evil.test", "/\\evil.test", "/api/sync", "/login", undefined, ""]) {
      expect(safeNext(bad)).toBe("/dashboard");
    }
  });
});

describe("login rate limiting", () => {
  beforeAll(async () => {
    useTempDb();
    await runMigrations(getDb());
  });

  test(`locks after ${MAX_ATTEMPTS} failures, keyed by a hash (not the raw IP)`, async () => {
    const db = getDb();
    const key = attemptKey("203.0.113.7", SECRET);
    expect(key).not.toContain("203.0.113.7");
    const now = Date.now();
    for (let i = 1; i < MAX_ATTEMPTS; i++) expect((await recordFailure(db, key, now)).locked).toBe(false);
    expect((await recordFailure(db, key, now)).locked).toBe(true);
    expect(await lockedFor(db, key, now)).toBeGreaterThan(0);
    expect(await lockedFor(db, key, now + 16 * 60_000)).toBe(0);
    await clearFailures(db, key);
    expect(await lockedFor(db, key, now)).toBe(0);
  });
});

describe("local storage", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tj-store-"));
  const store = new LocalStorage(root);

  test("put / get / delete", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    await store.put("screenshots/t1/abc.webp", bytes, "image/webp");
    expect(await store.get("screenshots/t1/abc.webp")).toEqual({ body: bytes, contentType: "image/webp" });
    await store.delete("screenshots/t1/abc.webp");
    expect(await store.get("screenshots/t1/abc.webp")).toBeNull();
  });

  test("rejects traversal, absolute paths and non-image types", async () => {
    for (const bad of ["../x.webp", "a/../../x.webp", "/etc/passwd.png", "a/./b.png", "x.svg", "x.html", "a//b.png", ""]) {
      expect(() => assertSafeKey(bad)).toThrow();
      await expect(store.get(bad)).rejects.toThrow();
    }
  });
});
