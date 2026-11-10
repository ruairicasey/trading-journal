import { beforeEach, describe, expect, test } from "vitest";
import { displayPair, parseCoin } from "@/server/hyperliquid/markets";
import { orderByTimeTid, orderFills, reconstructAll, reconstructCoin } from "@/server/reconstruct/reconstruct";
import type { FillInput } from "@/server/reconstruct/types";
import { DEMO_WALLET, MIN, T0, feeSum, resetTids, sim } from "./fixtures/fills";

const W = "wallet-1";
const one = (coin: string, fills: FillInput[]) => reconstructCoin(W, coin, fills, { ownAddress: DEMO_WALLET });

/** Put fills on one timestamp and assign tids in the given order (tid order ≠ position order, like HL). */
function sameMs(fills: FillInput[], time: number, tids: number[]) {
  fills.forEach((f, i) => {
    f.time = time;
    f.tid = tids[i];
  });
  return fills;
}

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

  test("16. liquidation close is an exit and is flagged when WE were liquidated", () => {
    const s = sim("SOL").buy(50, 100, 0).sell(50, 80, 90, { liquidation: true });
    const [t] = one("SOL", s.fills);
    expect(t.status).toBe("closed");
    expect(t.flags.liquidated).toBe(true);
    expect(t.metrics.grossPnl).toBe(-1000);
  });

  test("being the counterparty of someone else's liquidation is not flagged as liquidated", () => {
    const s = sim("ETH").buy(2, 3000, 0).sell(2, 3050, 30, { liquidation: true });
    // the liquidation object names another account (realistic: our resting order filled their liquidation)
    s.fills[1].liquidation = { liquidatedUser: "0x00000000000000000000000000000000000000ff", markPx: "3050", method: "market" };
    const [t] = one("ETH", s.fills);
    expect(t.flags.liquidated).toBeUndefined();
    expect(t.flags.liquidationCounterparty).toBe(true);
  });

  test("non-USD fee token is flagged; USD stablecoins used by HIP-3 dexes are not", () => {
    const s = sim("BTC").buy(1, 60000, 0, { feeToken: "HYPE" }).sell(1, 60100, 5);
    expect(one("BTC", s.fills)[0].flags.nonUsdcFee).toBe(true);
    for (const token of ["USDH", "USDT0", "USDE", " USDC"]) {
      const h = sim("vntl:X").buy(1, 100, 0, { feeToken: token }).sell(1, 101, 5, { feeToken: token });
      expect(one("vntl:X", h.fills)[0].flags.nonUsdcFee).toBeUndefined();
    }
  });
});

