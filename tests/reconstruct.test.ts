import { beforeEach, describe, expect, test } from "vitest";
import { displayPair, parseCoin } from "@/server/hyperliquid/markets";
import { reconstructAll, reconstructCoin } from "@/server/reconstruct/reconstruct";
import type { FillInput } from "@/server/reconstruct/types";
import { MIN, T0, feeSum, resetTids, sim } from "./fixtures/fills";

const W = "wallet-1";
const one = (coin: string, fills: FillInput[]) => reconstructCoin(W, coin, fills);

beforeEach(() => resetTids());

describe("basic round trips", () => {
  test("1. simple long: open then close", () => {
    const s = sim("BTC").buy("0.5", "60000", 0).sell("0.5", "61000", 45);
    const [t] = one("BTC", s.fills);
    expect(t.direction).toBe("long");
    expect(t.status).toBe("closed");
    expect(t.metrics.avgEntry).toBe(60000);
    expect(t.metrics.avgExit).toBe(61000);
    expect(t.metrics.sizeUnits).toBe(0.5);
    expect(t.metrics.notionalUsd).toBe(30000);
    expect(t.metrics.grossPnl).toBe(500);
    expect(t.metrics.fees).toBeCloseTo(feeSum(s.fills), 9);
    expect(t.metrics.netPnl).toBeCloseTo(500 - feeSum(s.fills), 9);
    expect(t.metrics.returnPct).toBeCloseTo(((500 - feeSum(s.fills)) / 30000) * 100, 9);
    expect(t.metrics.entryTime).toBe(T0);
    expect(t.metrics.exitTime).toBe(T0 + 45 * MIN);
    expect(t.metrics.durationMs).toBe(45 * MIN);
    expect(t.metrics.fillCount).toBe(2);
    expect(t.flags).toEqual({});
  });

  test("2. simple short", () => {
    const s = sim("ETH").sell(10, 3000, 0).buy(10, 2900, 30);
    const [t] = one("ETH", s.fills);
    expect(t.direction).toBe("short");
    expect(t.metrics.avgEntry).toBe(3000);
    expect(t.metrics.avgExit).toBe(2900);
    expect(t.metrics.grossPnl).toBe(1000);
    expect(t.status).toBe("closed");
  });

  test("3. scale-in ×3 then one close → weighted average entry", () => {
    const s = sim("SOL").buy(10, 100, 0).buy(20, 97, 5).buy(10, 94, 10).sell(40, 105, 60);
    const trades = one("SOL", s.fills);
    expect(trades).toHaveLength(1);
    const t = trades[0];
    expect(t.metrics.avgEntry).toBeCloseTo((10 * 100 + 20 * 97 + 10 * 94) / 40, 12); // 97
    expect(t.metrics.entryUnitsTotal).toBe(40);
    expect(t.metrics.sizeUnits).toBe(40);
    expect(t.metrics.grossPnl).toBeCloseTo((105 - 97) * 40, 9);
    expect(t.legs.filter((l) => l.role === "entry")).toHaveLength(3);
  });

  test("4. one open then 3 partial closes → weighted average exit, partials kept", () => {
    const s = sim("BTC").buy(1, 60000, 0).sell("0.25", 61000, 10).sell("0.25", 62000, 20).sell("0.5", 63000, 30);
    const [t] = one("BTC", s.fills);
    expect(t.metrics.avgExit).toBeCloseTo(0.25 * 61000 + 0.25 * 62000 + 0.5 * 63000, 9); // 62250
    const exits = t.legs.filter((l) => l.role === "exit");
    expect(exits.map((l) => l.sz)).toEqual([0.25, 0.25, 0.5]);
    expect(t.metrics.grossPnl).toBeCloseTo(2250, 9);
    expect(t.metrics.exitTime).toBe(T0 + 30 * MIN);
  });

  test("5. scale-ins and partials interleaved → max size and averages", () => {
    const s = sim("ETH").buy(2, 3000, 0).sell(1, 3100, 5).buy(3, 3050, 10).sell(4, 3200, 20);
    const [t] = one("ETH", s.fills);
    expect(t.metrics.sizeUnits).toBe(4); // 2 → 1 → 4 → 0
    expect(t.metrics.avgEntry).toBeCloseTo((2 * 3000 + 3 * 3050) / 5, 9);
    expect(t.metrics.avgExit).toBeCloseTo((1 * 3100 + 4 * 3200) / 5, 9);
    expect(t.metrics.entryUnitsTotal).toBe(5);
    expect(t.metrics.exitUnitsTotal).toBe(5);
    expect(t.status).toBe("closed");
  });
});

