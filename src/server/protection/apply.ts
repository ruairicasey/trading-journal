/**
 * Write detected SL/TP/stop moves into the journal WITHOUT ever overwriting the user's values.
 *
 * A field is written only when its *_source is "auto", or it is empty and has no source. An "auto" value that the
 * current rules no longer detect is cleared (source back to null), so a rule change re-applies cleanly. A "user" source
 * (typed, or deliberately cleared, in the Edit form) is never touched. Auto stop moves (stop_moves.source =
 * "auto") mirror the exchange and are replaced; the user's own stop moves are never touched.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { detectProtection, type DetectedProtection, type ProtectionOrder } from "./detect";

type Trade = typeof s.trades.$inferSelect;
type Journal = typeof s.tradeJournal.$inferSelect;

export type ApplyResult = { trades: number; stopLoss: number; takeProfit: number; tpPartials: number; stopMoves: number };

const sameNum = (a: number | null | undefined, b: number | null | undefined) =>
  (a ?? null) === (b ?? null) || (a != null && b != null && Math.abs(a - b) <= Math.abs(b) * 1e-12);

const writable = (source: s.ProtectionSource | null | undefined, value: unknown) => source === "auto" || (!source && (value === null || value === undefined));

async function loadOrders(db: DB, walletId: string, coins?: string[]): Promise<ProtectionOrder[]> {
  const rows = await db
    .select()
    .from(s.orders)
    .where(and(eq(s.orders.walletId, walletId), eq(s.orders.isTrigger, true), ...(coins ? [inArray(s.orders.coin, coins)] : [])));
  return rows as ProtectionOrder[];
}

/** Detection for one trade (used by the Edit page and "Revert to auto"). */
export async function detectForTrade(db: DB, trade: Trade, now = Date.now()): Promise<DetectedProtection | null> {
  if (trade.source !== "hyperliquid" || !trade.walletId) return null;
  return detectProtection(trade, await loadOrders(db, trade.walletId, [trade.coin]), now);
}

/** Detect and apply for every live synced trade of a wallet (in memory; writes only what changed). */
export async function applyProtection(db: DB, walletId: string, opts: { now?: number; tradeIds?: string[] } = {}): Promise<ApplyResult> {
  const now = opts.now ?? Date.now();
  const res: ApplyResult = { trades: 0, stopLoss: 0, takeProfit: 0, tpPartials: 0, stopMoves: 0 };
  const orders = await loadOrders(db, walletId);
  if (!orders.length) return res;
  const byCoin = new Map<string, ProtectionOrder[]>();
  for (const o of orders) byCoin.set(o.coin, [...(byCoin.get(o.coin) ?? []), o]);

  const tradeRows = await db
    .select()
    .from(s.trades)
    .where(
      and(
        eq(s.trades.walletId, walletId),
        eq(s.trades.source, "hyperliquid"),
        isNull(s.trades.deletedAt),
        inArray(s.trades.coin, [...byCoin.keys()]),
        ...(opts.tradeIds ? [inArray(s.trades.id, opts.tradeIds)] : []),
      ),
    );
  const live = tradeRows.filter((t) => !t.flags?.superseded);
  if (!live.length) return res;
  const ids = live.map((t) => t.id);

  const journals = new Map<string, Journal>();
  const tpRows = new Map<string, { price: number; pct: number | null }[]>();
  const autoMoves = new Map<string, { time: number; price: number; oid: number | null }[]>();
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    for (const j of await db.select().from(s.tradeJournal).where(inArray(s.tradeJournal.tradeId, chunk))) journals.set(j.tradeId, j);
    for (const p of await db
      .select()
      .from(s.tradePartials)
      .where(and(inArray(s.tradePartials.tradeId, chunk), eq(s.tradePartials.kind, "tp")))
      .orderBy(s.tradePartials.sort))
      tpRows.set(p.tradeId, [...(tpRows.get(p.tradeId) ?? []), { price: p.price, pct: p.pct }]);
    for (const m of await db
      .select()
      .from(s.stopMoves)
      .where(and(inArray(s.stopMoves.tradeId, chunk), eq(s.stopMoves.source, "auto")))
      .orderBy(s.stopMoves.time))
      autoMoves.set(m.tradeId, [...(autoMoves.get(m.tradeId) ?? []), { time: m.time, price: m.price, oid: m.oid }]);
  }

  for (const t of live) {
    const d = detectProtection(t, byCoin.get(t.coin) ?? [], now);
    const j = journals.get(t.id);
    const set: Partial<typeof s.tradeJournal.$inferInsert> = {};

    if (d.stopLoss && writable(j?.stopLossSource, j?.stopLoss) && !(j?.stopLossSource === "auto" && sameNum(j.stopLoss, d.stopLoss.price))) {
      Object.assign(set, { stopLoss: d.stopLoss.price, stopLossSource: "auto" as const });
      res.stopLoss++;
    } else if (!d.stopLoss && j?.stopLossSource === "auto") {
      // an auto value the current rules no longer detect (e.g. a profit-side stop): clear it. Never a user value.
      Object.assign(set, { stopLoss: null, stopLossSource: null });
      res.stopLoss++;
    }
    if (d.takeProfit && writable(j?.takeProfitSource, j?.takeProfit) && !(j?.takeProfitSource === "auto" && sameNum(j.takeProfit, d.takeProfit.price))) {
      Object.assign(set, { takeProfit: d.takeProfit.price, takeProfitSource: "auto" as const });
      res.takeProfit++;
    } else if (!d.takeProfit && j?.takeProfitSource === "auto") {
      Object.assign(set, { takeProfit: null, takeProfitSource: null });
      res.takeProfit++;
    }
    const currentTp = tpRows.get(t.id) ?? [];
    const partialsWritable = j?.tpPartialsSource === "auto" || (!j?.tpPartialsSource && currentTp.length === 0);
    const tpChanged =
      currentTp.length !== d.tpPartials.length || currentTp.some((p, i) => !sameNum(p.price, d.tpPartials[i].price) || !sameNum(p.pct, d.tpPartials[i].pct));
    const writePartials = j?.tpPartialsSource === "auto" ? tpChanged : d.tpPartials.length > 0 && partialsWritable && tpChanged;
    if (writePartials) {
      set.tpPartialsSource = d.tpPartials.length ? "auto" : null;
      res.tpPartials++;
    }

    const moves = autoMoves.get(t.id) ?? [];
    const movesChanged =
      moves.length !== d.stopMoves.length ||
      moves.some((m, i) => m.time !== d.stopMoves[i].time || !sameNum(m.price, d.stopMoves[i].price) || m.oid !== d.stopMoves[i].oid);

    if (!Object.keys(set).length && !movesChanged) continue;
    res.trades++;
    await db.transaction(async (tx) => {
      if (Object.keys(set).length) {
        await tx
          .insert(s.tradeJournal)
          .values({ tradeId: t.id, ...set })
          .onConflictDoUpdate({ target: s.tradeJournal.tradeId, set: { ...set, updatedAt: sql`${s.tradeJournal.updatedAt}` } });
      }
      if (writePartials) {
        await tx.delete(s.tradePartials).where(and(eq(s.tradePartials.tradeId, t.id), eq(s.tradePartials.kind, "tp")));
        if (d.tpPartials.length) {
          await tx
            .insert(s.tradePartials)
            .values(d.tpPartials.map((p, i) => ({ tradeId: t.id, kind: "tp" as const, price: p.price, pct: p.pct, sort: i })));
        }
      }
      if (movesChanged) {
        await tx.delete(s.stopMoves).where(and(eq(s.stopMoves.tradeId, t.id), eq(s.stopMoves.source, "auto")));
        if (d.stopMoves.length) {
          await tx
            .insert(s.stopMoves)
            .values(d.stopMoves.map((m) => ({ tradeId: t.id, time: m.time, price: m.price, oid: m.oid, source: "auto" as const })));
        }
        res.stopMoves += d.stopMoves.length;
      }
    });
  }
  return res;
}

