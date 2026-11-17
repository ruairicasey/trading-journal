/**
 * Analytics → Behaviour: streaks, what you do after a run, rolling and daily P&L, overtrading and stacking.
 * Sequences use EXIT order (when each result landed) and count trades from before the selected period, so a
 * streak or "after 2 losses" doesn't restart at the period boundary. Breakevens neither extend nor break a run.
 */
import { addDays } from "date-fns";
import { TZDate } from "@date-fns/tz";
import { dayBoundsLocal, localDateKey } from "../periods";
import { outcomeOf } from "../outcome";
import { groupBy } from "./group";
import type { AnalyticsTrade, Breakdown } from "./types";
import { STOP_CLASS_LABEL, STOP_CLASSES } from "../stop-moves";

export type BehaviourWidgetId = "streaks" | "after-streak" | "rolling" | "daily" | "per-day" | "stacking" | "stop-management";

export const BEHAVIOUR_WIDGETS: { id: BehaviourWidgetId; title: string; description: string }[] = [
  { id: "streaks", title: "Streaks and extremes", description: "Runs of wins and losses (breakevens don't break a run), and your biggest trades" },
  { id: "after-streak", title: "After a run of wins or losses", description: "How the NEXT trade does after 1, 2 or 3+ wins or losses in a row" },
  { id: "rolling", title: "Rolling P&L", description: "Sum of the trailing 7 or 30 days, day by day" },
  { id: "daily", title: "Daily P&L", description: "The last 30 days of the period, by exit day" },
  { id: "per-day", title: "Trades per day (overtrading)", description: "Trades grouped by how many you entered that day" },
  { id: "stacking", title: "Stacking positions", description: "Other trades already open when you entered" },
  {
    id: "stop-management",
    title: "Stop management",
    description: "Trades with a stop, by what you did with it: one class each (widened beats trailed beats breakeven beats tightened)",
  },
];

type Outcome = "win" | "loss" | "be";
const outcome = (t: AnalyticsTrade): Outcome => outcomeOf(t.netPnl, t.notionalUsd) ?? "be";
const byExit = (ts: AnalyticsTrade[]) => [...ts].sort((a, b) => a.exitTime - b.exitTime || a.id.localeCompare(b.id));

export type Run = { kind: "win" | "loss"; n: number; from: number; to: number };

/** Current and longest runs; longest ones only count runs that ENDED inside the period. */
export function streaks(context: AnalyticsTrade[], inPeriod: (t: AnalyticsTrade) => boolean) {
  const seq = byExit(context);
  let cur = null as Run | null;
  let longestWin = null as Run | null;
  let longestLoss = null as Run | null;
  const close = (r: Run | null) => {
    if (!r) return;
    if (r.kind === "win" && (!longestWin || r.n > longestWin.n)) longestWin = r;
    if (r.kind === "loss" && (!longestLoss || r.n > longestLoss.n)) longestLoss = r;
  };
  let lastInPeriod = false;
  for (const t of seq) {
    const o = outcome(t);
    if (o === "be") continue;
    if (cur && cur.kind === o) cur = { ...cur, n: cur.n + 1, to: t.exitTime };
    else {
      if (lastInPeriod) close(cur);
      cur = { kind: o, n: 1, from: t.exitTime, to: t.exitTime };
    }
    lastInPeriod = inPeriod(t);
  }
  if (lastInPeriod) close(cur);
  const own = seq.filter(inPeriod);
  const best = own.reduce<AnalyticsTrade | null>((a, t) => (!a || t.netPnl > a.netPnl ? t : a), null);
  const worst = own.reduce<AnalyticsTrade | null>((a, t) => (!a || t.netPnl < a.netPnl ? t : a), null);
  return { current: cur, longestWin, longestLoss, best, worst };
}

/** For every trade: the run (of decided results) that ended just before it, e.g. { kind: "loss", n: 2 }. */
export function runBefore(context: AnalyticsTrade[]) {
  const out = new Map<string, { kind: "win" | "loss"; n: number } | null>();
  let run: { kind: "win" | "loss"; n: number } | null = null;
  for (const t of byExit(context)) {
    out.set(t.id, run);
    const o = outcome(t);
    if (o === "be") continue;
    run = run && run.kind === o ? { kind: o, n: run.n + 1 } : { kind: o, n: 1 };
  }
  return out;
}

export type DayPoint = { date: string; t: number; net: number; r: number; count: number };

