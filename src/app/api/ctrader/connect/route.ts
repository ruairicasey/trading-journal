/**
 * GET /api/ctrader/connect — starts the cTrader OAuth grant (view-only "accounts" scope; never "trading").
 * Session-protected like every route. A random state goes in a short-lived httpOnly cookie and is checked on the way
 * back, so a callback this browser didn't start is rejected.
 */
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getConfig } from "@/server/config";
import { authorizeUrl, redirectUriFor, STATE_COOKIE } from "@/server/ctrader/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const cfg = getConfig();
  const back = new URL("/settings/ctrader", req.url);
  if (cfg.isDemo || !cfg.ctrader.configured) {
    back.searchParams.set("error", cfg.isDemo ? "demo" : "not-configured");
    return NextResponse.redirect(back);
  }
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(
    authorizeUrl({ clientId: cfg.ctrader.clientId!, redirectUri: redirectUriFor(req.url), state }),
  );
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: cfg.env === "production",
    sameSite: "lax", // sent on the top-level redirect back from id.ctrader.com
    path: "/api/ctrader",
    maxAge: 600,
  });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
