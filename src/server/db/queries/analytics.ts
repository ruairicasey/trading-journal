import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { AnalyticsTrade } from "../../../lib/analytics/types";
import { classifyStopMoves } from "../../../lib/stop-moves";
import type { DB } from "../client";
import * as s from "../schema";
import { rExpr } from "./trades";

const t = s.trades;
const j = s.tradeJournal;
const strategy = alias(s.vocabItems, "strategy");

/** Closed, live trades with the journal fields the analytics page groups by (computed in JS). */
export async function analyticsTrades(db: DB, accountId: string, walletId: string | null = null): Promise<AnalyticsTrade[]> {
  const rows = await db
    .select({
      id: t.id,
      coin: t.coin,
      displayPair: t.displayPair,
      direction: t.direction,
      netPnl: t.netPnl,
      fees: t.fees,
      notionalUsd: t.notionalUsd,
      entryTime: t.entryTime,
      exitTime: t.exitTime,
      r: rExpr,
      tradeType: j.tradeType,
      session: j.session,
      grade: j.grade,
      strategyId: j.strategyId,
      strategy: strategy.label,
      htf: j.htfTimeframes,
      flags: t.flags,
      riskUsd: sql<number | null>`case when ${j.stopLoss} is not null and ${t.avgEntry} is not null
        then abs(${t.avgEntry} - ${j.stopLoss}) * ${t.sizeUnits} end`,
      riskMultiplier: j.riskMultiplier,
      maxRReached: j.maxRReached,
      entryRetests: j.entryRetests,
      rulesFollowed: j.rulesFollowed,
      processCompliant: j.processCompliant,
      stopLoss: j.stopLoss,
      avgEntry: t.avgEntry,
    })
    .from(t)
    .leftJoin(j, eq(j.tradeId, t.id))
    .leftJoin(strategy, eq(strategy.id, j.strategyId))
    .where(
      and(
        eq(t.accountId, accountId),
        ...(walletId ? [eq(t.walletId, walletId)] : []),
        isNull(t.deletedAt),
        sql`coalesce(json_extract(${t.flags}, '$.superseded'), 0) = 0`,
        eq(t.status, "closed"),
        isNotNull(t.exitTime),
        isNotNull(t.netPnl),
      ),
    )
    .orderBy(asc(t.exitTime));

  const ids = rows.map((r) => r.id);
  type Item = { id: string; label: string };
  const linked = { confluence: new Map<string, Item[]>(), sl_reason: new Map<string, Item[]>(), tp_reason: new Map<string, Item[]>() };
  // final exit leg per trade, with the order behind it (if it was one of your trigger orders)
  const lastExit = new Map<string, { time: number; orderType: string | null; isTrigger: boolean | null }>();
  const moves = new Map<string, { id: string; time: number; price: number }[]>();
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const links = await db
      .select({ tradeId: s.tradeVocab.tradeId, kind: s.tradeVocab.kind, id: s.vocabItems.id, label: s.vocabItems.label })
      .from(s.tradeVocab)
      .innerJoin(s.vocabItems, eq(s.vocabItems.id, s.tradeVocab.itemId))
      .where(and(inArray(s.tradeVocab.tradeId, chunk), inArray(s.tradeVocab.kind, ["confluence", "sl_reason", "tp_reason"])));
    for (const l of links) {
      const m = linked[l.kind as keyof typeof linked];
      m.set(l.tradeId, [...(m.get(l.tradeId) ?? []), { id: l.id, label: l.label }]);
    }
    const exits = await db
      .select({ tradeId: s.tradeFills.tradeId, time: s.tradeFills.time, orderType: s.orders.orderType, isTrigger: s.orders.isTrigger })
      .from(s.tradeFills)
      .innerJoin(s.fills, and(eq(s.fills.walletId, s.tradeFills.walletId), eq(s.fills.tid, s.tradeFills.tid)))
      .leftJoin(s.orders, and(eq(s.orders.walletId, s.fills.walletId), eq(s.orders.oid, s.fills.oid)))
      .where(and(inArray(s.tradeFills.tradeId, chunk), eq(s.tradeFills.role, "exit")));
    for (const m of await db
      .select({ id: s.stopMoves.id, tradeId: s.stopMoves.tradeId, time: s.stopMoves.time, price: s.stopMoves.price })
      .from(s.stopMoves)
      .where(inArray(s.stopMoves.tradeId, chunk))
      .orderBy(asc(s.stopMoves.time), asc(s.stopMoves.id)))
      moves.set(m.tradeId, [...(moves.get(m.tradeId) ?? []), { id: m.id, time: m.time, price: m.price }]);
    for (const e of exits) {
      const cur = lastExit.get(e.tradeId);
      if (!cur || e.time >= cur.time) lastExit.set(e.tradeId, { time: e.time, orderType: e.orderType, isTrigger: e.isTrigger });
    }
  }
  const exitBy = (id: string, liquidated: boolean | undefined): AnalyticsTrade["exitBy"] => {
    if (liquidated) return "liquidated";
    const e = lastExit.get(id);
    if (!e?.isTrigger || !e.orderType) return "manual";
    return e.orderType.toLowerCase().includes("take profit") ? "tp" : "stop";
  };
  return rows.map(({ flags, stopLoss, avgEntry, ...r }) => ({
    ...r,
    netPnl: r.netPnl ?? 0,
    fees: r.fees ?? 0,
    exitTime: r.exitTime!,
    r: r.r === null ? null : Number(r.r),
    riskUsd: r.riskUsd === null ? null : Number(r.riskUsd),
    htf: (r.htf ?? []) as string[],
    confluences: linked.confluence.get(r.id) ?? [],
    slReasons: linked.sl_reason.get(r.id) ?? [],
    tpReasons: linked.tp_reason.get(r.id) ?? [],
    exitBy: exitBy(r.id, flags?.liquidated),
    stopClass: stopLoss != null && avgEntry ? classifyStopMoves(r.direction, avgEntry, stopLoss, moves.get(r.id) ?? []).cls : null,
  }));
}
