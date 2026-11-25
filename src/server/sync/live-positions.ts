/** Live open positions across a set of wallets. Never returns an address. */
import type * as s from "../db/schema";
import type { HlClient } from "../hyperliquid/client";
import { displayPair } from "../hyperliquid/markets";
import { fetchPositions } from "../hyperliquid/sync";
import type { LighterClient } from "../lighter/client";
import { leverageOf, liquidationOf, openPositions } from "../lighter/sync";

export type LivePosition = {
  wallet: string;
  walletId: string;
  coin: string;
  displayPair: string;
  size: number;
  entryPx: number | null;
  positionValue: number | null;
  unrealizedPnl: number | null;
  returnOnEquity: number | null;
  leverage: number | null;
  liquidationPx: number | null;
};

type Wallet = typeof s.wallets.$inferSelect;

/** `missing` names the Lighter wallets that could not be read; a Hyperliquid failure throws, as it always has. */
export async function loadLivePositions(
  wallets: Wallet[],
  clients: { hl: HlClient; lighter: LighterClient },
): Promise<{ positions: LivePosition[]; missing: string[] }> {
  const positions: LivePosition[] = [];
  const missing: string[] = [];
  for (const w of wallets) {
    if (w.exchange === "lighter") {
      // public by account index, so no token is needed. A Lighter problem never hides Hyperliquid's positions.
      try {
        for (const p of openPositions(await clients.lighter.account(w.accountIndex, { quick: true }))) {
          const size = Math.abs(Number(p.position)) * (p.sign < 0 ? -1 : 1);
          const value = p.position_value === undefined ? null : Number(p.position_value);
          const upnl = p.unrealized_pnl === undefined ? null : Number(p.unrealized_pnl);
          const lev = leverageOf(p);
          const liq = liquidationOf(p);
          positions.push({
            wallet: w.label,
            walletId: w.id,
            coin: p.symbol,
            displayPair: displayPair(p.symbol),
            size,
            entryPx: p.avg_entry_price === undefined ? null : Number(p.avg_entry_price),
            positionValue: value,
            unrealizedPnl: upnl,
            // margin is the position's value over its leverage
            returnOnEquity: upnl !== null && value && lev ? upnl / (Math.abs(value) / lev) : null,
            leverage: lev,
            liquidationPx: liq === null ? null : Number(liq),
          });
        }
      } catch {
        missing.push(w.label);
      }
      continue;
    }
    for (const p of await fetchPositions(clients.hl, w.address)) {
      const num = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));
      positions.push({
        wallet: w.label,
        walletId: w.id,
        coin: p.coin,
        displayPair: displayPair(p.coin),
        size: Number(p.szi),
        entryPx: num(p.entryPx),
        positionValue: num(p.positionValue),
        unrealizedPnl: num(p.unrealizedPnl),
        returnOnEquity: num(p.returnOnEquity),
        leverage: p.leverage?.value ?? null,
        liquidationPx: num(p.liquidationPx),
      });
    }
  }
  return { positions, missing };
}
