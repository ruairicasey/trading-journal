import { describe, expect, test } from "vitest";
import { calendarMonth, computeKpis, equityCurve, type ClosedTrade } from "@/lib/stats";

const T = (net: number, exitIso: string, extra: Partial<ClosedTrade> = {}): ClosedTrade => ({
  id: Math.random().toString(36).slice(2),
  displayPair: "BTC/USD",
  direction: "long",
  netPnl: net,
  fees: 1,
  notionalUsd: 10_000,
  entryTime: Date.parse(exitIso) - 3_600_000,
  exitTime: Date.parse(exitIso),
  r: null,
  ...extra,
});

describe("KPIs", () => {
  test("win rate excludes breakevens; profit factor, averages, R only from trades with a stop", () => {
    const k = computeKpis([
      T(300, "2026-11-02T01:00:00Z", { r: 2 }),
      T(-100, "2026-11-03T01:00:00Z", { r: -1 }),
      T(-50, "2026-11-04T01:00:00Z"),
      T(2, "2026-11-05T01:00:00Z"), // within the $5 BE band (0.05% of 10k)
      T(150, "2026-11-06T01:00:00Z", { r: 1.5 }),
    ]);
    expect(k).toMatchObject({ count: 5, net: 302, fees: 5, wins: 2, losses: 2, breakeven: 1, best: 300, worst: -100, rCount: 3 });
    expect(k.winRate).toBe(0.5);
    expect(k.profitFactor).toBeCloseTo(450 / 150, 12);
    expect(k.avgWin).toBe(225);
    expect(k.avgLoss).toBe(-75);
    expect(k.avgTrade).toBeCloseTo(60.4, 12);
    expect(k.totalR).toBe(2.5);
    expect(k.avgR).toBeCloseTo(2.5 / 3, 12);
    expect(k.since).toBe(Date.parse("2026-11-02T01:00:00Z"));
  });

  test("edge cases: empty, all wins", () => {
    expect(computeKpis([])).toMatchObject({ count: 0, winRate: null, profitFactor: null, avgTrade: null, totalR: null });
    expect(computeKpis([T(100, "2026-11-02T01:00:00Z")]).profitFactor).toBe(Infinity);
  });
});

describe("equity curve", () => {
  const trades = [T(100, "2026-10-01T00:00:00Z", { r: 1 }), T(-40, "2026-11-02T00:00:00Z", { r: -1 }), T(60, "2026-11-05T00:00:00Z")];

  test("all-time starts at the starting balance", () => {
    const pts = equityCurve(trades, 10_000, null);
    expect(pts.map((p) => p.equity)).toEqual([10_000, 10_100, 10_060, 10_120]);
    expect(pts.map((p) => p.cumR)).toEqual([0, 1, 0, 0]);
  });

  test("a period starts at the equity realised before it", () => {
    const from = Date.parse("2026-11-01T00:00:00Z");
    const pts = equityCurve(trades, 10_000, from);
    expect(pts[0]).toMatchObject({ t: from, equity: 10_100, cumR: 0 });
    expect(pts.map((p) => p.equity)).toEqual([10_100, 10_060, 10_120]);
    expect(equityCurve(trades, 10_000, Date.parse("2027-01-01T00:00:00Z"))).toEqual([]);
  });
});

describe("P&L calendar", () => {
  test("Monday-first weeks, days by exit date in Melbourne, weekly and monthly totals", () => {
    const tz = "Australia/Melbourne";
    const cal = calendarMonth(
      [
        T(100, "2026-10-31T14:30:00Z", { r: 1 }), // 1 Nov 01:30 AEDT
        T(-30, "2026-11-01T12:00:00Z"), // 1 Nov 23:00 AEDT
        T(50, "2026-11-01T13:30:00Z", { r: 0.5 }), // 2 Nov 00:30 AEDT
        T(999, "2026-10-30T00:00:00Z"), // October: excluded
      ],
      2026,
      11,
      tz,
    );
    // Nov 2026 starts on a Sunday → first row is Mon 26 Oct … Sun 1 Nov
    expect(cal.weeks[0].days[0]).toMatchObject({ date: "2026-10-26", inMonth: false });
    expect(cal.weeks[0].days[6]).toMatchObject({ date: "2026-11-01", inMonth: true, net: 70, count: 2, r: 1, rCount: 1 });
    expect(cal.weeks[0]).toMatchObject({ net: 70, count: 2 }); // October padding days contribute nothing
    expect(cal.weeks[1].days[0]).toMatchObject({ date: "2026-11-02", net: 50, count: 1 });
    expect(cal.weeks).toHaveLength(6); // Nov 2026 spans 6 Monday-first rows
    expect(cal.weeks.at(-1)!.days.at(-1)!.date).toBe("2026-12-06");
    expect(cal).toMatchObject({ net: 120, count: 3, maxAbs: 70 });
    expect(cal.r).toBeCloseTo(1.5, 12);
  });
});

describe("equity axis dates", () => {
  test("adds the year once the range spans more than a year", async () => {
    const { axisDateFormat } = await import("@/lib/format");
    const t = Date.parse("2026-03-05T03:00:00Z");
    expect(axisDateFormat(200 * 86_400_000, "Australia/Melbourne").format(t)).toBe("05 Mar");
    expect(axisDateFormat(400 * 86_400_000, "Australia/Melbourne").format(t)).toBe("Mar 2026");
  });
});
