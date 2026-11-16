/**
 * Drawdown on the TRADING P&L equity series: starting balance + realised net P&L, by exit time. Deposits and
 * withdrawals (Phase 2 item 4) are deliberately left out, so moving money never looks like a drawdown.
 *
 * The underwater series is always computed over the whole history (the running peak includes everything
 * before the selected period); a period view slices it.
 */
import type { ClosedTrade } from "./stats";

export type UnderwaterPoint = {
  t: number;
  equity: number;
  peak: number;
  /** ≤ 0, in $ */
  dd: number;
  /** ≤ 0, as % of the peak; null with no starting balance or with equity below zero (see underwaterSeries) */
  ddPct: number | null;
  cumR: number;
  peakR: number;
  /** ≤ 0, in R (trades without a stop count as 0R) */
  ddR: number;
};

export function underwaterSeries(trades: Pick<ClosedTrade, "exitTime" | "netPnl" | "r">[], startingBalance: number): UnderwaterPoint[] {
  const sorted = [...trades].sort((a, b) => a.exitTime - b.exitTime);
  if (!sorted.length) return [];
  let equity = startingBalance;
  let peak = startingBalance;
  let cumR = 0;
  let peakR = 0;
  const point = (t: number): UnderwaterPoint => ({
    t,
    equity,
    peak,
    dd: equity - peak,
    // % only means something against a real balance: not with a $0 (unset) starting balance, where the
    // "peak" is just realised profit, and not once equity is below zero (a drawdown past −100%).
    ddPct: startingBalance > 0 && peak > 0 && equity >= 0 ? ((equity - peak) / peak) * 100 : null,
    cumR,
    peakR,
    ddR: cumR - peakR,
  });
  const out: UnderwaterPoint[] = [point(sorted[0].exitTime - 1)];
  for (const tr of sorted) {
    equity += tr.netPnl;
    cumR += tr.r ?? 0;
    peak = Math.max(peak, equity);
    peakR = Math.max(peakR, cumR);
    out.push(point(tr.exitTime));
  }
  return out;
}

export type DrawdownEpisode = {
  /** $ (≤ 0) */
  dd: number;
  ddPct: number | null;
  peakAt: number;
  troughAt: number;
  /** first time equity got back to the old peak; null = not recovered yet */
  recoveredAt: number | null;
};

export type DrawdownStats = {
  current: {
    equity: number;
    peak: number;
    peakAt: number;
    dd: number;
    ddPct: number | null;
    /** % gain needed from here to get back to the peak; null when equity ≤ 0 */
    recoverPct: number | null;
    daysInDrawdown: number;
    tradesSincePeak: number;
    ddR: number;
  };
  /** deepest $ drawdown inside [from, to) (the running peak may be older) */
  max: DrawdownEpisode | null;
  /** deepest % drawdown (can differ from the deepest $ one when equity grew a lot) */
  maxPct: number | null;
  maxR: { ddR: number; peakAt: number; troughAt: number } | null;
};

const DAY = 86_400_000;

export function drawdownStats(series: UnderwaterPoint[], opts: { from?: number | null; to?: number | null; now: number }): DrawdownStats | null {
  if (!series.length) return null;
  const last = series[series.length - 1];

  // when was the current peak set (the last point whose equity equals the running peak)?
  let peakIdx = series.length - 1;
  while (peakIdx > 0 && series[peakIdx].equity < series[peakIdx].peak) peakIdx--;
  const underwater = last.dd < 0;
  const current = {
    equity: last.equity,
    peak: last.peak,
    peakAt: series[peakIdx].t,
    dd: last.dd,
    ddPct: last.ddPct,
    recoverPct: underwater && last.equity > 0 ? (last.peak / last.equity - 1) * 100 : underwater ? null : 0,
    daysInDrawdown: underwater ? Math.floor((opts.now - series[peakIdx].t) / DAY) : 0,
    tradesSincePeak: underwater ? series.length - 1 - peakIdx : 0,
    ddR: last.ddR,
  };

  const inRange = (p: UnderwaterPoint) => (opts.from == null || p.t >= opts.from) && (opts.to == null || p.t < opts.to);
  let max: DrawdownEpisode | null = null;
  let maxPct: number | null = null;
  let maxR: DrawdownStats["maxR"] = null;
  let peakAt = series[0].t;
  let peakRAt = series[0].t;
  for (let i = 0; i < series.length; i++) {
    const p = series[i];
    if (p.dd === 0) peakAt = p.t;
    if (p.ddR === 0) peakRAt = p.t;
    if (!inRange(p)) continue;
    if (p.dd < 0 && (!max || p.dd < max.dd)) {
      let recoveredAt: number | null = null;
      for (let k = i + 1; k < series.length; k++) {
        if (series[k].equity >= p.peak) {
          recoveredAt = series[k].t;
          break;
        }
      }
      max = { dd: p.dd, ddPct: p.ddPct, peakAt, troughAt: p.t, recoveredAt };
    }
    if (p.ddPct !== null && p.ddPct < 0 && (maxPct === null || p.ddPct < maxPct)) maxPct = p.ddPct;
    if (p.ddR < 0 && (!maxR || p.ddR < maxR.ddR)) maxR = { ddR: p.ddR, peakAt: peakRAt, troughAt: p.t };
  }
  return { current, max, maxPct, maxR };
}

/** The part of the series from `from` on, starting with the level carried into the period (re-stamped at `from`). */
export function sliceUnderwater(series: UnderwaterPoint[], from: number | null): UnderwaterPoint[] {
  if (from === null) return series;
  const first = series.findIndex((p) => p.t >= from);
  if (first === -1) return [];
  if (first === 0) return series;
  return [{ ...series[first - 1], t: from }, ...series.slice(first)];
}
