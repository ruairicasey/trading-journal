import type { MarketType } from "../hyperliquid/markets";

/** A Hyperliquid fill as returned by the info API (numerics are strings). */
export type FillInput = {
  tid: number;
  coin: string;
  px: string;
  sz: string;
  side: "B" | "A";
  time: number;
  startPosition: string;
  dir: string;
  closedPnl: string;
  fee: string;
  feeToken: string;
  hash: string;
  oid: number;
  crossed: boolean;
  builderFee?: string | null;
  liquidation?: unknown;
  twapId?: number | null;
};

export type Leg = {
  tid: number;
  time: number;
  role: "entry" | "exit";
  /** Units, always positive. */
  sz: number;
  px: number;
  /** Share of the fill's fee attributed to this leg (pro rata on flips). */
  fee: number;
  /** Share of the fill's closedPnl (all of it on the closing leg of a flip). */
  closedPnl: number;
};

export type ReconFlags = {
  partialHistory?: boolean;
  gap?: boolean;
  nonUsdcFee?: boolean;
  /** We were liquidated (liquidatedUser === this wallet). */
  liquidated?: boolean;
  /** One of our fills was the other side of someone else's liquidation. Informational only. */
  liquidationCounterparty?: boolean;
  entryImplied?: boolean;
};

export type TradeMetrics = {
  avgEntry: number | null;
  avgExit: number | null;
  sizeUnits: number;
  entryUnitsTotal: number;
  exitUnitsTotal: number;
  notionalUsd: number | null;
  grossPnl: number;
  fees: number;
  funding: number;
  netPnl: number;
  returnPct: number | null;
  entryTime: number;
  exitTime: number | null;
  durationMs: number | null;
  fillCount: number;
};

export type ReconstructedTrade = {
  externalKey: string;
  coin: string;
  dex: string;
  marketType: MarketType;
  displayPair: string;
  direction: "long" | "short";
  status: "open" | "closed";
  legs: Leg[];
  flags: ReconFlags;
  metrics: TradeMetrics;
};
