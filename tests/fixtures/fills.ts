/**
 * SYNTHETIC fill builder. Never put real fills here.
 *
 * `sim(coin)` mimics Hyperliquid's position bookkeeping so fixtures are realistic:
 * it tracks the position + average entry, and fills in startPosition, dir and closedPnl
 * (closedPnl = (px − avgEntry) × closedQty × sign, gross of fees, like HL).
 */
import Decimal from "decimal.js";
import type { FillInput } from "@/server/reconstruct/types";

export const DEMO_WALLET = "0x0000000000000000000000000000000000000001";
export const T0 = Date.UTC(2026, 0, 5, 9, 0, 0); // a Monday, 09:00 UTC
export const MIN = 60_000;
export const FEE_RATE = new Decimal("0.00045");

let tidSeq = 1_000;
export function resetTids(start = 1_000) {
  tidSeq = start;
}

type Step = {
  side: "B" | "A";
  sz: string | number;
  px: string | number;
  /** minutes after T0 */
  t?: number;
  fee?: string;
  tid?: number;
  liquidation?: boolean;
  feeToken?: string;
};

export function sim(coin: string, startPosition: Decimal.Value = 0, startAvg: Decimal.Value = 0) {
  let pos = new Decimal(startPosition);
  let avg = new Decimal(startAvg);
  let clock = 0;
  const fills: FillInput[] = [];

  const api = {
    fills,
    step(st: Step) {
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

      const t = st.t ?? clock;
      clock = t + 1;
      const fill: FillInput = {
        tid: st.tid ?? tidSeq++,
        coin,
        px: px.toString(),
        sz: sz.toString(),
        side: st.side,
        time: T0 + t * MIN,
        startPosition: s0.toString(),
        dir: dirLabel(s0, s1),
        closedPnl: closedPnl.toString(),
        fee: st.fee ?? px.times(sz).times(FEE_RATE).toDecimalPlaces(6).toString(),
        feeToken: st.feeToken ?? "USDC",
        hash: "0x" + "0".repeat(56) + (st.tid ?? tidSeq).toString(16).padStart(8, "0"),
        oid: 50_000 + fills.length,
        crossed: true,
        liquidation: st.liquidation ? { liquidatedUser: DEMO_WALLET, markPx: px.toString(), method: "market" } : null,
      };
      fills.push(fill);
      return api;
    },
    buy(sz: Step["sz"], px: Step["px"], t?: number, extra: Partial<Step> = {}) {
      return api.step({ side: "B", sz, px, t, ...extra });
    },
    sell(sz: Step["sz"], px: Step["px"], t?: number, extra: Partial<Step> = {}) {
      return api.step({ side: "A", sz, px, t, ...extra });
    },
  };
  return api;
}

function dirLabel(s0: Decimal, s1: Decimal) {
  if (s0.isZero()) return s1.isPositive() ? "Open Long" : "Open Short";
  if (s0.isPositive() && s1.isNegative()) return "Long > Short";
  if (s0.isNegative() && s1.isPositive()) return "Short > Long";
  if (s0.isPositive()) return s1.gt(s0) ? "Open Long" : "Close Long";
  return s1.lt(s0) ? "Open Short" : "Close Short";
}

/** Sum of fee strings, for expectations. */
export const feeSum = (fills: FillInput[]) => fills.reduce((a, f) => a.plus(f.fee), new Decimal(0)).toNumber();
