import { describe, expect, test } from "vitest";
import { limitBreaches, limitsSet, todayLimits, type RiskLimits } from "@/lib/analytics/limits";
import { insights } from "@/lib/analytics/insights";
import { scores } from "@/lib/analytics/scores";
import type { AnalyticsTrade } from "@/lib/analytics/types";

const H = 3_600_000;
const M = 60_000;
const D0 = Date.UTC(2026, 0, 5); // a Monday, 00:00 UTC
let seq = 0;
function tr(entry: number, exit: number, net: number): AnalyticsTrade {
  seq++;
  return {
    id: `t${String(seq).padStart(3, "0")}`,
    displayPair: "BTC",
    direction: "long",
    netPnl: net,
    fees: 0,
    notionalUsd: 10_000, // breakeven band ±$5
    entryTime: entry,
    exitTime: exit,
    r: 1,
    coin: "BTC",
    tradeType: null,
    session: null,
    grade: "A",
    strategyId: null,
    strategy: null,
    htf: [],
    confluences: [],
    riskUsd: 100,
    riskMultiplier: null,
    maxRReached: null,
    entryRetests: null,
    rulesFollowed: "yes",
    processCompliant: null,
    slReasons: [],
    tpReasons: [],
    exitBy: "manual",
    stopClass: "never_moved",
    reviewed: false,
    hasExitReason: false,
    hasEmotions: false,
    mistakes: [],
  };
}
const off: RiskLimits = { dailyLossLimit: null, maxTradesPerDay: null, maxLossStreak: null };
const ids = (s: Set<string>) => [...s].sort();

describe("limitBreaches", () => {
  test("nothing breaks when no rule is set", () => {
    const ts = [tr(D0 + H, D0 + 2 * H, -500), tr(D0 + 3 * H, D0 + 4 * H, -500)];
    expect(limitsSet(off)).toBe(false);
    expect(limitBreaches(ts, ts, "UTC", off).any.size).toBe(0);
    expect(limitBreaches(ts, ts, "UTC", null).any.size).toBe(0);
  });

  test("loss: opened after the day's realised net reached −limit; exits after the entry and other days don't count", () => {
    const a = tr(D0 + 1 * H, D0 + 2 * H, -120);
    const b = tr(D0 + 3 * H, D0 + 4 * H, -80); // day at −120 when opened: under the limit
    const c = tr(D0 + 5 * H, D0 + 6 * H, 50); // day at −200 when opened: at the limit → breaks
    const held = tr(D0 + 1.5 * H, D0 + 7 * H, -10); // opened at −0 (a exits later): fine
    const next = tr(D0 + 25 * H, D0 + 26 * H, -10); // a new day
    const ts = [a, b, c, held, next];
    const b1 = limitBreaches(ts, ts, "UTC", { ...off, dailyLossLimit: 200 });
    expect(ids(b1.loss)).toEqual([c.id]);
    expect(ids(b1.any)).toEqual([c.id]);
  });

  test("loss uses your timezone's day: a loss late on the UTC day is the next local day in Melbourne", () => {
    // 20:00 UTC Monday = 07:00 Tuesday in Melbourne (UTC+11 in January)
    const a = tr(D0 + 19 * H, D0 + 20 * H, -300);
    const b = tr(D0 + 21 * H, D0 + 22 * H, -10);
    const ts = [a, b];
    const lim = { ...off, dailyLossLimit: 200 };
    expect(ids(limitBreaches(ts, ts, "UTC", lim).loss)).toEqual([b.id]);
    expect(ids(limitBreaches(ts, ts, "Australia/Melbourne", lim).loss)).toEqual([b.id]);
    // a trade opened before Melbourne midnight (12:59 UTC) belongs to Monday there, and Monday had no loss
    const early = tr(D0 + 12 * H + 59 * M, D0 + 23 * H, -10);
    const ts2 = [a, early];
    expect(limitBreaches(ts2, ts2, "Australia/Melbourne", lim).loss.size).toBe(0);
  });

  test("trades: every entry after the day's cap, counted over all trades (even outside the period)", () => {
    const day = [1, 2, 3, 4, 5].map((h) => tr(D0 + h * H, D0 + h * H + 30 * M, 20));
    const lim = { ...off, maxTradesPerDay: 3 };
    expect(ids(limitBreaches(day, day, "UTC", lim).trades)).toEqual([day[3].id, day[4].id]);
    // judged in a period holding only the last trade, the earlier four still count
    expect(ids(limitBreaches([day[4]], day, "UTC", lim).trades)).toEqual([day[4].id]);
  });

  test("streak: N losses in a row that day; a win resets it, a breakeven doesn't, a new day starts at 0", () => {
    const l1 = tr(D0 + 1 * H, D0 + 1.5 * H, -50);
    const be = tr(D0 + 2 * H, D0 + 2.5 * H, 1);
    const l2 = tr(D0 + 3 * H, D0 + 3.5 * H, -50);
    const x = tr(D0 + 4 * H, D0 + 4.5 * H, 100); // after 2 losses (be ignored) → breaks
    const y = tr(D0 + 5 * H, D0 + 5.5 * H, -50); // after the win → fine
    const nextDay = tr(D0 + 25 * H, D0 + 25.5 * H, -50);
    const ts = [l1, be, l2, x, y, nextDay];
    expect(ids(limitBreaches(ts, ts, "UTC", { ...off, maxLossStreak: 2 }).streak)).toEqual([x.id]);
  });

  test("loss compares in cents: losses that sum to exactly the limit reach it", () => {
    const a = tr(D0 + 1 * H, D0 + 1.1 * H, -0.7);
    const b = tr(D0 + 1.2 * H, D0 + 1.3 * H, -0.1); // −0.7999999999999999 as floats
    const c = tr(D0 + 2 * H, D0 + 3 * H, -0.01);
    const ts = [a, b, c];
    expect(-0.7 + -0.1).not.toBe(-0.8);
    expect(ids(limitBreaches(ts, ts, "UTC", { ...off, dailyLossLimit: 0.8 }).loss)).toEqual([c.id]);
    expect(todayLimits([a, b], [], "UTC", { ...off, dailyLossLimit: 0.8 }, D0 + 5 * H).state).toBe("hit");
  });

  test("open trades count toward the day's cap, so history agrees with the Today card", () => {
    const b = tr(D0 + 10 * H, D0 + 11 * H, 20);
    const ts = [b];
    const open = [{ id: "open-a", entryTime: D0 + 9 * H }];
    expect(limitBreaches(ts, ts, "UTC", { ...off, maxTradesPerDay: 1 }).trades.size).toBe(0);
    expect(ids(limitBreaches(ts, ts, "UTC", { ...off, maxTradesPerDay: 1, open }).trades)).toEqual([b.id]);
  });

  test("the scope's account-wide context wins over a wallet-filtered one", () => {
    const other = tr(D0 + 1 * H, D0 + 2 * H, -300); // the account's other wallet
    const mine = tr(D0 + 3 * H, D0 + 4 * H, -10);
    const lim = { ...off, dailyLossLimit: 200 };
    expect(limitBreaches([mine], [mine], "UTC", lim).loss.size).toBe(0);
    expect(ids(limitBreaches([mine], [mine], "UTC", { ...lim, context: [other, mine] }).loss)).toEqual([
      mine.id,
    ]);
  });

  test("any is the union; a trade breaking two rules counts once", () => {
    const a = tr(D0 + 1 * H, D0 + 2 * H, -300);
    const b = tr(D0 + 3 * H, D0 + 4 * H, -10);
    const ts = [a, b];
    const r = limitBreaches(ts, ts, "UTC", { dailyLossLimit: 100, maxTradesPerDay: 1, maxLossStreak: 1 });
    expect(ids(r.loss)).toEqual([b.id]);
    expect(ids(r.trades)).toEqual([b.id]);
    expect(ids(r.streak)).toEqual([b.id]);
    expect(ids(r.any)).toEqual([b.id]);
  });
});

