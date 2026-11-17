import { beforeAll, describe, expect, test } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { useTempDb } from "./helpers/db";
import { getDb } from "@/server/db/client";
import { runMigrations, seedDefaults } from "@/server/db/bootstrap";
import * as s from "@/server/db/schema";
import { DEFAULT_SESSIONS } from "@/server/db/seed-data";
import { DEMO_ADDRESS, DEMO_SEED, generateDemoHistory } from "@/server/demo/generate";
import { seedDemoJournal } from "@/server/demo/journal";
import { createRng } from "@/server/demo/rng";
import { insertFills, rebuildTrades } from "@/server/reconstruct/persist";
import { balanceInputs, closedTrades, openTrades } from "@/server/db/queries/dashboard";
import { analyticsTrades } from "@/server/db/queries/analytics";
import { listTrades, missingCounts } from "@/server/db/queries/trades";
import { parseFilters } from "@/server/trades/filters";
import { moveWalletTo } from "@/server/wallets/move";
import { balanceCurve, foldOwnTransfers } from "@/lib/stats";

const TZ = "UTC";
const END = Date.UTC(2026, 10, 9, 12);
let accountId: string;
let main: string;
let sub: string;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

beforeAll(async () => {
  useTempDb();
  const db = getDb();
  await runMigrations(db);
  await seedDefaults(db);
  accountId = (await db.select().from(s.accounts))[0].id;
  const [a, b] = await db
    .insert(s.wallets)
    .values([
      { accountId, address: DEMO_ADDRESS, label: "Main" },
      { accountId, address: "0x0000000000000000000000000000000000000de1", label: "Scalps", kind: "sub" },
    ])
    .returning();
  main = a.id;
  sub = b.id;
  const h1 = generateDemoHistory({ end: END });
  const h2 = generateDemoHistory({ seed: DEMO_SEED + 10, end: END, days: 45 });
  await insertFills(db, main, h1.fills);
  await insertFills(db, sub, h2.fills);
  await rebuildTrades(db, { walletId: main, accountId });
  await rebuildTrades(db, { walletId: sub, accountId });
  await seedDemoJournal(db, createRng(7), { walletId: main, plans: h1.plans, sessions: DEFAULT_SESSIONS });
  // in "All wallets" only: a manual trade (no wallet), and a synced trade from another account's wallet that was
  // put on this account from the trade form
  const closed = { coin: "EUR/USD", displayPair: "EUR/USD", direction: "long", status: "closed", entryTime: END - 7_200_000, exitTime: END - 3_600_000 } as const;
  await db.insert(s.trades).values({ ...closed, accountId, walletId: null, source: "manual", netPnl: 12.5 });
  const [elsewhere] = await db.insert(s.accounts).values({ name: "Elsewhere" }).returning();
  const [w3] = await db.insert(s.wallets).values({ accountId: elsewhere.id, address: "0x0000000000000000000000000000000000000de2", label: "Other" }).returning();
  await db.insert(s.trades).values({ ...closed, accountId, walletId: w3.id, source: "hyperliquid", externalKey: "x:1", netPnl: 7 });
});

describe("wallet scope", () => {
  test("every query: the wallets add up to all wallets (plus manual trades), in count and net", async () => {
    const db = getDb();
    const all = await closedTrades(db, accountId);
    const m = await closedTrades(db, accountId, main);
    const b = await closedTrades(db, accountId, sub);
    expect(m.length).toBeGreaterThan(20);
    expect(b.length).toBeGreaterThan(5);
    const manual = all.filter((t) => t.source === "manual");
    expect(manual).toHaveLength(1);
    // + 1 manual + 1 from another account's wallet (2 trades, 12.5 + 7) in every reconciliation below
    expect(m.length + b.length + 2).toBe(all.length);
    expect(sum(m.map((t) => t.netPnl)) + sum(b.map((t) => t.netPnl)) + 12.5 + 7).toBeCloseTo(sum(all.map((t) => t.netPnl)), 6);
    expect(new Set([...m, ...b].map((t) => t.id)).size).toBe(m.length + b.length); // disjoint

    const an = [await analyticsTrades(db, accountId), await analyticsTrades(db, accountId, main), await analyticsTrades(db, accountId, sub)];
    expect(an[1].length + an[2].length + 2).toBe(an[0].length);

    const open = [await openTrades(db, accountId), await openTrades(db, accountId, main), await openTrades(db, accountId, sub)];
    expect(open[1].length + open[2].length).toBe(open[0].length);

    const lt = async (walletId: string | null) => (await listTrades(db, accountId, parseFilters({}), { tz: TZ, now: END, walletId })).counts;
    const [ca, cm, cs] = [await lt(null), await lt(main), await lt(sub)];
    expect(cm.all + cs.all + 2).toBe(ca.all);
    expect(cm.closed + cs.closed + 2).toBe(ca.closed);

    const wk = [END - 30 * 86_400_000, END] as const;
    const mc = [await missingCounts(db, accountId, ...wk), await missingCounts(db, accountId, ...wk, main), await missingCounts(db, accountId, ...wk, sub)];
    expect(mc[1].total + mc[2].total + 2).toBe(mc[0].total);
  });

  test("another account's wallet id selects nothing", async () => {
    const db = getDb();
    const [other] = await db.insert(s.accounts).values({ name: "Other" }).returning();
    expect(await closedTrades(db, other.id, main)).toHaveLength(0);
    expect(await balanceInputs(db, other.id, main)).toBeNull();
    await db.delete(s.accounts).where(eq(s.accounts.id, other.id));
  });
});

