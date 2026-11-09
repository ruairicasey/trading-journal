/**
 * Persistence for fills and reconstructed trades.
 *
 * Guarantees (tested in tests/rebuild.test.ts):
 *  - insertFills is idempotent: (wallet_id, tid) primary key + ON CONFLICT DO NOTHING.
 *  - rebuildTrades writes ONLY exchange-owned trade columns, keyed by external_key, so a trade keeps
 *    its id — and therefore its trade_journal row — across any number of rebuilds.
 *  - A previously stored trade that reconstruction no longer produces is flagged `superseded`,
 *    never deleted. Soft-deleted trades stay soft-deleted.
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { parseCoin } from "../hyperliquid/markets";
import { reconstructAll } from "./reconstruct";
import type { FillInput } from "./types";

const CHUNK = 100;

export async function insertFills(db: DB, walletId: string, fills: FillInput[]): Promise<{ inserted: number; coins: string[] }> {
  let inserted = 0;
  const coins = new Set<string>();
  for (let i = 0; i < fills.length; i += CHUNK) {
    const rows = fills.slice(i, i + CHUNK).map((f) => {
      const p = parseCoin(f.coin);
      return {
        walletId,
        tid: f.tid,
        coin: f.coin,
        dex: p.dex,
        marketType: p.marketType,
        px: f.px,
        sz: f.sz,
        side: f.side,
        time: f.time,
        startPosition: f.startPosition,
        dir: f.dir,
        closedPnl: f.closedPnl,
        fee: f.fee,
        feeToken: f.feeToken,
        builderFee: f.builderFee ?? null,
        hash: f.hash,
        oid: f.oid,
        crossed: f.crossed,
        liquidation: f.liquidation ?? null,
        twapId: f.twapId ?? null,
        raw: f,
      };
    });
    const res = await db
      .insert(s.fills)
      .values(rows)
      .onConflictDoNothing()
      .returning({ tid: s.fills.tid, coin: s.fills.coin });
    inserted += res.length;
    for (const r of res) coins.add(r.coin);
  }
  return { inserted, coins: [...coins] };
}

function rowToFill(r: typeof s.fills.$inferSelect): FillInput {
  return {
    tid: r.tid,
    coin: r.coin,
    px: r.px,
    sz: r.sz,
    side: r.side,
    time: r.time,
    startPosition: r.startPosition,
    dir: r.dir,
    closedPnl: r.closedPnl,
    fee: r.fee,
    feeToken: r.feeToken,
    hash: r.hash,
    oid: r.oid,
    crossed: r.crossed,
    builderFee: r.builderFee,
    liquidation: r.liquidation ?? undefined,
    twapId: r.twapId,
  };
}

export type RebuildResult = { created: number; updated: number; superseded: number; tradeIds: string[] };

/**
 * Rebuild trades from stored fills for a wallet (optionally only some coins).
 * Each coin is always rebuilt from its FULL stored fill set.
 */
export async function rebuildTrades(
  db: DB,
  opts: { walletId: string; accountId: string; coins?: string[]; includeSpot?: boolean },
): Promise<RebuildResult> {
  const { walletId, accountId } = opts;
  const where = opts.coins?.length
    ? and(eq(s.fills.walletId, walletId), inArray(s.fills.coin, opts.coins))
    : eq(s.fills.walletId, walletId);
  const rows = await db.select().from(s.fills).where(where);
  const recon = reconstructAll(walletId, rows.map(rowToFill), { includeSpot: opts.includeSpot });
  const now = Date.now();

  return db.transaction(async (tx) => {
    const existingWhere = and(
      eq(s.trades.walletId, walletId),
      eq(s.trades.source, "hyperliquid"),
      isNotNull(s.trades.externalKey),
      ...(opts.coins?.length ? [inArray(s.trades.coin, opts.coins)] : []),
    );
    const existing = await tx.select().from(s.trades).where(existingWhere);
    const byKey = new Map(existing.map((t) => [t.externalKey!, t]));
    const seen = new Set<string>();
    const result: RebuildResult = { created: 0, updated: 0, superseded: 0, tradeIds: [] };

    for (const r of recon) {
      seen.add(r.externalKey);
      const m = r.metrics;
      // Exchange-owned columns only. leverage/liqPx come from live positions and are not touched here.
      const exchangeCols = {
        coin: r.coin,
        displayPair: r.displayPair,
        dex: r.dex,
        marketType: r.marketType,
        direction: r.direction,
        status: r.status,
        avgEntry: m.avgEntry,
        avgExit: m.avgExit,
        sizeUnits: m.sizeUnits,
        entryUnitsTotal: m.entryUnitsTotal,
        exitUnitsTotal: m.exitUnitsTotal,
        notionalUsd: m.notionalUsd,
        grossPnl: m.grossPnl,
        fees: m.fees,
        netPnl: m.netPnl, // funding attribution arrives in Phase 2
        returnPct: m.returnPct,
        entryTime: m.entryTime,
        exitTime: m.exitTime,
        durationMs: m.durationMs,
        fillCount: m.fillCount,
        flags: { ...r.flags },
        reconstructedAt: now,
      };

      let tradeId: string;
      const prev = byKey.get(r.externalKey);
      if (prev) {
        tradeId = prev.id;
        await tx.update(s.trades).set(exchangeCols).where(eq(s.trades.id, tradeId));
        result.updated++;
      } else {
        const [ins] = await tx
          .insert(s.trades)
          .values({ ...exchangeCols, accountId, walletId, source: "hyperliquid", externalKey: r.externalKey })
          .returning({ id: s.trades.id });
        tradeId = ins.id;
        result.created++;
      }
      result.tradeIds.push(tradeId);

      await tx.delete(s.tradeFills).where(eq(s.tradeFills.tradeId, tradeId));
      if (r.legs.length) {
        await tx.insert(s.tradeFills).values(
          r.legs.map((l) => ({
            tradeId,
            walletId,
            tid: l.tid,
            role: l.role,
            sz: l.sz,
            px: l.px,
            fee: l.fee,
            closedPnl: l.closedPnl,
            time: l.time,
          })),
        );
      }
    }

    for (const t of existing) {
      if (seen.has(t.externalKey!) || t.flags?.superseded) continue;
      // Detach its fill legs (they now belong to the trade that replaced it) so no fill is counted twice.
      // The trade row — and any journal data on it — is kept for review.
      await tx.delete(s.tradeFills).where(eq(s.tradeFills.tradeId, t.id));
      await tx
        .update(s.trades)
        .set({ flags: { ...t.flags, superseded: true }, reconstructedAt: now })
        .where(eq(s.trades.id, t.id));
      result.superseded++;
    }
    return result;
  });
}
