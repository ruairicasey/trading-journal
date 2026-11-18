/**
 * Risk-adjusted metrics for a period. Pure: no DB, no I/O.
 *
 * Daily returns are TRADING returns: each local day's change in balance minus the money moved in or out that day,
 * divided by the capital at work (the balance at the start of the day plus that day's deposits). So a deposit is
 * never a "gain", and days with no capital (balance at $0) are skipped rather than counted as 0%.
 * Crypto trades every day, so annualising uses 365 calendar days. Risk-free rate 0.
 *
 * - Sharpe = mean(r) / sd(r) × √365          - Sortino = mean(r) / downside deviation × √365
 * - Return = Π(1 + r) − 1 (time-weighted)    - Annualised = (1 + return)^(365 / days) − 1, from 30 days up
 * Daily returns use whole local days: a period that starts mid-day (7D, 30D) starts them at the next midnight. The
 * trade stats (expectancy, payoff, SQN, the trade count) use exactly the period's trades, like the KPI card.
 * Open positions aren't marked to market: a trade's P&L lands on the day it closes.
 * - Max drawdown / longest drawdown on that time-weighted index; Calmar = annualised ÷ |max drawdown|
 * - Recovery factor = net trading P&L ÷ the deepest $ drop in cumulative trading P&L
 * - Expectancy ($ and R), payoff ratio (avg win ÷ |avg loss|), SQN = √min(n, 100) × mean R ÷ sd R (Van Tharp)
 */
import { TZDate } from "@date-fns/tz";
import { addDays } from "date-fns";
import { localDateKey } from "./periods";
import { outcomeOf } from "./outcome";
import type { ClosedTrade } from "./stats";

export const MIN_SAMPLE = 30;
/** less capital than this at work on a day: no meaningful % return */
export const MIN_CAPITAL = 10;

export type DayReturn = { date: string; capital: number; pnl: number; r: number };

export type RiskMetrics = {
  days: DayReturn[];
  sharpe: number | null;
  sortino: number | null;
  totalReturn: number | null;
  annualised: number | null;
  maxDrawdown: number | null;
  longestDrawdownDays: number | null;
  calmar: number | null;
  recoveryFactor: number | null;
  pnl: number;
  trades: number;
  expectancy: number | null;
  expectancyR: number | null;
  rCount: number;
  payoff: number | null;
  sqn: number | null;
  /** fewer than MIN_SAMPLE days with capital (for the return ratios) or trades with R (for SQN) */
  smallDays: boolean;
  smallTrades: boolean;
};

/** a balance step: the balance right after time t, and the money moved in/out at t (0 for trading cash) */
export type BalanceStep = { t: number; balance: number; flow: number };

const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};

/**
 * One return per local day in [from, to), from the balance steps (all history, oldest first).
 * `from` null = the day of the first step.
 */
const localMidnight = (t: number, tz: string) => {
  const d = new TZDate(t, tz);
  return new TZDate(d.getFullYear(), d.getMonth(), d.getDate(), tz).getTime();
};

/** The first local midnight at or after `from` (null = no start): risk metrics use whole days. */
export function firstWholeDay(from: number | null, tz: string): number | null {
  if (from === null) return null;
  const m = localMidnight(from, tz);
  return m === from ? m : addDays(new TZDate(m, tz), 1).getTime();
}

export function dailyReturns(
  steps: BalanceStep[],
  o: { from: number | null; to: number; tz: string },
): DayReturn[] {
  if (!steps.length) return [];
  // whole local days only: a period starting mid-day (7D, 30D) starts at the next midnight; never before the history
  const start = Math.max(firstWholeDay(o.from, o.tz) ?? 0, localMidnight(steps[0].t, o.tz));
  let day = new TZDate(start, o.tz);
  const out: DayReturn[] = [];
  let i = 0;
  let balance = 0;
  // balance before the first day
  while (i < steps.length && steps[i].t < day.getTime()) balance = steps[i++].balance;
  while (day.getTime() < o.to) {
    const next = addDays(day, 1);
    const b0 = balance;
    let inflow = 0;
    let flows = 0;
    while (i < steps.length && steps[i].t < next.getTime() && steps[i].t < o.to) {
      flows += steps[i].flow;
      if (steps[i].flow > 0) inflow += steps[i].flow;
      balance = steps[i++].balance;
    }
    const capital = Math.max(b0, 0) + inflow;
    const pnl = balance - b0 - flows;
    if (capital >= MIN_CAPITAL)
      out.push({ date: localDateKey(day.getTime(), o.tz), capital, pnl, r: pnl / capital });
    day = new TZDate(next.getTime(), o.tz);
  }
  return out;
}

