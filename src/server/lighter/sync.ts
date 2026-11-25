/**
 * Lighter → database sync. Idempotent like the Hyperliquid one, and it writes exchange-owned columns only.
 *
 * Lighter pages newest first with an opaque cursor, so a pass that stops halfway leaves a hole behind it. Trades are
 * therefore rebuilt, and `fills_through` moved, only when a pass reaches its end: until then the cursor is saved
 * after every page and the next call carries on from it. (Rebuilding on half the history would give trades the wrong
 * first fill, and so a different identity once the rest arrives.)
 */
import { and, eq, inArray, isNull, like, min, ne, sql } from "drizzle-orm";
import { getConfig } from "../config";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { attributeFunding } from "../funding/attribute";
import { upsertOrders, type OrderRecord } from "../hyperliquid/orders";
import { applyPositions, type LivePositionInfo } from "../sync/positions";
import { applyProtection } from "../protection/apply";
import { insertFills, rebuildTrades } from "../reconstruct/persist";
import type { FillInput } from "../reconstruct/types";
import {
  beginRun,
  emptyResult,
  finishRun,
  sanitizeError,
  type SyncProgress,
  type SyncTrigger,
  type WalletSyncResult,
} from "../sync/runs";
import { LighterApiError, type LighterAuth, type LighterClient } from "./client";
import {
  isPerp,
  mapDeposit,
  mapFill,
  mapFunding,
  mapOrder,
  mapTransfer,
  mapWithdraw,
  versionOid,
  type LedgerRow,
  type MappedOrder,
} from "./map";
import type { LtAccount, LtOrder, LtPosition } from "./schemas";
import { openToken } from "./token";

type Wallet = typeof s.wallets.$inferSelect;
type State = typeof s.lighterState.$inferSelect;
export type LighterDeps = { client: LighterClient; tokenSecret: string | undefined };

/** every pass re-reads this much before the last one ended */
export const OVERLAP_MS = 10 * 60_000;
const DAY = 86_400_000;
const FUNDING_WINDOW_MS = 30 * DAY;
const FUNDING_OVERLAP_MS = 2 * 3_600_000;
/** inactive orders are re-read from this long before the last pass, and from any order still stored as open */
const ORDERS_OVERLAP_MS = 7 * DAY;
/** the balance check may fail this long (money in flight) before the balance view stops using the wallet */
export const RECONCILE_GRACE_MS = DAY;
const MAX_LEDGER_PAGES = 50;
const UNLISTED = "market-";
const GRACE_MS = 15_000;

type Ctx = {
  outOfTime: () => boolean;
  /** well past the budget: stop, so a slow API can't run the function into its time limit */
  pastGrace: () => boolean;
  now: () => number;
  result: WalletSyncResult;
  onProgress?: (e: SyncProgress) => void;
};

export async function syncLighterWallet(
  db: DB,
  deps: LighterDeps,
  wallet: Wallet,
  opts: {
    trigger: SyncTrigger;
    budgetMs?: number;
    now?: () => number;
    onProgress?: (e: SyncProgress) => void;
  },
): Promise<WalletSyncResult> {
  const now = opts.now ?? Date.now;
  const startedAt = now();
  const deadline = startedAt + (opts.budgetMs ?? Infinity);
  const result = emptyResult(wallet);
  const runId = await beginRun(db, wallet.id, { trigger: opts.trigger, startedAt });
  if (!runId) return { ...result, status: "skipped", done: false };
  const ctx: Ctx = {
    outOfTime: () => now() >= deadline,
    pastGrace: () => now() >= deadline + GRACE_MS,
    now,
    result,
    onProgress: opts.onProgress,
  };
  const { client } = deps;
  /** a part that fails is reported but never blocks the others */
  const part = async (name: string, fn: () => Promise<void>) => {
    try {
      if (ctx.pastGrace()) throw new Error("no time left, next sync");
      await fn();
    } catch (e) {
      result.error = [result.error, `${name}: ${sanitizeError(e)}`].filter(Boolean).join("; ");
    }
  };

  try {
    const auth = await authFor(db, deps, wallet, now());
    const fillsDone = await syncFills(db, client, wallet, auth, ctx);
    if (!fillsDone) result.done = false;
    else {
      await part("orders", () => syncOrders(db, client, wallet, auth, ctx));
      let account: LtAccount | null = null;
      await part("positions", async () => {
        account = await client.account(auth.account);
        const open = openPositions(account);
        result.openPositions = open.length;
        result.gapsDetected += await applyPositions(db, wallet.id, open.map(toLive));
      });
      await part("funding", () => syncFunding(db, client, wallet, auth, ctx));
      await part("ledger", () => syncLedger(db, client, wallet, auth, account, ctx));
    }
    result.status = result.done ? "success" : "partial";
  } catch (e) {
    result.status = "error";
    result.done = false;
    result.error = [sanitizeError(e), result.error].filter(Boolean).join("; ");
  }
  await finishRun(db, runId, result, { finishedAt: now() });
  return result;
}

