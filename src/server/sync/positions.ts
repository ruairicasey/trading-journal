import { and, eq, isNull } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import type { HlPosition } from "../hyperliquid/schemas";

/** what either exchange says about an open position */
export type LivePositionInfo = Pick<HlPosition, "coin" | "leverage" | "liquidationPx">;

/**
 * Copy live leverage / liquidation price onto matching open trades (exchange-owned columns only).
 * Returns the number of mismatches between exchange positions and reconstructed open trades.
 */
export async function applyPositions(
  db: DB,
  walletId: string,
  positions: LivePositionInfo[],
): Promise<number> {
  const open = await db
    .select()
    .from(s.trades)
    .where(and(eq(s.trades.walletId, walletId), eq(s.trades.status, "open"), isNull(s.trades.deletedAt)));
  const live = open.filter((t) => !t.flags?.superseded);
  const byCoin = new Map(positions.map((p) => [p.coin, p]));
  let mismatches = 0;
  for (const t of live) {
    const p = byCoin.get(t.coin);
    if (!p) {
      mismatches++;
      continue;
    }
    await db
      .update(s.trades)
      .set({
        leverage: p.leverage?.value ?? null,
        liqPx: p.liquidationPx != null ? Number(p.liquidationPx) : null,
      })
      .where(eq(s.trades.id, t.id));
  }
  const openCoins = new Set(live.map((t) => t.coin));
  for (const p of positions) if (!openCoins.has(p.coin)) mismatches++;
  return mismatches;
}
