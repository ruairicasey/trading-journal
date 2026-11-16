/**
 * SYNTHETIC Hyperliquid `historicalOrders` rows (used by tests and the demo seed).
 * Mirrors the verified real shape: an "open" snapshot when placed, then the terminal row(s); a trigger
 * that fires adds a non-trigger "filled" row before the "triggered" row. Position TP/SL orders have sz 0.
 */
export type SynthOrder = {
  oid: number;
  coin: string;
  side: "B" | "A";
  orderType: "Stop Market" | "Take Profit Market" | "Stop Limit" | "Take Profit Limit" | "Market" | "Limit";
  triggerPx?: number;
  limitPx?: number;
  placedAt: number;
  /** final status; omit (or "open") for an order that is still live */
  end?: { status: "canceled" | "reduceOnlyCanceled" | "siblingFilledCanceled" | "triggered" | "filled"; at: number };
  sz?: number; // 0 / omitted = position TP/SL (whole position)
  positionTpsl?: boolean;
  reduceOnly?: boolean;
  children?: SynthOrder[];
};

export type SynthRow = { order: Record<string, unknown>; status: string; statusTimestamp: number };

const str = (n: number | undefined) => (n === undefined ? "0.0" : String(n));

function order(o: SynthOrder, over: Record<string, unknown> = {}): Record<string, unknown> {
  const trigger = o.triggerPx !== undefined;
  const sz = str(o.sz ?? 0);
  return {
    coin: o.coin,
    side: o.side,
    limitPx: str(o.limitPx ?? o.triggerPx),
    sz,
    oid: o.oid,
    timestamp: o.placedAt,
    triggerCondition: trigger ? `Price ${o.side === "A" ? (o.orderType.startsWith("Stop") ? "below" : "above") : o.orderType.startsWith("Stop") ? "above" : "below"} ${o.triggerPx}` : "N/A",
    isTrigger: trigger,
    triggerPx: str(o.triggerPx),
    children: (o.children ?? []).map((c) => order({ ...c, oid: o.oid })), // children carry the PARENT's oid (verified)
    isPositionTpsl: o.positionTpsl ?? (trigger && !o.sz),
    reduceOnly: o.reduceOnly ?? trigger,
    orderType: o.orderType,
    origSz: sz,
    tif: trigger ? null : o.orderType === "Market" ? "FrontendMarket" : "Gtc",
    cloid: null,
    ...over,
  };
}

/** All history rows for one order, newest first (like the API). */
export function orderRows(o: SynthOrder): SynthRow[] {
  const rows: SynthRow[] = [{ order: order(o), status: "open", statusTimestamp: o.placedAt }];
  if (o.end?.status === "triggered") {
    rows.push({ order: order(o, { isTrigger: false, triggerPx: "0.0", sz: "0.0", origSz: "0.0", timestamp: o.end.at, children: [] }), status: "filled", statusTimestamp: o.end.at });
    rows.push({ order: order(o, { children: [] }), status: "triggered", statusTimestamp: o.end.at });
  } else if (o.end) {
    rows.push({ order: order(o, { children: [] }), status: o.end.status, statusTimestamp: o.end.at });
  }
  // newest first like the API; for a fired trigger the API lists "filled" before its same-timestamp "triggered"
  return o.end?.status === "triggered" ? [rows[1], rows[2], rows[0]] : rows.reverse();
}

export function historyRows(orders: SynthOrder[]): SynthRow[] {
  return orders.flatMap(orderRows).sort((a, b) => b.statusTimestamp - a.statusTimestamp); // stable: keeps ties in API order
}
