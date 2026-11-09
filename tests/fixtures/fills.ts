/**
 * SYNTHETIC fill builder for tests. Never put real fills here.
 * Wraps the shared simulator (src/server/demo/hl-sim.ts) with minute-offset helpers.
 */
import Decimal from "decimal.js";
import { createSim, MIN, type SimStep } from "@/server/demo/hl-sim";
import type { FillInput } from "@/server/reconstruct/types";

export { MIN };
export const DEMO_WALLET = "0x0000000000000000000000000000000000000001";
export const T0 = Date.UTC(2026, 0, 5, 9, 0, 0); // a Monday, 09:00 UTC

let tidSeq = 1_000;
export function resetTids(start = 1_000) {
  tidSeq = start;
}

type Extra = Omit<Partial<SimStep>, "side" | "sz" | "px" | "time">;

/** `t` arguments are minutes after T0. */
export function sim(coin: string, startPosition: Decimal.Value = 0, startAvg: Decimal.Value = 0) {
  const core = createSim(coin, {
    startPosition,
    startAvg,
    startTime: T0,
    nextTid: () => tidSeq++,
    liquidatedUser: DEMO_WALLET,
  });
  const at = (t?: number) => (t === undefined ? undefined : T0 + t * MIN);
  const api = {
    fills: core.fills,
    buy(sz: Decimal.Value, px: Decimal.Value, t?: number, extra: Extra = {}) {
      core.step({ side: "B", sz, px, time: at(t), ...extra });
      return api;
    },
    sell(sz: Decimal.Value, px: Decimal.Value, t?: number, extra: Extra = {}) {
      core.step({ side: "A", sz, px, time: at(t), ...extra });
      return api;
    },
  };
  return api;
}

/** Signed sum of fee strings, for expectations. */
export const feeSum = (fills: FillInput[]) => fills.reduce((a, f) => a.plus(f.fee), new Decimal(0)).toNumber();
