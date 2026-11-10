/**
 * Scheduled sync. Called by Vercel Cron (GET, daily backstop) and the GitHub Actions workflow (POST, ~10 min).
 * Not session-protected; requires `Authorization: Bearer <CRON_SECRET>` (constant-time compare).
 * Returns only a tiny status (no addresses, no counts beyond `done`).
 */
import { NextResponse } from "next/server";
import { readAuthEnv } from "@/server/auth/env";
import { bearerToken, safeEqual } from "@/server/auth/password";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { getHlClient } from "@/server/hyperliquid";
import { syncAll } from "@/server/hyperliquid/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: Request) {
  const { cronSecret } = readAuthEnv();
  if (!cronSecret) return NextResponse.json({ error: "Cron is not configured" }, { status: 503 });
  if (!safeEqual(bearerToken(req.headers.get("authorization")), cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (getConfig().isDemo) return NextResponse.json({ ok: true, done: true, skipped: "demo" });
  const out = await syncAll(getDb(), getHlClient(), { trigger: "cron", budgetMs: getConfig().hyperliquid.syncBudgetMs });
  const failed = out.results.some((r) => r.status === "error");
  return NextResponse.json({ ok: !failed, done: out.done }, { status: failed ? 502 : 200 });
}

export const GET = handle;
export const POST = handle;