async function authFor(db: DB, deps: LighterDeps, wallet: Wallet, now: number): Promise<LighterAuth> {
  const st = await db.query.lighterState.findFirst({ where: eq(s.lighterState.walletId, wallet.id) });
  if (!st?.tokenEnc) throw new Error("No Lighter token: paste a read-only token in Settings → Wallets.");
  if (st.tokenExpiresAt !== null && st.tokenExpiresAt <= now)
    throw new Error("The Lighter token has expired: paste a new read-only token in Settings → Wallets.");
  if (!deps.tokenSecret) throw new Error("AUTH_SECRET is not set, so the Lighter token can't be read.");
  return { token: openToken(st.tokenEnc, deps.tokenSecret), account: wallet.accountIndex };
}

const loadState = async (db: DB, walletId: string): Promise<State> =>
  (await db.query.lighterState.findFirst({ where: eq(s.lighterState.walletId, walletId) }))!;
const saveState = (db: DB, walletId: string, set: Partial<State>) =>
  db.update(s.lighterState).set(set).where(eq(s.lighterState.walletId, walletId));

async function includeSpot(db: DB): Promise<boolean> {
  const row = await db.query.settings.findFirst({ where: eq(s.settings.key, "include_spot") });
  return row?.value === true;
}

// ─── fills ───────────────────────────────────────────────────────────────────────
async function syncFills(
  db: DB,
  client: LighterClient,
  wallet: Wallet,
  auth: LighterAuth,
  ctx: Ctx,
): Promise<boolean> {
  const st = await loadState(db, wallet.id);
  const through = st.fillsThrough;
  let cursor = st.fillsCursor;
  let passThrough = cursor ? st.passThrough : null;
  let resumed = !!cursor;
  const touched = new Set<string>();

  for (let first = true; ; first = false) {
    if (!first && ctx.outOfTime()) return false;
    let page: Awaited<ReturnType<LighterClient["trades"]>>;
    try {
      page = await client.trades(auth, cursor);
    } catch (e) {
      // a saved cursor the API no longer accepts: start the pass again (fills already stored are skipped)
      if (first && resumed && e instanceof LighterApiError && e.status === 400) {
        await saveState(db, wallet.id, { fillsCursor: null, passThrough: null });
        cursor = null;
        passThrough = null;
        resumed = false;
        page = await client.trades(auth, null);
      } else throw e;
    }
    ctx.result.pages++;
    ctx.result.fillsFetched += page.rows.length;
    const fills: FillInput[] = [];
    for (const t of page.rows) {
      if (!isPerp(t)) continue; // spot and binary options aren't journalled
      const f = mapFill(t, auth.account, wallet.address);
      if (f) fills.push(f);
      else ctx.result.gapsDetected++;
    }
    const { inserted } = await insertFills(db, wallet.id, fills);
    ctx.result.fillsNew += inserted;
    for (const f of fills) touched.add(f.coin);
    const times = page.rows.map((t) => t.timestamp);
    if (times.length && passThrough === null) passThrough = Math.max(...times);
    ctx.onProgress?.({
      phase: "fills",
      page: ctx.result.pages,
      fetched: page.rows.length,
      inserted: ctx.result.fillsNew,
    });

    const reachedKnown = through !== null && times.length > 0 && Math.min(...times) < through - OVERLAP_MS;
    const end = !page.next || page.next === cursor || !page.rows.length || reachedKnown;
    if (!end) {
      cursor = page.next;
      await saveState(db, wallet.id, { fillsCursor: cursor, passThrough });
      continue;
    }

    // the pass is complete: rebuild first, so a failure here leaves the pass open and it is tried again
    if (touched.size || resumed) {
      const r = await rebuildTrades(db, {
        walletId: wallet.id,
        accountId: wallet.accountId,
        // a resumed pass doesn't know which coins its earlier calls touched: rebuild them all
        coins: resumed ? undefined : [...touched],
        includeSpot: await includeSpot(db),
      });
      ctx.result.tradesTouched = r.created + r.updated;
      ctx.onProgress?.({
        phase: "rebuild",
        detail: `${r.created} new, ${r.updated} updated, ${r.superseded} superseded`,
      });
    }
    await saveState(db, wallet.id, {
      fillsCursor: null,
      passThrough: null,
      fillsThrough: Math.max(through ?? 0, passThrough ?? 0) || null,
    });
    if (!wallet.backfillCompletedAt)
      await db.update(s.wallets).set({ backfillCompletedAt: ctx.now() }).where(eq(s.wallets.id, wallet.id));
    return true;
  }
}

