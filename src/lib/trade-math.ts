/**
 * Pure trade maths shared by the Edit Trade form (live previews) and the server (manual-trade metrics).
 */
export type Dir = "long" | "short";
const sign = (d: Dir) => (d === "long" ? 1 : -1);
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Size-weighted average price; null if no usable rows. */
export function weightedAvg(rows: { price: number | null; size: number | null }[]): number | null {
  let qty = 0;
  let notional = 0;
  for (const r of rows) {
    if (!finite(r.price) || !finite(r.size) || r.size <= 0) continue;
    qty += r.size;
    notional += r.price * r.size;
  }
  return qty > 0 ? notional / qty : null;
}

export function totalSize(rows: { size: number | null }[]) {
  return rows.reduce((a, r) => a + (finite(r.size) && r.size > 0 ? r.size : 0), 0);
}

/** $ risked between entry and stop for a given size. */
export function riskUsd(entry: number | null, stop: number | null, size: number | null): number | null {
  if (!finite(entry) || !finite(stop) || !finite(size)) return null;
  const r = Math.abs(entry - stop) * size;
  return r > 0 ? r : null;
}

/** Units to trade so that hitting the stop loses exactly `risk` dollars. */
export function sizeFromRisk(risk: number | null, entry: number | null, stop: number | null): number | null {
  if (!finite(risk) || !finite(entry) || !finite(stop) || risk <= 0) return null;
  const perUnit = Math.abs(entry - stop);
  return perUnit > 0 ? risk / perUnit : null;
}

/** Planned reward:risk ratio, e.g. 2.5 means TP is 2.5× as far as the stop. */
export function rewardRisk(dir: Dir, entry: number | null, stop: number | null, target: number | null): number | null {
  if (!finite(entry) || !finite(stop) || !finite(target)) return null;
  const risk = (entry - stop) * sign(dir);
  const reward = (target - entry) * sign(dir);
  return risk > 0 ? reward / risk : null;
}

/** Is the stop on the losing side of entry? (long: below, short: above) */
export function stopOnCorrectSide(dir: Dir, entry: number | null, stop: number | null): boolean | null {
  if (!finite(entry) || !finite(stop)) return null;
  return dir === "long" ? stop < entry : stop > entry;
}

export function usdToUnits(usd: number | null, price: number | null) {
  return finite(usd) && finite(price) && price > 0 ? usd / price : null;
}
export function unitsToUsd(units: number | null, price: number | null) {
  return finite(units) && finite(price) ? units * price : null;
}

/** Sum of TP partial percentages, and whether it's a valid plan (empty, or totals 100%). */
export function tpAllocation(rows: { pct: number | null }[]) {
  const used = rows.filter((r) => finite(r.pct));
  const total = used.reduce((a, r) => a + (r.pct as number), 0);
  return { total, valid: used.length === 0 || Math.abs(total - 100) < 0.01 };
}

/** Metrics for a MANUAL trade (exchange trades get theirs from fills). */
export function manualMetrics(input: {
  direction: Dir;
  entry: number | null;
  exit: number | null;
  size: number | null;
  fees: number | null;
  entryTime: number | null;
  exitTime: number | null;
  closed: boolean;
}) {
  const { direction, entry, exit, size } = input;
  const fees = finite(input.fees) ? input.fees : 0;
  const notional = finite(entry) && finite(size) ? entry * size : null;
  const gross = input.closed && finite(entry) && finite(exit) && finite(size) ? (exit - entry) * size * sign(direction) : null;
  const net = gross === null ? null : gross - fees;
  return {
    avgEntry: finite(entry) ? entry : null,
    avgExit: finite(exit) ? exit : null,
    sizeUnits: finite(size) ? size : null,
    entryUnitsTotal: finite(size) ? size : null,
    exitUnitsTotal: input.closed && finite(size) ? size : null,
    notionalUsd: notional,
    grossPnl: gross,
    fees: input.closed || fees ? fees : null,
    netPnl: net,
    returnPct: net !== null && notional ? (net / notional) * 100 : null,
    entryTime: input.entryTime,
    exitTime: input.closed ? input.exitTime : null,
    durationMs: input.closed && finite(input.entryTime) && finite(input.exitTime) ? input.exitTime - input.entryTime : null,
  };
}
