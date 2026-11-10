/**
 * Pure access decision used by middleware (edge-safe, unit-tested in tests/auth.test.ts).
 * Every page and API route is protected; the only public paths are listed below.
 */
import type { AuthEnv } from "./env";

/** Paths reachable without a session. The cron route enforces its own bearer token. */
export const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/sync/cron", "/robots.txt", "/favicon.ico"];

export type AccessDecision =
  | { action: "allow" }
  | { action: "redirect"; to: string }
  | { action: "unauthorized" }
  | { action: "unavailable"; reason: string };

export function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** Only allow same-origin relative redirect targets. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/dashboard";
  if (next.startsWith("/login") || next.startsWith("/api/")) return "/dashboard";
  return next;
}

export function decideAccess(input: { pathname: string; search?: string; hasSession: boolean; env: AuthEnv }): AccessDecision {
  const { pathname, hasSession, env } = input;
  if (pathname === "/robots.txt") return { action: "allow" };
  if (env.isPreview) return { action: "unavailable", reason: "Preview deployments have no data access." };
  if (!env.authEnabled) return { action: "allow" };
  if (env.misconfigured) return { action: "unavailable", reason: `Server misconfigured: ${env.misconfigured}.` };

  if (pathname === "/login" && hasSession) return { action: "redirect", to: "/dashboard" };
  if (isPublicPath(pathname)) return { action: "allow" };
  if (hasSession) return { action: "allow" };
  if (pathname.startsWith("/api/")) return { action: "unauthorized" };
  return { action: "redirect", to: `/login?next=${encodeURIComponent(safeNext(pathname + (input.search ?? "")))}` };
}