// ─── orders → stop loss / take profit ────────────────────────────────────────────
async function syncOrders(db: DB, client: LighterClient, wallet: Wallet, auth: LighterAuth, ctx: Ctx) {
  const st = await loadState(db, wallet.id);
  const now = ctx.now();
  const store = async (rows: LtOrder[]) => {
    ctx.result.ordersStored += await storeLighterOrders(
      db,
      wallet.id,
      rows.filter(isPerp).map((o) => mapOrder(wallet.id, o)),
    );
  };
  let cursor = st.ordersCursor;
  let since = st.ordersPassSince ?? 0;
  let passStart = st.ordersPassStart ?? now;
  if (!cursor) {
    // back to the creation of every order still stored as open, whose end is yet to be read. (Not placed_at: an edit
    // or a parent's fill moves that forward, and the API's window is by creation.)
    const [open] = await db
      .select({ first: sql<number | null>`min(json_extract(${s.orders.raw}, '$.createdAt'))` })
      .from(s.orders)
      .where(and(eq(s.orders.walletId, wallet.id), eq(s.orders.status, "open")));
    since =
      st.ordersThrough === null
        ? 0
        : Math.max(0, Math.min(st.ordersThrough - ORDERS_OVERLAP_MS, open?.first ?? Infinity));
    passStart = now;
  }
  // live orders first: one that fills in between is then read again, as inactive
  await store(await client.activeOrders(auth));
  ctx.result.pages++;
  for (let first = true; ; first = false) {
    if (!first && ctx.outOfTime()) {
      ctx.result.done = false;
      break;
    }
    let page: Awaited<ReturnType<LighterClient["inactiveOrders"]>>;
    const window = { start: since, end: passStart + DAY };
    try {
      page = await client.inactiveOrders(auth, window, cursor);
    } catch (e) {
      if (!(first && cursor && e instanceof LighterApiError && e.status === 400)) throw e;
      cursor = null; // the saved cursor is no longer accepted: read the same window from its top
      page = await client.inactiveOrders(auth, window, null);
    }
    ctx.result.pages++;
    await store(page.rows);
    if (page.next && page.next !== cursor && page.rows.length) {
      cursor = page.next;
      await saveState(db, wallet.id, {
        ordersCursor: cursor,
        ordersPassSince: since,
        ordersPassStart: passStart,
      });
      continue;
    }
    await saveState(db, wallet.id, {
      ordersThrough: passStart,
      ordersCursor: null,
      ordersPassSince: null,
      ordersPassStart: null,
    });
    st.ordersThrough = passStart;
    break;
  }
  // on part of the first history a later stop could be taken for a trade's first one
  if (st.ordersThrough !== null) {
    const p = await applyProtection(db, wallet.id, { now });
    ctx.result.protectionUpdated = p.trades;
  }
  ctx.onProgress?.({
    phase: "orders",
    detail: `${ctx.result.ordersStored} orders, ${ctx.result.protectionUpdated} trade(s) updated`,
  });
}

