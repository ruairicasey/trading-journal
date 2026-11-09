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
import { syncAll } from "@/server/hyperliquid/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
    budgetMs: getConfig().hyperliquid.syncBudgetMs,
  });
  // label/status/counts only — no addresses
  return NextResponse.json({ done: out.done, results: out.results, status: await getSyncStatus() });
}

export async function GET() {
  return NextResponse.json(await getSyncStatus());
}
