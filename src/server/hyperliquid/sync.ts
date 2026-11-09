/**
 * Hyperliquid → database sync. Idempotent: re-running over any range never duplicates anything
 * (fills keyed by (wallet, tid), funding by (wallet, hash, coin)), and only exchange-owned columns
 * are written. Backfill and funding are resumable: cursors are saved after every page and each call
 * respects a time budget, so serverless invocations (and the UI/cron) can loop until `done`.
 */
import { and, desc, eq, gt, inArray, isNull, max, min, sql } from "drizzle-orm";
import { maskAddress } from "../config";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { insertFills, rebuildTrades } from "../reconstruct/persist";
import type { FillInput } from "../reconstruct/types";
import type { HlClient } from "./client";
import { FILLS_HISTORY_LIMIT, FILLS_PAGE_LIMIT, TIME_RANGE_PAGE_LIMIT, type HlFill, type HlPosition } from "./schemas";

export const INCREMENTAL_OVERLAP_MS = 10 * 60_000;
export const LOCK_TTL_MS = 5 * 60_000;

export type SyncProgress = { phase: "fills" | "rebuild" | "positions" | "funding"; page?: number; fetched?: number; inserted?: number; detail?: string };

export type SyncTrigger = "manual" | "auto" | "cron" | "range" | "backfill";
type Wallet = typeof s.wallets.$inferSelect;

export type WalletSyncResult = {
  walletId: string;
  label: string;
  status: "success" | "partial" | "error" | "skipped";
  done: boolean;
  pages: number;
  fillsFetched: number;
  fillsNew: number;
  tradesTouched: number;
  gapsDetected: number;
  fundingNew: number;
  openPositions: number;
  error?: string;
};

/** Strip anything that looks like an address from error text before it is stored or shown. */
export function sanitizeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/0x[0-9a-fA-F]{40}/g, (m) => maskAddress(m)).slice(0, 500);
}

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
  const result: WalletSyncResult = {
    walletId: wallet.id,
    label: wallet.label,
    status: "success",
    done: true,
    pages: 0,
    fillsFetched: 0,
    fillsNew: 0,
    tradesTouched: 0,
    gapsDetected: 0,
    fundingNew: 0,
    openPositions: 0,
  };

  // ── lock: one sync per wallet at a time (stale locks expire) ──
  const running = await db
    .select({ id: s.syncRuns.id })
    .from(s.syncRuns)
    .where(
      and(
        eq(s.syncRuns.walletId, wallet.id),
        eq(s.syncRuns.status, "running"),
        gt(s.syncRuns.startedAt, startedAt - LOCK_TTL_MS),
      ),
    )
    .limit(1);
  if (running.length) return { ...result, status: "skipped", done: false };

  const [run] = await db
    .insert(s.syncRuns)
    .values({
      walletId: wallet.id,
      trigger: opts.trigger,
      rangeStart: opts.range?.start ?? null,
      rangeEnd: opts.range?.end ?? null,
      startedAt,
      status: "running",
    })
    .returning({ id: s.syncRuns.id });

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
    }

    result.status = result.done ? "success" : "partial";
  } catch (e) {
    result.status = "error";
    result.done = false;
    result.error = sanitizeError(e);
  }

  // ── bookkeeping ──
  const [agg] = await db
    .select({ first: min(s.fills.time), last: max(s.fills.time), n: sql<number>`count(*)` })
    .from(s.fills)
    .where(eq(s.fills.walletId, wallet.id));
  const finishedAt = now();
  await db
    .update(s.wallets)
    .set({
      lastSyncedAt: finishedAt,
      ...(result.status !== "error" ? { lastSuccessAt: finishedAt } : {}),
      lastFillTime: agg?.last ?? null,
      oldestFillTime: agg?.first ?? null,
      // Hyperliquid only serves the 10k most recent fills; with that many, older history may be unreachable.
      historyTruncated: Number(agg?.n ?? 0) >= FILLS_HISTORY_LIMIT,
    })
    .where(eq(s.wallets.id, wallet.id));
  await db
    .update(s.syncRuns)
    .set({
      finishedAt,
      status: result.status as "success" | "partial" | "error",
      pages: result.pages,
      fillsFetched: result.fillsFetched,
      fillsNew: result.fillsNew,
      tradesTouched: result.tradesTouched,
      gapsDetected: result.gapsDetected,
      done: result.done,
      error: result.error ?? null,
    })
    .where(eq(s.syncRuns.id, run.id));
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
    await db.update(s.wallets).set({ lastFundingTime: start }).where(eq(s.wallets.id, wallet.id));
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

/**
 * Copy live leverage / liquidation price onto matching open trades (exchange-owned columns only).
 * Returns the number of mismatches between exchange positions and reconstructed open trades.
 */
async function applyPositions(db: DB, walletId: string, positions: HlPosition[]): Promise<number> {
  const open = await db
    .select()
    .from(s.trades)
    .where(and(eq(s.trades.walletId, walletId), eq(s.trades.status, "open"), isNull(s.trades.deletedAt)));
  const live = open.filter((t) => !t.flags?.superseded);
  const byCoin = new Map(positions.map((p) => [p.coin, p]));
  let mismatches = 0;
  for (const t of live) {
    const p = byCoin.get(t.coin);
    if (!p) {
      mismatches++;
      continue;
    }
    await db
      .update(s.trades)
      .set({
        leverage: p.leverage?.value ?? null,
        liqPx: p.liquidationPx != null ? Number(p.liquidationPx) : null,
      })
      .where(eq(s.trades.id, t.id));
  }
  const openCoins = new Set(live.map((t) => t.coin));
  for (const p of positions) if (!openCoins.has(p.coin)) mismatches++;
  return mismatches;
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
  for (const w of wallets) {
    const remaining = opts.budgetMs === undefined ? undefined : Math.max(0, opts.budgetMs - (now() - started));
    results.push(
      await syncWallet(db, client, w, {
        ...opts,
        budgetMs: remaining,
        onProgress: opts.onProgress ? (e) => opts.onProgress!(w.label, e) : undefined,
      }),
    );
  }
  return { done: results.every((r) => r.done), results };
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