/**
 * Store mapped orders. Two Lighter differences are settled here:
 *  - a stop attached to an entry order exists before the entry fills, so it only counts from the parent's first fill;
 *  - an order edited in place keeps its index with a new trigger price. What was stored becomes a closed version of
 *    its own, so the first stop stays the first stop and the edit shows as a stop move.
 */
export async function storeLighterOrders(db: DB, walletId: string, mapped: MappedOrder[]): Promise<number> {
  // the same order can be in both lists (or twice): the latest reading wins
  const byOid = new Map<number, MappedOrder>();
  for (const m of mapped) {
    const prev = byOid.get(m.oid);
    if (!prev || (prev.endedAt === null && m.endedAt !== null) || m.statusAt > prev.statusAt)
      byOid.set(m.oid, m);
  }
  const list = [...byOid.values()];

  const parents = [...new Set(list.flatMap((m) => (m.parentOid ? [m.parentOid] : [])))];
  const firstFill = new Map<number, number>();
  for (let i = 0; i < parents.length; i += 200) {
    for (const r of await db
      .select({ oid: s.fills.oid, t: min(s.fills.time) })
      .from(s.fills)
      .where(and(eq(s.fills.walletId, walletId), inArray(s.fills.oid, parents.slice(i, i + 200))))
      .groupBy(s.fills.oid))
      if (r.t !== null) firstFill.set(r.oid, Number(r.t));
  }

  const stored = new Map<number, typeof s.orders.$inferSelect>();
  const oids = list.map((m) => m.oid);
  for (let i = 0; i < oids.length; i += 200)
    for (const r of await db
      .select()
      .from(s.orders)
      .where(and(eq(s.orders.walletId, walletId), inArray(s.orders.oid, oids.slice(i, i + 200)))))
      stored.set(r.oid, r);

  const out: OrderRecord[] = [];
  const edited: { record: OrderRecord }[] = [];
  for (const { parentOid, ...m } of list) {
    const rec: OrderRecord = { ...m };
    const filledAt = parentOid ? firstFill.get(parentOid) : undefined;
    if (filledAt !== undefined && filledAt > rec.placedAt) rec.placedAt = filledAt;
    if (rec.endedAt != null && rec.endedAt < rec.placedAt) rec.endedAt = rec.placedAt;
    const prev = stored.get(rec.oid);
    const movedPx =
      prev?.isTrigger &&
      rec.isTrigger &&
      prev.triggerPx !== null &&
      rec.triggerPx != null &&
      prev.triggerPx !== rec.triggerPx;
    if (prev && movedPx && prev.endedAt === null) {
      const movedAt = Math.max(rec.statusAt, prev.placedAt + 1);
      out.push({
        ...prev,
        oid: versionOid(prev.oid, prev.triggerPx!, prev.placedAt),
        status: "modified",
        statusAt: movedAt,
        endedAt: movedAt,
      });
      const endedAt = rec.endedAt == null ? null : Math.max(rec.endedAt, movedAt);
      edited.push({
        record: { ...rec, placedAt: movedAt, statusAt: Math.max(rec.statusAt, movedAt), endedAt },
      });
    } else {
      // an edited order keeps the time its current price was set, however often it is read again
      if (prev && prev.placedAt > rec.placedAt) {
        rec.placedAt = prev.placedAt;
        if (rec.endedAt != null && rec.endedAt < rec.placedAt) rec.endedAt = rec.placedAt;
      }
      out.push(rec);
    }
  }
  await db.transaction(async (tx) => {
    await upsertOrders(tx as unknown as DB, out);
    for (const { record } of edited) {
      const { walletId: w, oid, ...set } = record;
      await tx
        .update(s.orders)
        .set(set)
        .where(and(eq(s.orders.walletId, w), eq(s.orders.oid, oid)));
    }
    // the shared upsert keeps the earliest placement; for a child order the parent's fill is the later, right one
    for (const r of out) {
      if (r.placedAt > (stored.get(r.oid)?.placedAt ?? Infinity))
        await tx
          .update(s.orders)
          .set({ placedAt: r.placedAt })
          .where(and(eq(s.orders.walletId, walletId), eq(s.orders.oid, r.oid)));
    }
  });
  return list.length;
}

