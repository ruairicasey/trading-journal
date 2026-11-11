/**
 * GET /api/positions — live open positions (all perp dexes) for the active account's wallets.
 * Session-protected by middleware. Cached briefly to stay well inside Hyperliquid's rate limits.
 * Never returns wallet addresses.
 */
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { getActiveAccount } from "@/server/db/queries/settings";
import * as s from "@/server/db/schema";
import { getHlClient } from "@/server/hyperliquid";
import { displayPair } from "@/server/hyperliquid/markets";
import { fetchPositions } from "@/server/hyperliquid/sync";
import { sanitizeError } from "@/server/hyperliquid/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type LivePosition = {
  wallet: string;
  coin: string;
  displayPair: string;
  size: number;
  entryPx: number | null;
  positionValue: number | null;
  unrealizedPnl: number | null;
  returnOnEquity: number | null;
  leverage: number | null;
  liquidationPx: number | null;
};

const CACHE_MS = 15_000;
const g = globalThis as unknown as { __posCache?: Map<string, { at: number; body: unknown }> };
const cache = (g.__posCache ??= new Map());

export async function GET() {
  if (getConfig().isDemo) return NextResponse.json({ live: false, reason: "Demo data: no live positions", positions: [] });
  const { active } = await getActiveAccount();
  if (!active) return NextResponse.json({ live: false, reason: "No account", positions: [] });
  const hit = cache.get(active.id);
  if (hit && Date.now() - hit.at < CACHE_MS) return NextResponse.json(hit.body);

  const wallets = await getDb()
    .select()
    .from(s.wallets)
    .where(and(eq(s.wallets.accountId, active.id), eq(s.wallets.enabled, true)));
  if (!wallets.length) return NextResponse.json({ live: false, reason: "No wallet", positions: [] });
  try {
    const client = getHlClient();
    const positions: LivePosition[] = [];
    for (const w of wallets) {
      for (const p of await fetchPositions(client, w.address)) {
        const num = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));
        positions.push({
          wallet: w.label,
          coin: p.coin,
          displayPair: displayPair(p.coin),
          size: Number(p.szi),
          entryPx: num(p.entryPx),
          positionValue: num(p.positionValue),
          unrealizedPnl: num(p.unrealizedPnl),
          returnOnEquity: num(p.returnOnEquity),
          leverage: p.leverage?.value ?? null,
          liquidationPx: num(p.liquidationPx),
        });
      }
    }
    const body = { live: true, at: Date.now(), positions };
    cache.set(active.id, { at: Date.now(), body });
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json({ live: false, reason: sanitizeError(e), positions: [] }, { status: 502 });
  }
}
