/**
 * Classify a trade's stop moves. Pure: no DB, no I/O.
 *
 * Each move is judged against the stop it replaced (the initial stop for the first move), in this order:
 *  - widen:     the stop moved away from the profit side, wherever it sits (risk side or already in profit):
 *               it gives back R, e.g. 106 → 102 on a long entered at 100
 *  - unchanged: the same price (a re-placed order)
 *  - breakeven: the new stop is within BE_PCT of entry
 *  - trail:     the new stop is past entry on the profit side (it locks in profit)
 *  - tighten:   still on the risk side, but closer to entry (less at risk)
 * Moves are taken in time order, ties broken by id, so the same moves always class the same way.
 * A trade's primary class is the first that applies in this order, so the classes partition every trade that
 * has a stop: widened > trailed > breakeven > tightened > never moved.
 */
export const STOP_BE_PCT = 0.05; // % of entry: a stop this close to entry is "at breakeven"

export type StopMoveKind = "breakeven" | "trail" | "tighten" | "widen" | "unchanged";
export type StopClass = "widened" | "trailed" | "breakeven" | "tightened" | "never_moved";
export const STOP_CLASSES: readonly StopClass[] = ["widened", "trailed", "breakeven", "tightened", "never_moved"];
export const STOP_CLASS_LABEL: Record<StopClass, string> = {
  widened: "Stop widened",
  trailed: "Trailed into profit",
  breakeven: "Moved to breakeven",
  tightened: "Tightened only",
  never_moved: "Never moved",
};

export type ClassifiedMove = {
  time: number;
  price: number;
  kind: StopMoveKind;
  /** signed distance from entry as % of entry: positive = risk side, negative = profit side */
  riskPct: number;
  /** R the stop now guarantees if hit (before fees/slippage): −1 at the initial stop, 0 at entry, > 0 in profit */
  lockedR: number | null;
};

/** byte order, like SQLite's default for text: the same in every locale */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Moves sorted the way they are classified: by time, then id. */
export const sortMoves = <T extends { time: number; id?: string }>(moves: T[]) => [...moves].sort((a, b) => a.time - b.time || cmp(a.id ?? "", b.id ?? ""));

export function classifyStopMoves(
  direction: "long" | "short",
  entry: number,
  initialStop: number | null,
  moves: { time: number; price: number; id?: string }[],
): { moves: ClassifiedMove[]; cls: StopClass } {
  const sign = direction === "long" ? 1 : -1;
  const riskPct = (stop: number) => ((entry - stop) / entry) * 100 * sign;
  const initialRisk = initialStop === null ? null : (entry - initialStop) * sign;
  const lockedR = (stop: number) => (initialRisk && initialRisk > 0 ? ((stop - entry) * sign) / initialRisk : null);

  const sorted = sortMoves(moves);
  let prev = initialStop;
  const out: ClassifiedMove[] = [];
  for (const m of sorted) {
    const r = riskPct(m.price);
    const eps = Math.abs(entry) * 1e-12;
    let kind: StopMoveKind;
    if (prev !== null && (m.price - prev) * sign < -eps) kind = "widen";
    else if (prev !== null && Math.abs(m.price - prev) <= eps) kind = "unchanged";
    else if (Math.abs(r) < STOP_BE_PCT) kind = "breakeven";
    else if (r < 0) kind = "trail";
    else kind = "tighten"; // closer to entry on the risk side, or a first risk-side stop with nothing before it
    out.push({ time: m.time, price: m.price, kind, riskPct: r, lockedR: lockedR(m.price) });
    prev = m.price;
  }
  const has = (k: StopMoveKind) => out.some((m) => m.kind === k);
  const cls: StopClass = has("widen") ? "widened" : has("trail") ? "trailed" : has("breakeven") ? "breakeven" : has("tighten") ? "tightened" : "never_moved";
  return { moves: out, cls };
}
