import { describe, expect, test } from "vitest";
import { bucketOf, groupBy } from "@/lib/analytics/group";
import { setupBreakdowns } from "@/lib/analytics/setup";
import type { AnalyticsTrade } from "@/lib/analytics/types";

let n = 0;
const T0 = Date.UTC(2026, 9, 5);
function tr(net: number, o: Partial<AnalyticsTrade> = {}): AnalyticsTrade {
  n++;
  return {
    id: `t${n}`,
    coin: "BTC",
    displayPair: "BTC/USD",
    direction: "long",
    netPnl: net,
    fees: 1,
    notionalUsd: 10_000, // BE band = $5
    entryTime: T0 + n * 3_600_000,
    exitTime: T0 + n * 3_600_000 + 60_000,
    r: null,
    tradeType: null,
    grade: null,
    strategyId: null,
    strategy: null,
    htf: [],
    confluences: [],
    ...o,
  };
}

describe("buckets", () => {
  test("win rate excludes breakevens; R only from trades with a stop; small samples flagged", () => {
    const b = bucketOf("k", "K", [tr(100, { r: 1 }), tr(-50, { r: -0.5 }), tr(2), tr(30)], 5);
    expect(b).toMatchObject({ n: 4, wins: 2, losses: 1, breakeven: 1, net: 82, rCount: 2, small: true });
    expect(b.winRate).toBeCloseTo(2 / 3, 12);
    expect(b.avgR).toBeCloseTo(0.25, 12);
    expect(b.avgTrade).toBeCloseTo(20.5, 12);
    expect(bucketOf("k", "K", Array.from({ length: 5 }, () => tr(10)), 5).small).toBe(false);
  });

  test("multi-key grouping counts a trade in each of its buckets; fixed order is respected", () => {
    const trades = [tr(10, { confluences: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }), tr(-10, { confluences: [{ id: "b", label: "B" }] })];
    const g = groupBy(trades, (t) => t.confluences.map((c) => ({ key: c.id, label: c.label })), { minN: 1 });
    expect(g.map((x) => [x.key, x.n])).toEqual([
      ["b", 2],
      ["a", 1],
    ]);
    const ordered = groupBy(trades, (t) => ({ key: t.netPnl > 0 ? "up" : "down", label: "" }), { order: ["up", "down"] });
    expect(ordered.map((x) => x.key)).toEqual(["up", "down"]);
  });
});

describe("setup breakdowns", () => {
  const trades = [
    tr(100, { r: 1, direction: "long", grade: "A+", tradeType: "planned", htf: ["4H", "1D"], confluences: [{ id: "v", label: "VWAP" }] }),
    tr(-50, { r: -1, direction: "short", grade: "B", tradeType: "reactive", htf: ["1D", "4H"] }),
    tr(80, { r: 2, coin: "ETH", displayPair: "ETH/USD", grade: "A+", htf: ["1D"], strategyId: "s1", strategy: "Breakout" }),
    tr(-20, { r: -0.5, coin: "ETH", displayPair: "ETH/USD", confluences: [1, 2, 3, 4, 5, 6].map((i) => ({ id: `c${i}`, label: `C${i}` })) }),
  ];
  const b = setupBreakdowns(trades, { minN: 2 });

  test("pair, direction, planned vs reactive, grade (A+…D then Not set), strategy", () => {
    expect(b.pair.buckets.map((x) => [x.label, x.n, x.net])).toEqual([
      ["BTC/USD", 2, 50],
      ["ETH/USD", 2, 60],
    ]);
    expect(b.direction.buckets.map((x) => [x.key, x.n])).toEqual([
      ["long", 3],
      ["short", 1],
    ]);
    expect(b["trade-type"].buckets.map((x) => x.key)).toEqual(["planned", "reactive", "__none"]);
    expect(b.grade.buckets.map((x) => [x.key, x.n, x.avgR])).toEqual([
      ["A+", 2, 1.5],
      ["B", 1, -1],
      ["__none", 1, -0.5],
    ]);
    expect(b.strategy.buckets.find((x) => x.key === "s1")?.label).toBe("Breakout");
    expect(b.pair.total).toBe(4);
  });

  test("confluence count caps at 5+, HTF combos ignore order, HTF timeframes follow the timeframe order", () => {
    expect(b["confluence-count"].buckets.map((x) => [x.label, x.n])).toEqual([
      ["0 confluences", 2],
      ["1 confluence", 1],
      ["5+ confluences", 1],
    ]);
    expect(b["htf-combo"].buckets.map((x) => [x.label, x.n])).toEqual([
      ["4H + 1D", 2],
      ["1D", 1],
    ]);
    expect(b.htf.buckets.map((x) => x.key)).toEqual(["4H", "1D"]);
    expect(b["htf-count"].buckets.map((x) => [x.key, x.n])).toEqual([
      ["0", 1],
      ["1", 1],
      ["2", 2],
    ]);
  });

  test("empty input gives empty breakdowns", () => {
    const e = setupBreakdowns([]);
    expect(Object.values(e).every((x) => x.buckets.length === 0 && x.total === 0)).toBe(true);
  });
});
