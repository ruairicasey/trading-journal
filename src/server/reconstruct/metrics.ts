import Decimal from "decimal.js";
import type { Leg, TradeMetrics } from "./types";

/**
 * Per-trade metrics from its legs.
 * - avg entry/exit are size-weighted over entry/exit legs.
 * - If history starts mid-position (no entry legs), entry is implied from HL's closedPnl:
 *   long: pnl = (exit − entry)·sz  ⇒ entry = (Σpx·sz − Σpnl)/Σsz;  short: + instead of −.
 * - returnPct = net / notional × 100 (notional = avg entry × max position size).
 */
export function computeMetrics(
  legs: Leg[],
  opts: { direction: "long" | "short"; maxSize: Decimal; closed: boolean; funding?: number },
): TradeMetrics & { entryImplied: boolean } {
  const entries = legs.filter((l) => l.role === "entry");
  const exits = legs.filter((l) => l.role === "exit");
  const sum = (xs: Leg[], f: (l: Leg) => Decimal.Value) => xs.reduce((a, l) => a.plus(f(l)), new Decimal(0));

  const entryUnits = sum(entries, (l) => l.sz);
  const exitUnits = sum(exits, (l) => l.sz);
  const sign = opts.direction === "long" ? 1 : -1;

  let avgEntry: Decimal | null = entryUnits.gt(0) ? sum(entries, (l) => new Decimal(l.px).times(l.sz)).div(entryUnits) : null;
  let entryImplied = false;
  if (!avgEntry && exitUnits.gt(0)) {
    const pxSz = sum(exits, (l) => new Decimal(l.px).times(l.sz));
    const pnl = sum(exits, (l) => l.closedPnl);
    avgEntry = pxSz.minus(pnl.times(sign)).div(exitUnits);
    entryImplied = true;
  }
  const avgExit = exitUnits.gt(0) ? sum(exits, (l) => new Decimal(l.px).times(l.sz)).div(exitUnits) : null;

  const gross = sum(legs, (l) => l.closedPnl);
  const fees = sum(legs, (l) => l.fee);
  const funding = new Decimal(opts.funding ?? 0);
  const net = gross.minus(fees).plus(funding);
  const notional = avgEntry ? avgEntry.times(opts.maxSize) : null;

  const times = legs.map((l) => l.time);
  const entryTime = Math.min(...times);
  const exitTime = opts.closed ? Math.max(...times) : null;

  return {
    avgEntry: avgEntry?.toNumber() ?? null,
    avgExit: avgExit?.toNumber() ?? null,
    sizeUnits: opts.maxSize.toNumber(),
    entryUnitsTotal: entryUnits.toNumber(),
    exitUnitsTotal: exitUnits.toNumber(),
    notionalUsd: notional?.toNumber() ?? null,
    grossPnl: gross.toNumber(),
    fees: fees.toNumber(),
    funding: funding.toNumber(),
    netPnl: net.toNumber(),
    returnPct: notional && !notional.isZero() ? net.div(notional).times(100).toNumber() : null,
    entryTime,
    exitTime,
    durationMs: exitTime !== null ? exitTime - entryTime : null,
    fillCount: new Set(legs.map((l) => l.tid)).size,
    entryImplied,
  };
}
