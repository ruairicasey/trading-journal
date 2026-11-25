/**
 * Lighter rows → the journal's exchange-neutral records (pure). Built from Lighter's published schemas; the points
 * marked ASSUMED are checked by `npm run debug:lighter` on real data (see docs/lighter.md).
 */
import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import type { OrderRecord } from "../hyperliquid/orders";
import type { FillInput } from "../reconstruct/types";
import type { LtDeposit, LtFunding, LtOrder, LtTrade, LtTransfer, LtWithdraw } from "./schemas";

/** Timestamps come in seconds, milliseconds or microseconds depending on the field: normalise by magnitude. */
export function toMs(t: number): number {
  if (t < 1e11) return t * 1000;
  if (t < 1e14) return t;
  return Math.floor(t / 1000);
}

/**
 * The journal's integer order id for a Lighter one. Ids carry the market in their high bits, so from about market 16
 * they pass 2^53 and can't be a JS number (or be stored exactly): those get a 52-bit digest in [2^52, 2^53) instead.
 */
export function oidOf(id: string | undefined): number {
  if (!id || /^0*$/.test(id)) return 0;
  const n = Number(id);
  if (Number.isSafeInteger(n) && n < 2 ** 52) return n;
  return 2 ** 52 + Number.parseInt(createHash("sha256").update(id).digest("hex").slice(0, 13), 16);
}

export const isPerp = (r: { market_kind: string }) => r.market_kind === "perps";

/** One trade as a fill of `account`, or null when it isn't one (someone else's, or both sides are ours). */
export function mapFill(t: LtTrade, account: number, ownAddress: string): FillInput | null {
  const isAsk = t.ask_account_id === account;
  const isBid = t.bid_account_id === account;
  if (isAsk === isBid) return null;
  const maker = isAsk === t.is_maker_ask;
  const start = new Decimal((maker ? t.maker_position_size_before : t.taker_position_size_before) ?? 0);
  const entryQuote = new Decimal(
    (maker ? t.maker_entry_quote_before : t.taker_entry_quote_before) ?? 0,
  ).abs();
  const sz = new Decimal(t.size);
  const px = new Decimal(t.price);
  const delta = isAsk ? sz.neg() : sz;
  // ASSUMED: fee rates are millionths of the notional (documented for integrator fees; a live maker fee of 28 matches
  // a published 0.0028% tier). Standard accounts pay 0, so the field is normally absent.
  const rate = maker
    ? (t.maker_fee ?? 0) + (t.integrator_maker_fee ?? 0)
    : (t.taker_fee ?? 0) + (t.integrator_taker_fee ?? 0);
  const fee = new Decimal(t.usd_amount).abs().times(rate).div(1_000_000);

  const reducing = !start.isZero() && start.isPositive() !== delta.isPositive();
  let pnl = new Decimal(0);
  if (reducing) {
    const given = isAsk ? t.ask_account_pnl : t.bid_account_pnl;
    // the field is omitted when zero; the entry value before the fill gives the same number
    // (without either there is no honest number: fail loudly rather than store a wrong one, which would stick)
    if (given === undefined && entryQuote.isZero())
      throw new Error("trades: a closing fill has neither P&L nor entry value");
    pnl = given !== undefined ? new Decimal(given) : expectedPnl(start, entryQuote, sz, px);
  }
  const side = reducing ? (start.isPositive() ? "Long" : "Short") : delta.isPositive() ? "Long" : "Short";
  const flips = reducing && sz.gt(start.abs());
  return {
    tid: t.trade_id,
    coin: t.market_symbol,
    px: t.price,
    sz: t.size,
    side: isAsk ? "A" : "B",
    time: toMs(t.timestamp),
    startPosition: start.toFixed(),
    dir: flips
      ? start.isPositive()
        ? "Long > Short"
        : "Short > Long"
      : `${reducing ? "Close" : "Open"} ${side}`,
    closedPnl: pnl.toFixed(),
    fee: fee.toFixed(),
    feeToken: "USDC",
    hash: t.tx_hash,
    oid: oidOf(isAsk ? t.ask_id_str : t.bid_id_str),
    crossed: !maker,
    builderFee: null,
    // ASSUMED: the liquidation engine takes from the book, so the liquidated account is the taker
    liquidation:
      t.type === "liquidation" ? { liquidatedUser: maker ? null : ownAddress, method: "market" } : undefined,
    twapId: null,
  };
}

/** Realised P&L of reducing a position of `start` units entered for `entryQuote` by `sz` at `px` (gross of fees). */
export function expectedPnl(start: Decimal, entryQuote: Decimal, sz: Decimal, px: Decimal): Decimal {
  const units = Decimal.min(start.abs(), sz);
  const entry = entryQuote.div(start.abs());
  return px
    .minus(entry)
    .times(units)
    .times(start.isPositive() ? 1 : -1);
}

const TRIGGER_TYPES: Record<string, string> = {
  "stop-loss": "Stop Market",
  "stop-loss-limit": "Stop Limit",
  "take-profit": "Take Profit Market",
  "take-profit-limit": "Take Profit Limit",
};
const PLAIN_TYPES: Record<string, string> = {
  limit: "Limit",
  market: "Market",
  twap: "TWAP",
  "twap-sub": "TWAP",
  liquidation: "Liquidation",
};
const LIVE = new Set(["open", "pending", "in-progress"]);
const positive = (x: string | undefined | null) => {
  const n = Number(x);
  return x != null && x !== "" && Number.isFinite(n) && n > 0 ? n : null;
};

