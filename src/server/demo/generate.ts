/**
 * Deterministic SYNTHETIC trading history for the demo account.
 * Prices are random walks; nothing here is derived from any real wallet.
 */
import Decimal from "decimal.js";
import type { FillInput } from "../reconstruct/types";
import { createSim, TAKER_FEE } from "./hl-sim";
import { createRng, type Rng } from "./rng";

export const DEMO_ADDRESS = "0x0000000000000000000000000000000000000de0";
export const DEMO_SEED = 20260109;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MAKER_FEE = new Decimal("0.00015");
const MAKER_REBATE = new Decimal("-0.00002");

type CoinSpec = { coin: string; px: number; dailyVol: number; decimals: number; pxDecimals: number; weight: number };

export const DEMO_COINS: CoinSpec[] = [
  { coin: "BTC", px: 95_000, dailyVol: 0.025, decimals: 4, pxDecimals: 0, weight: 5 },
  { coin: "ETH", px: 3_400, dailyVol: 0.035, decimals: 3, pxDecimals: 1, weight: 4 },
  { coin: "SOL", px: 180, dailyVol: 0.045, decimals: 2, pxDecimals: 2, weight: 3 },
  { coin: "HYPE", px: 30, dailyVol: 0.06, decimals: 1, pxDecimals: 3, weight: 3 },
  { coin: "kPEPE", px: 0.012, dailyVol: 0.07, decimals: 0, pxDecimals: 6, weight: 1 },
  { coin: "xyz:SPX", px: 6_000, dailyVol: 0.012, decimals: 2, pxDecimals: 1, weight: 2 },
];

export type Pattern = "single" | "scale_in" | "partials" | "flip";

/** What the generator "intended" for a trade — the seed uses it to fill realistic journal data. */
export type DemoPlan = {
  coin: string;
  /** tid of the first entry fill; the reconstructed external key is `${walletId}:${coin}:${firstTid}${keySuffix}` */
  firstTid: number;
  keySuffix: "" | ":o";
  direction: "long" | "short";
  pattern: Pattern;
  entryPx: number;
  stopLoss: number;
  takeProfit: number;
  /** realised R the generator aimed for (null while open) */
  targetR: number | null;
  open: boolean;
};

export type DemoHistory = { fills: FillInput[]; plans: DemoPlan[] };

/** Hourly random-walk price paths, one per coin. */
function pricePaths(rng: Rng, start: number, end: number) {
  const hours = Math.ceil((end - start) / HOUR) + 1;
  const paths = new Map<string, number[]>();
  for (const c of DEMO_COINS) {
    const hourlyVol = c.dailyVol / Math.sqrt(24);
    const drift = rng.between(-0.00004, 0.00008);
    const path = [c.px];
    for (let i = 1; i < hours; i++) path.push(path[i - 1] * Math.exp(drift + hourlyVol * rng.normal()));
    paths.set(c.coin, path);
  }
  return (coin: string, t: number) => {
    const path = paths.get(coin)!;
    const i = Math.min(path.length - 1, Math.max(0, Math.floor((t - start) / HOUR)));
    return path[i];
  };
}

const round = (x: number, dp: number) => new Decimal(x).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);

