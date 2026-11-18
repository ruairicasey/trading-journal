import { describe, expect, test } from "vitest";
import { balanceSteps, computeRisk, dailyReturns, riskMetrics, type DayReturn } from "@/lib/risk";
import type { ClosedTrade } from "@/lib/stats";

const TZ = "UTC";
const D = 86_400_000;
const T0 = Date.UTC(2026, 2, 1); // 1 Mar 2026
const at = (day: number, h = 12) => T0 + day * D + h * 3_600_000;
let k = 0;
const tr = (net: number, exitTime: number, r: number | null = null): ClosedTrade => ({
  id: `t${++k}`,
  displayPair: "BTC",
  direction: "long",
  netPnl: net,
  fees: 0,
  notionalUsd: 10_000,
  entryTime: exitTime - 3_600_000,
  exitTime,
  r,
});

describe("dailyReturns", () => {
  test("deposits and withdrawals are not returns; days at $0 are skipped", () => {
    const steps = balanceSteps(
      [
        { t: at(0, 1), usd: 1000 }, // deposit
        { t: at(2, 9), usd: 1000 }, // another deposit, same day as a +50 trade
        { t: at(4, 9), usd: -2150 }, // withdraw everything (2,000 in + 150 made)
      ],
      [
        { t: at(1), usd: 100 }, // +10% on 1,000
        { t: at(2, 15), usd: 50 }, // +50 on 1,100 + 1,000 deposited that day
      ],
    );
    const days = dailyReturns(steps, { from: T0, to: at(7, 0), tz: TZ });
    const by = Object.fromEntries(days.map((d) => [d.date, d]));
    expect(by["2026-03-01"]).toMatchObject({ capital: 1000, pnl: 0, r: 0 }); // the deposit day: 0%, not +∞
    expect(by["2026-03-02"]).toMatchObject({ capital: 1000, pnl: 100, r: 0.1 });
    expect(by["2026-03-03"].capital).toBe(2100);
    expect(by["2026-03-03"].r).toBeCloseTo(50 / 2100);
    expect(by["2026-03-05"]).toMatchObject({ pnl: 0, r: 0 }); // the withdrawal day: no gain or loss
    expect(by["2026-03-06"]).toBeUndefined(); // $0 at work
    expect(days.map((d) => d.date)).toEqual([
      "2026-03-01",
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
    ]);
  });

  test("days are local: a trade at 23:30 UTC lands on the next day in Melbourne", () => {
    const steps = balanceSteps([{ t: T0 - D, usd: 1000 }], [{ t: Date.UTC(2026, 2, 1, 23, 30), usd: 10 }]);
    const utc = dailyReturns(steps, { from: T0, to: T0 + 3 * D, tz: "UTC" });
    const mel = dailyReturns(steps, { from: T0, to: T0 + 3 * D, tz: "Australia/Melbourne" });
    expect(utc.find((d) => d.pnl !== 0)!.date).toBe("2026-03-01");
    expect(mel.find((d) => d.pnl !== 0)!.date).toBe("2026-03-02");
  });
});