// ─── positions ───────────────────────────────────────────────────────────────────
export const openPositions = (a: LtAccount): LtPosition[] =>
  (a.positions ?? []).filter((p) => Number(p.position) !== 0);

/** margin fraction is a percentage: "20.00" is 5x */
export function leverageOf(p: LtPosition): number | null {
  const f = Number(p.initial_margin_fraction);
  return Number.isFinite(f) && f > 0 ? Math.round((100 / f) * 100) / 100 : null;
}
export const liquidationOf = (p: LtPosition): string | null =>
  Number(p.liquidation_price) > 0 ? p.liquidation_price! : null;

const toLive = (p: LtPosition): LivePositionInfo => {
  const lev = leverageOf(p);
  return {
    coin: p.symbol,
    leverage: lev === null ? undefined : { type: "cross", value: lev },
    liquidationPx: liquidationOf(p),
  };
};

// ─── funding ─────────────────────────────────────────────────────────────────────
/** Windows of 30 days, oldest first; the saved time moves only once a whole window is stored. */
async function syncFunding(db: DB, client: LighterClient, wallet: Wallet, auth: LighterAuth, ctx: Ctx) {
  const fresh = (await db.query.wallets.findFirst({ where: eq(s.wallets.id, wallet.id) }))!;
  const [firstFill] = await db
    .select({ t: min(s.fills.time) })
    .from(s.fills)
    .where(eq(s.fills.walletId, wallet.id));
  const now = ctx.now();
  const complete = async () => {
    if (!fresh.fundingCompletedAt)
      await db.update(s.wallets).set({ fundingCompletedAt: now }).where(eq(s.wallets.id, wallet.id));
  };
  // no fills, no position, so nothing to have paid
  if (firstFill?.t == null) return complete();
  let markets = await client.markets();
  let refreshed = false;
  // a payment whose market wasn't listed when it was stored takes its name once it is
  const unnamed = await db
    .selectDistinct({ coin: s.fundingEvents.coin })
    .from(s.fundingEvents)
    .where(and(eq(s.fundingEvents.walletId, wallet.id), like(s.fundingEvents.coin, `${UNLISTED}%`)));
  for (const { coin } of unnamed) {
    const name = markets.get(Number(coin.slice(UNLISTED.length)));
    if (!name) continue;
    const mine = and(eq(s.fundingEvents.walletId, wallet.id), eq(s.fundingEvents.coin, coin));
    await db.transaction(async (tx) => {
      // a time already stored under the real name is the same payment: drop the stand-in, rename the rest
      const real = await tx
        .select({ time: s.fundingEvents.time })
        .from(s.fundingEvents)
        .where(and(eq(s.fundingEvents.walletId, wallet.id), eq(s.fundingEvents.coin, name)));
      const times = real.map((r) => r.time);
      for (let i = 0; i < times.length; i += 400)
        await tx
          .delete(s.fundingEvents)
          .where(and(mine, inArray(s.fundingEvents.time, times.slice(i, i + 400))));
      await tx.update(s.fundingEvents).set({ coin: name }).where(mine);
    });
  }
  let start =
    fresh.lastFundingTime === null ? Number(firstFill.t) : fresh.lastFundingTime - FUNDING_OVERLAP_MS;
  let unknown = 0;
  for (let firstPage = true; ;) {
    const end = Math.min(now, start + FUNDING_WINDOW_MS);
    let cursor: string | null = null;
    for (;;) {
      if (!firstPage && ctx.outOfTime()) {
        ctx.result.done = false;
        return;
      }
      firstPage = false;
      const page: Awaited<ReturnType<LighterClient["fundings"]>> = await client.fundings(
        auth,
        { start, end },
        cursor,
      );
      ctx.result.pages++;
      // the market list is cached for a day: look again before treating a market as unlisted
      if (!refreshed && page.rows.some((f) => !markets.has(f.market_id))) {
        refreshed = true;
        markets = await client.markets({ fresh: true });
      }
      // an unlisted market's payment still moved the balance: keep it under a stand-in name, unattributed
      const named = page.rows.map((f) => {
        const coin = markets.get(f.market_id);
        if (!coin) unknown++;
        return mapFunding(wallet.id, f, coin ?? `${UNLISTED}${f.market_id}`);
      });
      // the same payment may already be stored under another name (listed or delisted since it was first read)
      const same = (r: { hash: string; time: number; usdc: string; szi: string; fundingRate: string }) =>
        [r.hash, r.time, r.usdc, r.szi, r.fundingRate].join("|");
      const pageTimes = [...new Set(named.map((r) => r.time))];
      const stored = pageTimes.length
        ? await db
            .select()
            .from(s.fundingEvents)
            .where(and(eq(s.fundingEvents.walletId, wallet.id), inArray(s.fundingEvents.time, pageTimes)))
        : [];
      const known = new Set(stored.map(same));
      const rows = named.filter((r) => !known.has(same(r)));
      for (let i = 0; i < rows.length; i += 100) {
        const res = await db
          .insert(s.fundingEvents)
          .values(rows.slice(i, i + 100))
          .onConflictDoNothing()
          .returning({ hash: s.fundingEvents.hash });
        ctx.result.fundingNew += res.length;
      }
      ctx.onProgress?.({
        phase: "funding",
        page: ctx.result.pages,
        fetched: page.rows.length,
        inserted: ctx.result.fundingNew,
      });
      if (!page.next || page.next === cursor || !page.rows.length) break;
      cursor = page.next;
    }
    await db.update(s.wallets).set({ lastFundingTime: end }).where(eq(s.wallets.id, wallet.id));
    if (end >= now) break;
    start = end - FUNDING_OVERLAP_MS;
  }
  await complete();
  await attributeFunding(db, wallet.id);
  if (unknown)
    throw new Error(`${unknown} payment(s) on a market the exchange no longer lists, kept without a trade`);
}

