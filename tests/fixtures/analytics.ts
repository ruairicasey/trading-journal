/** SYNTHETIC closed trades for analytics tests. */
import type { AnalyticsTrade } from "@/lib/analytics/types";

let n = 0;
export const A_T0 = Date.UTC(2026, 9, 5); // Mon 5 Oct 2026, 11:00 Melbourne (AEDT)

export function atr(net: number, o: Partial<AnalyticsTrade> = {}): AnalyticsTrade {
  n++;
  return {
    id: `t${String(n).padStart(4, "0")}`,
    coin: "BTC",
    displayPair: "BTC/USD",
    direction: "long",
    netPnl: net,
    fees: 1,
    notionalUsd: 10_000, // BE band = $5
    entryTime: A_T0 + n * 3_600_000,
    exitTime: A_T0 + n * 3_600_000 + 60_000,
    r: null,
    tradeType: null,
    session: null,
    grade: null,
    strategyId: null,
    strategy: null,
    htf: [],
    confluences: [],
    riskUsd: null,
    riskMultiplier: null,
    maxRReached: null,
    entryRetests: null,
    rulesFollowed: null,
    processCompliant: null,
    stopClass: null,
    slReasons: [],
    tpReasons: [],
    exitBy: "manual",
    ...o,
  };
}
