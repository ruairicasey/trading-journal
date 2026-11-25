/**
 * POST /api/sync — run a sync now (UI "Sync now", auto-sync timer, custom range resync).
 * GET  /api/sync — current sync status.
 * Protected by the auth middleware from step 6 (every route). Never returns addresses.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { getSyncStatus } from "@/server/db/queries/sync";
import { getHlClient } from "@/server/hyperliquid";
import { lighterDeps } from "@/server/lighter/sync";
import { syncAll } from "@/server/hyperliquid/sync";
import { syncCtrader } from "@/server/ctrader/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Fluid compute on Vercel Hobby allows up to 300s. Sync work itself is bounded by a time budget.
export const maxDuration = 300;

const Body = z.object({
  trigger: z.enum(["manual", "auto", "range"]).default("manual"),
  walletId: z.string().min(1).max(64).optional(),
  range: z
    .object({ start: z.number().int().min(0), end: z.number().int().min(0) })
    .refine((r) => r.end > r.start, "end must be after start")
    .optional(),
});

export async function POST(req: Request) {
  if (getConfig().isDemo) {
    return NextResponse.json({ error: "Sync is disabled for the demo account." }, { status: 409 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { trigger, walletId, range } = parsed.data;
  const out = await syncAll(getDb(), getHlClient(), {
    trigger: range ? "range" : trigger,
    walletId,
    range,
    lighter: await lighterDeps(),
    budgetMs: getConfig().hyperliquid.syncBudgetMs,
  });
  // "Sync now" on the whole journal (no wallet or range picked) also pulls cTrader; the background auto-sync doesn't
  const ct =
    trigger !== "manual" || walletId || range
      ? null
      : await syncCtrader(getDb(), {
          cfg: getConfig().ctrader,
          budgetMs: Math.max(10_000, getConfig().hyperliquid.syncBudgetMs / 2),
        });
  // label/status/counts only — no addresses or logins
  return NextResponse.json({
    done: out.done && (ct?.done ?? true),
    results: out.results,
    ctrader: ct?.results ?? [],
    status: await getSyncStatus(),
  });
}

export async function GET() {
  return NextResponse.json(await getSyncStatus());
}
