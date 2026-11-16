import { describe, expect, test } from "vitest";
import { behaviourBreakdowns, dailySeries, rolling, runBefore, streaks } from "@/lib/analytics/behaviour";
import { atr } from "./fixtures/analytics";

const TZ = "Australia/Melbourne";
const H = 3_600_000;
const D = 24 * H;
const T = Date.UTC(2026, 10, 8, 13); // Mon 9 Nov 2026 00:00 Melbourne
const at = (day: number, hour: number, net: number, o = {}) => atr(net, { entryTime: T + day * D + hour * H, exitTime: T + day * D + hour * H + H / 2, ...o });

describe("streaks", () => {
  // W W L L L BE L W  → longest win 2, longest loss 4 (BE doesn't break it), current win 1
  const seq = [at(0, 1, 50), at(0, 2, 20), at(0, 3, -10), at(0, 4, -10), at(0, 5, -10), at(0, 6, 1), at(0, 7, -10), at(0, 8, 40)];
  test("runs ignore breakevens; current, longest win and loss, best and worst", () => {
    const s = streaks(seq, () => true);
    expect(s.current).toMatchObject({ kind: "win", n: 1 });
    expect(s.longestWin).toMatchObject({ kind: "win", n: 2 });
    expect(s.longestLoss).toMatchObject({ kind: "loss", n: 4 });
    expect(s.best?.netPnl).toBe(50);
    expect(s.worst?.netPnl).toBe(-10);
  });

  test("a period only counts runs that ended inside it, but a run may start before it", () => {
    const s = streaks(seq, (t) => t.exitTime > T + 4.5 * H);
    expect(s.longestLoss?.n).toBe(4);
    expect(s.longestWin).toMatchObject({ n: 1 });
    expect(s.best?.netPnl).toBe(40);
  });

  test("run before each trade", () => {
    const r = runBefore(seq);
    expect(seq.map((t) => r.get(t.id))).toEqual([
      null,
      { kind: "win", n: 1 },
      { kind: "win", n: 2 },
      { kind: "loss", n: 1 },
      { kind: "loss", n: 2 },
      { kind: "loss", n: 3 },
      { kind: "loss", n: 3 }, // after the breakeven: still 3 losses in a row
      { kind: "loss", n: 4 },
    ]);
    const b = behaviourBreakdowns(seq, { tz: TZ, minN: 1 })["after-streak"];
    expect(b.buckets.map((x) => [x.key, x.n])).toEqual([
      ["loss-3", 3],
      ["loss-2", 1],
      ["loss-1", 1],
      ["win-1", 1],
      ["win-2", 1],
    ]);
    expect(b.buckets[0].label).toBe("After 3+ losses");
  });
});

describe("daily and rolling P&L", () => {
  test("one point per local day (empty days are 0); rolling sums drop days that leave the window", () => {
    const days = dailySeries([at(0, 10, 100, { r: 1 }), at(0, 12, -30), at(2, 9, 50, { r: 0.5 }), at(5, 9, -20, { r: -1 })], TZ, "2026-11-09", "2026-11-15");
    expect(days.map((d) => [d.date, d.net, d.count])).toEqual([
      ["2026-11-09", 70, 2],
      ["2026-11-10", 0, 0],
      ["2026-11-11", 50, 1],
      ["2026-11-12", 0, 0],
      ["2026-11-13", 0, 0],
      ["2026-11-14", -20, 1],
      ["2026-11-15", 0, 0],
    ]);
    expect(rolling(days, 3).map((d) => d.net)).toEqual([70, 70, 120, 50, 50, -20, -20]);
    expect(rolling(days, 3).map((d) => d.r)).toEqual([1, 1, 1.5, 0.5, 0.5, -1, -1]);
  });

  test("a DST change doesn't skip or repeat a day", () => {
    const days = dailySeries([], TZ, "2026-10-02", "2026-10-06"); // Melbourne clocks go forward Sun 4 Oct
    expect(days.map((d) => d.date)).toEqual(["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"]);
  });
});

describe("overtrading and stacking", () => {
  test("trades per (entry) day", () => {
    const trades = [at(0, 1, 10), at(0, 3, -10), at(0, 5, -10), at(1, 1, 5), ...[1, 2, 3, 4, 5, 6].map((h) => at(2, h, -1))];
    const b = behaviourBreakdowns(trades, { tz: TZ, minN: 1 })["per-day"];
    expect(b.buckets.map((x) => [x.key, x.n])).toEqual([
      ["1", 1],
      ["3", 3],
      ["6", 6],
    ]);
  });

  test("stacking counts other trades open at entry, same vs opposite direction", () => {
    const a = atr(10, { entryTime: T, exitTime: T + 10 * H, direction: "long" });
    const b = atr(10, { entryTime: T + H, exitTime: T + 9 * H, direction: "long" }); // 1 same open
    const c = atr(10, { entryTime: T + 2 * H, exitTime: T + 3 * H, direction: "long" }); // 2 same open
    const d = atr(10, { entryTime: T + 4 * H, exitTime: T + 5 * H, direction: "short" }); // only longs open → opposite
    const e = atr(10, { entryTime: T + 20 * H, exitTime: T + 21 * H }); // nothing open
    const s = behaviourBreakdowns([a, b, c, d, e], { tz: TZ, minN: 1 }).stacking;
    expect(s.buckets.map((x) => [x.key, x.n])).toEqual([
      ["none", 2],
      ["same1", 1],
      ["same2", 1],
      ["opp", 1],
    ]);
  });
});