describe("insight and discipline", () => {
  const day = [1, 2, 3, 4, 5, 6].map((h) => tr(D0 + h * H, D0 + h * H + 30 * M, -40));
  const lim = { ...off, maxTradesPerDay: 2 };

  test("Past your limits is listed only when a rule is set, with the breaking trades' net", () => {
    expect(insights(day, day, "UTC").list.find((i) => i.id === "limits")).toBeUndefined();
    const i = insights(day, day, "UTC", lim).list.find((x) => x.id === "limits")!;
    expect(i.n).toBe(4);
    expect(i.impact).toBe(-160);
    expect(i.detail).toContain("2 trades");
  });

  test("within-limits joins discipline only when a rule is set", () => {
    const without = scores(day, day, "UTC");
    expect(without.discipline.checks["within-limits"]).toEqual({ passed: 0, of: 0 });
    const withRule = scores(day, day, "UTC", lim);
    expect(withRule.discipline.checks["within-limits"]).toEqual({ passed: 2, of: 6 });
    // the other five checks are unchanged; the score takes the extra check into its average
    const passed = (s: typeof withRule) =>
      Object.values(s.discipline.checks).reduce((a, c) => a + c.passed, 0);
    expect(without.discipline.score).toBeCloseTo((passed(without) / 30) * 100, 6);
    expect(withRule.discipline.score).toBeCloseTo((passed(withRule) / 36) * 100, 6);
  });
});

describe("todayLimits", () => {
  const now = D0 + 10 * H;
  test("counts today's exits, today's entries (closed and open) and the current run", () => {
    const y = tr(D0 - 2 * H, D0 - H, -500); // yesterday
    const a = tr(D0 + 1 * H, D0 + 2 * H, -90);
    const b = tr(D0 + 3 * H, D0 + 4 * H, -70);
    const t = todayLimits(
      [y, a, b],
      [D0 + 5 * H, D0 - 3 * H],
      "UTC",
      {
        dailyLossLimit: 200,
        maxTradesPerDay: 4,
        maxLossStreak: 3,
      },
      now,
    );
    expect(t).toMatchObject({ net: -160, trades: 3, streak: 2, state: "near" });
    expect(t.loss).toMatchObject({ state: "near", used: 0.8 }); // 160 of 200 ≥ 75%
    expect(t.count).toMatchObject({ state: "near" }); // one trade left
    expect(t.run).toMatchObject({ state: "near" }); // one loss away
  });

  test("hit when the next trade would break a rule; ok when far from all; unset rules are null", () => {
    const a = tr(D0 + 1 * H, D0 + 2 * H, -250);
    expect(todayLimits([a], [], "UTC", { ...off, dailyLossLimit: 200 }, now)).toMatchObject({
      state: "hit",
      count: null,
      run: null,
    });
    const w = tr(D0 + 1 * H, D0 + 2 * H, 100);
    expect(todayLimits([w], [], "UTC", { ...off, maxTradesPerDay: 5, maxLossStreak: 3 }, now).state).toBe(
      "ok",
    );
    // a cap of one is never "near": it's ok before the trade and hit after
    expect(todayLimits([], [], "UTC", { ...off, maxTradesPerDay: 1 }, now).state).toBe("ok");
    expect(todayLimits([], [D0 + H], "UTC", { ...off, maxTradesPerDay: 1 }, now).state).toBe("hit");
  });
});
