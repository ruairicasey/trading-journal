/** The sync-run record shared by the exchanges: one sync per wallet at a time, and the bookkeeping afterwards. */
import { and, eq, gt, max, min, sql } from "drizzle-orm";
import { maskAddress } from "../config";
import type { DB } from "../db/client";
import type { Exchange } from "../../lib/enums";
import * as s from "../db/schema";

export const LOCK_TTL_MS = 5 * 60_000;
export type SyncTrigger = "manual" | "auto" | "cron" | "range" | "backfill";

export type SyncProgress = {
  phase: "fills" | "rebuild" | "orders" | "positions" | "funding" | "ledger";
  page?: number;
  fetched?: number;
  inserted?: number;
  detail?: string;
};

export type WalletSyncResult = {
  walletId: string;
  label: string;
  exchange: Exchange;
  status: "success" | "partial" | "error" | "skipped";
  done: boolean;
  pages: number;
  fillsFetched: number;
  fillsNew: number;
  tradesTouched: number;
  gapsDetected: number;
  fundingNew: number;
  openPositions: number;
  ordersStored: number;
  protectionUpdated: number;
  ledgerNew: number;
  error?: string;
};

type Wallet = typeof s.wallets.$inferSelect;

export const emptyResult = (w: Wallet): WalletSyncResult => ({
  walletId: w.id,
  label: w.label,
  exchange: w.exchange,
  status: "success",
  done: true,
  pages: 0,
  fillsFetched: 0,
  fillsNew: 0,
  tradesTouched: 0,
  gapsDetected: 0,
  fundingNew: 0,
  openPositions: 0,
  ordersStored: 0,
  protectionUpdated: 0,
  ledgerNew: 0,
});

/** Strip anything that looks like an address or a token from error text before it is stored or shown. */
export function sanitizeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  // a failed query carries its SQL and parameters
  if (msg.startsWith("Failed query")) return "database query failed";
  return msg
    .replace(/0x[0-9a-fA-F]{40}/g, (m) => maskAddress(m))
    .replace(/ro:\d+:(single|all):\S+/g, "ro:…")
    .slice(0, 500);
}

/**
 * What a scheduled run reports. Only a Hyperliquid failure fails it (502, which alerts): a Lighter token can expire,
 * and that shows on the wallet card and in the sync warnings instead.
 */
export function cronOutcome(results: Pick<WalletSyncResult, "status" | "exchange">[]) {
  const failed = (x: Exchange) => results.some((r) => r.status === "error" && r.exchange === x);
  return { status: failed("hyperliquid") ? 502 : 200, lighterOk: !failed("lighter") };
}

/** Start a run, or null when one is already going for this wallet (stale locks expire). */
export async function beginRun(
  db: DB,
  walletId: string,
  o: { trigger: SyncTrigger; startedAt: number; range?: { start: number; end: number } },
): Promise<string | null> {
  const running = await db
    .select({ id: s.syncRuns.id })
    .from(s.syncRuns)
    .where(
      and(
        eq(s.syncRuns.walletId, walletId),
        eq(s.syncRuns.status, "running"),
        gt(s.syncRuns.startedAt, o.startedAt - LOCK_TTL_MS),
      ),
    )
    .limit(1);
  if (running.length) return null;
  const [run] = await db
    .insert(s.syncRuns)
    .values({
      walletId,
      trigger: o.trigger,
      rangeStart: o.range?.start ?? null,
      rangeEnd: o.range?.end ?? null,
      startedAt: o.startedAt,
      status: "running",
    })
    .returning({ id: s.syncRuns.id });
  return run.id;
}

/** `historyLimit`: with that many fills the exchange may no longer serve the oldest ones. */
export async function finishRun(
  db: DB,
  runId: string,
  result: WalletSyncResult,
  o: { finishedAt: number; historyLimit?: number },
) {
  const [agg] = await db
    .select({ first: min(s.fills.time), last: max(s.fills.time), n: sql<number>`count(*)` })
    .from(s.fills)
    .where(eq(s.fills.walletId, result.walletId));
  await db
    .update(s.wallets)
    .set({
      lastSyncedAt: o.finishedAt,
      ...(result.status !== "error" ? { lastSuccessAt: o.finishedAt } : {}),
      lastFillTime: agg?.last ?? null,
      oldestFillTime: agg?.first ?? null,
      historyTruncated: o.historyLimit !== undefined && Number(agg?.n ?? 0) >= o.historyLimit,
    })
    .where(eq(s.wallets.id, result.walletId));
  await db
    .update(s.syncRuns)
    .set({
      finishedAt: o.finishedAt,
      status: result.status as "success" | "partial" | "error",
      pages: result.pages,
      fillsFetched: result.fillsFetched,
      fillsNew: result.fillsNew,
      tradesTouched: result.tradesTouched,
      gapsDetected: result.gapsDetected,
      done: result.done,
      error: result.error ?? null,
    })
    .where(eq(s.syncRuns.id, runId));
}
