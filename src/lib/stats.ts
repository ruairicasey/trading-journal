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
  notionalUsd: number | null;
  entryTime: number | null;
  exitTime: number;
  r: number | null;
};

export type Kpis = {
  count: number;
  net: number;
  fees: number;
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
};

export function computeKpis(trades: ClosedTrade[]): Kpis {
  const n = trades.length;
  let net = 0;
  let fees = 0;
  let wins = 0;
  let losses = 0;
  let be = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let rSum = 0;
  let rCount = 0;
  for (const t of trades) {
    net += t.netPnl;
    fees += t.fees;
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
    }
  }
  const decided = wins + losses;
  return {
    count: n,
    net,
    fees,
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
