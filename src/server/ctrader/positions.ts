/**
 * cTrader deals → journal trades. Pure: no DB, no I/O.
 *
 * cTrader names its positions, so a trade is simply one positionId: deals without closePositionDetail open or add to
 * it, deals with it reduce or close it. Money comes from the closing deals' closePositionDetail, cTrader's own
 * realised figures for the closed volume:
 *   gross = Σ grossProfit · fees = −Σ (commission + pnlConversionFee) · funding (swap) = Σ swap
 * A position with no closing deal yet shows the opening commission as its fees so far.
 * Rejected / missed deals and zero-fill deals are ignored. Volumes are units (API cents ÷ 100).
 */
import { DEAL_STATUS, TRADE_SIDE, type RawDeal } from "./protocol";

export type StoredDeal = {
  ctid: number;
  dealId: number;
  positionId: number;
  orderId: number;
  symbolId: number;
  symbol: string;
  side: "B" | "S";
  status: number;
  volume: number;
  price: number | null;
  time: number;
  commission: number;
  baseToUsd: number | null;
  close: {
    entryPrice: number;
    gross: number;
    swap: number;
    commission: number;
    conversionFee: number;
    units: number;
    balance: number;
  } | null;
};

/** API deal → stored row (money scaled by moneyDigits, volume in units). */
export function toStoredDeal(ctid: number, d: RawDeal, symbol: string, accountDigits: number): StoredDeal {
  const md = d.moneyDigits ?? accountDigits;
  const money = (v: number | undefined) => (v ?? 0) / 10 ** md;
  const c = d.closePositionDetail;
  const cmd = c?.moneyDigits ?? md;
  const cm = (v: number | undefined) => (v ?? 0) / 10 ** cmd;
  return {
    ctid,
    dealId: d.dealId,
    positionId: d.positionId,
    orderId: d.orderId,
    symbolId: d.symbolId,
    symbol,
    side: d.tradeSide === TRADE_SIDE.SELL ? "S" : "B",
    status: d.dealStatus,
    volume: d.filledVolume / 100,
    price: d.executionPrice ?? null,
    time: d.executionTimestamp,
    commission: money(d.commission),
    baseToUsd: d.baseToUsdConversionRate ?? null,
    close: c
      ? {
          entryPrice: c.entryPrice,
          gross: cm(c.grossProfit),
          swap: cm(c.swap),
          commission: cm(c.commission),
          conversionFee: cm(c.pnlConversionFee),
          units: (c.closedVolume ?? d.filledVolume) / 100,
          balance: cm(c.balance),
        }
      : null,
  };
}

export const isExecuted = (d: { status: number; volume: number }) =>
  (d.status === DEAL_STATUS.FILLED || d.status === DEAL_STATUS.PARTIALLY_FILLED) && d.volume > 0;

export type PositionTrade = {
  externalKey: string;
  positionId: number;
  coin: string;
  displayPair: string;
  direction: "long" | "short";
  status: "open" | "closed";
  avgEntry: number | null;
  avgExit: number | null;
  sizeUnits: number;
  entryUnitsTotal: number;
  exitUnitsTotal: number;
  notionalUsd: number | null;
  grossPnl: number;
  fees: number;
  funding: number;
  entryTime: number;
  exitTime: number | null;
  durationMs: number | null;
  fillCount: number;
  partialHistory: boolean;
};

/** Stable identity: the account's login (also printed in cTrader's history export) + the position id. */
export const ctraderKey = (login: number | string, positionId: number | string) =>
  `ctrader:${login}:${positionId}`;

const vwap = (xs: { units: number; price: number | null }[]) => {
  const w = xs.filter((x) => x.price !== null && x.units > 0);
  const u = w.reduce((a, x) => a + x.units, 0);
  return u > 0 ? w.reduce((a, x) => a + x.units * x.price!, 0) / u : null;
};

const EPS = 1e-9;

/** One trade per position, from all of that position's stored deals (any order). */
export function positionTrade(login: number | string, deals: StoredDeal[]): PositionTrade | null {
  const ds = deals.filter(isExecuted).sort((a, b) => a.time - b.time || a.dealId - b.dealId);
  if (!ds.length) return null;
  const opens = ds.filter((d) => !d.close);
  const closes = ds.filter((d) => d.close);
  // opening side; with only closing deals (the open is older than the fetched history) a closing SELL means long
  const direction = opens.length
    ? opens[0].side === "B"
      ? "long"
      : "short"
    : closes[0].side === "S"
      ? "long"
      : "short";
  const entryUnits = opens.reduce((a, d) => a + d.volume, 0);
  const exitUnits = closes.reduce((a, d) => a + d.close!.units, 0);
  const partialHistory = !opens.length;

  let pos = 0;
  let size = 0;
  for (const d of ds) {
    pos += d.close ? -d.close.units : d.volume;
    size = Math.max(size, pos);
  }
  if (partialHistory) size = exitUnits;

  const avgEntry = opens.length
    ? vwap(opens.map((d) => ({ units: d.volume, price: d.price })))
    : vwap(closes.map((d) => ({ units: d.close!.units, price: d.close!.entryPrice })));
  const avgExit = vwap(closes.map((d) => ({ units: d.close!.units, price: d.price })));
  const closed = closes.length > 0 && (partialHistory || exitUnits >= entryUnits - EPS);

  const grossPnl = closes.reduce((a, d) => a + d.close!.gross, 0);
  const funding = closes.reduce((a, d) => a + d.close!.swap, 0);
  const fees = closes.length
    ? -closes.reduce((a, d) => a + d.close!.commission + d.close!.conversionFee, 0)
    : -opens.reduce((a, d) => a + d.commission, 0);
  // notional in USD at entry: base units × cTrader's base→USD rate when it gives one, else units × price
  const rate =
    opens.find((d) => d.baseToUsd)?.baseToUsd ?? closes.find((d) => d.baseToUsd)?.baseToUsd ?? null;
  const notionalUsd = rate ? size * rate : avgEntry !== null ? size * avgEntry : null;
  const entryTime = ds[0].time;
  const exitTime = closed ? ds[ds.length - 1].time : null;
  return {
    externalKey: ctraderKey(login, ds[0].positionId),
    positionId: ds[0].positionId,
    coin: ds[0].symbol,
    displayPair: ds[0].symbol,
    direction,
    status: closed ? "closed" : "open",
    avgEntry,
    avgExit,
    sizeUnits: size,
    entryUnitsTotal: partialHistory ? exitUnits : entryUnits,
    exitUnitsTotal: exitUnits,
    notionalUsd,
    grossPnl,
    fees,
    funding,
    entryTime,
    exitTime,
    durationMs: exitTime === null ? null : exitTime - entryTime,
    fillCount: ds.length,
    partialHistory,
  };
}