export type MappedOrder = OrderRecord & { parentOid: number | null };

export function mapOrder(walletId: string, o: LtOrder): MappedOrder {
  const trigger = TRIGGER_TYPES[o.type];
  const live = LIVE.has(o.status);
  const placedAt = toMs(o.created_at || o.timestamp);
  const statusAt = toMs(o.updated_at || o.timestamp);
  const size = positive(o.initial_base_amount);
  return {
    walletId,
    oid: oidOf(o.order_id),
    coin: o.market_symbol,
    side: o.is_ask ? "A" : "B",
    orderType: trigger ?? PLAIN_TYPES[o.type] ?? o.type,
    isTrigger: !!trigger,
    triggerPx: trigger ? positive(o.trigger_price) : null,
    triggerCondition: null,
    limitPx: positive(o.price),
    reduceOnly: !!o.reduce_only,
    // ASSUMED: a reduce-only trigger with no size covers the whole position, like Hyperliquid's position TP/SL
    isPositionTpsl: !!trigger && !!o.reduce_only && size === null,
    origSz: size ?? 0,
    placedAt,
    status: live ? "open" : trigger && o.status === "filled" ? "triggered" : o.status,
    statusAt: Math.max(statusAt, placedAt),
    endedAt: live ? null : Math.max(statusAt, placedAt),
    raw: { type: o.type, status: o.status, version: o.order_version ?? 0, createdAt: placedAt },
    parentOid: oidOf(o.parent_order_id) || null,
  };
}

/**
 * An id for a superseded version of an order that was edited in place. Negative, so it can't meet a real order
 * index; 52 bits of a digest, so versions of one order don't meet each other.
 */
export function versionOid(oid: number, triggerPx: number, placedAt: number): number {
  const hex = createHash("sha256").update(`${oid}|${triggerPx}|${placedAt}`).digest("hex").slice(0, 13);
  return -Number.parseInt(hex, 16) - 1;
}

/** Funding: `szi` signed by side. ASSUMED: `change` is the effect on your balance (negative = you paid). */
export function mapFunding(walletId: string, f: LtFunding, coin: string) {
  const size = new Decimal(f.position_size).abs();
  return {
    walletId,
    hash: String(f.funding_id),
    coin,
    time: toMs(f.timestamp),
    usdc: f.change,
    szi: (f.position_side === "long" ? size : size.neg()).toFixed(),
    fundingRate: f.rate,
  };
}

export type LedgerRow = {
  uid: string;
  time: number;
  hash: string;
  type: string;
  kind: string;
  usd: number;
  delta: Record<string, unknown>;
};

const usd = (x: string | undefined) => {
  const n = Number(x ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Only money that reached the account counts: a deposit still on its way has no effect yet. */
export function mapDeposit(d: LtDeposit, usdcId: number): LedgerRow {
  const isUsdc = d.asset_id === usdcId;
  const arrived = d.status === "completed";
  return {
    uid: `dep:${d.id}`,
    time: toMs(d.timestamp),
    hash: d.l1_tx_hash ?? "",
    type: "deposit",
    kind: !isUsdc ? "spot_only" : arrived ? "deposit" : "no_cash",
    usd: isUsdc && arrived ? usd(d.amount) : 0,
    delta: { status: d.status, assetId: d.asset_id },
  };
}

/** A withdrawal leaves the balance when requested, unless it failed or was refunded. */
export function mapWithdraw(w: LtWithdraw, usdcId: number): LedgerRow {
  const isUsdc = w.asset_id === usdcId;
  const gone = w.status !== "failed" && w.status !== "refunded";
  return {
    uid: `wd:${w.id}`,
    time: toMs(w.timestamp),
    hash: w.l2_tx_hash ?? "",
    type: "withdraw",
    kind: !isUsdc ? "spot_only" : gone ? "withdraw" : "no_cash",
    usd: isUsdc && gone ? -usd(w.amount) : 0,
    delta: { status: w.status, assetId: w.asset_id, speed: w.type ?? null },
  };
}

export function mapTransfer(t: LtTransfer, usdcId: number, unified: boolean): LedgerRow {
  const base = { uid: `tr:${t.id}`, time: toMs(t.timestamp), hash: t.tx_hash ?? "", type: t.type };
  const delta = { assetId: t.asset_id, from: t.from_route ?? null, to: t.to_route ?? null };
  const row = (kind: string, value: number): LedgerRow => ({ ...base, delta, kind, usd: value });
  if (t.asset_id !== usdcId) return row("spot_only", 0);
  const amount = usd(t.amount);
  const fee = usd(t.fee);
  if (t.type === "L2SelfTransfer") {
    // between your own spot and perps balances: moves the collateral only when the two are separate (classic mode)
    if (unified || t.from_route === t.to_route) return row("internal", 0);
    return row("spot_perp", t.to_route === "perps" ? amount : -amount);
  }
  const inflow = t.type.endsWith("Inflow");
  if (!inflow && !t.type.endsWith("Outflow")) return row("unknown", 0);
  const route = inflow ? t.to_route : t.from_route;
  if (!unified && route === "spot") return row("spot_only", 0);
  const kind = t.type.startsWith("L2Transfer") ? (inflow ? "transfer_in" : "transfer_out") : "vault";
  return row(kind, inflow ? amount : -(amount + fee));
}
