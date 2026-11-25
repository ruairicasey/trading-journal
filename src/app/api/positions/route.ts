/**
 * GET /api/positions — live open positions (Hyperliquid, all perp dexes, and Lighter) for the active account's wallets.
 * Session-protected by middleware. Cached briefly to stay well inside Hyperliquid's rate limits.
 * Never returns wallet addresses.
 */
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { getActiveScope } from "@/server/db/queries/settings";
import * as s from "@/server/db/schema";
import { getHlClient } from "@/server/hyperliquid";
import { getLighterClient } from "@/server/lighter";
import { loadLivePositions, type LivePosition } from "@/server/sync/live-positions";
import { sanitizeError } from "@/server/sync/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type { LivePosition };

const CACHE_MS = 15_000;
const g = globalThis as unknown as { __posCache?: Map<string, { at: number; body: unknown }> };
const cache = (g.__posCache ??= new Map());

export async function GET() {
  if (getConfig().isDemo) return NextResponse.json({ live: false, reason: "Demo data: no live positions", positions: [] });
  const { active, walletId } = await getActiveScope();
  if (!active) return NextResponse.json({ live: false, reason: "No account", positions: [] });
  const key = `${active.id}|${walletId ?? "all"}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return NextResponse.json(hit.body);

  const wallets = await getDb()
    .select()
    .from(s.wallets)
    .where(and(eq(s.wallets.accountId, active.id), eq(s.wallets.enabled, true), ...(walletId ? [eq(s.wallets.id, walletId)] : [])));
  if (!wallets.length) return NextResponse.json({ live: false, reason: "No wallet", positions: [] });
  try {
    const { positions, missing } = await loadLivePositions(wallets, { hl: getHlClient(), lighter: getLighterClient() });
    const body = { live: true, at: Date.now(), positions, missing };
    cache.set(key, { at: Date.now(), body });
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json({ live: false, reason: sanitizeError(e), positions: [] }, { status: 502 });
  }
}