export function generateDemoHistory(opts: { seed?: number; end: number; days?: number }): DemoHistory {
  const rng = createRng(opts.seed ?? DEMO_SEED);
  const days = opts.days ?? 182;
  const end = Math.floor(opts.end / HOUR) * HOUR;
  const start = end - days * DAY;
  const priceAt = pricePaths(rng, start, end);

  let tid = 1_000_000;
  const nextTid = () => (tid += rng.int(1, 40));
  const fills: FillInput[] = [];
  const plans: DemoPlan[] = [];
  const busyUntil = new Map<string, number>();
  const weighted = DEMO_COINS.flatMap((c) => Array(c.weight).fill(c) as CoinSpec[]);

  for (let day = 0; day < days; day++) {
    const dayStart = start + day * DAY;
    const dow = new Date(dayStart).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    const nTrades = weekend ? rng.int(0, 1) : rng.int(0, 4);

    for (let n = 0; n < nTrades; n++) {
      const spec = rng.pick(weighted);
      // entries cluster around London/NY hours with some Asia
      const hour = rng.chance(0.7) ? rng.int(7, 20) : rng.int(0, 23);
      const entryTime = dayStart + hour * HOUR + rng.int(0, 59) * 60_000;
      const isLast = day >= days - 3;
      if (entryTime >= end - HOUR) continue;
      if ((busyUntil.get(spec.coin) ?? 0) > entryTime) continue;

      const dir: 1 | -1 = rng.chance(0.55) ? 1 : -1;
      const side = (d: 1 | -1) => (d === 1 ? "B" : "A") as "B" | "A";
      const px0 = priceAt(spec.coin, entryTime);
      const riskPct = rng.between(0.004, 0.015);
      const stop = px0 * (1 - dir * riskPct);

      // outcome in R: ~47% winners, losers mostly full stops
      const win = rng.chance(0.47);
      const targetR = win ? rng.pick([0.6, 1, 1.5, 2, 2, 2.5, 3, 4]) * rng.between(0.85, 1.1) : rng.chance(0.75) ? -1 : -rng.between(0.2, 0.9);
      const exitPx = px0 * (1 + dir * riskPct * targetR);
      const tp = px0 * (1 + dir * riskPct * rng.pick([2, 2.5, 3]));

      const notional = rng.between(3_000, 30_000);
      const qty = round(notional / px0, spec.decimals);
      if (qty.lte(0)) continue;

      const duration = Math.round(
        rng.chance(0.55) ? rng.between(8, 240) * 60_000 : rng.chance(0.7) ? rng.between(4, 30) * HOUR : rng.between(1, 4) * DAY,
      );
      const exitTime = Math.min(entryTime + duration, end - 30 * 60_000);
      const leaveOpen = isLast && rng.chance(0.85);

      const pattern: Pattern = rng.chance(0.05) ? "flip" : rng.chance(0.27) ? "scale_in" : rng.chance(0.28) ? "partials" : "single";
      const sim = createSim(spec.coin, { startTime: entryTime, nextTid, liquidatedUser: DEMO_ADDRESS });
      const feeFor = (px: Decimal, sz: Decimal, maker: boolean) => {
        const rate = maker ? (rng.chance(0.1) ? MAKER_REBATE : MAKER_FEE) : TAKER_FEE;
        return px.times(sz).times(rate).toDecimalPlaces(6).toString();
      };
      const fill = (d: 1 | -1, sz: Decimal, pxNum: number, time: number, maker = rng.chance(0.35)) => {
        if (sz.lte(0)) return;
        const px = round(pxNum, spec.pxDecimals);
        sim.step({ side: side(d), sz, px, time: Math.round(time), fee: feeFor(px, sz, maker) });
      };

      // entries
      const span = Math.max(exitTime - entryTime, 10 * 60_000);
      if (pattern === "scale_in") {
        const parts = rng.int(2, 3);
        const part = round(qty.toNumber() / parts, spec.decimals);
        let used = new Decimal(0);
        for (let i = 0; i < parts; i++) {
          const sz = i === parts - 1 ? qty.minus(used) : part;
          if (sz.lte(0)) continue;
          used = used.plus(sz);
          const t = entryTime + Math.round((span * 0.25 * i) / parts);
          fill(dir, sz, px0 * (1 - dir * riskPct * 0.25 * i), t, true);
        }
      } else {
        fill(dir, qty, px0, entryTime);
      }
      const firstTid = sim.fills[0]?.tid;
      if (firstTid === undefined) continue;

      const plan: DemoPlan = {
        coin: spec.coin,
        firstTid,
        keySuffix: "",
        direction: dir === 1 ? "long" : "short",
        pattern,
        entryPx: px0,
        stopLoss: stop,
        takeProfit: tp,
        targetR: leaveOpen ? null : targetR,
        open: leaveOpen,
      };
      plans.push(plan);

      // exits
      let doneAt = exitTime;
      if (leaveOpen) {
        if (pattern === "partials") fill(-dir as 1 | -1, round(qty.toNumber() * 0.3, spec.decimals), px0 * (1 + dir * riskPct), entryTime + span / 2);
        doneAt = end;
      } else if (pattern === "partials" && targetR > 0) {
        const first = round(qty.toNumber() * rng.pick([0.25, 0.33, 0.5]), spec.decimals);
        const second = round(qty.minus(first).toNumber() * 0.5, spec.decimals);
        const third = qty.minus(first).minus(second);
        fill(-dir as 1 | -1, first, px0 * (1 + dir * riskPct * Math.min(1, targetR)), entryTime + span * 0.4);
        if (second.gt(0)) fill(-dir as 1 | -1, second, px0 * (1 + dir * riskPct * targetR * 0.9), entryTime + span * 0.7);
        if (third.gt(0)) fill(-dir as 1 | -1, third, exitPx, exitTime);
      } else if (pattern === "flip") {
        // reverse through zero in one fill, then close the new position later
        const flipQty = qty.times(2);
        fill(-dir as 1 | -1, flipQty, exitPx, exitTime, false);
        const flipFill = sim.fills[sim.fills.length - 1];
        const px2 = exitPx * (1 - dir * riskPct * rng.between(-0.8, 1.5));
        const t2 = Math.min(exitTime + rng.between(20, 360) * 60_000, end - 10 * 60_000);
        fill(dir, qty, px2, t2);
        const stop2 = exitPx * (1 + dir * riskPct);
        plans.push({
          coin: spec.coin,
          firstTid: flipFill.tid,
          keySuffix: ":o",
          direction: dir === 1 ? "short" : "long",
          pattern: "flip",
          entryPx: exitPx,
          stopLoss: stop2,
          takeProfit: exitPx * (1 - dir * riskPct * 2),
          targetR: null,
          open: false,
        });
        doneAt = t2;
      } else {
        fill(-dir as 1 | -1, qty, exitPx, exitTime);
      }

      // Safety: every closed trade must end flat.
      if (!leaveOpen && !sim.position.isZero()) {
        fill((sim.position.isPositive() ? -1 : 1) as 1 | -1, sim.position.abs(), exitPx, doneAt + 60_000);
      }
      busyUntil.set(spec.coin, doneAt + 60_000);
      fills.push(...sim.fills);
    }
  }

  // A few positions still open "now" so the Open tab and live-P&L banner have data.
  const free = DEMO_COINS.filter((c) => (busyUntil.get(c.coin) ?? 0) < end - 12 * HOUR);
  for (const spec of rng.sample(free, 3)) {
    const t = end - rng.int(2, 10) * HOUR;
    const dir: 1 | -1 = rng.chance(0.5) ? 1 : -1;
    const px = priceAt(spec.coin, t);
    const qty = round(rng.between(3_000, 15_000) / px, spec.decimals);
    if (qty.lte(0)) continue;
    const sim = createSim(spec.coin, { startTime: t, nextTid, liquidatedUser: DEMO_ADDRESS });
    const pxD = round(px, spec.pxDecimals);
    sim.step({ side: dir === 1 ? "B" : "A", sz: qty, px: pxD, time: t });
    const riskPct = rng.between(0.005, 0.012);
    plans.push({
      coin: spec.coin,
      firstTid: sim.fills[0].tid,
      keySuffix: "",
      direction: dir === 1 ? "long" : "short",
      pattern: "single",
      entryPx: px,
      stopLoss: px * (1 - dir * riskPct),
      takeProfit: px * (1 + dir * riskPct * 2.5),
      targetR: null,
      open: true,
    });
    fills.push(...sim.fills);
  }

  fills.sort((a, b) => a.time - b.time || a.tid - b.tid);
  return { fills, plans };
}