describe("same-millisecond multi-fill orders (regression: trades split by tid ordering)", () => {
  test("one taker order filling 3 makers in the same ms, with tids not in position order", () => {
    // Open long 1.0 in one order hitting 3 makers; close 1.0 later hitting 2 makers. Exactly like a real
    // HL order, all fills of an order share a timestamp; tids here run against the position chain.
    const s = sim("BTC").buy("0.2", 60000).buy("0.5", 60005).buy("0.3", 60010).sell("0.6", 60500).sell("0.4", 60490);
    sameMs(s.fills.slice(0, 3), T0, [503, 501, 502]);
    sameMs(s.fills.slice(3), T0 + 45 * MIN, [702, 701]);

    // Proof the old ordering was wrong for this input: (time, tid) breaks the startPosition chain.
    const naive = orderByTimeTid(s.fills).map((f) => f.startPosition);
    expect(naive.slice(0, 3)).toEqual(["0.2", "0.7", "0"]); // tid order: 501, 502, 503
    expect(orderFills(s.fills).map((f) => f.startPosition)).toEqual(["0", "0.2", "0.7", "1", "0.4"]);

    const trades = one("BTC", s.fills);
    expect(trades).toHaveLength(1);
    const [t] = trades;
    expect(t.flags).toEqual({});
    expect(t.status).toBe("closed");
    expect(t.metrics.sizeUnits).toBe(1);
    expect(t.metrics.avgEntry).toBeCloseTo(0.2 * 60000 + 0.5 * 60005 + 0.3 * 60010, 6);
    expect(t.metrics.entryTime).toBe(T0);
    expect(t.metrics.exitTime).toBe(T0 + 45 * MIN);
    expect(t.externalKey).toBe(`${W}:BTC:503`); // key = first fill in position order
  });

  test("a flip spread over several same-ms fills with shuffled tids", () => {
    // long 1 → one sell order of 3 filled by 3 makers: 1.2 (closes 1, opens 0.2 short), 0.8, 1.0
    const s = sim("ETH").buy(1, 3000, 0).sell("1.2", 3100).sell("0.8", 3099).sell("1.0", 3098).buy(2, 3050);
    sameMs(s.fills.slice(1, 4), T0 + 10 * MIN, [902, 903, 901]);
    s.fills[4].time = T0 + 20 * MIN;
    const trades = one("ETH", s.fills);
    expect(trades.map((t) => [t.direction, t.status, t.metrics.sizeUnits])).toEqual([
      ["long", "closed", 1],
      ["short", "closed", 2],
    ]);
    expect(trades.every((t) => !t.flags.gap && !t.flags.partialHistory)).toBe(true);
  });

  test("same-ms group at the very start of history finds its chain head", () => {
    const s = sim("SOL").buy(5, 100).buy(5, 100.1).sell(10, 101, 30);
    sameMs(s.fills.slice(0, 2), T0, [11, 10]); // second fill has the lower tid
    const trades = one("SOL", s.fills);
    expect(trades).toHaveLength(1);
    expect(trades[0].flags).toEqual({});
  });

  test("float dust in HL startPosition strings is not treated as a gap", () => {
    const s = sim("kPEPE").buy(2059303.1, "0.012", 0).buy(100, "0.0121", 5).sell("2059403.1", "0.0125", 10);
    s.fills[1].startPosition = "2059303.0999999999"; // HL-style dust
    s.fills[2].startPosition = "2059403.1000000001";
    const trades = one("kPEPE", s.fills);
    expect(trades).toHaveLength(1);
    expect(trades[0].flags).toEqual({});
    expect(trades[0].status).toBe("closed");
  });
});

describe("fees", () => {
  test("maker rebate (negative fee) reduces total fees; fees are summed signed", () => {
    // entry as maker with a rebate, exit as taker
    const s = sim("BTC").buy(1, 60000, 0, { fee: "-0.6" }).sell(1, 60100, 10, { fee: "27.045" });
    const [t] = one("BTC", s.fills);
    expect(t.legs[0].fee).toBe(-0.6);
    expect(t.metrics.fees).toBeCloseTo(26.445, 9); // not 27.645 (abs) and not 27.045 (rebate dropped)
    expect(t.metrics.netPnl).toBeCloseTo(100 - 26.445, 9);

    // all-maker round trip: total fees negative, net exceeds gross
    const m = sim("ETH").sell(2, 3000, 0, { fee: "-0.06" }).buy(2, 2990, 5, { fee: "-0.0598" });
    const [mt] = one("ETH", m.fills);
    expect(mt.metrics.fees).toBeCloseTo(-0.1198, 9);
    expect(mt.metrics.netPnl).toBeGreaterThan(mt.metrics.grossPnl);
  });

  test("a rebate on a flip fill is split pro rata with its sign kept", () => {
    const s = sim("SOL").buy(1, 100, 0).sell(4, 101, 5, { fee: "-0.08" });
    const [long, short] = one("SOL", s.fills);
    const closeFee = long.legs.find((l) => l.role === "exit")!.fee;
    const openFee = short.legs.find((l) => l.role === "entry")!.fee;
    expect(closeFee).toBeCloseTo(-0.02, 12);
    expect(openFee).toBeCloseTo(-0.06, 12);
    expect(closeFee + openFee).toBeCloseTo(-0.08, 12);
  });

  test("builderFee is not subtracted on top of fee (fee already includes it)", () => {
    const s = sim("xyz:SPX")
      .buy(1, 6000, 0, { fee: "3.5", builderFee: "1.0" })
      .sell(1, 6010, 5, { fee: "3.5", builderFee: "1.0" });
    const [t] = one("xyz:SPX", s.fills);
    expect(t.metrics.fees).toBe(7); // 3.5 + 3.5, not 9
    expect(t.metrics.netPnl).toBe(10 - 7);
    expect(s.fills[0].builderFee).toBe("1.0"); // still carried through for storage
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
