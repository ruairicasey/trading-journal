/**
 * Monthly goals (per account, Settings → Accounts): a realised net target, a most-trades cap and a review target.
 * Pure: no DB, no I/O.
 *
 * - Months are calendar months in your timezone. Net counts trades CLOSED that month (realised), trades counts those
 *   OPENED that month (open ones too, like the daily cap), review counts closed trades marked reviewed.
 * - Judged over the whole account (whatever wallet is picked), from the journal start when one is set.
 * - History: of the last six full months (none before the journal start or your first trade), how many hit each goal.
 *   A month with no closed trades has no review figure, so it doesn't count toward the review goal.
 */
import { TZDate } from "@date-fns/tz";

export type Goals = {
  goalMonthlyNet: number | null;
  goalMonthlyTrades: number | null;
  goalReviewPct: number | null;
};
export type GoalTrade = { entryTime: number | null; exitTime: number; netPnl: number; reviewed: boolean };

export const goalsSet = (g: Goals | null | undefined): g is Goals =>
  !!g && (g.goalMonthlyNet !== null || g.goalMonthlyTrades !== null || g.goalReviewPct !== null);

const cents = (x: number) => Math.round(x * 100);

export type MonthFigures = {
  /** "YYYY-MM" */
  key: string;
  start: number;
  end: number;
  net: number;
  /** trades opened in the month (open ones included) */
  opened: number;
  closed: number;
  reviewed: number;
};

export type NetState = "met" | "on-pace" | "behind";
export type TradesState = "ok" | "near" | "at" | "over";

export type MonthGoals = MonthFigures & {
  /** share of the month gone, 0–1 */
  elapsed: number;
  daysLeft: number;
  net: number;
  netGoal: { target: number; state: NetState; pace: number } | null;
  tradesGoal: { cap: number; state: TradesState } | null;
  reviewGoal: { target: number; pct: number | null; met: boolean } | null;
};

export type GoalHistory = {
  months: number;
  net: { hit: number; of: number } | null;
  trades: { hit: number; of: number } | null;
  review: { hit: number; of: number } | null;
};

/** [start, end) of the local month `offset` months from the one holding `ts`. */
export function monthBounds(ts: number, tz: string, offset = 0) {
  const d = new TZDate(ts, tz);
  const start = new TZDate(d.getFullYear(), d.getMonth() + offset, 1, tz);
  const end = new TZDate(d.getFullYear(), d.getMonth() + offset + 1, 1, tz);
  const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;
  return { key, start: start.getTime(), end: end.getTime() };
}

function figures(
  b: { key: string; start: number; end: number },
  closed: GoalTrade[],
  openEntries: number[],
): MonthFigures {
  const inM = (t: number | null) => t !== null && t >= b.start && t < b.end;
  const exits = closed.filter((t) => inM(t.exitTime));
  return {
    ...b,
    net: exits.reduce((a, t) => a + t.netPnl, 0),
    opened: closed.filter((t) => inM(t.entryTime)).length + openEntries.filter(inM).length,
    closed: exits.length,
    reviewed: exits.filter((t) => t.reviewed).length,
  };
}

const netMet = (net: number, target: number) => cents(net) >= cents(target);
const reviewPct = (m: MonthFigures) => (m.closed ? (m.reviewed / m.closed) * 100 : null);

export function monthGoals(
  closed: GoalTrade[],
  openEntries: number[],
  tz: string,
  goals: Goals,
  now: number,
  floor: number | null = null,
): { current: MonthGoals; history: GoalHistory } {
  const b = monthBounds(now, tz);
  const f = figures(b, closed, openEntries);
  const elapsed = Math.min(1, Math.max(0, (now - b.start) / (b.end - b.start)));
  // calendar days left counting today (a day lost or gained to daylight saving doesn't change the count)
  const today = new TZDate(now, tz).getDate();
  const lastDay = new TZDate(b.end - 1, tz).getDate();
  const daysLeft = lastDay - today + 1;

  const g = goals;
  const netGoal =
    g.goalMonthlyNet === null
      ? null
      : {
          target: g.goalMonthlyNet,
          pace: g.goalMonthlyNet * elapsed,
          state: (netMet(f.net, g.goalMonthlyNet)
            ? "met"
            : cents(f.net) >= cents(g.goalMonthlyNet * elapsed)
              ? "on-pace"
              : "behind") as NetState,
        };
  const cap = g.goalMonthlyTrades;
  const tradesGoal =
    cap === null
      ? null
      : {
          cap,
          state: (f.opened > cap
            ? "over"
            : f.opened === cap
              ? "at"
              : cap > 1 && cap - f.opened === 1
                ? "near"
                : "ok") as TradesState,
        };
  const pct = reviewPct(f);
  const reviewGoal =
    g.goalReviewPct === null
      ? null
      : { target: g.goalReviewPct, pct, met: pct !== null && pct >= g.goalReviewPct };

  // the last six full months, none before the journal start or the first trade
  const first = Math.min(
    ...closed.map((t) => t.entryTime ?? t.exitTime),
    ...openEntries,
    Number.POSITIVE_INFINITY,
  );
  const from = Math.max(floor ?? Number.NEGATIVE_INFINITY, first);
  const past: MonthFigures[] = [];
  for (let i = 1; i <= 6; i++) {
    const m = monthBounds(now, tz, -i);
    if (!Number.isFinite(from) || m.end <= from) break;
    // a month the journal start cuts into is partial: skip it
    if (floor !== null && m.start < floor) break;
    past.push(figures(m, closed, openEntries));
  }
  const tally = (ok: (m: MonthFigures) => boolean | null) => {
    let hit = 0;
    let of = 0;
    for (const m of past) {
      const r = ok(m);
      if (r === null) continue;
      of++;
      if (r) hit++;
    }
    return { hit, of };
  };

  return {
    current: { ...f, elapsed, daysLeft, netGoal, tradesGoal, reviewGoal },
    history: {
      months: past.length,
      net: g.goalMonthlyNet === null ? null : tally((m) => netMet(m.net, g.goalMonthlyNet!)),
      trades: cap === null ? null : tally((m) => m.opened <= cap),
      review:
        g.goalReviewPct === null
          ? null
          : tally((m) => {
              const p = reviewPct(m);
              return p === null ? null : p >= g.goalReviewPct!;
            }),
    },
  };
}
