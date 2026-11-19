/**
 * Dashboard statistics: pure functions over CLOSED trades (realised at exit time).
 * Money figures use net P&L (after fees). R figures only include trades that have a stop loss.
 */
import { TZDate } from "@date-fns/tz";
import { addDays, startOfMonth, startOfWeek } from "date-fns";
import { localDateKey } from "./periods";
import { outcomeOf } from "./outcome";

export type ClosedTrade = {
  id: string;
  displayPair: string;
  direction: "long" | "short";
  netPnl: number;
  fees: number;
  /** attributed funding (negative = paid); 0 for manual trades */
  funding?: number | null;
  source?: "hyperliquid" | "ctrader" | "manual";
  notionalUsd: number | null;
  entryTime: number | null;
  exitTime: number;
  r: number | null;
};

export type Kpis = {
  count: number;
  net: number;
  fees: number;
  /** Σ attributed funding (negative = paid) */
  funding: number;
  wins: number;
  losses: number;
  breakeven: number;
  /** wins / (wins + losses); breakevens excluded. null with no decided trades. */
  winRate: number | null;
  /** gross profit / gross loss (net of fees). Infinity when there are wins but no losses. */
  profitFactor: number | null;
  avgTrade: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  best: number | null;
  worst: number | null;
  since: number | null;
  rCount: number;
  totalR: number | null;
  avgR: number | null;
  /** median R: robust to a few extreme R values (e.g. a very tight stop) that drag the average */
  medianR: number | null;
};

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
}

export function computeKpis(trades: ClosedTrade[]): Kpis {
  const n = trades.length;
  let net = 0;
  let fees = 0;
  let funding = 0;
  let wins = 0;
  let losses = 0;
  let be = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let rSum = 0;
  let rCount = 0;
  const rs: number[] = [];
  for (const t of trades) {
    net += t.netPnl;
    fees += t.fees;
    funding += t.funding ?? 0;
    const o = outcomeOf(t.netPnl, t.notionalUsd);
    if (o === "win") {
      wins++;
      grossWin += t.netPnl;
    } else if (o === "loss") {
      losses++;
      grossLoss += -t.netPnl;
    } else be++;
    if (t.r !== null && Number.isFinite(t.r)) {
      rSum += t.r;
      rCount++;
      rs.push(t.r);
    }
  }
  const decided = wins + losses;
  return {
    count: n,
    net,
    fees,
    funding,
    wins,
    losses,
    breakeven: be,
    winRate: decided ? wins / decided : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null,
    avgTrade: n ? net / n : null,
    avgWin: wins ? grossWin / wins : null,
    avgLoss: losses ? -grossLoss / losses : null,
    best: n ? Math.max(...trades.map((t) => t.netPnl)) : null,
    worst: n ? Math.min(...trades.map((t) => t.netPnl)) : null,
    since: n ? Math.min(...trades.map((t) => t.exitTime)) : null,
    rCount,
    totalR: rCount ? rSum : null,
    avgR: rCount ? rSum / rCount : null,
    medianR: median(rs),
  };
}

export type EquityPoint = { t: number; equity: number; cumR: number; trade?: { id: string; pair: string; net: number; r: number | null } };

/**
 * Equity after each trade exit, starting from the account's starting balance plus everything realised before
 * `from` (so the period's curve sits at the right level). The first point is the period start.
 */
export function equityCurve(all: ClosedTrade[], startingBalance: number, from: number | null): EquityPoint[] {
  const sorted = [...all].sort((a, b) => a.exitTime - b.exitTime);
  let equity = startingBalance;
  let cumR = 0;
  const before = from === null ? [] : sorted.filter((t) => t.exitTime < from);
  for (const t of before) equity += t.netPnl;
  const inRange = from === null ? sorted : sorted.filter((t) => t.exitTime >= from);
  if (!inRange.length) return [];
  const points: EquityPoint[] = [{ t: from ?? inRange[0].exitTime - 1, equity, cumR }];
  for (const t of inRange) {
    equity += t.netPnl;
    cumR += t.r ?? 0;
    points.push({ t: t.exitTime, equity, cumR, trade: { id: t.id, pair: t.displayPair, net: t.netPnl, r: t.r } });
  }
  return points;
}

export type BalanceFlow = { t: number; usd: number; kind: string };
/** a cash movement from trading: a fill's realised P&L minus its fee, or a funding payment */
export type BalanceCash = { t: number; usd: number };
export type BalancePoint = EquityPoint & { deposited: number; flow?: { kind: string; usd: number } };

/**
 * A transfer between two wallets that are both in view is not money in or out: each side is synced by its own
 * wallet, so the pair is folded into one "internal" flow worth their sum (just the fee, if any). A side whose
 * other wallet is out of view stays a transfer. Pairs match on tx hash + time + opposite kinds, across wallets.
 */