describe("flips", () => {
  test("6. long → short in one fill: two trades, fee split pro rata, pnl on the close", () => {
    const s = sim("BTC").buy(1, 60000, 0).sell(3, 61000, 10).buy(2, 60500, 20);
    const trades = one("BTC", s.fills);
    expect(trades).toHaveLength(2);
    const [long, short] = trades;
    const flipFee = Number(s.fills[1].fee);

    expect(long.direction).toBe("long");
    expect(long.status).toBe("closed");
    expect(long.metrics.grossPnl).toBe(1000);
    expect(long.metrics.exitTime).toBe(T0 + 10 * MIN);
    const longExit = long.legs.find((l) => l.role === "exit")!;
    expect(longExit.sz).toBe(1);
    expect(longExit.fee).toBeCloseTo(flipFee / 3, 9);

    expect(short.direction).toBe("short");
    expect(short.status).toBe("closed");
    expect(short.metrics.avgEntry).toBe(61000);
    expect(short.metrics.sizeUnits).toBe(2);
    expect(short.metrics.entryTime).toBe(T0 + 10 * MIN);
    const shortEntry = short.legs.find((l) => l.role === "entry")!;
    expect(shortEntry.closedPnl).toBe(0);
    expect(shortEntry.fee).toBeCloseTo((flipFee * 2) / 3, 9);
    expect(longExit.fee + shortEntry.fee).toBeCloseTo(flipFee, 12);
    expect(short.metrics.grossPnl).toBe(1000); // (61000 − 60500) × 2

    expect(short.externalKey).toBe(`${W}:BTC:${s.fills[1].tid}:o`);
    expect(new Set(trades.map((t) => t.externalKey)).size).toBe(2);
  });

  test("7. double flip long → short → long", () => {
    const s = sim("SOL").buy(5, 100, 0).sell(10, 110, 5).buy(10, 105, 10).sell(5, 108, 15);
    const trades = one("SOL", s.fills);
    expect(trades.map((t) => [t.direction, t.status])).toEqual([
      ["long", "closed"],
      ["short", "closed"],
      ["long", "closed"],
    ]);
    expect(trades.map((t) => t.metrics.grossPnl)).toEqual([50, 25, 15]);
    expect(trades.reduce((a, t) => a + t.metrics.fees, 0)).toBeCloseTo(feeSum(s.fills), 9);
  });
});

describe("open positions and history edges", () => {
  test("8. still open after a partial close", () => {
    const s = sim("ETH").buy(4, 3000, 0).sell(1, 3300, 30);
    const [t] = one("ETH", s.fills);
    expect(t.status).toBe("open");
    expect(t.metrics.exitTime).toBeNull();
    expect(t.metrics.durationMs).toBeNull();
    expect(t.metrics.grossPnl).toBe(300); // realised so far
    expect(t.metrics.avgExit).toBe(3300);
    expect(t.metrics.sizeUnits).toBe(4);
  });

  test("9. history starts mid-position → partialHistory, entry implied from closedPnl", () => {
    const s = sim("BTC", "0.4", "58000").sell("0.4", 60000, 0);
    const [t] = one("BTC", s.fills);
    expect(t.flags.partialHistory).toBe(true);
    expect(t.flags.entryImplied).toBe(true);
    expect(t.direction).toBe("long");
    expect(t.metrics.avgEntry).toBeCloseTo(58000, 6);
    expect(t.metrics.sizeUnits).toBe(0.4);
    expect(t.status).toBe("closed");
  });

  test("10. gap in the middle (missing fill) → gap flag, no crash", () => {
    const s = sim("ETH").buy(2, 3000, 0).buy(1, 3010, 5).sell(3, 3100, 10);
    const withGap = [s.fills[0], s.fills[2]]; // middle scale-in missing
    const [t, ...rest] = one("ETH", withGap);
    expect(rest).toHaveLength(0);
    expect(t.flags.gap).toBe(true);
    expect(t.status).toBe("closed");

    // a missing close: next fill starts flat while we think we are long
    const s2 = sim("SOL").buy(5, 100, 0).sell(5, 101, 5).buy(2, 102, 10).sell(2, 103, 15);
    const trades = one("SOL", [s2.fills[0], s2.fills[2], s2.fills[3]]);
    expect(trades).toHaveLength(2);
    expect(trades[0].flags.gap).toBe(true);
    expect(trades[0].status).toBe("closed");
    expect(trades[1].flags.gap).toBeUndefined();
  });

  test("11. same-millisecond fills are ordered by tid", () => {
    const s = sim("BTC").buy(1, 60000, 0, { tid: 10 }).buy(1, 60010, 0, { tid: 11 }).sell(2, 60100, 0, { tid: 12 });
    const shuffled = [s.fills[2], s.fills[0], s.fills[1]];
    const trades = one("BTC", shuffled);
    expect(trades).toHaveLength(1);
    expect(trades[0].status).toBe("closed");
    expect(trades[0].flags).toEqual({});
  });

  test("12. multiple coins interleaved stay independent", () => {
    const btc = sim("BTC").buy(1, 60000, 0).sell(1, 60500, 30);
    const eth = sim("ETH").sell(5, 3000, 10).buy(5, 2950, 20);
    const all = [btc.fills[0], eth.fills[0], eth.fills[1], btc.fills[1]];
    const trades = reconstructAll(W, all);
    expect(trades.map((t) => [t.coin, t.direction, t.metrics.grossPnl])).toEqual([
      ["BTC", "long", 500],
      ["ETH", "short", 250],
    ]);
  });
});

