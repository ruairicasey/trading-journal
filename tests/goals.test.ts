import { describe, expect, test } from "vitest";
import { goalsSet, monthBounds, monthGoals, type GoalTrade, type Goals } from "@/lib/analytics/goals";

const TZ = "Australia/Melbourne";
const off: Goals = { goalMonthlyNet: null, goalMonthlyTrades: null, goalReviewPct: null };
// 20 Nov 2026, 12:00 in Melbourne (UTC+11): two-thirds of November gone
const NOW = Date.UTC(2026, 10, 20, 1);
const at = (y: number, m: number, d: number, h = 12) => new Date(Date.UTC(y, m - 1, d, h - 11)).getTime();
const tr = (entry: number, exit: number, net: number, reviewed = false): GoalTrade => ({
  entryTime: entry,
  exitTime: exit,
  netPnl: net,
  reviewed,
});

describe("monthBounds", () => {
  test("local calendar months, DST-safe", () => {
    const nov = monthBounds(NOW, TZ);
    expect(nov.key).toBe("2026-11");
    expect(nov.start).toBe(Date.UTC(2026, 9, 31, 13)); // 1 Nov 00:00 AEDT
    expect(nov.end).toBe(Date.UTC(2026, 10, 30, 13));
    // April starts in AEST (UTC+10), after DST ends
    expect(monthBounds(NOW, TZ, -7)).toMatchObject({ key: "2026-04", start: Date.UTC(2026, 2, 31, 13) });
    expect(monthBounds(NOW, TZ, 2).key).toBe("2027-01");
  });
});

describe("days left", () => {
  test("calendar days counting today, also across the April DST change", () => {
    const g = (ts: number) => monthGoals([], [], TZ, { ...off, goalReviewPct: 1 }, ts).current.daysLeft;
    expect(g(Date.UTC(2026, 3, 1, 13, 30))).toBe(29); // 2 Apr 00:30 AEDT
    expect(g(Date.UTC(2026, 3, 30, 13, 59))).toBe(1); // 30 Apr 23:59 AEST
    expect(g(Date.UTC(2026, 9, 31, 13))).toBe(30); // 1 Nov 00:00 AEDT
  });
});

describe("monthGoals", () => {
  test("goalsSet only when one is set", () => {
    expect(goalsSet(off)).toBe(false);
    expect(goalsSet({ ...off, goalReviewPct: 50 })).toBe(true);
  });

  test("this month: net by exit, trades by entry (open count), reviews over closed", () => {
    const ts = [
      tr(at(2026, 10, 30), at(2026, 11, 2), 500, true), // opened in October, closed in November
      tr(at(2026, 11, 3), at(2026, 11, 4), -100),
      tr(at(2026, 11, 5), at(2026, 12, 1, 1), 999), // closes next month... not this one
    ];
    const g = monthGoals(
      ts,
      [at(2026, 11, 10)],
      TZ,
      { goalMonthlyNet: 600, goalMonthlyTrades: 4, goalReviewPct: 50 },
      NOW,
    );
    const c = g.current;
    expect(c).toMatchObject({ key: "2026-11", net: 400, opened: 3, closed: 2, reviewed: 1, daysLeft: 11 });
    // 400 ≥ 600 × 19.5/30 = 390: on pace
    expect(c.netGoal).toMatchObject({ target: 600, state: "on-pace" });
    expect(c.tradesGoal).toEqual({ cap: 4, state: "near" });
    expect(c.reviewGoal).toEqual({ target: 50, pct: 50, met: true });
  });

  test("net states compare in cents; trades at and over the cap; a cap of one is never near", () => {
    const a = tr(at(2026, 11, 1), at(2026, 11, 1, 13), 0.7);
    const b = tr(at(2026, 11, 2), at(2026, 11, 2, 13), 0.1);
    const g = monthGoals([a, b], [], TZ, { ...off, goalMonthlyNet: 0.8, goalMonthlyTrades: 2 }, NOW);
    expect(g.current.netGoal!.state).toBe("met");
    expect(g.current.tradesGoal!.state).toBe("at");
    expect(
      monthGoals([a, b], [at(2026, 11, 3)], TZ, { ...off, goalMonthlyTrades: 2 }, NOW).current.tradesGoal!
        .state,
    ).toBe("over");
    expect(monthGoals([], [], TZ, { ...off, goalMonthlyTrades: 1 }, NOW).current.tradesGoal!.state).toBe(
      "ok",
    );
    expect(monthGoals([], [], TZ, { ...off, goalMonthlyNet: 100 }, NOW).current.netGoal!.state).toBe(
      "behind",
    );
    expect(monthGoals([], [], TZ, { ...off, goalReviewPct: 50 }, NOW).current.reviewGoal).toEqual({
      target: 50,
      pct: null,
      met: false,
    });
  });

  test("history: last six full months from the first trade; empty months count for net and trades, not reviews", () => {
    const ts = [
      tr(at(2026, 6, 3), at(2026, 6, 4), 300, true), // June: net hit, reviewed
      tr(at(2026, 7, 3), at(2026, 7, 4), 50), // July: net missed, not reviewed
      tr(at(2026, 9, 3), at(2026, 9, 4), 200),
      tr(at(2026, 9, 5), at(2026, 9, 6), 200),
      tr(at(2026, 9, 7), at(2026, 9, 8), 200), // September: 3 opened, over a cap of 2
    ];
    const h = monthGoals(
      ts,
      [],
      TZ,
      { goalMonthlyNet: 100, goalMonthlyTrades: 2, goalReviewPct: 100 },
      NOW,
    ).history;
    // Oct, Sep, Aug, Jul, Jun (May is before the first trade)
    expect(h.months).toBe(5);
    expect(h.net).toEqual({ hit: 2, of: 5 }); // Jun, Sep
    expect(h.trades).toEqual({ hit: 4, of: 5 }); // all but Sep
    expect(h.review).toEqual({ hit: 1, of: 3 }); // Jun of Jun, Jul, Sep
  });

  test("history stops at the journal start; a month it cuts into is skipped", () => {
    const ts = [tr(at(2026, 1, 3), at(2026, 1, 4), 300)];
    const apr1 = Date.UTC(2026, 2, 31, 13);
    expect(monthGoals(ts, [], TZ, { ...off, goalMonthlyNet: 1 }, NOW, apr1).history.months).toBe(6); // May–Oct
    const sep15 = at(2026, 9, 15, 0);
    expect(monthGoals(ts, [], TZ, { ...off, goalMonthlyNet: 1 }, NOW, sep15).history.months).toBe(1); // Oct only
    expect(monthGoals([], [], TZ, { ...off, goalMonthlyNet: 1 }, NOW).history.months).toBe(0);
  });
});
