/**
 * SYNTHETIC Hyperliquid fill simulator (used by test fixtures and the demo seed).
 *
 * Mimics HL position bookkeeping so generated fills are realistic: tracks position and
 * average entry, and fills in startPosition, dir and closedPnl
 * (closedPnl = (px − avgEntry) × closedQty × sign, gross of fees, like HL).
 * Never feed real fills through here into committed files.
 */
import Decimal from "decimal.js";
import type { FillInput } from "../reconstruct/types";

export const MIN = 60_000;
export const TAKER_FEE = new Decimal("0.00045");

export type SimStep = {
  side: "B" | "A";
  sz: Decimal.Value;
  px: Decimal.Value;
  /** absolute ms timestamp (defaults to previous + 1 minute) */
  time?: number;
  /** explicit fee string; negative = maker rebate. Defaults to taker fee on notional. */
  fee?: string;
  /** builder fee portion (HL reports it separately; assumed already included in `fee`). */
  builderFee?: string;
  tid?: number;
  liquidation?: boolean;
  feeToken?: string;
};

export type SimOptions = {
  startPosition?: Decimal.Value;
  startAvg?: Decimal.Value;
  startTime?: number;
  nextTid: () => number;
  liquidatedUser?: string;
};

export function createSim(coin: string, opts: SimOptions) {
  let pos = new Decimal(opts.startPosition ?? 0);
  let avg = new Decimal(opts.startAvg ?? 0);
  let clock = opts.startTime ?? 0;
  const fills: FillInput[] = [];

  const sim = {
    coin,
    fills,
    get position() {
      return pos;
    },
    step(st: SimStep) {
      const sz = new Decimal(st.sz);
      const px = new Decimal(st.px);
      const delta = st.side === "B" ? sz : sz.neg();
      const s0 = pos;
      const s1 = s0.plus(delta);
      let closedPnl = new Decimal(0);

      const sameDir = s0.isZero() || s0.isPositive() === delta.isPositive();
      if (sameDir) {
        avg = s1.isZero() ? new Decimal(0) : avg.times(s0.abs()).plus(px.times(sz)).div(s1.abs());
      } else {
        const closeQty = Decimal.min(sz, s0.abs());
        const sign = s0.isPositive() ? 1 : -1;
        closedPnl = px.minus(avg).times(closeQty).times(sign);
        if (s1.isZero()) avg = new Decimal(0);
        else if (s1.isPositive() !== s0.isPositive()) avg = px; // flipped: new position at fill price
      }
      pos = s1;

      const time = st.time ?? clock;
      clock = time + MIN;
      const tid = st.tid ?? opts.nextTid();
      const fill: FillInput = {
        tid,
        coin,
        px: px.toString(),
        sz: sz.toString(),
        side: st.side,
        time,
        startPosition: s0.toString(),
        dir: dirLabel(s0, s1),
        closedPnl: closedPnl.toDecimalPlaces(6).toString(),
        fee: st.fee ?? px.times(sz).times(TAKER_FEE).toDecimalPlaces(6).toString(),
        feeToken: st.feeToken ?? "USDC",
        builderFee: st.builderFee ?? null,
        hash: "0x" + "0".repeat(52) + tid.toString(16).padStart(12, "0"),
        oid: 50_000 + tid,
        crossed: st.fee === undefined || !st.fee.startsWith("-"),
        liquidation: st.liquidation
          ? { liquidatedUser: opts.liquidatedUser ?? null, markPx: px.toString(), method: "market" }
          : null,
      };
      fills.push(fill);
      return sim;
    },
  };
  return sim;
}

export function dirLabel(s0: Decimal, s1: Decimal) {
  if (s0.isZero()) return s1.isPositive() ? "Open Long" : "Open Short";
  if (s0.isPositive() && s1.isNegative()) return "Long > Short";
  if (s0.isNegative() && s1.isPositive()) return "Short > Long";
  if (s0.isPositive()) return s1.gt(s0) ? "Open Long" : "Close Long";
  return s1.lt(s0) ? "Open Short" : "Close Short";
}