describe("markets", () => {
  test("13. HIP-3 dex coin parsing and display names", () => {
    expect(parseCoin("xyz:SPX")).toEqual({ coin: "xyz:SPX", dex: "xyz", base: "SPX", marketType: "hip3" });
    expect(displayPair("xyz:SPX")).toBe("SPX/USD · xyz");
    expect(displayPair("kPEPE")).toBe("kPEPE/USD");
    expect(parseCoin("BTC").marketType).toBe("perp");

    const s = sim("xyz:SPX").buy(2, 6000, 0).sell(2, 6050, 60);
    const [t] = reconstructAll(W, s.fills);
    expect(t.dex).toBe("xyz");
    expect(t.marketType).toBe("hip3");
    expect(t.displayPair).toBe("SPX/USD · xyz");
    expect(t.metrics.grossPnl).toBe(100);
  });

  test("14. spot fills are excluded by default", () => {
    expect(parseCoin("@107").marketType).toBe("spot");
    expect(parseCoin("PURR/USDC").marketType).toBe("spot");
    const spot = sim("@107").buy(100, 1, 0).sell(100, 1.1, 5);
    const perp = sim("BTC").buy(1, 60000, 0).sell(1, 60100, 5);
    expect(reconstructAll(W, [...spot.fills, ...perp.fills]).map((t) => t.coin)).toEqual(["BTC"]);
    expect(reconstructAll(W, [...spot.fills, ...perp.fills], { includeSpot: true })).toHaveLength(2);
  });
});

describe("precision and special fills", () => {
  test("15. 0.1 + 0.2 closed by 0.3 returns exactly to flat", () => {
    const s = sim("ETH").buy("0.1", 3000, 0).buy("0.2", 3000, 1).sell("0.3", 3010, 2).buy("0.5", 3020, 3);
    const trades = one("ETH", s.fills);
    expect(trades).toHaveLength(2);
    expect(trades[0].status).toBe("closed");
    expect(trades[0].metrics.sizeUnits).toBe(0.3);
    expect(trades[1].status).toBe("open");
    expect(trades[1].flags).toEqual({});
  });

  test("16. liquidation close is an exit and is flagged", () => {
    const s = sim("SOL").buy(50, 100, 0).sell(50, 80, 90, { liquidation: true });
    const [t] = one("SOL", s.fills);
    expect(t.status).toBe("closed");
    expect(t.flags.liquidated).toBe(true);
    expect(t.metrics.grossPnl).toBe(-1000);
  });

  test("non-USDC fee token is flagged", () => {
    const s = sim("BTC").buy(1, 60000, 0, { feeToken: "HYPE" }).sell(1, 60100, 5);
    expect(one("BTC", s.fills)[0].flags.nonUsdcFee).toBe(true);
  });
});

describe("determinism", () => {
  test("duplicates and order do not change the result", () => {
    const s = sim("BTC").buy(1, 60000, 0).buy(1, 59000, 5).sell(3, 61000, 10).buy(1, 60000, 20);
    const a = reconstructAll(W, s.fills);
    const b = reconstructAll(W, [...s.fills].reverse().concat(s.fills));
    expect(b).toEqual(a);
  });
});