describe("balance across wallets", () => {
  test("a transfer between two wallets in view folds into one internal move; with one wallet it stays a transfer", () => {
    const hash = "0xabc";
    const rows = [
      { walletId: "a", hash: "0x1", t: 1, usd: 1000, kind: "deposit" },
      { walletId: "a", hash, t: 5, usd: -401, kind: "transfer_out" }, // 1 fee
      { walletId: "b", hash, t: 5, usd: 400, kind: "transfer_in" },
      { walletId: "a", hash: "0x2", t: 9, usd: -50, kind: "transfer_out" }, // to someone else
    ];
    expect(foldOwnTransfers(rows)).toEqual([
      { t: 1, usd: 1000, kind: "deposit" },
      { t: 5, usd: -1, kind: "internal" },
      { t: 9, usd: -50, kind: "transfer_out" },
    ]);
    // only one side in view (one wallet scoped): the transfer stays a transfer
    expect(foldOwnTransfers(rows.filter((r) => r.walletId === "b"))).toEqual([{ t: 5, usd: 400, kind: "transfer_in" }]);
    // a fee-free pair disappears; same-wallet rows never pair, whatever their hash
    expect(foldOwnTransfers([rows[1], { ...rows[2], usd: 401 }])).toEqual([]);
    expect(foldOwnTransfers([rows[1], { ...rows[2], walletId: "a" }])).toHaveLength(2);
  });

  test("balance and net deposited for all wallets = the sum of each wallet's", async () => {
    const db = getDb();
    const hash = "0x" + "5".repeat(64);
    const t0 = END - 60 * 86_400_000;
    await db.insert(s.ledgerEvents).values([
      { walletId: main, uid: "d1", time: t0 - 1, hash: "0x1", type: "deposit", delta: {}, kind: "deposit", usd: 25_000 },
      { walletId: main, uid: "x1", time: t0, hash, type: "subAccountTransfer", delta: {}, kind: "transfer_out", usd: -4000 },
      { walletId: sub, uid: "x2", time: t0, hash, type: "subAccountTransfer", delta: {}, kind: "transfer_in", usd: 4000 },
    ]);
    const done = { ledgerCompletedAt: END, fundingCompletedAt: END, backfillCompletedAt: END, accountMode: "unifiedAccount" };
    await db.update(s.wallets).set(done).where(sql`1 = 1`);
    const end = (w: string | null) =>
      Promise.all([closedTrades(db, accountId, w), balanceInputs(db, accountId, w)]).then(([tr, b]) => balanceCurve(tr, b!.flows, b!.cash, { from: null, to: null }).at(-1)!);
    const [a, m, b] = [await end(null), await end(main), await end(sub)];
    expect(m.equity + b.equity).toBeCloseTo(a.equity, 6);
    expect(m.deposited).toBeCloseTo(21_000, 6);
    expect(b.deposited).toBeCloseTo(4000, 6);
    expect(a.deposited).toBeCloseTo(25_000, 6); // the transfer is not money in
    // …and is not shown as a transfer in or out on the chart: it folds away (no fee)
    expect((await balanceInputs(db, accountId))!.flows.map((f) => f.kind)).toEqual(["deposit"]);
    expect((await balanceInputs(db, accountId, sub))!.flows.map((f) => f.kind)).toEqual(["transfer_in"]);
    // a disabled wallet leaves "All wallets" (it is never synced), and on its own has no balance view
    await db.update(s.wallets).set({ enabled: false }).where(eq(s.wallets.id, sub));
    expect((await end(null)).deposited).toBeCloseTo(21_000, 6);
    expect(await balanceInputs(db, accountId, sub)).toBeNull();
    await db.update(s.wallets).set({ enabled: true }).where(eq(s.wallets.id, sub));
  });
});