/** One point per local day from `from` to `to` (inclusive), with that day's realised P&L. */
export function dailySeries(trades: AnalyticsTrade[], tz: string, fromDate: string, toDate: string): DayPoint[] {
  const by = new Map<string, DayPoint>();
  for (const t of trades) {
    const k = localDateKey(t.exitTime, tz);
    const d = by.get(k) ?? { date: k, t: 0, net: 0, r: 0, count: 0 };
    d.net += t.netPnl;
    d.r += t.r ?? 0;
    d.count++;
    by.set(k, d);
  }
  const out: DayPoint[] = [];
  const start = dayBoundsLocal(fromDate, tz);
  if (!start) return out;
  for (let day = new TZDate(start.start, tz), i = 0; i < 4000; day = addDays(day, 1), i++) {
    const k = localDateKey(day.getTime(), tz);
    if (k > toDate) break;
    out.push({ ...(by.get(k) ?? { date: k, net: 0, r: 0, count: 0 }), t: day.getTime() });
  }
  return out;
}

/** Trailing-window sums over a daily series (window in days, including the day itself). */
export function rolling(days: DayPoint[], window: number) {
  let net = 0;
  let r = 0;
  return days.map((d, i) => {
    net += d.net;
    r += d.r;
    if (i >= window) {
      net -= days[i - window].net;
      r -= days[i - window].r;
    }
    return { date: d.date, t: d.t, net, r };
  });
}

export function behaviourBreakdowns(trades: AnalyticsTrade[], opts: { tz: string; minN?: number; context?: AnalyticsTrade[] }) {
  const minN = opts.minN ?? 5;
  const total = trades.length;
  const context = opts.context ?? trades;
  const bd = (id: BehaviourWidgetId, buckets: Breakdown["buckets"]): Breakdown => ({ id, buckets, total, minN });
  const g = (fn: (t: AnalyticsTrade) => { key: string; label: string } | null, o: Parameters<typeof groupBy>[2] = {}) =>
    groupBy(trades, fn as never, { minN, ...o });

  const before = runBefore(context);
  const perDay = new Map<string, number>();
  for (const t of context) if (t.entryTime !== null) perDay.set(localDateKey(t.entryTime, opts.tz), (perDay.get(localDateKey(t.entryTime, opts.tz)) ?? 0) + 1);

  // open trades (by any account trade in the context) at each entry
  const stack = (t: AnalyticsTrade) => {
    if (t.entryTime === null) return null;
    let same = 0;
    let opposite = 0;
    for (const o of context) {
      if (o.id === t.id || o.entryTime === null) continue;
      if (o.entryTime < t.entryTime && o.exitTime > t.entryTime) {
        if (o.direction === t.direction) same++;
        else opposite++;
      }
    }
    return { same, opposite };
  };

  return {
    "after-streak": bd(
      "after-streak",
      g(
        (t) => {
          const r = before.get(t.id);
          if (!r) return null;
          const n = Math.min(r.n, 3);
          const k = `${r.kind}-${n}`;
          return { key: k, label: `After ${n === 3 ? "3+" : n} ${r.kind === "win" ? (n === 1 ? "win" : "wins") : n === 1 ? "loss" : "losses"}` };
        },
        { order: ["loss-3", "loss-2", "loss-1", "win-1", "win-2", "win-3"] },
      ),
    ),
    "per-day": bd(
      "per-day",
      g(
        (t) => {
          if (t.entryTime === null) return null;
          const n = perDay.get(localDateKey(t.entryTime, opts.tz)) ?? 1;
          const b = n >= 6 ? { key: "6", label: "6+ trades that day" } : n >= 4 ? { key: "4", label: "4–5 trades" } : { key: String(n), label: n === 1 ? "1 trade" : `${n} trades` };
          return b;
        },
        { order: ["1", "2", "3", "4", "6"] },
      ),
    ),
    stacking: bd(
      "stacking",
      g(
        (t) => {
          const s = stack(t);
          if (!s) return null;
          if (s.same >= 2) return { key: "same2", label: "2+ same side open" };
          if (s.same === 1) return { key: "same1", label: "1 same side open" };
          if (s.opposite > 0) return { key: "opp", label: "Only opposite side" };
          return { key: "none", label: "Nothing else open" };
        },
        { order: ["none", "same1", "same2", "opp"] },
      ),
    ),
    "stop-management": bd(
      "stop-management",
      g((t) => (t.stopClass ? { key: t.stopClass, label: STOP_CLASS_LABEL[t.stopClass] } : null), { order: [...STOP_CLASSES] }),
    ),
  } satisfies Partial<Record<BehaviourWidgetId, Breakdown>>;
}
