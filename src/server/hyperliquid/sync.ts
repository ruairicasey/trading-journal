/**
 * Hyperliquid → database sync. Idempotent: re-running over any range never duplicates anything
 * (fills keyed by (wallet, tid), funding by (wallet, hash, coin)), and only exchange-owned columns
 * are written. Backfill and funding are resumable: cursors are saved after every page and each call
 * respects a time budget, so serverless invocations (and the UI/cron) can loop until `done`.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { applyProtection } from "../protection/apply";
import { insertFills, rebuildTrades } from "../reconstruct/persist";
import { storeOrders } from "./orders";
import { syncLedger } from "./ledger-sync";
import { attributeFunding } from "../funding/attribute";
import type { FillInput } from "../reconstruct/types";
import { applyPositions } from "../sync/positions";
import { syncLighterWallet, type LighterDeps } from "../lighter/sync";
import {
  beginRun,
  emptyResult,
  finishRun,
  sanitizeError,
  type SyncProgress,
  type SyncTrigger,
  type WalletSyncResult,
} from "../sync/runs";
import type { HlClient } from "./client";
import { FILLS_HISTORY_LIMIT, FILLS_PAGE_LIMIT, TIME_RANGE_PAGE_LIMIT, type HlFill, type HlPosition } from "./schemas";

export { sanitizeError, LOCK_TTL_MS } from "../sync/runs";
export type { SyncProgress, SyncTrigger, WalletSyncResult } from "../sync/runs";

export const INCREMENTAL_OVERLAP_MS = 10 * 60_000;

type Wallet = typeof s.wallets.$inferSelect;

function toFillInput(f: HlFill): FillInput {
  return { ...f, builderFee: f.builderFee ?? null, liquidation: f.liquidation ?? null, twapId: f.twapId ?? null };
}

async function includeSpot(db: DB): Promise<boolean> {
  const row = await db.query.settings.findFirst({ where: eq(s.settings.key, "include_spot") });
  return row?.value === true;
}

export async function syncWallet(
  db: DB,
  client: HlClient,
  wallet: Wallet,
  opts: {
    trigger: SyncTrigger;
    range?: { start: number; end: number };
    budgetMs?: number;
    now?: () => number;
    onProgress?: (e: SyncProgress) => void;
  },
): Promise<WalletSyncResult> {
  const now = opts.now ?? Date.now;
  const startedAt = now();
  const deadline = startedAt + (opts.budgetMs ?? Infinity);
  const outOfTime = () => now() >= deadline;
  const result = emptyResult(wallet);

  // ── lock: one sync per wallet at a time ──
  const runId = await beginRun(db, wallet.id, { trigger: opts.trigger, startedAt, range: opts.range });
  if (!runId) return { ...result, status: "skipped", done: false };

  const user = wallet.address;
  const touched = new Set<string>();

  try {
    // ── 1. fills ──
    const backfilling = !opts.range && !wallet.backfillCompletedAt;
    let start = opts.range
      ? opts.range.start
      : backfilling
        ? (wallet.backfillCursor ?? 0)
        : Math.max(0, (wallet.lastFillTime ?? 0) - INCREMENTAL_OVERLAP_MS);
    const end = opts.range?.end;
    let fillsDone = false;

    while (!fillsDone) {
      if (result.pages > 0 && outOfTime()) break;
      const page = await client.userFillsByTime(user, start, end);
      result.pages++;
      result.fillsFetched += page.length;
      if (page.length) {
        const { inserted } = await insertFills(db, wallet.id, page.map(toFillInput));
        result.fillsNew += inserted;
        // Rebuild every coin on the page, not just ones with new fills (a range resync re-checks them).
        for (const c of page) touched.add(c.coin);
      }
      opts.onProgress?.({ phase: "fills", page: result.pages, fetched: page.length, inserted: result.fillsNew });

      if (page.length < FILLS_PAGE_LIMIT) {
        fillsDone = true;
      } else {
        const lastTime = page[page.length - 1].time;
        // Next page starts at the last timestamp (inclusive → same-ms fills repeat; deduped by tid).
        // If a whole page shares one millisecond we can't make progress that way: step past it.
        if (lastTime <= start) {
          start = start + 1;
          result.gapsDetected++;
        } else {
          start = lastTime;
        }
      }
      if (backfilling) {
        await db
          .update(s.wallets)
          .set({ backfillCursor: start, ...(fillsDone ? { backfillCompletedAt: now() } : {}) })
          .where(eq(s.wallets.id, wallet.id));
      }
    }
    if (!fillsDone) result.done = false;

    // ── 2. rebuild trades for touched coins (even mid-backfill, so data shows up early) ──
    if (touched.size) {
      const r = await rebuildTrades(db, {
        walletId: wallet.id,
        accountId: wallet.accountId,
        coins: [...touched],
        includeSpot: await includeSpot(db),
      });
      result.tradesTouched = r.created + r.updated;
      opts.onProgress?.({ phase: "rebuild", detail: `${r.created} new, ${r.updated} updated, ${r.superseded} superseded` });
    }

    // ── 2b. order history → SL/TP auto-detection. Every run stores the latest ~2000 order rows, so history
    // accumulates beyond Hyperliquid's window. Non-fatal: a problem here never blocks fills or funding.
    if (!opts.range) {
      try {
        const hist = await client.historicalOrders(user);
        result.ordersStored = (await storeOrders(db, wallet.id, hist)).orders;
        const p = await applyProtection(db, wallet.id, { now: now() });
        result.protectionUpdated = p.trades;
        opts.onProgress?.({ phase: "orders", detail: `${result.ordersStored} orders, ${p.trades} trade(s) updated` });
      } catch (e) {
        result.error = `orders: ${sanitizeError(e)}`;
      }
    }

    // ── 3. open positions (only once fills are caught up; positions are "now") ──
    if (fillsDone && !opts.range) {
      const positions = await fetchPositions(client, user);
      result.openPositions = positions.length;
      opts.onProgress?.({ phase: "positions", detail: `${positions.length} open position(s)` });
      result.gapsDetected += await applyPositions(db, wallet.id, positions);
    }

    // ── 4. funding (raw storage; attribution in Phase 2) — resumable like the backfill ──
    // At least one page per call once fills are caught up, so a tight budget can never starve it.
    if (fillsDone && !opts.range) {
      const f = await syncFunding(db, client, wallet, { outOfTime, now, onProgress: opts.onProgress });
      result.fundingNew = f.inserted;
      result.pages += f.pages;
      result.gapsDetected += f.stalls;
      if (!f.done) result.done = false;
      // re-attribute ALL of the wallet's funding every run: cheap (only changed rows are written) and it also
      // picks up payments stored before attribution existed or before a rebuild moved trade boundaries
      await attributeFunding(db, wallet.id);
    }

    // ── 5. ledger (deposits, withdrawals, transfers): resumable; a problem here never blocks the rest ──
    if (fillsDone && !opts.range) {
      try {
        const l = await syncLedger(db, client, wallet, { outOfTime, onProgress: (detail) => opts.onProgress?.({ phase: "ledger", detail }) });
        result.ledgerNew = l.inserted;
        result.pages += l.pages;
        if (!l.done) result.done = false;
      } catch (e) {
        result.error = [result.error, `ledger: ${sanitizeError(e)}`].filter(Boolean).join("; ");
      }
    }

    result.status = result.done ? "success" : "partial";
  } catch (e) {
    result.status = "error";
    result.done = false;
    result.error = [sanitizeError(e), result.error].filter(Boolean).join("; ");
  }

  // Hyperliquid only serves the 10k most recent fills; with that many, older history may be unreachable.
  await finishRun(db, runId, result, { finishedAt: now(), historyLimit: FILLS_HISTORY_LIMIT });
  return result;
}

/** Funding history, ≤500 per page, cursor (`last_funding_time`) saved after every page. */
async function syncFunding(
  db: DB,
  client: HlClient,
  wallet: Wallet,
  ctx: { outOfTime: () => boolean; now: () => number; onProgress?: (e: SyncProgress) => void },
) {
  const fresh = await db.query.wallets.findFirst({ where: eq(s.wallets.id, wallet.id) });
  let start = fresh?.lastFundingTime ?? fresh?.oldestFillTime ?? 0;
  let pages = 0;
  let inserted = 0;
  let stalls = 0;
  for (;;) {
    if (pages > 0 && ctx.outOfTime()) return { done: false, pages, inserted, stalls };
    const page = await client.userFunding(wallet.address, start);
    pages++;
    if (page.length) {
      const rows = page.map((p) => ({
        walletId: wallet.id,
        hash: p.hash,
        coin: p.delta.coin,
        time: p.time,
        usdc: p.delta.usdc,
        szi: p.delta.szi,
        fundingRate: p.delta.fundingRate,
      }));
      for (let i = 0; i < rows.length; i += 100) {
        const res = await db
          .insert(s.fundingEvents)
          .values(rows.slice(i, i + 100))
          .onConflictDoNothing()
          .returning({ hash: s.fundingEvents.hash });
        inserted += res.length;
      }
    }
    ctx.onProgress?.({ phase: "funding", page: pages, fetched: page.length, inserted });
    const done = page.length < TIME_RANGE_PAGE_LIMIT;
    if (page.length) {
      const lastTime = page[page.length - 1].time;
      if (!done && lastTime <= start) {
        start = start + 1;
        stalls++;
      } else {
        start = lastTime;
      }
    }
    await db
      .update(s.wallets)
      .set({ lastFundingTime: start, ...(done && !fresh?.fundingCompletedAt ? { fundingCompletedAt: ctx.now() } : {}) })
      .where(eq(s.wallets.id, wallet.id));
    if (done) return { done: true, pages, inserted, stalls };
  }
}

