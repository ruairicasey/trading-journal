/**
 * GET /api/ctrader/callback?code&state — the cTrader OAuth redirect URI (registered as <prod origin>/api/ctrader/callback).
 * Checks the state cookie, exchanges the one-minute code for tokens, stores them encrypted, then discovers the
 * accounts. A grant with trading scope is refused and deleted. Never echoes the code or tokens.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { exchangeCode, redirectUriFor, STATE_COOKIE } from "@/server/ctrader/oauth";
import { discoverAccounts, saveConnection, TradeScopeRefused } from "@/server/ctrader/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function GET(req: Request) {
  const cfg = getConfig();
  const url = new URL(req.url);
  const back = new URL("/settings/ctrader", req.url);
  const done = (params: Record<string, string>) => {
    for (const [k, v] of Object.entries(params)) back.searchParams.set(k, v);
    const res = NextResponse.redirect(back);
    res.cookies.set(STATE_COOKIE, "", { path: "/api/ctrader", maxAge: 0 });
    res.headers.set("Cache-Control", "no-store");
    return res;
  };
  if (cfg.isDemo || !cfg.ctrader.configured) return done({ error: cfg.isDemo ? "demo" : "not-configured" });

  const cookie =
    req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${STATE_COOKIE}=([^;]+)`))?.[1] ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (!cookie || !state || !same(cookie, state)) return done({ error: "state" });
  if (url.searchParams.get("error")) return done({ error: "denied" });
  const code = url.searchParams.get("code");
  if (!code) return done({ error: "no-code" });

  const db = getDb();
  try {
    const tokens = await exchangeCode({
      code,
      redirectUri: redirectUriFor(req.url),
      clientId: cfg.ctrader.clientId!,
      clientSecret: cfg.ctrader.clientSecret!,
    });
    await saveConnection(db, cfg.ctrader, tokens);
  } catch {
    return done({ error: "token" });
  }
  try {
    const r = await discoverAccounts(db, { cfg: cfg.ctrader });
    return done({ connected: String(r.found), added: String(r.added) });
  } catch (e) {
    if (e instanceof TradeScopeRefused) {
      await db.update(s.ctraderAccounts).set({ connectionId: null });
      await db.delete(s.ctraderConnections);
      return done({ error: "trade-scope" });
    }
    // tokens are saved; discovery can be retried from the page
    return done({ connected: "0", error: "discovery" });
  }
}
