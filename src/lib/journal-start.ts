/**
 * "Journal starts on": an account setting that hides trades opened before a date from every view by default (stats,
 * scores, insights, calendar, reports, the trade list, the balance curve). The "All time" period ignores it, and so does
 * a custom date range on the dashboard, Analytics and Reports (the Trades page's date filters combine with it). Nothing is deleted or changed, and sync is unaffected: this is purely a view filter.
 *
 * Rule: a trade belongs to the journal when it was OPENED at or after the start (entry time). The period's own range
 * (by exit time) then applies as before, and the balance curve / daily returns start no earlier than the start.
 */

/** The period id that ignores the journal start. */
export const ALL_TIME = "all";
/** The period from the journal start to now (the default where "all" used to be, when a start is set). */
export const SINCE_START = "start";

/** The floor for a view: the journal start, or null when the view looks past it (All time, a custom range). */
export function journalFloor(journalStart: number | null | undefined, period: string): number | null {
  if (journalStart === null || journalStart === undefined) return null;
  return period === ALL_TIME || period === "custom" ? null : journalStart;
}

/** Keeps trades opened at or after the floor (a trade with no entry time is kept only without a floor). */
export function fromFloor<T extends { entryTime: number | null }>(xs: T[], floor: number | null): T[] {
  return floor === null ? xs : xs.filter((t) => t.entryTime !== null && t.entryTime >= floor);
}

/** A range start raised to the floor. */
export const clampStart = (start: number | null, floor: number | null) =>
  floor === null ? start : start === null ? floor : Math.max(start, floor);

/**
 * The account's balance at the floor when there's no ledger: the starting balance plus the net of every closed trade
 * the floor hides (so the curve, drawdown and daily returns start at the real figure, not the bare starting balance).
 */
// A hidden trade that closes after the floor is booked in the base too (so later balances stay right), at the cost of
// showing its P&L from the start date rather than its exit. Accounts with a ledger use the real balance instead.
export function baseAtFloor(
  all: { entryTime: number | null; netPnl: number }[],
  floor: number | null,
  startingBalance: number,
): number {
  if (floor === null) return startingBalance;
  return all.reduce(
    (a, t) => (t.entryTime !== null && t.entryTime >= floor ? a : a + t.netPnl),
    startingBalance,
  );
}
