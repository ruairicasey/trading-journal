/**
 * Hyperliquid order history → `orders` table (exchange-owned, never deleted).
 *
 * Verified shape (2026-11, live public accounts + the owner's address-free probe):
 *  - historicalOrders returns the ~2000 most recent ROWS, newest first, and an order appears once per status
 *    change: an "open" snapshot when it was placed (statusTimestamp = timestamp), then its terminal row
 *    ("canceled", "reduceOnlyCanceled", "siblingFilledCanceled", "triggered", "filled", …). So "open" rows
 *    are not evidence that an order is still live; only the latest row per oid is.
 *  - A trigger that fires shows up as  Stop Market(T):open → Stop Market:filled (isTrigger=false,
 *    triggerPx 0, a later timestamp) → Stop Market(T):triggered. Its fills carry the same oid.
 *  - Position TP/SL orders have sz = origSz = 0 (they cover the whole position).
 *  - Nested `children` (TP/SL attached to an entry order) carry the PARENT's oid, not their own. When the
 *    parent fills they become real orders with their own oid and rows, so children are not stored separately.
 */
import { sql } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import type { HlHistoricalOrder } from "./schemas";

export type OrderRecord = typeof s.orders.$inferInsert;

const num = (x: string | undefined | null) => {
  const n = Number(x);
  return x != null && Number.isFinite(n) ? n : null;
};

/** status precedence: open < any other terminal status < triggered */
const rank = (r: { status: string; statusTimestamp: number }) => (r.status === "triggered" ? 2 : r.status === "open" ? 0 : 1);

/** Merge raw history rows into one record per oid (pure). */
export function mergeOrderRows(walletId: string, rows: HlHistoricalOrder[]): OrderRecord[] {
  const byOid = new Map<number, HlHistoricalOrder[]>();
  for (const r of rows) {
    const list = byOid.get(r.order.oid) ?? [];
    list.push(r);
    byOid.set(r.order.oid, list);
  }
  const out: OrderRecord[] = [];
  for (const [oid, list] of byOid) {
    // "triggered" is final whenever present (its "filled" twin usually shares the timestamp and is listed first;
    // occasionally it is even later). Otherwise the latest status wins, a terminal one beating the "open" snapshot.
    const latest = list.reduce((a, b) => (rank(b) > rank(a) || (rank(b) === rank(a) && b.statusTimestamp > a.statusTimestamp) ? b : a));
    // trigger details come from a trigger row (the post-trigger "filled" row has triggerPx 0 and sz 0)
    const trig = list.filter((r) => r.order.isTrigger);
    const base = (trig.length ? trig : list).reduce((a, b) => (b.order.timestamp < a.order.timestamp ? b : a));
    const o = base.order;
    const placedAt = Math.min(...(trig.length ? trig : list).map((r) => r.order.timestamp));
    out.push({
      walletId,
      oid,
      coin: o.coin,
      side: o.side,
      orderType: o.orderType,
      isTrigger: trig.length > 0,
      triggerPx: trig.length ? num(o.triggerPx) : null,
      triggerCondition: trig.length ? o.triggerCondition : null,
      limitPx: num(o.limitPx),
      reduceOnly: o.reduceOnly,
      isPositionTpsl: o.isPositionTpsl,
      origSz: num(o.origSz),
      placedAt,
      status: latest.status,
      statusAt: latest.statusTimestamp,
      endedAt: latest.status === "open" ? null : latest.statusTimestamp,
      raw: { ...latest.order, children: undefined, status: latest.status, childCount: o.children?.length ?? 0 },
    });
  }
  return out;
}

/**
 * Upsert merged orders. Merging with what is already stored follows the same rules, so running it on
 * overlapping windows (every sync) is idempotent and statuses only ever move forward in time.
 */
// Same precedence as `rank` above, in SQL: does the incoming record's status replace the stored one?
const rankSql = (col: string) => `(case ${col} when 'triggered' then 2 when 'open' then 0 else 1 end)`;
const NEW_WINS = sql.raw(
  `(${rankSql("excluded.status")} > ${rankSql("orders.status")} or (${rankSql("excluded.status")} = ${rankSql("orders.status")} and excluded.status_at > orders.status_at))`,
);

export async function storeOrders(db: DB, walletId: string, rows: HlHistoricalOrder[]): Promise<{ orders: number }> {
  const recs = mergeOrderRows(walletId, rows);
  for (let i = 0; i < recs.length; i += 50) {
    await db
      .insert(s.orders)
      .values(recs.slice(i, i + 50))
      .onConflictDoUpdate({
        target: [s.orders.walletId, s.orders.oid],
        // In SQLite every SET expression reads the row's OLD values, so these can reference each other safely.
        set: {
          isTrigger: sql`max(${s.orders.isTrigger}, excluded.is_trigger)`,
          triggerPx: sql`case when excluded.is_trigger = 1 then excluded.trigger_px else ${s.orders.triggerPx} end`,
          triggerCondition: sql`case when excluded.is_trigger = 1 then excluded.trigger_condition else ${s.orders.triggerCondition} end`,
          origSz: sql`case when excluded.is_trigger = 1 or ${s.orders.isTrigger} = 0 then excluded.orig_sz else ${s.orders.origSz} end`,
          orderType: sql`case when excluded.is_trigger = 1 or ${s.orders.isTrigger} = 0 then excluded.order_type else ${s.orders.orderType} end`,
          placedAt: sql`case when excluded.is_trigger = 1 and ${s.orders.isTrigger} = 0 then excluded.placed_at else min(${s.orders.placedAt}, excluded.placed_at) end`,
          status: sql`case when ${NEW_WINS} then excluded.status else ${s.orders.status} end`,
          endedAt: sql`case when ${NEW_WINS} then excluded.ended_at else ${s.orders.endedAt} end`,
          raw: sql`case when ${NEW_WINS} then excluded.raw else ${s.orders.raw} end`,
          statusAt: sql`case when ${NEW_WINS} then excluded.status_at else ${s.orders.statusAt} end`,
        },
      });
  }
  return { orders: recs.length };
}
