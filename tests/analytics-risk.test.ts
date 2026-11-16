import { describe, expect, test } from "vitest";
import { riskBreakdowns } from "@/lib/analytics/risk";
import { atr } from "./fixtures/analytics";

const keys = (b: { buckets: { key: string; n: number }[] }) => b.buckets.map((x) => [x.key, x.n]);

describe("risk & execution", () => {
  test("risk size is relative to the median risk; trades without a stop are left out", () => {
    const trades = [atr(10, { riskUsd: 100 }), atr(-10, { riskUsd: 100 }), atr(5, { riskUsd: 40 }), atr(-30, { riskUsd: 250 }), atr(1, { riskUsd: 160 }), atr(3)];
    const out = riskBreakdowns(trades, { minN: 1 });
    expect(out.typicalRisk).toBe(100);
    expect(out.withStop).toBe(5);
    expect(keys(out.breakdowns["risk-size"])).toEqual([
      ["lt0.5", 1],
      ["0.9-1.1", 2],
      ["1.5-2", 1],
      ["2+", 1],
    ]);
  });

  test("risk multiplier, rules and process (with Not recorded)", () => {
    const out = riskBreakdowns(
      [
        atr(1, { riskMultiplier: 0.5, rulesFollowed: "yes", processCompliant: true }),
        atr(1, { riskMultiplier: 1, rulesFollowed: "no", processCompliant: false }),
        atr(1, { riskMultiplier: 2, rulesFollowed: "partial" }),
        atr(1),
      ],
      { minN: 1 },
    ).breakdowns;
    expect(out["risk-multiplier"].buckets.map((x) => x.key)).toEqual(["lt1", "1", "gt1", "__none"]);
    expect(out.rules.buckets.map((x) => x.label)).toEqual(["Yes", "Partly", "No", "Not recorded"]);
    expect(out.process.buckets.map((x) => x.key)).toEqual(["yes", "no", "__none"]);
  });

  test("how trades ended, and stop / target reasons count once per reason", () => {
    const sl = { id: "s1", label: "Below swing low" };
    const sl2 = { id: "s2", label: "Below VAL" };
    const out = riskBreakdowns(
      [atr(50, { exitBy: "tp", tpReasons: [{ id: "t1", label: "Prior high" }] }), atr(-20, { exitBy: "stop", slReasons: [sl, sl2] }), atr(-5, { exitBy: "stop", slReasons: [sl] }), atr(8), atr(-90, { exitBy: "liquidated" })],
      { minN: 1 },
    ).breakdowns;
    expect(keys(out["exit-by"])).toEqual([
      ["tp", 1],
      ["stop", 2],
      ["manual", 1],
      ["liquidated", 1],
    ]);
    expect(keys(out["sl-reason"])).toEqual([
      ["s1", 2],
      ["s2", 1],
    ]);
    expect(out["tp-reason"].buckets[0].label).toBe("Prior high");
  });

  test("losers by max R reached (0R is 'never in profit'), and the share that reached 1R", () => {
    const out = riskBreakdowns([atr(-10, { maxRReached: 0 }), atr(-10, { maxRReached: 0.3 }), atr(-10, { maxRReached: 1.2 }), atr(-10, { maxRReached: 2.5 }), atr(-10), atr(20, { maxRReached: 3 })], {
      minN: 1,
    });
    expect(keys(out.breakdowns["loser-max-r"])).toEqual([
      ["0", 1],
      ["0-0.5", 1],
      ["1-2", 1],
      ["2+", 1],
      ["__none", 1],
    ]);
    expect(out.losers).toBe(5);
    expect(out.losersReached1R).toBe(0.5);
  });

  test("winners: R captured of max R reached", () => {
    const out = riskBreakdowns([atr(10, { r: 1, maxRReached: 4 }), atr(10, { r: 2, maxRReached: 2 }), atr(10, { r: 3, maxRReached: 2 }), atr(10, { r: 1 }), atr(-10, { r: -1, maxRReached: 1 })], { minN: 1 });
    expect(keys(out.breakdowns.capture)).toEqual([
      ["25-50", 1],
      ["75-100", 1],
      ["100+", 1],
    ]);
    expect(out.winnersWithMax).toBe(3);
    expect(out.avgCapture).toBeCloseTo((0.25 + 1 + 1.5) / 3, 10);
  });

  test("retests bucket 3+, empty input is safe", () => {
    const out = riskBreakdowns([atr(1, { entryRetests: 0 }), atr(1, { entryRetests: 5 }), atr(1, { entryRetests: 1 })], { minN: 1 });
    expect(out.breakdowns.retests.buckets.map((x) => x.key)).toEqual(["0", "1", "3"]);
    const e = riskBreakdowns([]);
    expect(e).toMatchObject({ typicalRisk: null, losersReached1R: null, avgCapture: null });
  });
});