export async function fetchPositions(client: HlClient, user: string): Promise<HlPosition[]> {
  const dexes = await client.perpDexNames();
  const out: HlPosition[] = [];
  for (const dex of dexes) {
    const state = await client.clearinghouseState(user, dex);
    for (const ap of state.assetPositions) if (Number(ap.position.szi) !== 0) out.push(ap.position);
  }
  return out;
}

/** Sync every enabled wallet (auto/cron only touch wallets with auto-sync on). */
export async function syncAll(
  db: DB,
  client: HlClient,
  opts: {
    trigger: SyncTrigger;
    walletId?: string;
    range?: { start: number; end: number };
    budgetMs?: number;
    now?: () => number;
    /** how to sync Lighter wallets; without it they are left alone */
    lighter?: LighterDeps;
    onProgress?: (walletLabel: string, e: SyncProgress) => void;
  },
) {
  const now = opts.now ?? Date.now;
  const started = now();
  const wallets = await db
    .select()
    .from(s.wallets)
    .where(
      and(
        eq(s.wallets.enabled, true),
        ...(opts.walletId ? [eq(s.wallets.id, opts.walletId)] : []),
        ...(opts.trigger === "auto" || opts.trigger === "cron" ? [eq(s.wallets.autoSync, true)] : []),
      ),
    );
  const results: WalletSyncResult[] = [];
  // Hyperliquid first: a slow or failing Lighter wallet never holds its sync up
  const ordered = [...wallets].sort((a, b) => Number(a.exchange === "lighter") - Number(b.exchange === "lighter"));
  for (const w of ordered) {
    const remaining = opts.budgetMs === undefined ? undefined : Math.max(0, opts.budgetMs - (now() - started));
    if (w.exchange === "lighter") {
      // a date-range re-sync is a Hyperliquid feature; Lighter passes always cover everything since the last one
      if (!opts.lighter || (opts.range && !opts.walletId)) continue;
      results.push(
        await syncLighterWallet(db, opts.lighter, w, {
          trigger: opts.trigger,
          budgetMs: remaining,
          now: opts.now,
          onProgress: opts.onProgress ? (e) => opts.onProgress!(w.label, e) : undefined,
        }),
      );
      continue;
    }
    results.push(
      await syncWallet(db, client, w, {
        ...opts,
        budgetMs: remaining,
        onProgress: opts.onProgress ? (e) => opts.onProgress!(w.label, e) : undefined,
      }),
    );
  }
  // a failed or already-running Lighter sync has nothing to continue: it must not make callers repeat the whole round
  const settled = (r: WalletSyncResult) => r.exchange === "lighter" && (r.status === "error" || r.status === "skipped");
  return { done: results.every((r) => r.done || settled(r)), results };
}

export async function recentRuns(db: DB, walletIds: string[], limit = 10) {
  if (!walletIds.length) return [];
  return db
    .select()
    .from(s.syncRuns)
    .where(inArray(s.syncRuns.walletId, walletIds))
    .orderBy(desc(s.syncRuns.startedAt))
    .limit(limit);
}
