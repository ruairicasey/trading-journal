/**
 * Win / loss / breakeven. A trade is BREAKEVEN when |net| is within max($1, 0.05% of notional).
 * Defined once here and mirrored in SQL by `outcomeSql` (src/server/db/queries/trades.ts).
 */
export const BE_MIN_USD = 1;
export const BE_NOTIONAL_FRACTION = 0.0005;

export type Outcome = "win" | "loss" | "be";

export function beBand(notional: number | null | undefined) {
  return Math.max(BE_MIN_USD, Math.abs(notional ?? 0) * BE_NOTIONAL_FRACTION);
}

export function outcomeOf(net: number | null | undefined, notional: number | null | undefined): Outcome | null {
  if (net === null || net === undefined) return null;
  const band = beBand(notional);
  return net > band ? "win" : net < -band ? "loss" : "be";
}

/** R-multiple: net / initial risk, where risk = |entry − stop| × size. Null without a stop. */
export function rMultiple(t: { netPnl: number | null; avgEntry: number | null; sizeUnits: number | null; stopLoss: number | null }) {
  if (t.netPnl == null || t.avgEntry == null || t.sizeUnits == null || t.stopLoss == null) return null;
  const risk = Math.abs(t.avgEntry - t.stopLoss) * t.sizeUnits;
  return risk > 0 ? t.netPnl / risk : null;
}
