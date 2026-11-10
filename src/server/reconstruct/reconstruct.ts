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
 *
 * ORDERING: one order often produces several fills in the same millisecond, and Hyperliquid's tids
 * inside such a group do NOT follow the position sequence (verified on live fills 2026-11: about half
 * the multi-fill groups run in descending tid order). Sorting by (time, tid) therefore produces false
 * position jumps that split trades. Within a same-millisecond group we instead chain fills by
 * startPosition: each next fill is the one whose startPosition equals the previous fill's end position.
 *
 * TOLERANCE: HL's startPosition strings carry float dust (e.g. "2059303.0999999999" following a fill
 * that ends at "2059303.1000000001"), so positions are compared with a small tolerance, not exactly.
 */
import Decimal from "decimal.js";
import { displayPair, parseCoin } from "../hyperliquid/markets";
import { computeMetrics } from "./metrics";
import type { FillInput, Leg, ReconFlags, ReconstructedTrade } from "./types";

// HL sizes have ≤ 8 decimals, but startPosition strings carry float dust. Two positions are "the same"
// if they differ by ≤ 1e-8 units or ≤ 1e-12 relative (whichever is larger).
const ABS_EPS = new Decimal("1e-8");
const REL_EPS = new Decimal("1e-12");
const isZero = (d: Decimal) => d.abs().lte(ABS_EPS);
export const samePosition = (a: Decimal, b: Decimal) =>
  a.minus(b).abs().lte(Decimal.max(ABS_EPS, Decimal.max(a.abs(), b.abs()).times(REL_EPS)));
/**
 * Fee tokens treated as $1. Some HIP-3 dexes settle in other USD stablecoins (seen live 2026-11:
 * USDH on vntl/km/flx, USDT0 on cash, USDE on hyna). Anything else (e.g. HYPE) is flagged `nonUsdcFee`.
 */
export const USD_FEE_TOKENS = new Set(["USDC", "USDH", "USDT0", "USDT", "USDE"]);
const sgn = (d: Decimal) => (isZero(d) ? 0 : d.isPositive() ? 1 : -1);

type Building = {
  key: string;
  direction: "long" | "short";
  legs: Leg[];
  flags: ReconFlags;
  maxSize: Decimal;
  closed: boolean;
};

const startOf = (f: FillInput) => new Decimal(f.startPosition);
const endOf = (f: FillInput) => startOf(f).plus(f.side === "B" ? f.sz : new Decimal(f.sz).neg());

/** Naive order: by (time, tid). Kept for diagnostics (scripts/debug-ordering.ts). */
export function orderByTimeTid(fills: FillInput[]): FillInput[] {
  return [...fills].sort((a, b) => a.time - b.time || a.tid - b.tid);
}

/**
 * Order one coin's fills: by time, and within a same-millisecond group by chaining startPosition
 * (next fill starts where the previous one ended). Ties and unchainable fills fall back to tid.
 */
export function orderFills(fills: FillInput[]): FillInput[] {
  const sorted = orderByTimeTid(fills);
  const out: FillInput[] = [];
  let pos: Decimal | null = null;
  for (let i = 0; i < sorted.length; ) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].time === sorted[i].time) j++;
    const group = sorted.slice(i, j);
    if (group.length === 1) {
      out.push(group[0]);
      pos = endOf(group[0]);
    } else {
      const rem = [...group];
      while (rem.length) {
        let k: number = pos ? rem.findIndex((f) => samePosition(startOf(f), pos!)) : -1;
        if (k < 0) {
          // chain head: a fill whose start isn't the end of any other remaining fill
          const ends = rem.map(endOf);
          k = rem.findIndex((f) => !ends.some((e) => samePosition(e, startOf(f))));
          if (k < 0) k = 0;
        }
        const [f] = rem.splice(k, 1);
        out.push(f);
        pos = endOf(f);
      }
    }
    i = j;
  }
  return out;
}

/** Drop duplicate tids, then order — makes reconstruction order- and duplicate-insensitive. */
export function normalizeFills(fills: FillInput[]): FillInput[] {
  const byTid = new Map<number, FillInput>();
  for (const f of fills) if (!byTid.has(f.tid)) byTid.set(f.tid, f);
  return orderFills([...byTid.values()]);
}

/** Reconstruct trades for ONE coin of ONE wallet. */
export function reconstructCoin(
  walletId: string,
  coin: string,
  input: FillInput[],
  opts: { ownAddress?: string } = {},
): ReconstructedTrade[] {
  const own = opts.ownAddress?.toLowerCase();
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
    if (f.feeToken && !USD_FEE_TOKENS.has(f.feeToken.trim().toUpperCase())) b.flags.nonUsdcFee = true;
    if (f.liquidation) {
      // A `liquidation` object is attached to every fill that took part in a liquidation, including the
      // counterparty's (verified live: a liquidator's fills carry it with someone else as liquidatedUser).
      // Only liquidatedUser === this wallet means *we* were liquidated.
      const who = (f.liquidation as { liquidatedUser?: string | null }).liquidatedUser?.toLowerCase();
      if (own && who === own) b.flags.liquidated = true;
      else b.flags.liquidationCounterparty = true;
    }
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
    } else if (!samePosition(s0, tracked)) {
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
  opts: { includeSpot?: boolean; ownAddress?: string } = {},
): ReconstructedTrade[] {
  const coins = [...new Set(fills.map((f) => f.coin))].filter(
    (c) => opts.includeSpot || parseCoin(c).marketType !== "spot",
  );
  return coins
    .flatMap((c) => reconstructCoin(walletId, c, fills, { ownAddress: opts.ownAddress }))
    .sort((a, b) => a.metrics.entryTime - b.metrics.entryTime || a.externalKey.localeCompare(b.externalKey));
}