describe("dailyReturns: edges", () => {
  test("a period starting mid-day (7D): days start at the next local midnight; trade stats keep the exact period", () => {
    const steps = balanceSteps(
      [{ t: T0 - 5 * D, usd: 1000 }],
      [
        { t: at(2, 9), usd: -100 },
        { t: at(4), usd: 50 },
      ],
    );
    const from = at(2, 10); // an hour after the −100
    const days = dailyReturns(steps, { from, to: T0 + 7 * D, tz: TZ });
    expect(days[0].date).toBe("2026-03-04");
    expect(days.reduce((a, d) => a + d.pnl, 0)).toBeCloseTo(50);
    // trades: −100 before `from` (out), +20 after `from` on the partial first day (in, like the KPI card), +50 later
    const r = computeRisk(
      [tr(-100, at(2, 9)), tr(20, at(2, 15)), tr(50, at(4))],
      {
        flows: [{ t: T0 - 5 * D, usd: 1000 }],
        cash: [
          { t: at(2, 9), usd: -100 },
          { t: at(4), usd: 50 },
        ],
      },
      0,
      {
        from,
        to: null,
        tz: TZ,
        now: T0 + 7 * D,
      },
    );
    expect(r.trades).toBe(2);
    expect(r.expectancy).toBeCloseTo(35);
    expect(r.pnl).toBeCloseTo(50); // the daily returns cover whole days only
  });

  test("starts at the first balance, however early the period: no walk through empty years", () => {
    const steps = balanceSteps([{ t: at(0), usd: 1000 }], []);
    const t = performance.now();
    const days = dailyReturns(steps, { from: Date.UTC(1900, 0, 1), to: at(3), tz: TZ });
    expect(performance.now() - t).toBeLessThan(50);
    expect(days[0].date).toBe("2026-03-01");
  });

  test("daylight saving: Melbourne days stay whole across 5 Apr and 4 Oct 2026", () => {
    const tz = "Australia/Melbourne";
    const steps = balanceSteps(
      [{ t: Date.UTC(2026, 3, 1), usd: 1000 }],
      [
        { t: Date.UTC(2026, 3, 5, 13, 30), usd: 10 }, // 23:30 AEST on 5 Apr (the 25-hour day)
        { t: Date.UTC(2026, 9, 3, 13, 30), usd: 20 }, // 23:30 AEST on 3 Oct
        { t: Date.UTC(2026, 9, 4, 12, 30), usd: 30 }, // 23:30 AEDT on 4 Oct (the 23-hour day)
      ],
    );
    const days = dailyReturns(steps, { from: Date.UTC(2026, 3, 1), to: Date.UTC(2026, 9, 10), tz });
    const by = Object.fromEntries(days.map((d) => [d.date, d.pnl]));
    expect([by["2026-04-05"], by["2026-10-03"], by["2026-10-04"]]).toEqual([10, 20, 30]);
    expect(new Set(days.map((d) => d.date)).size).toBe(days.length); // no day twice, none skipped
  });

  test("a flow and cash in the same ms: the flow is money moved, the cash is P&L; the to cap excludes both", () => {
    const steps = balanceSteps(
      [
        { t: T0 - D, usd: 1000 },
        { t: at(1), usd: 500 },
      ],
      [
        { t: at(1), usd: 30 },
        { t: at(3), usd: 99 },
      ],
    );
    const days = dailyReturns(steps, { from: T0, to: at(3), tz: TZ });
    const d1 = days.find((d) => d.date === "2026-03-02")!;
    expect(d1).toMatchObject({ capital: 1500, pnl: 30 });
    expect(days.reduce((a, d) => a + d.pnl, 0)).toBeCloseTo(30); // the +99 at the cap is out
  });

  test("withdrawing more than the day's start balance, and a day whose capital is only that day's deposit", () => {
    // start 0; deposit 200 and lose 50 the same day; next day withdraw 150 (everything)
    const steps = balanceSteps(
      [
        { t: at(0, 1), usd: 200 },
        { t: at(1, 1), usd: -150 },
      ],
      [{ t: at(0, 5), usd: -50 }],
    );
    const days = dailyReturns(steps, { from: T0, to: at(3), tz: TZ });
    expect(days[0]).toMatchObject({ capital: 200, pnl: -50, r: -0.25 });
    expect(days[1]).toMatchObject({ capital: 150, pnl: 0 });
    expect(days).toHaveLength(2); // then $0 at work
  });
});

