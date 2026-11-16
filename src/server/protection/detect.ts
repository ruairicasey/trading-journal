/**
 * Detect a trade's stop loss, take profit(s) and stop moves from its exchange trigger orders (pure).
 *
 * Candidates: trigger orders on the trade's coin, on the CLOSING side, reduce-only or position TP/SL,
 * placed from 2 minutes before entry up to the exit (or now), and still live at entry.
 *  - SL vs TP by order type ("Stop …" / "Take Profit …"), else by trigger price vs the average entry.
 *  - Stop loss = the first RISK-SIDE stop in force after entry (below entry for a long, above for a short);
 *    R uses it. A stop on the profit side of entry (breakeven/trailing) is never the stop loss, only a move.
 *    No risk-side stop → no stop loss. A stop first placed > LATE_STOP_MS after entry is kept, and the
 *    Edit page says how late it was placed.
 *  - Every other stop order at a different price (cancel-and-replace, or a new one) is a stop move.
 *  - Take profit = the first TP in force. If two or more sized TP orders were live together and cover the
 *    position (±2%), they become TP partials and the take profit is the farthest one.
 */
export type ProtectionOrder = {
  oid: number;
  coin: string;
  side: "B" | "A";
  orderType: string;
  isTrigger: boolean;
  triggerPx: number | null;
  reduceOnly: boolean;
  isPositionTpsl: boolean;
  origSz: number | null;
  placedAt: number;
  endedAt: number | null;
};

export type ProtectionTrade = {
  coin: string;
  direction: "long" | "short";
  avgEntry: number | null;
  sizeUnits: number | null;
  entryTime: number | null;
  exitTime: number | null;
};

export type DetectedLevel = { price: number; placedAt: number; oid: number };
export type DetectedProtection = {
  stopLoss: DetectedLevel | null;
  takeProfit: DetectedLevel | null;
  tpPartials: { price: number; pct: number; oid: number }[];
  stopMoves: { time: number; price: number; oid: number }[];
};

export const PRE_ENTRY_GRACE_MS = 2 * 60_000;
/** an initial stop placed later than this after entry is labelled "placed Xh after entry" */
export const LATE_STOP_MS = 15 * 60_000;
const COVERAGE_TOLERANCE = 0.02;

export function classify(o: ProtectionOrder, t: ProtectionTrade): "sl" | "tp" | null {
  const type = o.orderType.toLowerCase();
  if (type.includes("take profit")) return "tp";
  if (type.includes("stop")) return "sl";
  if (o.triggerPx === null || t.avgEntry === null) return null;
  const below = o.triggerPx < t.avgEntry;
  return t.direction === "long" ? (below ? "sl" : "tp") : below ? "tp" : "sl";
}

export function detectProtection(t: ProtectionTrade, orders: ProtectionOrder[], now: number): DetectedProtection {
  const none: DetectedProtection = { stopLoss: null, takeProfit: null, tpPartials: [], stopMoves: [] };
  if (t.entryTime === null) return none;
  const entry = t.entryTime;
  const end = t.exitTime ?? now;
  const closingSide = t.direction === "long" ? "A" : "B";
  const live = (o: ProtectionOrder) => Math.max(o.placedAt, entry); // when it started protecting this trade

  const cands = orders
    .filter(
      (o) =>
        o.coin === t.coin &&
        o.isTrigger &&
        o.triggerPx !== null &&
        o.triggerPx > 0 &&
        o.side === closingSide &&
        (o.reduceOnly || o.isPositionTpsl) &&
        o.placedAt >= entry - PRE_ENTRY_GRACE_MS &&
        o.placedAt <= end &&
        (o.endedAt === null || o.endedAt >= entry),
    )
    .sort((a, b) => live(a) - live(b) || a.placedAt - b.placedAt || a.oid - b.oid);

  const sls = cands.filter((o) => classify(o, t) === "sl");
  const tps = cands.filter((o) => classify(o, t) === "tp");

  // ── stop loss + moves ──
  const riskSide = (px: number) => t.avgEntry !== null && (t.direction === "long" ? px < t.avgEntry : px > t.avgEntry);
  const initial = sls.find((o) => riskSide(o.triggerPx!)) ?? null;
  const stopLoss: DetectedLevel | null = initial ? { price: initial.triggerPx!, placedAt: initial.placedAt, oid: initial.oid } : null;
  const stopMoves: DetectedProtection["stopMoves"] = [];
  let current: number | null = null;
  for (const o of sls) {
    if (o === initial) {
      current = o.triggerPx;
      continue;
    }
    if (o.triggerPx !== current) stopMoves.push({ time: live(o), price: o.triggerPx!, oid: o.oid });
    current = o.triggerPx;
  }

  // ── take profit / partials ──
  let takeProfit: DetectedLevel | null = tps.length ? { price: tps[0].triggerPx!, placedAt: tps[0].placedAt, oid: tps[0].oid } : null;
  let tpPartials: DetectedProtection["tpPartials"] = [];
  const sized = tps.filter((o) => !o.isPositionTpsl && (o.origSz ?? 0) > 0);
  if (sized.length >= 2 && t.sizeUnits && t.sizeUnits > 0) {
    for (const anchor of sized) {
      // every sized TP live at the moment `anchor` was placed (the ladder as it stood then)
      const at = live(anchor);
      const ladder = sized.filter((o) => live(o) <= at && (o.endedAt === null || o.endedAt > at));
      const prices = new Set(ladder.map((o) => o.triggerPx));
      const total = ladder.reduce((a, o) => a + o.origSz!, 0);
      if (ladder.length >= 2 && prices.size === ladder.length && Math.abs(total / t.sizeUnits - 1) <= COVERAGE_TOLERANCE) {
        const dist = (o: ProtectionOrder) => Math.abs(o.triggerPx! - (t.avgEntry ?? 0));
        const sorted = [...ladder].sort((a, b) => dist(a) - dist(b));
        tpPartials = sorted.map((o) => ({ price: o.triggerPx!, pct: Math.round((o.origSz! / total) * 10_000) / 100, oid: o.oid }));
        // make the rounded percentages add up to exactly 100
        const drift = Math.round((100 - tpPartials.reduce((a, p) => a + p.pct, 0)) * 100) / 100;
        tpPartials[tpPartials.length - 1].pct = Math.round((tpPartials[tpPartials.length - 1].pct + drift) * 100) / 100;
        const far = sorted[sorted.length - 1];
        takeProfit = { price: far.triggerPx!, placedAt: far.placedAt, oid: far.oid };
        break;
      }
    }
  }
  return { stopLoss, takeProfit, tpPartials, stopMoves };
}
