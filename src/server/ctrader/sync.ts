/**
 * cTrader Open API sync: tokens, account discovery, deal history → trades.
 *
 * One short WebSocket session per host per run (demo.ctraderapi.com for demo/challenge accounts, live.… for live
 * ones; a host only serves its own kind). Deals are fetched in windows of a week from the account's cursor, saved
 * idempotently (ctid, dealId), and every position they touch is rebuilt from all of its stored deals. The cursor is
 * saved after each window, so a run that hits its time budget resumes where it stopped (done: false).
 *
 * Ownership: only exchange-owned trade columns are written, keyed by external_key; the journal half of a trade, its
 * account (if you moved it) and soft deletes are never touched.
 */
import { and, asc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { INCLUDE_FUNDING_KEY } from "../funding/attribute";
import type { AppConfig } from "../config";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { decryptToken, encryptToken } from "./crypto";
import { CtraderAuthError, refreshTokens, type Tokens } from "./oauth";
import { positionTrade, toStoredDeal, type PositionTrade, type StoredDeal } from "./positions";
import {
  AccountsByTokenRes,
  AssetListRes,
  DealListRes,
  HOSTS,
  PT,
  SCOPE,
  SymbolsListRes,
  TOKEN_ERRORS,
  TraderRes,
} from "./protocol";
import { CtraderError, openSession, type CtraderSession, type TransportFactory } from "./session";

const DAY = 86_400_000;
export const WINDOW_MS = 7 * DAY;
/** each run re-reads the last hour, so a deal stamped just before the previous cursor isn't missed */
export const OVERLAP_MS = 3_600_000;
/** refresh the access token (≈30-day life) once it has less than this left */
export const REFRESH_AHEAD_MS = 7 * DAY;
const MAX_ROWS = 1000;

export type CtraderDeps = {
  cfg: AppConfig["ctrader"];
  fetch?: typeof fetch;
  transport?: TransportFactory;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const creds = (cfg: AppConfig["ctrader"]) => ({ clientId: cfg.clientId!, clientSecret: cfg.clientSecret! });
const sessionOpts = (d: CtraderDeps) => ({ transport: d.transport, sleep: d.sleep, now: d.now });

export class ReconnectNeeded extends Error {}
export class TradeScopeRefused extends Error {
  constructor() {
    super(
      "That cTrader grant allows trading. This journal only accepts view-only (accounts) access: connect again.",
    );
  }
}

// ─── tokens ─────────────────────────────────────────────────────────────────────────

export async function saveConnection(db: DB, cfg: AppConfig["ctrader"], t: Tokens): Promise<string> {
  const values = {
    accessTokenEnc: encryptToken(t.accessToken, cfg.tokenKey!),
    refreshTokenEnc: encryptToken(t.refreshToken, cfg.tokenKey!),
    accessExpiresAt: t.expiresAt,
    refreshingUntil: null,
    lastError: null,
  };
  // one connection: a new grant replaces the old one
  const existing = await db.select({ id: s.ctraderConnections.id }).from(s.ctraderConnections).limit(1);
  if (existing.length) {
    await db.update(s.ctraderConnections).set(values).where(eq(s.ctraderConnections.id, existing[0].id));
    return existing[0].id;
  }
  const [row] = await db
    .insert(s.ctraderConnections)
    .values(values)
    .returning({ id: s.ctraderConnections.id });
  return row.id;
}

/** A valid access token, refreshing it first when it's within REFRESH_AHEAD_MS of expiry. */
export async function accessToken(
  db: DB,
  d: CtraderDeps,
): Promise<{ connectionId: string; token: string } | null> {
  const now = (d.now ?? Date.now)();
  const conn = await db.query.ctraderConnections.findFirst();
  if (!conn) return null;
  const key = d.cfg.tokenKey!;
  if (conn.accessExpiresAt - now > REFRESH_AHEAD_MS)
    return { connectionId: conn.id, token: decryptToken(conn.accessTokenEnc, key) };

  // lease: refresh tokens rotate, so only one run may refresh at a time
  const got = await db
    .update(s.ctraderConnections)
    .set({ refreshingUntil: now + 60_000 })
    .where(
      and(
        eq(s.ctraderConnections.id, conn.id),
        // the tokens we read are still the stored ones (another run may have just rotated them)
        eq(s.ctraderConnections.accessExpiresAt, conn.accessExpiresAt),
        or(isNull(s.ctraderConnections.refreshingUntil), lt(s.ctraderConnections.refreshingUntil, now)),
      ),
    )
    .returning({ id: s.ctraderConnections.id });
  if (!got.length) {
    // someone else refreshed (or is refreshing): use the freshest stored token while it's still valid
    const cur =
      (await db.query.ctraderConnections.findFirst({ where: eq(s.ctraderConnections.id, conn.id) })) ?? conn;
    if (cur.accessExpiresAt > now + 300_000)
      return { connectionId: cur.id, token: decryptToken(cur.accessTokenEnc, key) };
    throw new Error("A cTrader token refresh is already in progress");
  }
  try {
    const t = await refreshTokens(
      { refreshToken: decryptToken(conn.refreshTokenEnc, key), ...creds(d.cfg) },
      d.fetch,
      now,
    );
    await saveConnection(db, d.cfg, t);
    return { connectionId: conn.id, token: t.accessToken };
  } catch (e) {
    const revoked = e instanceof CtraderAuthError && !!e.code;
    await db
      .update(s.ctraderConnections)
      .set({
        refreshingUntil: null,
        lastError: revoked ? "cTrader access expired or was revoked: connect again" : (e as Error).message,
      })
      .where(eq(s.ctraderConnections.id, conn.id));
    if (revoked) throw new ReconnectNeeded("cTrader access expired or was revoked: connect again");
    throw e;
  }
}

// ─── discovery ──────────────────────────────────────────────────────────────────────

const authAccount = (sess: CtraderSession, ctid: number, token: string) =>
  sess.request(
    PT.ACCOUNT_AUTH_REQ,
    { ctidTraderAccountId: ctid, accessToken: token },
    PT.ACCOUNT_AUTH_RES,
    z.unknown(),
  );

/**
 * Lists the accounts the grant covers and records each one. A new cTrader account gets its own journal account
 * (type prop, in its deposit currency); its starting balance is the current balance when it has no closed deals yet.
 * Refuses a grant with trading scope.
 */
export async function discoverAccounts(db: DB, d: CtraderDeps): Promise<{ found: number; added: number }> {
  const tok = await accessToken(db, d);
  if (!tok) return { found: 0, added: 0 };
  const now = (d.now ?? Date.now)();
  const list = await withSession(HOSTS.demo, d, (sess) =>
    sess.request(
      PT.GET_ACCOUNTS_BY_ACCESS_TOKEN_REQ,
      { accessToken: tok.token },
      PT.GET_ACCOUNTS_BY_ACCESS_TOKEN_RES,
      AccountsByTokenRes,
    ),
  );
  if (list.permissionScope === SCOPE.SCOPE_TRADE) throw new TradeScopeRefused();

  let added = 0;
  for (const live of [false, true]) {
    const accts = list.ctidTraderAccount.filter((a) => !!a.isLive === live);
    if (!accts.length) continue;
    await withSession(live ? HOSTS.live : HOSTS.demo, d, async (sess) => {
      for (const a of accts) {
        await authAccount(sess, a.ctidTraderAccountId, tok.token);
        const { trader } = await sess.request(
          PT.TRADER_REQ,
          { ctidTraderAccountId: a.ctidTraderAccountId },
          PT.TRADER_RES,
          TraderRes,
        );
        const assets = await sess.request(
          PT.ASSET_LIST_REQ,
          { ctidTraderAccountId: a.ctidTraderAccountId },
          PT.ASSET_LIST_RES,
          AssetListRes,
        );
        const currency = assets.asset.find((x) => x.assetId === trader.depositAssetId)?.name ?? "USD";
        const moneyDigits = trader.moneyDigits ?? 2;
        const login = a.traderLogin ?? trader.traderLogin ?? null;
        const broker = a.brokerTitleShort ?? trader.brokerName ?? "cTrader";
        const exchange = {
          connectionId: tok.connectionId,
          isLive: live,
          traderLogin: login,
          broker,
          currency,
          moneyDigits,
          registeredAt: trader.registrationTimestamp ?? null,
        };
        const prev = await db.query.ctraderAccounts.findFirst({
          where: eq(s.ctraderAccounts.ctid, a.ctidTraderAccountId),
        });
        if (prev) {
          await db
            .update(s.ctraderAccounts)
            .set(exchange)
            .where(eq(s.ctraderAccounts.ctid, a.ctidTraderAccountId));
          continue;
        }
        const [acct] = await db
          .insert(s.accounts)
          .values({
            name: `${broker} ${live ? "" : "demo "}${login ?? a.ctidTraderAccountId}`,
            type: "prop",
            currency,
            startingBalance: a.lastClosingDealTimestamp ? 0 : trader.balance / 10 ** moneyDigits,
          })
          .returning({ id: s.accounts.id });
        await db.insert(s.ctraderAccounts).values({
          ctid: a.ctidTraderAccountId,
          accountId: acct.id,
          createdAccountId: acct.id,
          // closed deals already behind it: its starting balance comes from the history once it's all read
          startingBalancePending: !!a.lastClosingDealTimestamp,
          createdAt: now,
          ...exchange,
        });
        added++;
      }
    });
  }
  return { found: list.ctidTraderAccount.length, added };
}

async function withSession<T>(
  url: string,
  d: CtraderDeps,
  fn: (s: CtraderSession) => Promise<T>,
): Promise<T> {
  const sess = await openSession(url, creds(d.cfg), sessionOpts(d));
  try {
    return await fn(sess);
  } finally {
    sess.close();
  }
}

// ─── persistence ────────────────────────────────────────────────────────────────────

async function includeFunding(db: DB) {
  const row = await db.query.settings.findFirst({ where: eq(s.settings.key, INCLUDE_FUNDING_KEY) });
  return row?.value !== false;
}

/** Idempotent on (ctid, dealId); a deal seen again (e.g. its status changed) is updated in place. 100 per statement. */
export async function saveDeals(db: DB, deals: (StoredDeal & { raw: unknown })[]): Promise<number> {
  const cols = [
    "positionId",
    "orderId",
    "symbolId",
    "symbol",
    "side",
    "status",
    "volume",
    "price",
    "time",
    "commission",
    "baseToUsd",
    "close",
    "raw",
  ] as const;
  const set = Object.fromEntries(cols.map((c) => [c, sql.raw(`excluded.${s.ctraderDeals[c].name}`)]));
  for (let i = 0; i < deals.length; i += 100) {
    await db
      .insert(s.ctraderDeals)
      .values(deals.slice(i, i + 100))
      .onConflictDoUpdate({ target: [s.ctraderDeals.ctid, s.ctraderDeals.dealId], set });
  }
  return deals.length;
}

/**
 * An account discovered with closed deals already behind it starts at the balance before its first close (cTrader
 * stamps each close with the balance after it). Only on the journal account discovery created for it, only while
 * that account's starting balance is still 0, and only once, after the history has been read up to now.
 */
async function setStartingBalance(db: DB, a: typeof s.ctraderAccounts.$inferSelect) {
  const clear = () =>
    db
      .update(s.ctraderAccounts)
      .set({ startingBalancePending: false })
      .where(eq(s.ctraderAccounts.ctid, a.ctid));
  const acct = await db.query.accounts.findFirst({ where: eq(s.accounts.id, a.accountId) });
  if (a.accountId !== a.createdAccountId || !acct || acct.startingBalance !== 0) return clear();
  const [first] = await db
    .select()
    .from(s.ctraderDeals)
    .where(and(eq(s.ctraderDeals.ctid, a.ctid), isNotNull(s.ctraderDeals.close)))
    .orderBy(asc(s.ctraderDeals.time), asc(s.ctraderDeals.dealId))
    .limit(1);
  const c = first?.close;
  const before = c ? c.balance - (c.gross + c.swap + c.commission + c.conversionFee) : 0;
  if (before > 0)
    await db.update(s.accounts).set({ startingBalance: before }).where(eq(s.accounts.id, a.accountId));
  await clear();
}

/**
 * Upserts trades by external key (exchange-owned columns only). `imported` trades (from a history file) never
 * overwrite API ones; API trades replace imported ones.
 */
export async function upsertPositionTrades(
  db: DB,
  accountId: string,
  trades: PositionTrade[],
  o: { imported?: boolean; now?: number } = {},
): Promise<{ created: number; updated: number; skipped: number; tradeIds: string[] }> {
  const inc = (await includeFunding(db)) ? 1 : 0;
  const now = o.now ?? Date.now();
  const out = { created: 0, updated: 0, skipped: 0, tradeIds: [] as string[] };
  if (!trades.length) return out;
  await db.transaction(async (tx) => {
    const keys = trades.map((t) => t.externalKey);
    const existing = new Map<string, typeof s.trades.$inferSelect>();
    for (let i = 0; i < keys.length; i += 200) {
      const rows = await tx
        .select()
        .from(s.trades)
        .where(inArray(s.trades.externalKey, keys.slice(i, i + 200)));
      for (const r of rows) existing.set(r.externalKey!, r);
    }
    for (const t of trades) {
      const prev = existing.get(t.externalKey);
      if (prev && prev.source !== "ctrader") {
        out.skipped++;
        continue;
      }
      if (prev && o.imported && !prev.flags?.imported) {
        out.skipped++; // the API's version wins
        continue;
      }
      const net = t.grossPnl - t.fees + inc * t.funding;
      const cols = {
        coin: t.coin,
        displayPair: t.displayPair,
        dex: "",
        marketType: "cfd" as const,
        direction: t.direction,
        status: t.status,
        avgEntry: t.avgEntry,
        avgExit: t.avgExit,
        sizeUnits: t.sizeUnits,
        entryUnitsTotal: t.entryUnitsTotal,
        exitUnitsTotal: t.exitUnitsTotal,
        notionalUsd: t.notionalUsd,
        grossPnl: t.grossPnl,
        fees: t.fees,
        funding: t.funding,
        netPnl: net,
        returnPct: t.notionalUsd ? (net / t.notionalUsd) * 100 : null,
        entryTime: t.entryTime,
        exitTime: t.exitTime,
        durationMs: t.durationMs,
        fillCount: t.fillCount,
        flags: {
          ...(t.partialHistory ? { partialHistory: true } : {}),
          ...(o.imported ? { imported: true } : {}),
        },
        reconstructedAt: now,
      };
      if (prev) {
        await tx.update(s.trades).set(cols).where(eq(s.trades.id, prev.id));
        out.updated++;
        out.tradeIds.push(prev.id);
      } else {
        const [ins] = await tx
          .insert(s.trades)
          .values({ ...cols, accountId, walletId: null, source: "ctrader", externalKey: t.externalKey })
          .returning({ id: s.trades.id });
        out.created++;
        out.tradeIds.push(ins.id);
      }
    }
  });
  return out;
}

async function rebuildPositions(db: DB, acct: typeof s.ctraderAccounts.$inferSelect, positionIds: number[]) {
  if (!positionIds.length) return 0;
  const rows: StoredDeal[] = [];
  for (let i = 0; i < positionIds.length; i += 200) {
    rows.push(
      ...(await db
        .select()
        .from(s.ctraderDeals)
        .where(
          and(
            eq(s.ctraderDeals.ctid, acct.ctid),
            inArray(s.ctraderDeals.positionId, positionIds.slice(i, i + 200)),
          ),
        )),
    );
  }
  const byPos = new Map<number, StoredDeal[]>();
  for (const r of rows) byPos.set(r.positionId, [...(byPos.get(r.positionId) ?? []), r]);
  const trades = [...byPos.values()]
    .map((ds) => positionTrade(acct.traderLogin ?? acct.ctid, ds))
    .filter((t) => t !== null);
  const res = await upsertPositionTrades(db, acct.accountId, trades);
  return res.created + res.updated;
}

// ─── sync ───────────────────────────────────────────────────────────────────────────

export type CtraderSyncResult = {
  account: string;
  status: "success" | "partial" | "error";
  dealsFetched: number;
  tradesTouched: number;
  done: boolean;
  error?: string;
};

export async function syncCtrader(
  db: DB,
  d: CtraderDeps & { budgetMs?: number },
): Promise<{ done: boolean; results: CtraderSyncResult[] }> {
  const now = d.now ?? Date.now;
  const started = now();
  if (!d.cfg.configured) return { done: true, results: [] };
  const accts = await db.select().from(s.ctraderAccounts).where(eq(s.ctraderAccounts.enabled, true));
  if (!accts.length) return { done: true, results: [] };
  const names = new Map(
    (await db.select({ id: s.accounts.id, name: s.accounts.name }).from(s.accounts)).map((a) => [
      a.id,
      a.name,
    ]),
  );
  const label = (a: (typeof accts)[number]) => names.get(a.accountId) ?? "cTrader";

  let tok: Awaited<ReturnType<typeof accessToken>>;
  try {
    tok = await accessToken(db, d);
  } catch (e) {
    const msg = (e as Error).message;
    return {
      done: true,
      results: accts.map((a) => ({
        account: label(a),
        status: "error",
        dealsFetched: 0,
        tradesTouched: 0,
        done: true,
        error: msg,
      })),
    };
  }
  if (!tok) return { done: true, results: [] };

  const results: CtraderSyncResult[] = [];
  const overBudget = () => d.budgetMs !== undefined && now() - started > d.budgetMs;
  for (const live of [false, true]) {
    const group = accts.filter((a) => a.isLive === live);
    if (!group.length) continue;
    let sess: CtraderSession | null = null;
    try {
      sess = await openSession(live ? HOSTS.live : HOSTS.demo, creds(d.cfg), sessionOpts(d));
    } catch (e) {
      for (const a of group) results.push(await recordError(db, a, label(a), e as Error, now()));
      continue;
    }
    try {
      for (const a of group) {
        // the first account always gets at least one window, so a starved run still makes progress
        if (results.length && overBudget()) {
          results.push({
            account: label(a),
            status: "partial",
            dealsFetched: 0,
            tradesTouched: 0,
            done: false,
          });
          continue;
        }
        try {
          results.push(await syncAccount(db, sess, a, label(a), tok.token, { now, overBudget }));
        } catch (e) {
          if (e instanceof CtraderError && TOKEN_ERRORS.has(e.code)) {
            await db
              .update(s.ctraderConnections)
              .set({ lastError: "cTrader access expired or was revoked: connect again" });
          }
          results.push(await recordError(db, a, label(a), e as Error, now()));
          if (e instanceof CtraderError && e.code === "DISCONNECTED") break;
        }
      }
    } finally {
      sess.close();
    }
  }
  if (results.length && results.every((r) => r.status === "success")) {
    await db
      .update(s.ctraderConnections)
      .set({ lastError: null })
      .where(eq(s.ctraderConnections.id, tok.connectionId));
  }
  return { done: results.every((r) => r.done), results };
}

async function recordError(
  db: DB,
  a: typeof s.ctraderAccounts.$inferSelect,
  account: string,
  e: Error,
  t: number,
): Promise<CtraderSyncResult> {
  await db
    .update(s.ctraderAccounts)
    .set({ lastSyncedAt: t, lastError: e.message })
    .where(eq(s.ctraderAccounts.ctid, a.ctid));
  return { account, status: "error", dealsFetched: 0, tradesTouched: 0, done: true, error: e.message };
}

async function syncAccount(
  db: DB,
  sess: CtraderSession,
  a: typeof s.ctraderAccounts.$inferSelect,
  account: string,
  token: string,
  o: { now: () => number; overBudget: () => boolean },
): Promise<CtraderSyncResult> {
  const ctid = a.ctid;
  await authAccount(sess, ctid, token);
  const { trader } = await sess.request(
    PT.TRADER_REQ,
    { ctidTraderAccountId: ctid },
    PT.TRADER_RES,
    TraderRes,
  );
  const digits = trader.moneyDigits ?? a.moneyDigits ?? 2;
  const syms = await sess.request(
    PT.SYMBOLS_LIST_REQ,
    { ctidTraderAccountId: ctid, includeArchivedSymbols: true },
    PT.SYMBOLS_LIST_RES,
    SymbolsListRes,
  );
  const symbolName = new Map<number, string>([
    ...syms.archivedSymbol.map((x) => [x.symbolId, x.name ?? `#${x.symbolId}`] as const),
    ...syms.symbol.map((x) => [x.symbolId, x.symbolName ?? `#${x.symbolId}`] as const),
  ]);

  const start = Math.max(
    0,
    (a.dealsSyncedTo ?? a.registeredAt ?? trader.registrationTimestamp ?? a.createdAt - 30 * DAY) -
      OVERLAP_MS,
  );
  const fetched = new Set<number>();
  let touched = 0;
  let from = start;
  let done = true;

  /**
   * All deals in [lo, hi). The API caps a reply at maxRows and only says hasMore (not which end it kept), so a
   * full reply splits the range in half and reads each half: complete whatever order the server uses.
   * Returns false when the time budget ran out before the range was fully read.
   */
  const readRange = async (
    lo: number,
    hi: number,
    positions: Set<number>,
    first: boolean,
  ): Promise<boolean> => {
    if (!first && o.overBudget()) return false;
    const res = await sess.request(
      PT.DEAL_LIST_REQ,
      { ctidTraderAccountId: ctid, fromTimestamp: lo, toTimestamp: hi, maxRows: MAX_ROWS },
      PT.DEAL_LIST_RES,
      DealListRes,
      { historical: true },
    );
    const deals = res.deal.map((x) => ({
      ...toStoredDeal(ctid, x, symbolName.get(x.symbolId) ?? `#${x.symbolId}`, digits),
      raw: x,
    }));
    await saveDeals(db, deals);
    for (const x of deals) {
      fetched.add(x.dealId);
      positions.add(x.positionId);
    }
    // more than maxRows inside one millisecond can't be split further: keep what came back
    if (!res.hasMore || hi - lo <= 1) return true;
    const mid = lo + Math.floor((hi - lo) / 2);
    return (await readRange(lo, mid, positions, false)) && (await readRange(mid, hi, positions, false));
  };

  for (let w = 0; from < o.now(); w++) {
    if (w > 0 && o.overBudget()) {
      done = false;
      break;
    }
    const end = Math.min(from + WINDOW_MS, o.now());
    const positions = new Set<number>();
    const complete = await readRange(from, end, positions, w === 0);
    touched += await rebuildPositions(db, a, [...positions]);
    // the cursor only moves past a window that was read completely
    if (!complete) {
      done = false;
      break;
    }
    await db
      .update(s.ctraderAccounts)
      .set({ dealsSyncedTo: end, moneyDigits: digits })
      .where(eq(s.ctraderAccounts.ctid, ctid));
    from = end;
  }
  if (done && a.startingBalancePending) await setStartingBalance(db, a);
  const t = o.now();
  await db
    .update(s.ctraderAccounts)
    .set({ lastSyncedAt: t, ...(done ? { lastSuccessAt: t, lastError: null } : {}) })
    .where(eq(s.ctraderAccounts.ctid, ctid));
  return {
    account,
    status: done ? "success" : "partial",
    dealsFetched: fetched.size,
    tradesTouched: touched,
    done,
  };
}
