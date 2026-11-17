/**
 * Funding attribution (exchange-owned): each stored funding payment is assigned to the trade that held the
 * position at that moment, on the same wallet and coin, with entry ≤ t ≤ exit (or still open) and the same
 * direction as the payment's position size (szi > 0 = long). The sign check resolves a flip inside the same
 * funding hour. trades.funding = Σ usdc (negative = you paid), and net P&L = gross − fees + funding when
 * "Include funding in net" is on (the default).
 *
 * Older funding comes as DAILY aggregates (verified live 2026-11): one row stamped 00:00 UTC at the START of the
 * UTC day it covers, with nSamples hourly payments rolled up. When no trade was open at a 00:00 row's exact time,
 * it goes to the same-coin, same-direction trade that was open for the most hours that day (whole amount; the
 * split between two trades sharing such a day is approximate, the totals are exact).
 *
 * Runs after every rebuild and after new funding is synced. Payments that fall outside every trade (e.g. a
 * position opened before your fill history starts) stay unattributed and are reported, never forced onto a trade.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";

export const INCLUDE_FUNDING_KEY = "include_funding_in_net";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type TradeLite = { id: string; coin: string; direction: "long" | "short"; entryTime: number | null; exitTime: number | null };
type Payment = { coin: string; time: number; szi: string; usdc: string };

/** Pure: which trade each payment belongs to (null = none). */
export function assignFunding(trades: TradeLite[], payments: Payment[]): (string | null)[] {
  const byCoin = new Map<string, TradeLite[]>();
  for (const t of trades) if (t.entryTime !== null) byCoin.set(t.coin, [...(byCoin.get(t.coin) ?? []), t]);
  for (const list of byCoin.values()) list.sort((a, b) => a.entryTime! - b.entryTime!);
  return payments.map((p) => {
    const dir = Number(p.szi) > 0 ? "long" : Number(p.szi) < 0 ? "short" : null;
    if (!dir) return null;
    const same = (byCoin.get(p.coin) ?? []).filter((t) => t.direction === dir);
    const hit = same.filter((t) => t.entryTime! <= p.time && (t.exitTime === null || p.time <= t.exitTime));
    // overlapping same-direction trades can't happen within one wallet+coin; if they ever do, the latest entry wins
    if (hit.length) return hit[hit.length - 1].id;
    if (p.time % DAY !== 0) return null;
    // a daily aggregate: the trade holding the position for the most hourly funding times that UTC day
    let best: { id: string; hours: number } | null = null;
    for (const t of same) {
      let hours = 0;
      for (let h = p.time; h < p.time + DAY; h += HOUR) if (t.entryTime! <= h && (t.exitTime === null || h <= t.exitTime)) hours++;
      if (hours > 0 && (!best || hours >= best.hours)) best = { id: t.id, hours };
    }
    return best?.id ?? null;
  });
}

async function includeFunding(db: DB) {
  const row = await db.query.settings.findFirst({ where: eq(s.settings.key, INCLUDE_FUNDING_KEY) });
  return row?.value !== false;
}

/** Net P&L and return % for synced trades, with or without funding. */
export async function recomputeNet(db: DB, opts: { walletId?: string; tradeIds?: string[] } = {}) {
  const inc = (await includeFunding(db)) ? 1 : 0;
  const net = sql`coalesce(${s.trades.grossPnl}, 0) - coalesce(${s.trades.fees}, 0) + ${inc} * coalesce(${s.trades.funding}, 0)`;
  await db
    .update(s.trades)
    .set({
      netPnl: net,
      returnPct: sql`case when coalesce(${s.trades.notionalUsd}, 0) <> 0 then (${net}) / ${s.trades.notionalUsd} * 100 end`,
    })
    .where(
      and(
        eq(s.trades.source, "hyperliquid"),
        ...(opts.walletId ? [eq(s.trades.walletId, opts.walletId)] : []),
        ...(opts.tradeIds ? [inArray(s.trades.id, opts.tradeIds)] : []),
      ),
    );
}

export async function attributeFunding(db: DB, walletId: string, opts: { coins?: string[] } = {}) {
  const coinFilter = opts.coins?.length ? opts.coins : null;
  const trades = (
    await db
      .select({ id: s.trades.id, coin: s.trades.coin, direction: s.trades.direction, entryTime: s.trades.entryTime, exitTime: s.trades.exitTime, flags: s.trades.flags })
      .from(s.trades)
      .where(and(eq(s.trades.walletId, walletId), eq(s.trades.source, "hyperliquid"), isNull(s.trades.deletedAt), ...(coinFilter ? [inArray(s.trades.coin, coinFilter)] : [])))
  ).filter((t) => !t.flags?.superseded);
  const payments = await db
    .select()
    .from(s.fundingEvents)
    .where(and(eq(s.fundingEvents.walletId, walletId), ...(coinFilter ? [inArray(s.fundingEvents.coin, coinFilter)] : [])));
  const assigned = assignFunding(trades, payments);

  const perTrade = new Map<string, number>();
  const changes: { coin: string; time: number; tradeId: string | null }[] = [];
  payments.forEach((p, i) => {
    const id = assigned[i];
    if (id) perTrade.set(id, (perTrade.get(id) ?? 0) + Number(p.usdc));
    if ((p.tradeId ?? null) !== id) changes.push({ coin: p.coin, time: p.time, tradeId: id });
  });

  // every trade in scope (soft-deleted and superseded ones included) gets its funding reset first
  const scope = await db
    .select({ id: s.trades.id, funding: s.trades.funding })
    .from(s.trades)
    .where(and(eq(s.trades.walletId, walletId), eq(s.trades.source, "hyperliquid"), ...(coinFilter ? [inArray(s.trades.coin, coinFilter)] : [])));
  const touched: string[] = [];
  await db.transaction(async (tx) => {
    for (const c of changes) {
      await tx
        .update(s.fundingEvents)
        .set({ tradeId: c.tradeId })
        .where(and(eq(s.fundingEvents.walletId, walletId), eq(s.fundingEvents.coin, c.coin), eq(s.fundingEvents.time, c.time)));
    }
    for (const t of scope) {
      const f = perTrade.get(t.id) ?? 0;
      if (Math.abs((t.funding ?? 0) - f) > 1e-12) {
        await tx.update(s.trades).set({ funding: f }).where(eq(s.trades.id, t.id));
        touched.push(t.id);
      }
    }
  });
  // net may also be stale right after a rebuild (which writes net without funding), so recompute the scope
  await recomputeNet(db, { walletId, tradeIds: scope.map((t) => t.id) });
  const attributed = assigned.filter(Boolean).length;
  return { payments: payments.length, attributed, unattributed: payments.length - attributed, tradesChanged: touched.length };
}
