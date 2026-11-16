import { describe, expect, test } from "vitest";
import { drawdownStats, sliceUnderwater, underwaterSeries } from "@/lib/drawdown";

const DAY = 86_400_000;
const T = Date.UTC(2026, 0, 5);
const tr = (day: number, net: number, r: number | null = null) => ({ exitTime: T + day * DAY, netPnl: net, r });

describe("underwater series", () => {
  test("tracks the running peak; drawdown is ≤ 0 and relative to the peak", () => {
    const s = underwaterSeries([tr(1, 100), tr(2, -50), tr(3, -30), tr(4, 200)], 1000);
    expect(s.map((p) => p.equity)).toEqual([1000, 1100, 1050, 1020, 1220]);
    expect(s.map((p) => p.dd)).toEqual([0, 0, -50, -80, 0]);
    expect(s[3].ddPct).toBeCloseTo((-80 / 1100) * 100, 10);
  });

  test("sorts by exit time and handles an empty history", () => {
    expect(underwaterSeries([], 1000)).toEqual([]);
    const s = underwaterSeries([tr(2, -10), tr(1, 50)], 0);
    expect(s.map((p) => p.equity)).toEqual([0, 50, 40]);
  });

  test("% is null when the peak equity is not positive", () => {
    const s = underwaterSeries([tr(1, -100), tr(2, -50)], 0);
    expect(s.every((p) => p.ddPct === null)).toBe(true);
    expect(s.at(-1)!.dd).toBe(-150);
  });

  test("with a $0 starting balance % is always null, even after profits (a % of profit isn't a drawdown)", () => {
    const s = underwaterSeries([tr(1, 150), tr(2, -2_000), tr(3, 100)], 0);
    expect(s.map((p) => p.ddPct)).toEqual([null, null, null, null]);
    expect(s.map((p) => p.dd)).toEqual([0, 0, -2_000, -1_900]);
    const st = drawdownStats(s, { now: T + 5 * DAY })!;
    expect(st.current.ddPct).toBeNull();
    expect(st.max!.ddPct).toBeNull();
    expect(st.maxPct).toBeNull();
    expect(st.current.recoverPct).toBeNull();
  });

  test("below zero equity the % stops (no −1300%); at exactly zero it is −100%", () => {
    const s = underwaterSeries([tr(1, -1_000), tr(2, -500)], 1_000);
    expect(s.map((p) => p.ddPct)).toEqual([0, -100, null]);
  });

  test("R drawdown uses cumulative R; trades without a stop count as 0R", () => {
    const s = underwaterSeries([tr(1, 10, 2), tr(2, -10, -1), tr(3, -5, null), tr(4, -10, -1.5)], 1000);
    expect(s.map((p) => p.ddR)).toEqual([0, 0, -1, -1, -2.5]);
  });
});

describe("drawdown stats", () => {
  const series = underwaterSeries([tr(1, 500), tr(2, -200), tr(3, -300), tr(4, 600), tr(5, -100), tr(6, -150)], 1000);
  // equity: 1000 → 1500 → 1300 → 1000 → 1600 → 1500 → 1350

  test("current drawdown, recovery %, days and trades since the peak", () => {
    const st = drawdownStats(series, { now: T + 10 * DAY })!;
    expect(st.current).toMatchObject({ equity: 1350, peak: 1600, peakAt: T + 4 * DAY, dd: -250, daysInDrawdown: 6, tradesSincePeak: 2 });
    expect(st.current.ddPct).toBeCloseTo(-15.625, 10);
    expect(st.current.recoverPct).toBeCloseTo((1600 / 1350 - 1) * 100, 10);
  });

  test("max drawdown with peak, trough and recovery dates", () => {
    const st = drawdownStats(series, { now: T + 10 * DAY })!;
    expect(st.max).toEqual({ dd: -500, ddPct: (-500 / 1500) * 100, peakAt: T + DAY, troughAt: T + 3 * DAY, recoveredAt: T + 4 * DAY });
    expect(st.maxPct).toBeCloseTo((-500 / 1500) * 100, 10);
  });

  test("a period window only considers troughs inside it, but keeps the older peak", () => {
    const st = drawdownStats(series, { from: T + 4.5 * DAY, now: T + 10 * DAY })!;
    expect(st.max).toMatchObject({ dd: -250, peakAt: T + 4 * DAY, troughAt: T + 6 * DAY, recoveredAt: null });
  });

  test("at a new high there is no current drawdown", () => {
    const st = drawdownStats(underwaterSeries([tr(1, -100), tr(2, 300)], 1000), { now: T + 5 * DAY })!;
    expect(st.current).toMatchObject({ dd: 0, recoverPct: 0, daysInDrawdown: 0, tradesSincePeak: 0 });
    expect(st.max?.recoveredAt).toBe(T + 2 * DAY);
  });

  test("the deepest % can differ from the deepest $", () => {
    const s = underwaterSeries([tr(1, -400), tr(2, 10_400), tr(3, -1000)], 1000);
    const st = drawdownStats(s, { now: T + 5 * DAY })!;
    expect(st.max!.dd).toBe(-1000);
    expect(st.maxPct).toBeCloseTo(-40, 10); // 1000 → 600
  });

  test("max R drawdown", () => {
    const s = underwaterSeries([tr(1, 1, 3), tr(2, -1, -1), tr(3, -1, -1), tr(4, 1, 0.5)], 0);
    expect(drawdownStats(s, { now: T })!.maxR).toEqual({ ddR: -2, peakAt: T + DAY, troughAt: T + 3 * DAY });
  });
});

test("a period slice starts at the level carried into it", () => {
  const s = underwaterSeries([tr(1, 100), tr(2, -50), tr(5, -10)], 1000);
  const cut = sliceUnderwater(s, T + 3 * DAY);
  expect(cut.map((p) => [p.t, p.dd])).toEqual([
    [T + 3 * DAY, -50],
    [T + 5 * DAY, -60],
  ]);
  expect(sliceUnderwater(s, T + 9 * DAY)).toEqual([]);
  expect(sliceUnderwater(s, null)).toBe(s);
});
