import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { AnalyticsTrade } from "../../../lib/analytics/types";
import type { DB } from "../client";
import * as s from "../schema";
import { rExpr } from "./trades";

const t = s.trades;
const j = s.tradeJournal;
const strategy = alias(s.vocabItems, "strategy");

/** Closed, live trades with the journal fields the analytics page groups by (computed in JS). */
export async function analyticsTrades(db: DB, accountId: string): Promise<AnalyticsTrade[]> {
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
      grade: j.grade,
      strategyId: j.strategyId,
      strategy: strategy.label,
      htf: j.htfTimeframes,
    })
    .from(t)
    .leftJoin(j, eq(j.tradeId, t.id))
    .leftJoin(strategy, eq(strategy.id, j.strategyId))
    .where(
      and(
        eq(t.accountId, accountId),
        isNull(t.deletedAt),
        sql`coalesce(json_extract(${t.flags}, '$.superseded'), 0) = 0`,
        eq(t.status, "closed"),
        isNotNull(t.exitTime),
        isNotNull(t.netPnl),
      ),
    )
    .orderBy(asc(t.exitTime));

  const ids = rows.map((r) => r.id);
  const conf = new Map<string, { id: string; label: string }[]>();
  for (let i = 0; i < ids.length; i += 400) {
    const links = await db
      .select({ tradeId: s.tradeVocab.tradeId, id: s.vocabItems.id, label: s.vocabItems.label })
      .from(s.tradeVocab)
      .innerJoin(s.vocabItems, eq(s.vocabItems.id, s.tradeVocab.itemId))
      .where(and(inArray(s.tradeVocab.tradeId, ids.slice(i, i + 400)), eq(s.tradeVocab.kind, "confluence")));
    for (const l of links) conf.set(l.tradeId, [...(conf.get(l.tradeId) ?? []), { id: l.id, label: l.label }]);
  }
  return rows.map((r) => ({
    ...r,
    netPnl: r.netPnl ?? 0,
    fees: r.fees ?? 0,
    exitTime: r.exitTime!,
    r: r.r === null ? null : Number(r.r),
    htf: (r.htf ?? []) as string[],
    confluences: conf.get(r.id) ?? [],
  }));
}
