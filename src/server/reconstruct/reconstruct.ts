/**
 * Trade reconstruction: Hyperliquid fills → round-trip trades. Pure functions, no I/O.
 *
 * Source of truth is each fill's `startPosition` + signed size (not the `dir` string):
 *   s0 = startPosition, delta = +sz (buy) / −sz (sell), s1 = s0 + delta
 *   s0 = 0                      → open a new trade
 *   same sign, |s1| > |s0|      → scale in (entry leg)
 *   s1 = 0                      → final exit leg, close trade
 *   same sign, |s1| < |s0|      → partial exit leg
 *   sign flips                  → close current trade with |s0| units, open a new trade with |s1|
 *                                 (all closedPnl to the close; fee split pro rata by size)
 * If the first fill we have starts mid-position, the trade is flagged `partialHistory`.
 * If a fill's startPosition disagrees with the tracked position, fills are missing → `gap`.
 */
import Decimal from "decimal.js";
import { displayPair, parseCoin } from "../hyperliquid/markets";
import { computeMetrics } from "./metrics";
import type { FillInput, Leg, ReconFlags, ReconstructedTrade } from "./types";

// HL sizes have ≤ 8 decimals; Decimal arithmetic on the string inputs is exact, this only absorbs dust.
const EPS = new Decimal("1e-12");
const isZero = (d: Decimal) => d.abs().lte(EPS);
const sgn = (d: Decimal) => (isZero(d) ? 0 : d.isPositive() ? 1 : -1);

type Building = {
  key: string;
  direction: "long" | "short";
  legs: Leg[];
  flags: ReconFlags;
  maxSize: Decimal;
  closed: boolean;
};

/** Sort by (time, tid) and drop duplicate tids — makes reconstruction order- and duplicate-insensitive. */
export function normalizeFills(fills: FillInput[]): FillInput[] {
  const byTid = new Map<number, FillInput>();
  for (const f of fills) if (!byTid.has(f.tid)) byTid.set(f.tid, f);
  return [...byTid.values()].sort((a, b) => a.time - b.time || a.tid - b.tid);
}

/** Reconstruct trades for ONE coin of ONE wallet. */
export function reconstructCoin(walletId: string, coin: string, input: FillInput[]): ReconstructedTrade[] {
  const fills = normalizeFills(input.filter((f) => f.coin === coin));
  const out: Building[] = [];
  let cur: Building | null = null;
  let tracked: Decimal | null = null;

  const open = (f: FillInput, side: number, keySuffix = "", flags: ReconFlags = {}): Building => {
    const b: Building = {
      key: `${walletId}:${coin}:${f.tid}${keySuffix}`,
      direction: side > 0 ? "long" : "short",
      legs: [],
      flags: { ...flags },
      maxSize: new Decimal(0),
      closed: false,
    };
    out.push(b);
    return b;
  };
  const close = (b: Building) => {
    b.closed = true;
  };
  const leg = (b: Building, f: FillInput, role: Leg["role"], sz: Decimal, fee: Decimal, pnl: Decimal) => {
    b.legs.push({
      tid: f.tid,
      time: f.time,
      role,
      sz: sz.toNumber(),
      px: Number(f.px),
      fee: fee.toNumber(),
      closedPnl: pnl.toNumber(),
    });
    if (f.feeToken && f.feeToken !== "USDC") b.flags.nonUsdcFee = true;
    if (f.liquidation) b.flags.liquidated = true;
  };
  const touch = (b: Building, ...positions: Decimal[]) => {
    for (const p of positions) if (p.abs().gt(b.maxSize)) b.maxSize = p.abs();
  };

  for (const f of fills) {
    const s0 = new Decimal(f.startPosition);
    const sz = new Decimal(f.sz);
    const delta = f.side === "B" ? sz : sz.neg();
    const s1 = s0.plus(delta);
    const fee = new Decimal(f.fee);
    const pnl = new Decimal(f.closedPnl);

    // ── history / gap detection ──
    if (tracked === null) {
      if (!isZero(s0)) cur = open(f, sgn(s0), "", { partialHistory: true });
    } else if (!s0.minus(tracked).abs().lte(EPS)) {
      if (cur) cur.flags.gap = true;
      if (cur && (isZero(s0) || sgn(s0) !== sgn(tracked))) {
        close(cur);
        cur = null;
      }
      if (!cur && !isZero(s0)) cur = open(f, sgn(s0), "", { partialHistory: true, gap: true });
    }

    // ── apply fill ──
    if (isZero(s0)) {
      cur = open(f, sgn(delta));
      leg(cur, f, "entry", sz, fee, pnl);
      touch(cur, s1);
    } else if (isZero(s1)) {
      leg(cur!, f, "exit", sz, fee, pnl);
      touch(cur!, s0);
      close(cur!);
      cur = null;
    } else if (sgn(s1) === sgn(s0)) {
      const growing = s1.abs().gt(s0.abs());
      leg(cur!, f, growing ? "entry" : "exit", sz, fee, pnl);
      touch(cur!, s0, s1);
    } else {
      // flip through zero within one fill
      const closeQty = s0.abs();
      const openQty = s1.abs();
      const closeFee = fee.times(closeQty).div(sz);
      leg(cur!, f, "exit", closeQty, closeFee, pnl);
      touch(cur!, s0);
      close(cur!);
      cur = open(f, sgn(s1), ":o");
      leg(cur, f, "entry", openQty, fee.minus(closeFee), new Decimal(0));
      touch(cur, s1);
    }
    tracked = s1;
  }

  const p = parseCoin(coin);
  return out
    .filter((b) => b.legs.length > 0)
    .map((b) => {
      const m = computeMetrics(b.legs, { direction: b.direction, maxSize: b.maxSize, closed: b.closed });
      const { entryImplied, ...metrics } = m;
      return {
        externalKey: b.key,
        coin,
        dex: p.dex,
        marketType: p.marketType,
        displayPair: displayPair(coin),
        direction: b.direction,
        status: b.closed ? "closed" : "open",
        legs: b.legs,
        flags: entryImplied ? { ...b.flags, entryImplied: true } : b.flags,
        metrics,
      } satisfies ReconstructedTrade;
    });
}

/** Reconstruct all coins for a wallet. Spot is excluded unless `includeSpot`. */
export function reconstructAll(
  walletId: string,
  fills: FillInput[],
  opts: { includeSpot?: boolean } = {},
): ReconstructedTrade[] {
  const coins = [...new Set(fills.map((f) => f.coin))].filter(
    (c) => opts.includeSpot || parseCoin(c).marketType !== "spot",
  );
  return coins
    .flatMap((c) => reconstructCoin(walletId, c, fills))
    .sort((a, b) => a.metrics.entryTime - b.metrics.entryTime || a.externalKey.localeCompare(b.externalKey));
}
