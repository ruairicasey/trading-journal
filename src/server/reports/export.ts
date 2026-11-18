/**
 * Report data: every closed, live trade with its journal fields, and the CSV files built from it.
 * The trade set is the same as the dashboard's (closedTrades): closed, not deleted or superseded, with an exit and a net.
 */
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { TZDate } from "@date-fns/tz";
import { idCell, toCsv } from "../../lib/csv";
import { localDateKey } from "../../lib/periods";
import { outcomeOf } from "../../lib/outcome";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { rExpr } from "../db/queries/trades";

const t = s.trades;
const j = s.tradeJournal;
const strategy = alias(s.vocabItems, "strategy");

export type ReportTrade = Awaited<ReturnType<typeof reportTrades>>[number];

export async function reportTrades(db: DB, accountId: string, walletId: string | null) {
  const rows = await db
    .select({
      id: t.id,
      displayPair: t.displayPair,
      coin: t.coin,
      direction: t.direction,
      source: t.source,
      entryTime: t.entryTime,
      exitTime: t.exitTime,
      avgEntry: t.avgEntry,
      avgExit: t.avgExit,
      sizeUnits: t.sizeUnits,
      notionalUsd: t.notionalUsd,
      grossPnl: t.grossPnl,
      fees: t.fees,
      funding: t.funding,
      netPnl: t.netPnl,
      returnPct: t.returnPct,
      r: rExpr,
      stopLoss: j.stopLoss,
      takeProfit: j.takeProfit,
      strategy: strategy.label,
      grade: j.grade,
      session: j.session,
      tradeType: j.tradeType,
      rulesFollowed: j.rulesFollowed,
      processCompliant: j.processCompliant,
      reviewedAt: j.reviewedAt,
      rationale: j.rationale,
      postNotes: j.postNotes,
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
    .orderBy(asc(t.exitTime), asc(t.id));

  const tags = new Map<string, string[]>();
  const mistakes = new Map<string, string[]>();
  const ids = rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    for (const r of await db
      .select({ tradeId: s.tradeTags.tradeId, name: s.tags.name })
      .from(s.tradeTags)
      .innerJoin(s.tags, eq(s.tags.id, s.tradeTags.tagId))
      .where(inArray(s.tradeTags.tradeId, chunk)))
      tags.set(r.tradeId, [...(tags.get(r.tradeId) ?? []), r.name]);
    for (const r of await db
      .select({ tradeId: s.tradeVocab.tradeId, label: s.vocabItems.label })
      .from(s.tradeVocab)
      .innerJoin(s.vocabItems, eq(s.vocabItems.id, s.tradeVocab.itemId))
      .where(and(inArray(s.tradeVocab.tradeId, chunk), eq(s.tradeVocab.kind, "mistake"))))
      mistakes.set(r.tradeId, [...(mistakes.get(r.tradeId) ?? []), r.label]);
  }
  return rows.map((r) => ({
    ...r,
    exitTime: r.exitTime!,
    netPnl: r.netPnl!,
    r: r.r === null ? null : Number(r.r),
    outcome: outcomeOf(r.netPnl, r.notionalUsd),
    tags: (tags.get(r.id) ?? []).sort(),
    mistakes: (mistakes.get(r.id) ?? []).sort(),
  }));
}

/** "2026-11-18 14:05" in the account timezone */
export function localStamp(ts: number | null, tz: string) {
  if (ts === null) return null;
  const d = new TZDate(ts, tz);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${localDateKey(ts, tz)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const round = (x: number | null, dp: number) =>
  x === null || !Number.isFinite(x) ? null : Math.round(x * 10 ** dp) / 10 ** dp;

export function tradesCsv(trades: ReportTrade[], tz: string) {
  return toCsv(
    [
      "trade_id",
      "pair",
      "direction",
      "source",
      `entry_time (${tz})`,
      `exit_time (${tz})`,
      "entry_price",
      "exit_price",
      "size",
      "notional_usd",
      "gross_pnl",
      "fees",
      "funding",
      "net_pnl",
      "return_pct",
      "outcome",
      "r",
      "stop_loss",
      "take_profit",
      "strategy",
      "grade",
      "session",
      "trade_type",
      "rules_followed",
      "process_compliant",
      "reviewed",
      "tags",
      "mistakes",
      "rationale",
      "post_notes",
    ],
    trades.map((x) => [
      idCell(x.id),
      x.displayPair,
      x.direction,
      x.source,
      localStamp(x.entryTime, tz),
      localStamp(x.exitTime, tz),
      x.avgEntry,
      x.avgExit,
      x.sizeUnits,
      round(x.notionalUsd, 2),
      round(x.grossPnl, 2),
      round(x.fees, 2),
      round(x.funding, 2),
      round(x.netPnl, 2),
      round(x.returnPct, 4),
      x.outcome,
      round(x.r, 3),
      x.stopLoss,
      x.takeProfit,
      x.strategy,
      x.grade,
      x.session,
      x.tradeType,
      x.rulesFollowed,
      x.processCompliant,
      x.reviewedAt !== null,
      x.tags.join("; "),
      x.mistakes.join("; "),
      x.rationale,
      x.postNotes,
    ]),
  );
}

export type MonthRow = {
  month: string;
  trades: number;
  wins: number;
  losses: number;
  breakeven: number;
  fees: number;
  funding: number;
  net: number;
  rCount: number;
  totalR: number;
};

/** One row per month (by exit, account timezone), oldest first. */
export function monthly(trades: ReportTrade[], tz: string): MonthRow[] {
  const by = new Map<string, MonthRow>();
  for (const x of trades) {
    const m = localDateKey(x.exitTime, tz).slice(0, 7);
    const row = by.get(m) ?? {
      month: m,
      trades: 0,
      wins: 0,
      losses: 0,
      breakeven: 0,
      fees: 0,
      funding: 0,
      net: 0,
      rCount: 0,
      totalR: 0,
    };
    row.trades++;
    if (x.outcome === "win") row.wins++;
    else if (x.outcome === "loss") row.losses++;
    else row.breakeven++;
    row.fees += x.fees ?? 0;
    row.funding += x.funding ?? 0;
    row.net += x.netPnl;
    if (x.r !== null) {
      row.rCount++;
      row.totalR += x.r;
    }
    by.set(m, row);
  }
  return [...by.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export function monthlyCsv(rows: MonthRow[]) {
  return toCsv(
    [
      "month",
      "trades",
      "wins",
      "losses",
      "breakeven",
      "fees",
      "funding",
      "net_pnl",
      "trades_with_r",
      "total_r",
    ],
    rows.map((m) => [
      m.month,
      m.trades,
      m.wins,
      m.losses,
      m.breakeven,
      round(m.fees, 2),
      round(m.funding, 2),
      round(m.net, 2),
      m.rCount,
      round(m.totalR, 3),
    ]),
  );
}