/** "Revert to auto": put the detected value back and hand the field to sync again. */
export async function revertToAuto(
  db: DB,
  accountId: string,
  tradeId: string,
  field: "stopLoss" | "takeProfit" | "tpPartials",
): Promise<{ ok: true; stopLoss: number | null; takeProfit: number | null; tpPartials: { price: number; pct: number }[] } | { ok: false; error: string }> {
  const trade = await db.query.trades.findFirst({
    where: and(eq(s.trades.id, tradeId), eq(s.trades.accountId, accountId), isNull(s.trades.deletedAt)),
  });
  if (!trade) return { ok: false, error: "Trade not found" };
  const d = await detectForTrade(db, trade);
  if (!d) return { ok: false, error: "No exchange orders for this trade" };
  const set: Partial<typeof s.tradeJournal.$inferInsert> = { updatedAt: Date.now() };
  if (field === "stopLoss") {
    if (!d.stopLoss) return { ok: false, error: "No stop order found for this trade" };
    Object.assign(set, { stopLoss: d.stopLoss.price, stopLossSource: "auto" });
  } else if (field === "takeProfit") {
    if (!d.takeProfit) return { ok: false, error: "No take-profit order found for this trade" };
    Object.assign(set, { takeProfit: d.takeProfit.price, takeProfitSource: "auto" });
  } else {
    if (!d.tpPartials.length) return { ok: false, error: "No take-profit ladder found for this trade" };
    set.tpPartialsSource = "auto";
  }
  await db.transaction(async (tx) => {
    await tx.insert(s.tradeJournal).values({ tradeId, ...set }).onConflictDoUpdate({ target: s.tradeJournal.tradeId, set });
    if (field === "tpPartials") {
      await tx.delete(s.tradePartials).where(and(eq(s.tradePartials.tradeId, tradeId), eq(s.tradePartials.kind, "tp")));
      await tx.insert(s.tradePartials).values(d.tpPartials.map((p, i) => ({ tradeId, kind: "tp" as const, price: p.price, pct: p.pct, sort: i })));
    }
  });
  const j = await db.query.tradeJournal.findFirst({ where: eq(s.tradeJournal.tradeId, tradeId) });
  const tp = await db
    .select()
    .from(s.tradePartials)
    .where(and(eq(s.tradePartials.tradeId, tradeId), eq(s.tradePartials.kind, "tp")))
    .orderBy(s.tradePartials.sort);
  return { ok: true, stopLoss: j?.stopLoss ?? null, takeProfit: j?.takeProfit ?? null, tpPartials: tp.map((p) => ({ price: p.price, pct: p.pct ?? 0 })) };
}
