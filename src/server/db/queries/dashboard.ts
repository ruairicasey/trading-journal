import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { foldOwnTransfers, type BalanceCash, type BalanceFlow, type ClosedTrade } from "../../../lib/stats";
import type { DB } from "../client";
import * as s from "../schema";
import { rExpr } from "./trades";

/** null = every wallet on the account (and its manual trades); otherwise just that wallet's trades */
export type WalletScope = string | null;

const live = (accountId: string, walletId: WalletScope = null) => [
  eq(s.trades.accountId, accountId),
  ...(walletId ? [eq(s.trades.walletId, walletId)] : []),
  isNull(s.trades.deletedAt),
  sql`coalesce(json_extract(${s.trades.flags}, '$.superseded'), 0) = 0`,
];

/** All closed trades for the account (stats are computed in JS; hundreds to low thousands of rows). */
export async function closedTrades(db: DB, accountId: string, walletId: WalletScope = null): Promise<ClosedTrade[]> {
  const rows = await db
    .select({
      id: s.trades.id,
      displayPair: s.trades.displayPair,
      direction: s.trades.direction,
      netPnl: s.trades.netPnl,
      fees: s.trades.fees,
      funding: s.trades.funding,
      source: s.trades.source,
      notionalUsd: s.trades.notionalUsd,
      entryTime: s.trades.entryTime,
      exitTime: s.trades.exitTime,
      r: rExpr,
    })
    .from(s.trades)
    .leftJoin(s.tradeJournal, eq(s.tradeJournal.tradeId, s.trades.id))
    .where(and(...live(accountId, walletId), eq(s.trades.status, "closed"), isNotNull(s.trades.exitTime), isNotNull(s.trades.netPnl)))
    .orderBy(asc(s.trades.exitTime));
  return rows.map((r) => ({ ...r, netPnl: r.netPnl ?? 0, fees: r.fees ?? 0, exitTime: r.exitTime!, r: r.r === null ? null : Number(r.r) }));
}

const STABLES = new Set(["USDC", "USDH", "USDT0", "USDT", "USDE"]);
const isStable = (token: string) => STABLES.has(token.split(":")[0].toUpperCase());

/**
 * Inputs for the account-balance curve, or null when it can't be trusted and the dashboard falls back to starting
 * balance + realised P&L: when any enabled wallet on the account hasn't finished its fill, funding or ledger
 * backfill, or its fill history is truncated (the ledger would then carry deposits whose P&L is missing).
 * Cash = each fill's closedPnl − fee (a fee in a non-stable token valued at the fill price) + each funding payment:
 * the definitions `npm run debug:ledger` reconciles against holdings. Spot fills count only for unified accounts,
 * where spot stablecoins are the collateral.
 */
export async function balanceInputs(db: DB, accountId: string, walletId: WalletScope = null): Promise<{ flows: BalanceFlow[]; cash: BalanceCash[] } | null> {
  // disabled wallets are never synced, so they are left out of both the gate and the money
  const wallets = await db
    .select()
    .from(s.wallets)
    .where(and(eq(s.wallets.accountId, accountId), eq(s.wallets.enabled, true), ...(walletId ? [eq(s.wallets.id, walletId)] : [])));
  if (!wallets.length || wallets.some((w) => !w.ledgerCompletedAt || !w.fundingCompletedAt || !w.backfillCompletedAt || w.historyTruncated)) return null;
  const ids = wallets.map((w) => w.id);
  const unified = new Set(wallets.filter((w) => w.accountMode === "unifiedAccount").map((w) => w.id));
  const [ledger, fills, funding] = await Promise.all([
    db
      .select({ walletId: s.ledgerEvents.walletId, hash: s.ledgerEvents.hash, t: s.ledgerEvents.time, usd: s.ledgerEvents.usd, kind: s.ledgerEvents.kind })
      .from(s.ledgerEvents)
      .where(inArray(s.ledgerEvents.walletId, ids)),
    db
      .select({ walletId: s.fills.walletId, t: s.fills.time, marketType: s.fills.marketType, closedPnl: s.fills.closedPnl, fee: s.fills.fee, feeToken: s.fills.feeToken, px: s.fills.px })
      .from(s.fills)
      .where(inArray(s.fills.walletId, ids)),
    db.select({ t: s.fundingEvents.time, usdc: s.fundingEvents.usdc }).from(s.fundingEvents).where(inArray(s.fundingEvents.walletId, ids)),
  ]);
  const cash: BalanceCash[] = [];
  for (const f of fills) {
    if (f.marketType === "spot" && !unified.has(f.walletId)) continue;
    const fee = isStable(f.feeToken) ? Number(f.fee) : Number(f.fee) * Number(f.px);
    const usd = Number(f.closedPnl) - fee;
    if (Number.isFinite(usd) && usd !== 0) cash.push({ t: f.t, usd });
  }
  for (const p of funding) {
    const usd = Number(p.usdc);
    if (Number.isFinite(usd) && usd !== 0) cash.push({ t: p.t, usd });
  }
  return { flows: foldOwnTransfers(ledger), cash };
}

export async function openTrades(db: DB, accountId: string, walletId: WalletScope = null) {
  return db
    .select({
      id: s.trades.id,
      coin: s.trades.coin,
      displayPair: s.trades.displayPair,
      direction: s.trades.direction,
      source: s.trades.source,
      walletId: s.trades.walletId,
      avgEntry: s.trades.avgEntry,
      sizeUnits: s.trades.sizeUnits,
      netPnl: s.trades.netPnl,
      entryTime: s.trades.entryTime,
      leverage: s.trades.leverage,
      liqPx: s.trades.liqPx,
      stopLoss: s.tradeJournal.stopLoss,
    })
    .from(s.trades)
    .leftJoin(s.tradeJournal, eq(s.tradeJournal.tradeId, s.trades.id))
    .where(and(...live(accountId, walletId), eq(s.trades.status, "open")))
    .orderBy(asc(s.trades.entryTime));
}
export type OpenTradeRow = Awaited<ReturnType<typeof openTrades>>[number];
