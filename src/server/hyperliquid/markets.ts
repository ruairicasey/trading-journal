/**
 * Hyperliquid coin naming:
 *   "BTC", "kPEPE"      → main-dex perp
 *   "xyz:SPX"           → HIP-3 / builder-deployed perp on dex "xyz"
 *   "@107", "PURR/USDC" → spot
 */
export type MarketType = "perp" | "hip3" | "spot";

export type ParsedCoin = { coin: string; dex: string; base: string; marketType: MarketType };

export function parseCoin(coin: string): ParsedCoin {
  if (coin.startsWith("@") || coin.includes("/")) {
    return { coin, dex: "", base: coin, marketType: "spot" };
  }
  const i = coin.indexOf(":");
  if (i > 0) return { coin, dex: coin.slice(0, i), base: coin.slice(i + 1), marketType: "hip3" };
  return { coin, dex: "", base: coin, marketType: "perp" };
}

/** Human-readable pair: kPEPE → "kPEPE/USD", xyz:SPX → "SPX/USD · xyz", PURR/USDC → "PURR/USDC". */
export function displayPair(coin: string): string {
  const p = parseCoin(coin);
  if (p.marketType === "spot") return p.coin;
  if (p.marketType === "hip3") return `${p.base}/USD · ${p.dex}`;
  return `${p.base}/USD`;
}