export function foldOwnTransfers(rows: (BalanceFlow & { walletId: string; hash: string })[]): BalanceFlow[] {
  const isT = (k: string) => k === "transfer_in" || k === "transfer_out";
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!isT(r.kind)) continue;
    const key = `${r.hash}|${r.t}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const folded = new Set<(typeof rows)[number]>();
  const out: BalanceFlow[] = [];
  for (const g of groups.values()) {
    const outs = g.filter((r) => r.kind === "transfer_out");
    const ins = g.filter((r) => r.kind === "transfer_in");
    for (const o of outs) {
      const i = ins.find((x) => !folded.has(x) && x.walletId !== o.walletId);
      if (!i) continue;
      folded.add(o).add(i);
      out.push({ t: o.t, usd: o.usd + i.usd, kind: "internal" });
    }
  }
  for (const r of rows) if (!folded.has(r)) out.push({ t: r.t, usd: r.usd, kind: r.kind });
  return out.filter((f) => f.usd !== 0).sort((a, b) => a.t - b.t);
}

/**
 * The real account balance over time, from the exchange's own cash events rather than journal trades: net ledger
 * flows (deposits, withdrawals, transfers, ledger fees) + every fill's realised P&L − fee + every funding payment.
 * So partial closes of open positions, funding the journal can't attribute and trades hidden from the journal all
 * count, and the funding-in-net setting doesn't matter. Open P&L is not included.
 * Points sit at each flow and each closed-trade exit (for the tooltip), plus a final point if cash moved after
 * the last of them. `deposited` is the running net of flows. Range is [from, to) by time; the first point is
 * the period start. Same-millisecond order: flows, then cash, then the trade marker (so it includes its exit fill).
 */
export function balanceCurve(trades: ClosedTrade[], flows: BalanceFlow[], cash: BalanceCash[], o: { from: number | null; to: number | null }): BalancePoint[] {
  type Ev = { t: number; order: number; usd: number; dep: number; trade?: ClosedTrade; flow?: BalanceFlow };
  const evs: Ev[] = [
    ...flows.map((f) => ({ t: f.t, order: 0, usd: f.usd, dep: f.usd, flow: f })),
    ...cash.map((c) => ({ t: c.t, order: 1, usd: c.usd, dep: 0 })),
    ...trades.filter((t) => t.source !== "manual").map((t) => ({ t: t.exitTime, order: 2, usd: 0, dep: 0, trade: t })),
  ]
    .filter((e) => o.to === null || e.t < o.to)
    .sort((a, b) => a.t - b.t || a.order - b.order);
  let balance = 0;
  let deposited = 0;
  let cumR = 0;
  const inRange: Ev[] = [];
  for (const e of evs) {
    if (o.from !== null && e.t < o.from) {
      balance += e.usd;
      deposited += e.dep;
    } else inRange.push(e);
  }
  if (!inRange.length) return [];
  const points: BalancePoint[] = [{ t: o.from ?? inRange[0].t - 1, equity: balance, cumR, deposited }];
  for (const e of inRange) {
    balance += e.usd;
    deposited += e.dep;
    if (e.order === 1) continue; // cash moves the balance; the next point shows it
    if (e.trade) cumR += e.trade.r ?? 0;
    points.push({
      t: e.t,
      equity: balance,
      cumR,
      deposited,
      ...(e.trade ? { trade: { id: e.trade.id, pair: e.trade.displayPair, net: e.trade.netPnl, r: e.trade.r } } : {}),
      ...(e.flow ? { flow: { kind: e.flow.kind, usd: e.flow.usd } } : {}),
    });
  }
  if (inRange[inRange.length - 1].order === 1) points.push({ t: inRange[inRange.length - 1].t, equity: balance, cumR, deposited });
  return points;
}

export type CalendarDay = { date: string; day: number; inMonth: boolean; net: number; r: number; rCount: number; count: number };
export type CalendarWeek = { days: CalendarDay[]; net: number; r: number; count: number };
export type CalendarMonth = { year: number; month: number; weeks: CalendarWeek[]; net: number; r: number; count: number; maxAbs: number; maxAbsR: number };

/** Month grid (Monday-first weeks) of daily P&L by EXIT day in `tz`, with weekly totals. `month` is 1–12. */
export function calendarMonth(trades: ClosedTrade[], year: number, month: number, tz: string): CalendarMonth {
  const byDay = new Map<string, { net: number; r: number; rCount: number; count: number }>();
  for (const t of trades) {
    const k = localDateKey(t.exitTime, tz);
    const d = byDay.get(k) ?? { net: 0, r: 0, rCount: 0, count: 0 };
    d.net += t.netPnl;
    d.count++;
    if (t.r !== null) {
      d.r += t.r;
      d.rCount++;
    }
    byDay.set(k, d);
  }
  const first = startOfMonth(new TZDate(year, month - 1, 1, tz));
  let cursor = startOfWeek(first, { weekStartsOn: 1 });
  const weeks: CalendarWeek[] = [];
  let monthNet = 0;
  let monthR = 0;
  let monthCount = 0;
  let maxAbs = 0;
  let maxAbsR = 0;
  do {
    const days: CalendarDay[] = [];
    for (let i = 0; i < 7; i++) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
      const inMonth = cursor.getMonth() === month - 1;
      const d = inMonth ? (byDay.get(key) ?? { net: 0, r: 0, rCount: 0, count: 0 }) : { net: 0, r: 0, rCount: 0, count: 0 };
      days.push({ date: key, day: cursor.getDate(), inMonth, ...d });
      if (inMonth) {
        maxAbs = Math.max(maxAbs, Math.abs(d.net));
        maxAbsR = Math.max(maxAbsR, Math.abs(d.r));
      }
      cursor = addDays(cursor, 1);
    }
    const w = days.reduce((a, d) => ({ net: a.net + d.net, r: a.r + d.r, count: a.count + d.count }), { net: 0, r: 0, count: 0 });
    weeks.push({ days, ...w });
    monthNet += w.net;
    monthR += w.r;
    monthCount += w.count;
  } while (cursor.getMonth() === month - 1);
  return { year, month, weeks, net: monthNet, r: monthR, count: monthCount, maxAbs, maxAbsR };
}
