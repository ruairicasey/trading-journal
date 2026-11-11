import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { ClosedTrade } from "../../../lib/stats";
import type { DB } from "../client";
import * as s from "../schema";
import { rExpr } from "./trades";

const live = (accountId: string) => [
  eq(s.trades.accountId, accountId),
  isNull(s.trades.deletedAt),
  sql`coalesce(json_extract(${s.trades.flags}, '$.superseded'), 0) = 0`,
];

/** All closed trades for the account (stats are computed in JS; hundreds to low thousands of rows). */
export async function closedTrades(db: DB, accountId: string): Promise<ClosedTrade[]> {
  const rows = await db
    .select({
      id: s.trades.id,
      displayPair: s.trades.displayPair,
      direction: s.trades.direction,
      netPnl: s.trades.netPnl,
      fees: s.trades.fees,
      notionalUsd: s.trades.notionalUsd,
      entryTime: s.trades.entryTime,
      exitTime: s.trades.exitTime,
      r: rExpr,
    })
    .from(s.trades)
    .leftJoin(s.tradeJournal, eq(s.tradeJournal.tradeId, s.trades.id))
    .where(and(...live(accountId), eq(s.trades.status, "closed"), isNotNull(s.trades.exitTime), isNotNull(s.trades.netPnl)))
    .orderBy(asc(s.trades.exitTime));
  return rows.map((r) => ({ ...r, netPnl: r.netPnl ?? 0, fees: r.fees ?? 0, exitTime: r.exitTime!, r: r.r === null ? null : Number(r.r) }));
}

export async function openTrades(db: DB, accountId: string) {
  return db
    .select({
      id: s.trades.id,
      coin: s.trades.coin,
      displayPair: s.trades.displayPair,
      direction: s.trades.direction,
      source: s.trades.source,
      walletId: s.trades.walletId,
      avgEntry: s.trades.avgEntry,
      sizeUnits: s.trades.sizeUnits,
      netPnl: s.trades.netPnl,
      entryTime: s.trades.entryTime,
      leverage: s.trades.leverage,
      liqPx: s.trades.liqPx,
      stopLoss: s.tradeJournal.stopLoss,
    })
    .from(s.trades)
    .leftJoin(s.tradeJournal, eq(s.tradeJournal.tradeId, s.trades.id))
    .where(and(...live(accountId), eq(s.trades.status, "open")))
    .orderBy(asc(s.trades.entryTime));
}
export type OpenTradeRow = Awaited<ReturnType<typeof openTrades>>[number];
