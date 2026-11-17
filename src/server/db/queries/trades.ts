/**
 * Trades list / notes / search queries for the Trades page and ⌘K.
 * Always scoped to one account and always excludes soft-deleted and superseded trades.
 */
import { and, asc, desc, eq, gte, isNull, lt, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { BE_MIN_USD, BE_NOTIONAL_FRACTION } from "../../../lib/outcome";
import { MISSING_KINDS, type MissingKind } from "../../../lib/missing";
import { dayBoundsLocal, periodRange } from "../../../lib/periods";
import { PAGE_SIZE, type TradeFilters } from "../../trades/filters";
import type { DB } from "../client";
import * as s from "../schema";

const t = s.trades;
const j = s.tradeJournal;
const strategy = alias(s.vocabItems, "strategy");

/** R = net / (|entry − stop| × size); null without a stop. Mirrors rMultiple() in src/lib/outcome.ts. */
export const rExpr = sql<number | null>`case when ${j.stopLoss} is not null and ${t.avgEntry} is not null
  and abs(${t.avgEntry} - ${j.stopLoss}) * ${t.sizeUnits} > 0
  then ${t.netPnl} / (abs(${t.avgEntry} - ${j.stopLoss}) * ${t.sizeUnits}) end`;

/** Breakeven band, mirrors beBand(). (SQLite's 2-arg max() is scalar; Postgres would use greatest().) */
const band = sql`max(${sql.raw(String(BE_MIN_USD))}, abs(coalesce(${t.notionalUsd}, 0)) * ${sql.raw(String(BE_NOTIONAL_FRACTION))})`;

const likePattern = (q: string) => `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const like = (col: SQLWrapper, p: string) => sql`lower(coalesce(${col}, '')) like ${p} escape '\\'`;

const tagNames = sql<string | null>`(select group_concat(g.name, ',') from ${s.tradeTags} tt
  join ${s.tags} g on g.id = tt.tag_id where tt.trade_id = ${t.id})`;

/** Journal gaps on a closed trade (LEFT JOINed journal: no journal row = everything missing). */
export function missingCondition(kind: MissingKind): SQL {
  switch (kind) {
    case "review":
      return sql`${j.reviewedAt} is null`;
    case "stop":
      return sql`${j.stopLoss} is null`;
    case "process":
      return sql`${j.processCompliant} is null`;
    case "exit":
      return sql`${j.exitReasonId} is null`;
    case "mistakes":
      return sql`${j.rulesFollowed} in ('partial', 'no') and not exists (select 1 from ${s.tradeVocab} tv
        where tv.trade_id = ${t.id} and tv.kind = 'mistake')`;
    case "emotions":
      return sql`(${j.emotionBeforeId} is null or ${j.emotionAfterId} is null)`;
  }
}

/** Per-kind missing-context counts over closed trades that EXITED in [start, end). */
export async function missingCounts(db: DB, accountId: string, start: number, end: number, walletId: string | null = null) {
  const cols = Object.fromEntries(
    MISSING_KINDS.map((k) => [k, sql<number>`coalesce(sum(case when ${missingCondition(k)} then 1 else 0 end), 0)`]),
  ) as Record<MissingKind, SQL<number>>;
  const [row] = await db
    .select({ total: sql<number>`count(*)`, ...cols })
    .from(t)
    .leftJoin(j, eq(j.tradeId, t.id))
    .where(and(...baseConditions(accountId, walletId), eq(t.status, "closed"), gte(t.exitTime, start), lt(t.exitTime, end)));
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v ?? 0)])) as Record<MissingKind | "total", number>;
}

function baseConditions(accountId: string, walletId: string | null = null): SQL[] {
  return [
    eq(t.accountId, accountId),
    ...(walletId ? [eq(t.walletId, walletId)] : []),
    isNull(t.deletedAt),
    sql`coalesce(json_extract(${t.flags}, '$.superseded'), 0) = 0`,
  ];
}

/** All non-tab filter conditions. */
function filterConditions(f: TradeFilters, tz: string, now: number): SQL[] {
  const c: SQL[] = [];
  if (f.pair) c.push(eq(t.coin, f.pair));
  if (f.dir) c.push(eq(t.direction, f.dir));
  if (f.strategy) c.push(eq(j.strategyId, f.strategy));
  if (f.grade) c.push(eq(j.grade, f.grade));
  if (f.session) c.push(eq(j.session, f.session));
  if (f.type) c.push(eq(j.tradeType, f.type));
  if (f.period) {
    const r = periodRange(f.period, now, tz);
    if (r.from !== null) c.push(gte(t.entryTime, r.from));
  }
  const dateCol = f.dateBy === "exit" ? t.exitTime : t.entryTime;
  if (f.from) {
    const b = dayBoundsLocal(f.from, tz);
    if (b) c.push(gte(dateCol, b.start));
  }
  if (f.to) {
    const b = dayBoundsLocal(f.to, tz);
    if (b) c.push(lt(dateCol, b.end));
  }
  if (f.outcome) {
    c.push(eq(t.status, "closed"));
    if (f.outcome === "win") c.push(sql`${t.netPnl} > ${band}`);
    if (f.outcome === "loss") c.push(sql`${t.netPnl} < -${band}`);
    if (f.outcome === "be") c.push(sql`abs(${t.netPnl}) <= ${band}`);
  }
  if (f.missing) c.push(eq(t.status, "closed"), missingCondition(f.missing));
  if (f.minR !== undefined) c.push(sql`${rExpr} >= ${f.minR}`);
  if (f.maxR !== undefined) c.push(sql`${rExpr} <= ${f.maxR}`);
  if (f.q) {
    const p = likePattern(f.q);
    c.push(
      or(
        like(t.displayPair, p),
        like(t.coin, p),
        like(sql`${j.rationale}`, p),
        like(sql`${j.postNotes}`, p),
        like(sql`${strategy.label}`, p),
        sql`exists (select 1 from ${s.tradeTags} tt join ${s.tags} g on g.id = tt.tag_id
          where tt.trade_id = ${t.id} and lower(g.name) like ${p} escape '\\')`,
      )!,
    );
  }
  return c;
}

const tabCondition = (tab: TradeFilters["tab"]): SQL[] =>
  tab === "planned" || tab === "open" || tab === "closed" ? [eq(t.status, tab)] : [];

export type TradeRow = Awaited<ReturnType<typeof listTrades>>["rows"][number];

export async function listTrades(db: DB, accountId: string, f: TradeFilters, opts: { tz: string; now?: number; walletId?: string | null }) {
  const now = opts.now ?? Date.now();
  const common = [...baseConditions(accountId, opts.walletId ?? null), ...filterConditions(f, opts.tz, now)];
  const from = () =>
    db
      .select({
        id: t.id,
        source: t.source,
        walletId: t.walletId,
        coin: t.coin,
        displayPair: t.displayPair,
        marketType: t.marketType,
        direction: t.direction,
        status: t.status,
        avgEntry: t.avgEntry,
        avgExit: t.avgExit,
        sizeUnits: t.sizeUnits,
        notionalUsd: t.notionalUsd,
        grossPnl: t.grossPnl,
        fees: t.fees,
        funding: t.funding,
        netPnl: t.netPnl,
        returnPct: t.returnPct,
        entryTime: t.entryTime,
        exitTime: t.exitTime,
        durationMs: t.durationMs,
        fillCount: t.fillCount,
        leverage: t.leverage,
        flags: t.flags,
        stopLoss: j.stopLoss,
        takeProfit: j.takeProfit,
        grade: j.grade,
        session: j.session,
        tradeType: j.tradeType,
        entryTimeframe: j.entryTimeframe,
        timeframeClass: j.timeframeClass,
        rationale: j.rationale,
        manualEntry: j.manualEntry,
        strategyLabel: strategy.label,
        tags: tagNames,
        r: rExpr,
      })
      .from(t)
      .leftJoin(j, eq(j.tradeId, t.id))
      .leftJoin(strategy, eq(strategy.id, j.strategyId));

  const where = and(...common, ...tabCondition(f.tab));
  const page = f.page;
  const [rows, totalRow, statusCounts] = await Promise.all([
    from()
      .where(where)
      .orderBy(desc(sql`coalesce(${t.entryTime}, ${t.createdAt})`), desc(t.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db
      .select({ n: sql<number>`count(*)` })
      .from(t)
      .leftJoin(j, eq(j.tradeId, t.id))
      .leftJoin(strategy, eq(strategy.id, j.strategyId))
      .where(where),
    db
      .select({ status: t.status, n: sql<number>`count(*)` })
      .from(t)
      .leftJoin(j, eq(j.tradeId, t.id))
      .leftJoin(strategy, eq(strategy.id, j.strategyId))
      .where(and(...common))
      .groupBy(t.status),
  ]);
  const by = Object.fromEntries(statusCounts.map((r) => [r.status, Number(r.n)]));
  return {
    rows: rows.map((r) => ({ ...r, tags: r.tags ? r.tags.split(",").sort() : [] })),
    total: Number(totalRow[0]?.n ?? 0),
    page,
    pageSize: PAGE_SIZE,
    counts: {
      all: (by.planned ?? 0) + (by.open ?? 0) + (by.closed ?? 0),
      planned: by.planned ?? 0,
      open: by.open ?? 0,
      closed: by.closed ?? 0,
    },
  };
}

export async function listNotes(db: DB, accountId: string, f: Pick<TradeFilters, "q" | "page">) {
  const n = s.notes;
  const c: SQL[] = [or(eq(n.accountId, accountId), isNull(n.accountId))!];
  if (f.q) {
    const p = likePattern(f.q);
    c.push(or(like(sql`${n.title}`, p), like(sql`${n.body}`, p))!);
  }
  const page = f.page ?? 1;
  const [rows, total] = await Promise.all([
    db
      .select()
      .from(n)
      .where(and(...c))
      .orderBy(desc(n.date), desc(n.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ n: sql<number>`count(*)` }).from(n).where(and(...c)),
  ]);
  return { rows, total: Number(total[0]?.n ?? 0), page, pageSize: PAGE_SIZE };
}

export async function countNotes(db: DB, accountId: string, q?: string) {
  return (await listNotes(db, accountId, { q, page: 1 })).total;
}

/** Options for the filter panel, from the account's own data. */
export async function filterOptions(db: DB, accountId: string, walletId: string | null = null) {
  const [pairs, strategies] = await Promise.all([
    db
      .selectDistinct({ coin: t.coin, displayPair: t.displayPair })
      .from(t)
      .where(and(...baseConditions(accountId, walletId)))
      .orderBy(asc(t.displayPair)),
    db
      .select({ id: s.vocabItems.id, label: s.vocabItems.label })
      .from(s.vocabItems)
      .where(and(eq(s.vocabItems.kind, "strategy"), eq(s.vocabItems.archived, false)))
      .orderBy(asc(s.vocabItems.sort)),
  ]);
  return { pairs, strategies };
}

/** ⌘K live results. */
export async function searchEverything(db: DB, accountId: string, q: string, opts: { tz: string; walletId?: string | null }) {
  if (!q.trim()) return { trades: [], notes: [] };
  const base = { tab: "all" as const, page: 1, q };
  const [tr, no] = await Promise.all([
    listTrades(db, accountId, base, { tz: opts.tz, walletId: opts.walletId ?? null }),
    listNotes(db, accountId, { q, page: 1 }),
  ]);
  return {
    trades: tr.rows.slice(0, 6).map((r) => ({
      id: r.id,
      displayPair: r.displayPair,
      direction: r.direction,
      status: r.status,
      entryTime: r.entryTime,
      netPnl: r.netPnl,
    })),
    notes: no.rows.slice(0, 3).map((r) => ({ id: r.id, title: r.title, date: r.date })),
  };
}
