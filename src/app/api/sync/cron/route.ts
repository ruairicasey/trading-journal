/**
 * Scheduled sync. Called by the Cloudflare Worker cron (POST, hourly, primary), the GitHub Actions workflow
 * (POST, hourly, backup) and Vercel Cron (GET, daily backstop).
 * Not session-protected; requires `Authorization: Bearer <CRON_SECRET>` (constant-time compare).
 * Returns only a tiny status (no addresses, no counts beyond `done`).
 */
import { NextResponse } from "next/server";
import { readAuthEnv } from "@/server/auth/env";
import { bearerToken, safeEqual } from "@/server/auth/password";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { getHlClient } from "@/server/hyperliquid";
import { lighterDeps } from "@/server/lighter/sync";
import { syncAll } from "@/server/hyperliquid/sync";
import { cronOutcome } from "@/server/sync/runs";
import { syncCtrader } from "@/server/ctrader/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Fluid compute on Vercel Hobby allows up to 300s. Sync work itself is bounded by a time budget.
export const maxDuration = 300;

async function handle(req: Request) {
  const { cronSecret } = readAuthEnv();
  if (!cronSecret) return NextResponse.json({ error: "Cron is not configured" }, { status: 503 });
  if (!safeEqual(bearerToken(req.headers.get("authorization")), cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (getConfig().isDemo) return NextResponse.json({ ok: true, done: true, skipped: "demo" });
  const cfg = getConfig();
  const started = Date.now();
  const out = await syncAll(getDb(), getHlClient(), {
    trigger: "cron",
    lighter: await lighterDeps(),
    budgetMs: cfg.hyperliquid.cronSyncBudgetMs,
  });
  // cTrader goes second, inside the same 300 s function: it gets what's left up to 260 s in, and is skipped when
  // Hyperliquid used nearly all of it (a big backfill); it catches up next hour.
  const elapsed = Date.now() - started;
  const ct =
    elapsed < 230_000 ? await syncCtrader(getDb(), { cfg: cfg.ctrader, budgetMs: 260_000 - elapsed }) : null;
  // a cTrader problem (e.g. it needs reconnecting) shows on its settings page; it doesn't fail the Hyperliquid cron
  // likewise Lighter, whose token can expire: the wallet card and the sync warnings show it
  const { status, lighterOk } = cronOutcome(out.results);
  const ctOk = !ct || !ct.results.some((r) => r.status === "error");
  return NextResponse.json(
    { ok: status === 200, done: out.done && (ct?.done ?? false), ctrader: ctOk, lighter: lighterOk },
    { status },
  );
}

export const GET = handle;
export const POST = handle;