describe("move a wallet to another account", () => {
  test("its trades move with it, journal intact; manual trades stay; moving back restores everything", async () => {
    const db = getDb();
    const [other] = await db.insert(s.accounts).values({ name: "Second" }).returning();
    const [third] = await db.insert(s.accounts).values({ name: "Experiments" }).returning();
    // one of the wallet's trades you put on another account yourself, and one you deleted
    const [kept, hidden] = await db.select().from(s.trades).where(and(eq(s.trades.walletId, main), eq(s.trades.status, "closed"))).limit(2);
    await db.update(s.trades).set({ accountId: third.id }).where(eq(s.trades.id, kept.id));
    await db.update(s.trades).set({ deletedAt: END }).where(eq(s.trades.id, hidden.id));
    const before = await db.select().from(s.trades).where(eq(s.trades.walletId, main));
    const journals = await db.select().from(s.tradeJournal);
    const r = await moveWalletTo(db, main, other.id);
    expect(r.trades).toBe(before.length - 2); // the live ones that moved (the deleted one moves too, uncounted)
    expect((await db.select().from(s.trades).where(eq(s.trades.id, kept.id)))[0].accountId).toBe(third.id);
    expect((await db.select().from(s.trades).where(eq(s.trades.id, hidden.id)))[0].accountId).toBe(other.id);
    expect((await db.select().from(s.wallets).where(eq(s.wallets.id, main)))[0].accountId).toBe(other.id);
    expect((await closedTrades(db, other.id)).length).toBe(before.filter((t) => t.status === "closed").length - 2);
    const left = await closedTrades(db, accountId);
    expect(left.every((t) => before.every((x) => x.id !== t.id))).toBe(true);
    expect(left.some((t) => t.source === "manual")).toBe(true);
    expect(await db.select().from(s.tradeJournal)).toEqual(journals); // the journal is not touched

    expect((await moveWalletTo(db, main, other.id)).trades).toBe(0); // already there: a no-op
    await moveWalletTo(db, main, accountId);
    expect(await db.select().from(s.trades).where(eq(s.trades.walletId, main))).toEqual(before); // your choice survives the round trip
    await db.update(s.trades).set({ accountId }).where(eq(s.trades.id, kept.id));
    await db.update(s.trades).set({ deletedAt: null }).where(eq(s.trades.id, hidden.id));
  });

  test("a sync that started before a move puts its new trades on the wallet's new account", async () => {
    const db = getDb();
    const [later] = await db.insert(s.accounts).values({ name: "Later" }).returning();
    const [w] = await db.insert(s.wallets).values({ accountId: later.id, address: "0x0000000000000000000000000000000000000de3", label: "New" }).returning();
    await insertFills(db, w.id, generateDemoHistory({ seed: DEMO_SEED + 20, end: END, days: 10 }).fills);
    // the caller still holds the old account id (read before the move)
    const r = await rebuildTrades(db, { walletId: w.id, accountId });
    expect(r.created).toBeGreaterThan(0);
    const rows = await db.select({ a: s.trades.accountId }).from(s.trades).where(eq(s.trades.walletId, w.id));
    expect(new Set(rows.map((x) => x.a))).toEqual(new Set([later.id]));
  });

  test("refuses an archived or missing account, and a missing wallet, without changing anything", async () => {
    const db = getDb();
    const [arch] = await db.insert(s.accounts).values({ name: "Old", archived: true }).returning();
    await expect(moveWalletTo(db, main, arch.id)).rejects.toThrow("Pick an active journal account.");
    await expect(moveWalletTo(db, main, "nope")).rejects.toThrow("Pick an active journal account.");
    await expect(moveWalletTo(db, "nope", accountId)).rejects.toThrow("That wallet no longer exists.");
    expect((await db.select().from(s.wallets).where(eq(s.wallets.id, main)))[0].accountId).toBe(accountId);
  });
});