export function riskMetrics(days: DayReturn[], trades: ClosedTrade[]): RiskMetrics {
  const rs = days.map((d) => d.r);
  const n = rs.length;
  const m = n ? mean(rs) : 0;
  const s = n > 1 ? sd(rs) : 0;
  const down = n ? Math.sqrt(rs.reduce((a, r) => a + Math.min(r, 0) ** 2, 0) / n) : 0;

  // time-weighted index, its drawdowns
  let idx = 1;
  let peak = 1;
  let maxDd = 0;
  let run = 0;
  let longest = 0;
  for (const r of rs) {
    idx *= 1 + r;
    if (idx >= peak) {
      peak = idx;
      run = 0;
    } else {
      run++;
      longest = Math.max(longest, run);
      maxDd = Math.min(maxDd, idx / peak - 1);
    }
  }
  const totalReturn = n ? idx - 1 : null;
  // annualising a few days is meaningless (one +5% day → +5 billion % a year): only from MIN_SAMPLE days
  const annualised = n < MIN_SAMPLE ? null : idx > 0 ? idx ** (365 / n) - 1 : -1;

  // $ drawdown of cumulative trading P&L
  let cum = 0;
  let cumPeak = 0;
  let maxDd$ = 0;
  for (const d of days) {
    cum += d.pnl;
    cumPeak = Math.max(cumPeak, cum);
    maxDd$ = Math.min(maxDd$, cum - cumPeak);
  }

  // per trade
  const nets = trades.map((t) => t.netPnl);
  const wins = trades.filter((t) => outcomeOf(t.netPnl, t.notionalUsd) === "win").map((t) => t.netPnl);
  const losses = trades.filter((t) => outcomeOf(t.netPnl, t.notionalUsd) === "loss").map((t) => t.netPnl);
  const R = trades.map((t) => t.r).filter((r): r is number => r !== null && Number.isFinite(r));
  const sdR = R.length > 1 ? sd(R) : 0;

  return {
    days,
    sharpe: n > 1 && s > 0 ? (m / s) * Math.sqrt(365) : null,
    sortino: n > 1 && down > 0 ? (m / down) * Math.sqrt(365) : null,
    totalReturn,
    annualised,
    maxDrawdown: n ? maxDd : null,
    longestDrawdownDays: n ? longest : null,
    calmar: annualised !== null && maxDd < 0 ? annualised / Math.abs(maxDd) : null,
    recoveryFactor: maxDd$ < 0 ? cum / Math.abs(maxDd$) : null,
    pnl: cum,
    trades: trades.length,
    expectancy: nets.length ? mean(nets) : null,
    expectancyR: R.length ? mean(R) : null,
    rCount: R.length,
    payoff: wins.length && losses.length ? mean(wins) / Math.abs(mean(losses)) : null,
    sqn: R.length > 1 && sdR > 0 ? (Math.sqrt(Math.min(R.length, 100)) * mean(R)) / sdR : null,
    smallDays: n < MIN_SAMPLE,
    smallTrades: R.length < MIN_SAMPLE,
  };
}

/** Balance steps from the exchange's cash events: ledger flows (money in/out) and trading cash, oldest first. */
export function balanceSteps(
  flows: { t: number; usd: number }[],
  cash: { t: number; usd: number }[],
): BalanceStep[] {
  const evs = [
    ...flows.map((f) => ({ t: f.t, usd: f.usd, flow: true })),
    ...cash.map((c) => ({ t: c.t, usd: c.usd, flow: false })),
  ].sort((a, b) => a.t - b.t || Number(b.flow) - Number(a.flow));
  let balance = 0;
  return evs.map((e) => ({ t: e.t, balance: (balance += e.usd), flow: e.flow ? e.usd : 0 }));
}

/** Without a synced ledger: the starting balance as the only money in, plus each closed trade's net at its exit.
 *  With no starting balance either, there is no capital to measure against: no steps. */
export function stepsFromTrades(trades: ClosedTrade[], startingBalance: number): BalanceStep[] {
  const sorted = [...trades].sort((a, b) => a.exitTime - b.exitTime);
  // no known capital (no ledger, no starting balance): realised P&L alone isn't capital, so no % returns
  if (!sorted.length || startingBalance <= 0) return [];
  return balanceSteps(
    startingBalance ? [{ t: sorted[0].exitTime - 1, usd: startingBalance }] : [],
    sorted.map((t) => ({ t: t.exitTime, usd: t.netPnl })),
  );
}

/**
 * Risk metrics for trades exited in [from, to): daily returns from the real balance when the ledger is synced
 * (`bal`), else from the starting balance + realised P&L. `basis` says which, for the card's footnote.
 */
export function computeRisk(
  all: ClosedTrade[],
  bal: { flows: { t: number; usd: number }[]; cash: { t: number; usd: number }[] } | null,
  startingBalance: number,
  o: { from: number | null; to: number | null; tz: string; now: number },
): RiskMetrics & { basis: "balance" | "trades" } {
  const to = Math.min(o.to ?? o.now, o.now);
  const steps = bal ? balanceSteps(bal.flows, bal.cash) : stepsFromTrades(all, startingBalance);
  const days = dailyReturns(steps, { from: o.from, to, tz: o.tz });
  // trade stats use exactly the KPI card's trades; only the daily returns snap to whole days
  const inRange = all.filter((t) => (o.from === null || t.exitTime >= o.from) && t.exitTime < to);
  return { ...riskMetrics(days, inRange), basis: bal ? "balance" : "trades" };
}