describe("riskMetrics", () => {
  const day = (r: number, i: number, capital = 1000): DayReturn => ({
    date: `d${i}`,
    capital,
    pnl: r * capital,
    r,
  });

  test("Sharpe, Sortino, compounded return, drawdowns against hand-computed values", () => {
    const rs = [0.02, -0.01, 0.03, -0.02, 0.01];
    const m = riskMetrics(
      rs.map((r, i) => day(r, i)),
      [],
    );
    const mean = 0.006;
    const sd = Math.sqrt(rs.reduce((a, r) => a + (r - mean) ** 2, 0) / 4);
    expect(m.sharpe).toBeCloseTo((mean / sd) * Math.sqrt(365), 10);
    const down = Math.sqrt((0.01 ** 2 + 0.02 ** 2) / 5);
    expect(m.sortino).toBeCloseTo((mean / down) * Math.sqrt(365), 10);
    const idx = rs.reduce((a, r) => a * (1 + r), 1);
    expect(m.totalReturn).toBeCloseTo(idx - 1, 12);
    expect(m.annualised).toBeNull(); // 5 days: too few to annualise
    expect(m.calmar).toBeNull();
    const long = riskMetrics(
      Array.from({ length: 30 }, (_, i) => day(rs[i % 5], i)),
      [],
    );
    const idx30 = Array.from({ length: 30 }, (_, i) => 1 + rs[i % 5]).reduce((a, x) => a * x, 1);
    expect(long.annualised).toBeCloseTo(idx30 ** (365 / 30) - 1, 8);
    expect(long.calmar).toBeCloseTo(long.annualised! / Math.abs(long.maxDrawdown!), 8);
    // peak after day 3 (1.02 × 0.99 × 1.03), then −2%: the deepest drop
    expect(m.maxDrawdown).toBeCloseTo(-0.02, 12);
    expect(m.longestDrawdownDays).toBe(2); // day 4 and day 5 are both below that peak
    // $: +20 −10 +30 −20 +10 → cum 30, deepest drop 20
    expect(m.pnl).toBeCloseTo(30);
    expect(m.recoveryFactor).toBeCloseTo(1.5);
  });

  test("trade stats: expectancy in $ and R, payoff, SQN capped at 100 trades", () => {
    const ts = [tr(100, 1, 2), tr(-50, 2, -1), tr(-50, 3, -1), tr(200, 4, 4), tr(2, 5, null)]; // the +2 is breakeven
    const m = riskMetrics([], ts);
    expect(m.expectancy).toBeCloseTo(202 / 5);
    expect(m.expectancyR).toBeCloseTo(1);
    expect(m.rCount).toBe(4);
    expect(m.payoff).toBeCloseTo(150 / 50);
    const R = [2, -1, -1, 4];
    const sdR = Math.sqrt(R.reduce((a, r) => a + (r - 1) ** 2, 0) / 3);
    expect(m.sqn).toBeCloseTo((Math.sqrt(4) * 1) / sdR, 10);
    expect(m.sharpe).toBeNull(); // no days
    expect(m.smallDays && m.smallTrades).toBe(true);

    const many = Array.from({ length: 400 }, (_, i) => tr(i % 2 ? 10 : -5, i + 10, i % 2 ? 1 : -0.5));
    const big = riskMetrics([], many);
    const meanR = 0.25;
    const sdBig = Math.sqrt(many.reduce((a, t) => a + (t.r! - meanR) ** 2, 0) / 399);
    expect(big.sqn).toBeCloseTo((10 * meanR) / sdBig, 10); // √min(400, 100) = 10
  });

  test("a flat or one-day series has no Sharpe", () => {
    expect(riskMetrics([day(0, 1), day(0, 2)], []).sharpe).toBeNull();
    expect(riskMetrics([day(0.01, 1)], []).sharpe).toBeNull();
  });
});

describe("computeRisk", () => {
  test("without a ledger it uses the starting balance + realised P&L; only trades in the period count", () => {
    const ts = [tr(100, at(0)), tr(-50, at(1)), tr(25, at(10))];
    const r = computeRisk(ts, null, 1000, { from: T0 + 5 * D, to: null, tz: TZ, now: T0 + 12 * D });
    expect(r.basis).toBe("trades");
    expect(r.trades).toBe(1);
    expect(r.pnl).toBeCloseTo(25);
    // capital before the period: 1000 + 100 − 50
    expect(r.days.find((d) => d.pnl !== 0)).toMatchObject({ capital: 1050, pnl: 25 });
    // no starting balance and no ledger: no capital, no % returns
    const none = computeRisk(ts, null, 0, { from: null, to: null, tz: TZ, now: T0 + 12 * D });
    expect(none.days).toHaveLength(0);
    expect(none.sharpe).toBeNull();
    expect(none.expectancy).toBeCloseTo(25); // trade stats still work
  });

  test("with a ledger: balance basis, and the period's trading P&L equals the cash in the period", () => {
    const bal = {
      flows: [{ t: at(0, 1), usd: 5000 }],
      cash: [
        { t: at(3), usd: -200 },
        { t: at(8), usd: 300 },
      ],
    };
    const r = computeRisk([], bal, 0, { from: T0 + 2 * D, to: null, tz: TZ, now: T0 + 12 * D });
    expect(r.basis).toBe("balance");
    expect(r.pnl).toBeCloseTo(100);
    expect(r.days[0].date).toBe("2026-03-03");
  });
});