// ─── ledger ──────────────────────────────────────────────────────────────────────
async function allPages<T>(
  fetchPage: (cursor: string | null) => Promise<{ rows: T[]; next: string | null }>,
  ctx: Ctx,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < MAX_LEDGER_PAGES; i++) {
    if (ctx.pastGrace()) throw new Error("no time left, next sync");
    const page = await fetchPage(cursor);
    ctx.result.pages++;
    rows.push(...page.rows);
    if (!page.next || page.next === cursor || !page.rows.length) return rows;
    cursor = page.next;
  }
  throw new Error("too many pages");
}

/** These lists are short and an entry's status changes later, so they are read whole and stored by id every time. */
async function syncLedger(
  db: DB,
  client: LighterClient,
  wallet: Wallet,
  auth: LighterAuth,
  account: LtAccount | null,
  ctx: Ctx,
) {
  // always runs: it is a handful of requests, and skipping it when time is short would let a tight budget starve it
  const unified = account ? account.account_trading_mode === 1 : wallet.accountMode === "lighterUnified";
  const usdcId = await client.usdcAssetId();
  const rows: LedgerRow[] = [
    ...(await allPages((c) => client.deposits(auth, wallet.address, c), ctx)).map((d) =>
      mapDeposit(d, usdcId),
    ),
    ...(await allPages((c) => client.withdrawals(auth, c), ctx)).map((w) => mapWithdraw(w, usdcId)),
    ...(await allPages((c) => client.transfers(auth, c), ctx)).map((t) => mapTransfer(t, usdcId, unified)),
  ];
  const known = new Set(
    (
      await db
        .select({ uid: s.ledgerEvents.uid })
        .from(s.ledgerEvents)
        .where(eq(s.ledgerEvents.walletId, wallet.id))
    ).map((r) => r.uid),
  );
  ctx.result.ledgerNew = rows.filter((r) => !known.has(r.uid)).length;
  for (let i = 0; i < rows.length; i += 100) {
    await db
      .insert(s.ledgerEvents)
      .values(rows.slice(i, i + 100).map((r) => ({ walletId: wallet.id, ...r })))
      .onConflictDoUpdate({
        target: [s.ledgerEvents.walletId, s.ledgerEvents.uid],
        set: {
          kind: sql`excluded.kind`,
          usd: sql`excluded.usd`,
          time: sql`excluded.time`,
          delta: sql`excluded.delta`,
          hash: sql`excluded.hash`,
        },
      });
  }
  // "lighterUnified" is this wallet's own mode: it is not Hyperliquid's "unifiedAccount", which counts spot fills
  await db
    .update(s.wallets)
    .set({ lastLedgerTime: ctx.now(), accountMode: unified ? "lighterUnified" : null })
    .where(eq(s.wallets.id, wallet.id));
  if (account) await reconcile(db, wallet.id, account, ctx);
  ctx.onProgress?.({
    phase: "ledger",
    detail: `${ctx.result.ledgerNew} new ledger entr${ctx.result.ledgerNew === 1 ? "y" : "ies"}`,
  });
}

