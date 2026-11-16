/**
 * SYNTHETIC trigger orders for the demo account: a stop (sometimes moved once or twice), often a
 * take-profit, occasionally a 2-level TP ladder. Shaped like real `historicalOrders` rows via hl-orders.
 */
import type { DemoPlan } from "./generate";
import type { SynthOrder } from "./hl-orders";
import type { Rng } from "./rng";

type Trade = { id: string; coin: string; direction: "long" | "short"; status: string; avgEntry: number | null; sizeUnits: number | null; entryTime: number | null; exitTime: number | null; netPnl: number | null };

const p6 = (x: number) => Number(x.toPrecision(6));

export function demoOrders(rng: Rng, plans: DemoPlan[], tradeFor: (p: DemoPlan) => Trade | undefined, journaled: Set<string>): SynthOrder[] {
  let oid = 50_000_000;
  const out: SynthOrder[] = [];
  for (const plan of plans) {
    const t = tradeFor(plan);
    if (!t || t.entryTime === null || !rng.chance(0.75)) continue;
    const close = t.direction === "long" ? "A" : "B";
    const entry = t.entryTime;
    const exit = t.exitTime;
    const lost = (t.netPnl ?? 0) < 0;
    const endAt = (stoppedOut: boolean) => (exit === null ? undefined : { status: stoppedOut ? ("triggered" as const) : ("reduceOnlyCanceled" as const), at: exit });

    // stop: the planned level, or (on a few journaled trades) a slightly different one so "Revert to auto" shows
    let stopPx = p6(plan.stopLoss * (journaled.has(t.id) && rng.chance(0.12) ? 1 + (t.direction === "long" ? -1 : 1) * 0.004 : 1));
    let placed = entry + rng.int(5, 90) * 1000;
    const moves = exit !== null && exit - entry > 2 * 3_600_000 && rng.chance(0.35) ? rng.int(1, 2) : 0;
    for (let i = 0; i < moves; i++) {
      const at = placed + Math.floor(((exit! - placed) * (i + 1)) / (moves + 2));
      out.push({ oid: oid++, coin: t.coin, side: close, orderType: "Stop Market", triggerPx: stopPx, placedAt: placed, end: { status: "canceled", at } });
      // trail toward entry (never past it)
      stopPx = p6(stopPx + ((t.avgEntry ?? plan.entryPx) - stopPx) * rng.between(0.4, 0.9));
      placed = at;
    }
    out.push({ oid: oid++, coin: t.coin, side: close, orderType: "Stop Market", triggerPx: stopPx, placedAt: placed, end: endAt(lost) });

    if (rng.chance(0.08) && t.sizeUnits) {
      // two-level ladder covering the position
      const half = Number((t.sizeUnits / 2).toPrecision(8));
      const near = p6(plan.entryPx + (plan.takeProfit - plan.entryPx) * 0.5);
      for (const [px, sz] of [
        [near, half],
        [p6(plan.takeProfit), t.sizeUnits - half],
      ] as const) {
        out.push({ oid: oid++, coin: t.coin, side: close, orderType: "Take Profit Market", triggerPx: px, sz, placedAt: entry + 30_000, end: endAt(!lost) });
      }
    } else if (rng.chance(0.55)) {
      out.push({ oid: oid++, coin: t.coin, side: close, orderType: "Take Profit Market", triggerPx: p6(plan.takeProfit), placedAt: entry + 20_000, end: endAt(!lost) });
    }
  }
  return out;
}