export type Reconciliation = { expected: number; actual: number; ok: boolean };

/** Stored ledger + realised P&L − fees + funding, against the exchange's own collateral. */
export async function reconciliation(db: DB, walletId: string, account: LtAccount): Promise<Reconciliation> {
  const sum = async (q: Promise<{ v: number | null }[]>) => Number((await q)[0]?.v ?? 0);
  const ledger = await sum(
    db
      .select({ v: sql<number>`sum(${s.ledgerEvents.usd})` })
      .from(s.ledgerEvents)
      .where(eq(s.ledgerEvents.walletId, walletId)),
  );
  const pnl = await sum(
    db
      .select({ v: sql<number>`sum(cast(${s.fills.closedPnl} as real) - cast(${s.fills.fee} as real))` })
      .from(s.fills)
      .where(and(eq(s.fills.walletId, walletId), ne(s.fills.marketType, "spot"))),
  );
  const funding = await sum(
    db
      .select({ v: sql<number>`sum(cast(${s.fundingEvents.usdc} as real))` })
      .from(s.fundingEvents)
      .where(eq(s.fundingEvents.walletId, walletId)),
  );
  const expected = ledger + pnl + funding;
  // `collateral` is documented without saying whether open P&L is in it: accept either reading while a position is open
  const open = openPositions(account).reduce((a, p) => a + Number(p.unrealized_pnl ?? 0), 0);
  const collateral = Number(account.collateral);
  const near = (x: number) => Math.abs(x - expected) <= Math.max(2, 0.005 * Math.abs(x));
  const actual = near(collateral) || !near(collateral - open) ? collateral : collateral - open;
  return { expected, actual, ok: near(actual) };
}

/**
 * The balance view only uses a wallet whose stored history adds up to what the exchange says it holds. Until it does
 * (or after a day of not doing so) the wallet's ledger counts as incomplete and the dashboard falls back.
 */
async function reconcile(db: DB, walletId: string, account: LtAccount, ctx: Ctx) {
  const st = await loadState(db, walletId);
  const r = await reconciliation(db, walletId, account);
  const now = ctx.now();
  if (r.ok) {
    await saveState(db, walletId, { reconciledAt: now });
    await db
      .update(s.wallets)
      .set({ ledgerCompletedAt: now })
      .where(and(eq(s.wallets.id, walletId), isNull(s.wallets.ledgerCompletedAt)));
  } else if (st.reconciledAt === null || now - st.reconciledAt > RECONCILE_GRACE_MS) {
    await db.update(s.wallets).set({ ledgerCompletedAt: null }).where(eq(s.wallets.id, walletId));
  }
}

/** Deps from the app's configuration. */
export async function lighterDeps(): Promise<LighterDeps> {
  const { getLighterClient } = await import("./index");
  return { client: getLighterClient(), tokenSecret: getConfig().lighter.tokenSecret };
}
