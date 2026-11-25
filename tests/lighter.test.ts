import { beforeEach, describe, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import { useTempDb } from "./helpers/db";
import {
  ACCT,
  MIN,
  OWNER,
  SECRET,
  T0,
  USDC,
  fakeLighter,
  order,
  simLighter,
  tokenFor,
  type FakeLighter,
} from "./fixtures/lighter";
import { getDb } from "@/server/db/client";
import { runMigrations, seedDefaults } from "@/server/db/bootstrap";
import { balanceInputs } from "@/server/db/queries/dashboard";
import * as s from "@/server/db/schema";
import { connectLighter, removeToken, replaceToken } from "@/server/lighter/connect";
import { mapDeposit, oidOf, mapFill, mapTransfer, mapWithdraw, toMs, versionOid } from "@/server/lighter/map";
import { TradeSchema } from "@/server/lighter/schemas";
import { syncLighterWallet } from "@/server/lighter/sync";
import { openToken, parseReadOnlyToken, sealToken } from "@/server/lighter/token";
import { getSyncStatus } from "@/server/db/queries/sync";
import { syncAll } from "@/server/hyperliquid/sync";
import { createHlClient } from "@/server/hyperliquid/client";
import { cronOutcome, sanitizeError } from "@/server/sync/runs";
import { loadLivePositions } from "@/server/sync/live-positions";
import { balanceCurve, foldOwnTransfers } from "@/lib/stats";

let accountId: string;
beforeEach(async () => {
  useTempDb();
  const db = getDb();
  await runMigrations(db);
  await seedDefaults(db);
  accountId = (await db.select().from(s.accounts))[0].id;
});

async function connected(init: Partial<FakeLighter> = {}) {
  const fake = fakeLighter(init);
  const deps = { client: fake.client, tokenSecret: SECRET };
  const r = await connectLighter(getDb(), deps, { token: tokenFor(), label: "Lighter", accountId }, T0);
  if (!r.ok) throw new Error(r.error);
  const wallet = async () =>
    (await getDb().query.wallets.findFirst({ where: eq(s.wallets.id, r.walletId) }))!;
  const sync = async (o: { now?: number; budgetMs?: number } = {}) =>
    syncLighterWallet(getDb(), deps, await wallet(), {
      trigger: "manual",
      now: () => o.now ?? T0 + 600 * MIN,
      budgetMs: o.budgetMs,
    });
  return { ...fake, deps, wallet, sync, walletId: r.walletId };
}
const liveTrades = async () =>
  (await getDb().select().from(s.trades))
    .filter((t) => !t.flags?.superseded)
    .sort((a, b) => a.entryTime! - b.entryTime!);

describe("token", () => {
  test("only read-only tokens parse; anything that can sign is refused", () => {
    expect(parseReadOnlyToken(` ${tokenFor()} `)).toEqual({
      accountIndex: ACCT,
      scope: "single",
      expiresAt: Date.UTC(2030, 0, 1),
    });
    for (const bad of [
      "",
      "ro:",
      "1795578302:4242:3:abcdef0123456789",
      `0x${"a".repeat(8)}`,
      "ro:0:single:1893456000:abababababababab",
      "ro:4242:write:1893456000:abababababababab",
    ])
      expect(parseReadOnlyToken(bad)).toBeNull();
  });
  test("stored encrypted, opens only with the same secret, and never shows in an error", () => {
    const enc = sealToken(tokenFor(), SECRET);
    expect(enc).not.toContain("ro:");
    expect(openToken(enc, SECRET)).toBe(tokenFor());
    expect(() => openToken(enc, "y".repeat(40))).toThrow(/paste the token again/i);
    expect(sanitizeError(new Error(`bad ${tokenFor()} here`))).toBe("bad ro:… here");
  });
});

describe("connect", () => {
  test("adds the account beside a Hyperliquid wallet with the same address", async () => {
    const db = getDb();
    await db.insert(s.wallets).values({ accountId, address: OWNER, label: "Main" });
    const { wallet, walletId } = await connected();
    const w = await wallet();
    expect([w.exchange, w.address, w.accountIndex]).toEqual(["lighter", OWNER, ACCT]);
    const st = await db.query.lighterState.findFirst({ where: eq(s.lighterState.walletId, walletId) });
    expect(st!.tokenEnc).not.toContain("ro:");
    // the same Hyperliquid address twice is still refused
    await expect(
      db.insert(s.wallets).values({ accountId, address: OWNER, label: "Again" }),
    ).rejects.toThrow();
  });
  test("refuses a bad, expired or rejected token, or no secret, and stores nothing", async () => {
    const db = getDb();
    const { client, st } = fakeLighter();
    const go = (token: string, secret: string | undefined = SECRET) =>
      connectLighter(db, { client, tokenSecret: secret }, { token, label: "L", accountId }, T0);
    expect(await go("sk-not-a-token")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/read-only token/),
    });
    expect(await go(tokenFor(ACCT, T0 - 1000))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/expired/),
    });
    expect(
      await connectLighter(
        db,
        { client, tokenSecret: undefined },
        { token: tokenFor(), label: "L", accountId },
        T0,
      ),
    ).toMatchObject({ ok: false });
    st.fail.accountActiveOrders = 401;
    expect(await go(tokenFor())).toMatchObject({ ok: false, error: expect.stringMatching(/refused/) });
    expect(await db.select().from(s.wallets)).toHaveLength(0);
    expect(await db.select().from(s.lighterState)).toHaveLength(0);
    // nothing but the header ever carries the token
    for (const c of st.calls) expect(c.query.toString()).not.toContain("ro%3A");
  });
  test("a replacement must be for the same account; removing keeps the wallet and its trades", async () => {
    const { deps, walletId, sync, st } = await connected();
    const sim = simLighter();
    sim.fill("buy", 0.5, 60_000, T0);
    st.trades = sim.trades;
    await sync();
    expect(await replaceToken(getDb(), deps, { walletId, token: tokenFor(99) }, T0)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/different/),
    });
    expect(
      await replaceToken(getDb(), deps, { walletId, token: tokenFor(ACCT, Date.UTC(2035, 0, 1)) }, T0),
    ).toMatchObject({ ok: true });
    await removeToken(getDb(), walletId);
    const r = await sync();
    expect(r.status).toBe("error");
    expect(r.error).toMatch(/No Lighter token/);
    expect(await liveTrades()).toHaveLength(1);
  });
});

describe("fills", () => {
  const parse = (row: unknown) => TradeSchema.parse(row);
  test("maps side, role, position, P&L, and a fee rate in millionths", () => {
    const sim = simLighter();
    const a = mapFill(parse(sim.fill("sell", 0.5, 60_000, T0, { takerFee: 280 }).row), ACCT, OWNER)!;
    expect(a).toMatchObject({
      side: "A",
      startPosition: "0",
      closedPnl: "0",
      fee: "8.4",
      crossed: true,
      dir: "Open Short",
      feeToken: "USDC",
    });
    const b = mapFill(parse(sim.fill("buy", 0.5, 59_000, T0 + MIN, { maker: true }).row), ACCT, OWNER)!;
    expect(b).toMatchObject({
      side: "B",
      startPosition: "-0.5",
      closedPnl: "500",
      fee: "0",
      crossed: false,
      dir: "Close Short",
    });
    expect(mapFill(parse(sim.trades[0]), 999, OWNER)).toBeNull();
  });
  test("P&L left out of a reducing fill is worked out from the entry value", () => {
    const sim = simLighter();
    sim.fill("buy", 0.4, 60_000, T0);
    const { row } = sim.fill("sell", 0.1, 61_000, T0 + MIN);
    delete row.ask_account_pnl;
    expect(Number(mapFill(parse(row), ACCT, OWNER)!.closedPnl)).toBeCloseTo(100, 6);
  });
  test("a liquidation marks our own only when we were the taker", () => {
    const sim = simLighter();
    sim.fill("buy", 1, 100, T0);
    const own = mapFill(parse(sim.fill("sell", 1, 90, T0 + 1, { type: "liquidation" }).row), ACCT, OWNER)!;
    expect(own.liquidation).toMatchObject({ liquidatedUser: OWNER });
    const other = mapFill(
      parse(sim.fill("buy", 1, 90, T0 + 2, { type: "liquidation", maker: true }).row),
      ACCT,
      OWNER,
    )!;
    expect(other.liquidation).toMatchObject({ liquidatedUser: null });
  });
  test("order ids past 2^53 (high markets) become a stable, distinct, safe integer; small ones stay as they are", () => {
    const big = (BigInt("51228445761339392") + BigInt(5)).toString();
    const next = (BigInt("51228445761339392") + BigInt(6)).toString();
    for (const x of [big, next]) expect(Number.isSafeInteger(oidOf(x))).toBe(true);
    expect(oidOf(big)).toBe(oidOf(big));
    expect(oidOf(big)).not.toBe(oidOf(next));
    expect([oidOf("562950000000001"), oidOf("0"), oidOf(undefined)]).toEqual([562_950_000_000_001, 0, 0]);
    const { row } = simLighter().fill("buy", 1, 100, T0);
    expect(mapFill(parse({ ...row, bid_id_str: big }), ACCT, OWNER)!.oid).toBe(oidOf(big));
    expect(TradeSchema.safeParse({ ...row, trade_id: 2 ** 60 }).success).toBe(false);
  });
  test("a closing fill with neither P&L nor entry value is refused, not guessed", () => {
    const sim = simLighter();
    sim.fill("buy", 1, 3000, T0);
    const { row } = sim.fill("sell", 1, 3000, T0 + MIN);
    delete row.taker_entry_quote_before;
    expect(() => mapFill(parse(row), ACCT, OWNER)).toThrow(/neither/);
  });
  test("timestamps in seconds, ms and µs", () => {
    expect([toMs(T0 / 1000), toMs(T0), toMs(T0 * 1000)]).toEqual([T0, T0, T0]);
  });
});

describe("sync", () => {
  /** n BTC round trips of +$10 each, 2 fills a minute */
  const history = (n: number) => {
    const sim = simLighter();
    for (let i = 0; i < n; i++) {
      sim.fill("buy", 0.1, 60_000, T0 + i * 10 * MIN);
      sim.fill("sell", 0.1, 60_100, T0 + (i * 10 + 5) * MIN);
    }
    return sim.trades;
  };

  test("builds trades with source lighter; re-running changes nothing; only perps count", async () => {
    const spot = { ...history(1)[0], trade_id: 5, market_kind: "spot", market_symbol: "ETH/USDC" };
    const { sync, st } = await connected({ trades: [...history(3), spot] });
    const a = await sync();
    expect(a).toMatchObject({ status: "success", fillsNew: 6, tradesTouched: 3 });
    const t = await liveTrades();
    expect(t.map((x) => [x.source, x.displayPair, x.status, Math.round(x.netPnl!)])).toEqual(
      Array(3).fill(["lighter", "BTC/USD", "closed", 10]),
    );
    const ids = t.map((x) => x.id);
    expect(await sync()).toMatchObject({ status: "success", fillsNew: 0 });
    expect((await liveTrades()).map((x) => x.id)).toEqual(ids);
    // the token is only ever sent to endpoints that need it
    for (const c of st.calls)
      expect(c.auth === null).toBe(["account", "orderBooks", "assetDetails"].includes(c.path));
  });

  test("a pass that runs out of time resumes, and no trade is built on half the history", async () => {
    const { sync, st, wallet, walletId } = await connected({ trades: history(10), pageSize: 7 });
    const a = await sync({ budgetMs: 0 });
    expect(a).toMatchObject({ status: "partial", done: false, fillsNew: 7 });
    expect(await getDb().select().from(s.trades)).toHaveLength(0);
    expect((await wallet()).backfillCompletedAt).toBeNull();
    expect(await sync({ budgetMs: 0 })).toMatchObject({ status: "partial", fillsNew: 7 });
    expect(await sync({ budgetMs: 0 })).toMatchObject({ fillsNew: 6, tradesTouched: 10 });
    expect((await getDb().select().from(s.trades)).map((t) => t.flags)).toEqual(Array(10).fill({}));
    expect((await wallet()).backfillCompletedAt).not.toBeNull();
    // the next pass stops at what it knows
    st.calls.length = 0;
    await sync();
    expect(st.calls.filter((c) => c.path === "trades")).toHaveLength(1);
    const state = await getDb().query.lighterState.findFirst({
      where: eq(s.lighterState.walletId, walletId),
    });
    expect(state!.fillsCursor).toBeNull();
  });

  test("fills that arrive between two halves of a pass are picked up by the next one", async () => {
    const all = history(10);
    const { sync, st } = await connected({ trades: all.slice(0, 16), pageSize: 7 });
    await sync({ budgetMs: 0 });
    st.trades = all;
    for (let i = 0; i < 5 && !(await sync({ budgetMs: 0 })).done; i++);
    await sync();
    expect((await getDb().select().from(s.fills)).length).toBe(20);
    expect((await liveTrades()).length).toBe(10);
    expect((await liveTrades()).every((t) => t.status === "closed" && !t.flags?.gap)).toBe(true);
  });

  test("a saved cursor the API no longer accepts starts the pass again", async () => {
    const { sync, st } = await connected({ trades: history(10), pageSize: 7 });
    await sync({ budgetMs: 0 });
    st.badCursor = true;
    st.pageSize = 100;
    expect(await sync()).toMatchObject({ status: "success", tradesTouched: 10 });
  });

  test("expired token: a clear error, no request, and Hyperliquid wallets are unaffected", async () => {
    const { sync, st, deps } = await connected();
    st.calls.length = 0;
    const r = await sync({ now: Date.UTC(2031, 0, 1) });
    expect(r).toMatchObject({ status: "error", exchange: "lighter" });
    expect(r.error).toMatch(/expired/);
    expect(st.calls).toHaveLength(0);
    const db = getDb();
    await db.insert(s.wallets).values({ accountId, address: OWNER, label: "HL" });
    const seen: string[] = [];
    const hl = createHlClient({
      apiUrl: "https://hl.test",
      sleep: async () => {},
      fetchImpl: (async (_: string, q: { body: string }) => {
        const type = JSON.parse(q.body).type;
        seen.push(type);
        const body =
          type === "perpDexs"
            ? [null]
            : type === "userAbstraction"
              ? null
              : type === "clearinghouseState"
                ? {
                    assetPositions: [],
                    marginSummary: {
                      accountValue: "0",
                      totalNtlPos: "0",
                      totalRawUsd: "0",
                      totalMarginUsed: "0",
                    },
                    time: 1,
                  }
                : [];
        return new Response(JSON.stringify(body));
      }) as unknown as typeof fetch,
    });
    const out = await syncAll(db, hl, { trigger: "cron", lighter: deps, now: () => Date.UTC(2031, 0, 1) });
    expect(out.results.map((x) => [x.exchange, x.status])).toEqual([
      ["hyperliquid", "success"],
      ["lighter", "error"],
    ]);
    expect(seen).toContain("userFillsByTime");
  });

  test("one failing part doesn't block the others", async () => {
    const { sync } = await connected({
      trades: history(2),
      fail: { positionFunding: 400, accountInactiveOrders: 400 },
    });
    const r = await sync();
    expect(r).toMatchObject({ status: "success", tradesTouched: 2 });
    expect(r.error).toMatch(/orders: .*funding: /);
  });
});

describe("sync edge cases", () => {
  test("flips, scale-ins and same-millisecond fills (ETH, whose market id 0 is left out)", async () => {
    const sim = simLighter();
    const eth = { symbol: "ETH", market: 0 };
    sim.fill("sell", 1, 3000, T0, eth);
    sim.fill("sell", 1, 3100, T0, eth); // same ms: scale in
    sim.fill("buy", 3, 3000, T0 + MIN, eth); // covers 2 (+100), flips to long 1
    sim.fill("sell", 0.4, 3010, T0 + 2 * MIN, eth);
    sim.fill("sell", 0.6, 3010, T0 + 2 * MIN, eth);
    const { sync } = await connected({ trades: sim.trades });
    await sync();
    const t = await liveTrades();
    expect(t.map((x) => [x.direction, x.status, x.sizeUnits, Math.round(x.netPnl!), x.flags])).toEqual([
      ["short", "closed", 2, 100, {}],
      ["long", "closed", 1, 10, {}],
    ]);
  });

  test("a trade you deleted stays deleted; open positions fill in leverage and liquidation price", async () => {
    const sim = simLighter();
    sim.fill("buy", 0.1, 60_000, T0);
    sim.fill("sell", 0.1, 60_100, T0 + MIN);
    sim.fill("buy", 0.2, 60_000, T0 + 2 * MIN);
    const { sync } = await connected({
      trades: sim.trades,
      positions: [
        {
          market_id: 1,
          symbol: "BTC",
          sign: 1,
          position: "0.2",
          initial_margin_fraction: "20.00",
          liquidation_price: "50000",
        },
      ],
    });
    expect(await sync()).toMatchObject({ openPositions: 1, gapsDetected: 0 });
    const [closed, open] = await liveTrades();
    expect([open.leverage, open.liqPx]).toEqual([5, 50_000]);
    await getDb().update(s.trades).set({ deletedAt: 1 }).where(eq(s.trades.id, closed.id));
    await sync();
    expect((await liveTrades()).find((x) => x.id === closed.id)!.deletedAt).toBe(1);
  });

  test("orders: a pass short of time resumes, and completes", async () => {
    const sim = simLighter();
    sim.fill("buy", 0.5, 60_000, T0);
    const inactive = Array.from({ length: 30 }, (_, i) =>
      order({ order_id: String(100 + i), status: "canceled", trigger_price: "59000" }),
    );
    const { sync, walletId } = await connected({ trades: sim.trades, inactive, pageSize: 7 });
    const state = async () =>
      (await getDb().query.lighterState.findFirst({ where: eq(s.lighterState.walletId, walletId) }))!;
    expect(await sync({ budgetMs: 0 })).toMatchObject({ done: false, ordersStored: 7 });
    expect((await state()).ordersThrough).toBeNull();
    for (let i = 0; i < 3; i++) await sync({ budgetMs: 0 });
    expect((await state()).ordersThrough).toBeNull();
    expect(await sync({ budgetMs: 0 })).toMatchObject({ done: true });
    expect(await state()).toMatchObject({ ordersCursor: null });
    expect(await getDb().select().from(s.orders)).toHaveLength(30);
  });

  test("an edited order is still seen to end, long after", async () => {
    const DAY = 1440 * MIN;
    const sim = simLighter();
    sim.fill("buy", 0.5, 60_000, T0);
    const sec = (ms: number) => Math.floor(ms / 1000);
    const o = (x: Record<string, unknown>) => order({ order_id: "10", trigger_price: "59000", ...x });
    const c = await connected({ trades: sim.trades, active: [o({})] });
    await c.sync({ now: T0 + MIN });
    c.st.active = [o({ trigger_price: "58000", updated_at: sec(T0 + 10 * DAY) })];
    await c.sync({ now: T0 + 10 * DAY + MIN });
    c.st.active = [];
    c.st.inactive = [o({ trigger_price: "58000", status: "canceled", updated_at: sec(T0 + 21 * DAY) })];
    await c.sync({ now: T0 + 21 * DAY + MIN });
    const [row] = await getDb().select().from(s.orders).where(eq(s.orders.oid, 10));
    expect([row.status, row.endedAt]).toEqual(["canceled", T0 + 21 * DAY]);
  });

  test("funding on an unlisted market is kept, reported, and doesn't hold later payments up", async () => {
    const sim = simLighter();
    sim.fill("buy", 1, 60_000, T0);
    const pay = (id: number, market: number, at: number) => ({
      timestamp: at / 1000,
      market_id: market,
      funding_id: id,
      change: "-1",
      rate: "0.0001",
      position_size: "1",
      position_side: "long",
      discount: "0",
    });
    const DAY = 1440 * MIN;
    const { sync } = await connected({
      trades: sim.trades,
      fundings: [pay(1, 77, T0 + 60 * MIN), pay(2, 1, T0 + 60 * DAY)],
    });
    const r = await sync({ now: T0 + 61 * DAY });
    expect(r.error).toMatch(/1 payment\(s\) on a market/);
    expect(r.fundingNew).toBe(2);
    expect((await liveTrades())[0].funding).toBe(-1);
  });

  test("a failing or busy Lighter wallet never makes the caller repeat the round; a removed token is an error, not a loop", async () => {
    const db = getDb();
    const { deps, walletId, st } = await connected({ trades: [] });
    const hl = createHlClient({ apiUrl: "https://hl.test", fetchImpl: fetch, sleep: async () => {} });
    const run = () => syncAll(db, hl, { trigger: "cron", lighter: deps, now: () => T0 });
    st.fail.trades = 500;
    expect((await run()).done).toBe(true);
    delete st.fail.trades;
    await db.insert(s.syncRuns).values({ walletId, trigger: "cron", startedAt: T0, status: "running" });
    const busy = await run();
    expect([busy.done, busy.results[0].status]).toEqual([true, "skipped"]);
  });

  test("with the time long gone, the remaining parts are left for the next sync", async () => {
    const { deps, wallet, st } = await connected({ trades: history1() });
    let t = T0 + 600 * MIN;
    st.calls.length = 0;
    const r = await syncLighterWallet(getDb(), deps, await wallet(), {
      trigger: "cron",
      budgetMs: 1000,
      now: () => (t += 10_000),
    });
    expect(r.error).toMatch(/no time left/);
    expect(st.calls.map((c) => c.path)).not.toContain("deposit/history");
  });

  test("the header names the wallet that failed, and Hyperliquid's failure isn't hidden by a later success", async () => {
    const db = getDb();
    const { walletId, deps, wallet } = await connected();
    const [hl] = await db
      .insert(s.wallets)
      .values({ accountId, address: OWNER, label: "HL", lastSuccessAt: T0 })
      .returning();
    await db
      .insert(s.syncRuns)
      .values([{ walletId: hl.id, trigger: "cron", startedAt: T0, status: "error", error: "boom" }]);
    await syncLighterWallet(db, deps, await wallet(), { trigger: "cron", now: () => T0 + MIN });
    const status = await getSyncStatus(T0 + 2 * MIN);
    expect(status.lastRun).toMatchObject({ status: "error", error: "boom" });
    expect([status.failedWallets, status.staleWallets]).toEqual([["HL"], []]);
    expect(walletId).not.toBe(hl.id);
  });

  test("adding Lighter never takes the Hyperliquid balance away: it is left out, and named, until it matches", async () => {
    const db = getDb();
    const done = { ledgerCompletedAt: 1, fundingCompletedAt: 1, backfillCompletedAt: 1 };
    const [hl] = await db
      .insert(s.wallets)
      .values({ accountId, address: OWNER, label: "HL", ...done })
      .returning();
    await db.insert(s.ledgerEvents).values({
      walletId: hl.id,
      uid: "x",
      time: T0,
      hash: "",
      type: "deposit",
      delta: {},
      kind: "deposit",
      usd: 100,
    });
    const { sync, st, walletId } = await connected({ collateral: "999" });
    await sync();
    expect(await balanceInputs(db, accountId)).toMatchObject({
      excluded: ["Lighter"],
      flows: [{ usd: 100 }],
    });
    expect(await balanceInputs(db, accountId, walletId)).toBeNull();
    st.collateral = "0";
    await sync();
    expect((await balanceInputs(db, accountId))!.excluded).toEqual([]);
  });

  test("live positions: a Lighter failure leaves Hyperliquid's in place, names what is missing, and asks once", async () => {
    const db = getDb();
    await db.insert(s.wallets).values({ accountId, address: OWNER, label: "HL" });
    const { client, st } = await connected({
      positions: [
        {
          symbol: "BTC",
          sign: -1,
          position: "0.2",
          avg_entry_price: "60000",
          position_value: "12000",
          unrealized_pnl: "-60",
          initial_margin_fraction: "20.00",
        },
      ],
    });
    const hl = createHlClient({
      apiUrl: "https://hl.test",
      sleep: async () => {},
      fetchImpl: (async (_: string, q: { body: string }) =>
        new Response(
          JSON.stringify(
            JSON.parse(q.body).type === "perpDexs"
              ? [null]
              : {
                  assetPositions: [{ position: { coin: "ETH", szi: "1" } }],
                  marginSummary: {
                    accountValue: "0",
                    totalNtlPos: "0",
                    totalRawUsd: "0",
                    totalMarginUsed: "0",
                  },
                  time: 1,
                },
          ),
        )) as unknown as typeof fetch,
    });
    const wallets = await db.select().from(s.wallets);
    const ok = await loadLivePositions(wallets, { hl, lighter: client });
    expect(ok.missing).toEqual([]);
    expect(ok.positions.find((p) => p.coin === "BTC")).toMatchObject({
      size: -0.2,
      leverage: 5,
      returnOnEquity: -0.025,
    });
    st.fail.account = 503;
    st.calls.length = 0;
    const r = await loadLivePositions(wallets, { hl, lighter: client });
    expect([r.positions.map((p) => p.coin), r.missing]).toEqual([["ETH"], ["Lighter"]]);
    expect(st.calls).toHaveLength(1); // one try: a page is waiting
  });

  test("only a Hyperliquid failure fails the scheduled run", () => {
    const hl = (status: "success" | "error") => ({ exchange: "hyperliquid" as const, status });
    const lt = (status: "success" | "error") => ({ exchange: "lighter" as const, status });
    expect(cronOutcome([hl("success"), lt("error")])).toEqual({ status: 200, lighterOk: false });
    expect(cronOutcome([hl("error"), lt("success")])).toEqual({ status: 502, lighterOk: true });
    expect(cronOutcome([])).toEqual({ status: 200, lighterOk: true });
  });

  test("funding on a market listed, delisted and listed again is stored once and never blocks", async () => {
    const sim = simLighter();
    sim.fill("buy", 1, 60_000, T0, { symbol: "NEW" });
    const HOUR = 60 * MIN;
    const pay = (id: number, h: number) => ({
      timestamp: (T0 + h * HOUR) / 1000,
      market_id: 77,
      funding_id: id,
      change: "-1",
      rate: "0.0001",
      position_size: "1",
      position_side: "long",
      discount: "0",
    });
    const listed = [{ symbol: "NEW", market_id: 77, market_type: "perp" }];
    const { sync, st } = await connected({ trades: sim.trades, fundings: [pay(1, 1)], markets: listed });
    const rows = async () =>
      (await getDb().select().from(s.fundingEvents)).sort((a, b) => a.time - b.time).map((r) => r.coin);
    const NOW = T0 + 3 * HOUR;
    await sync({ now: NOW });
    expect(await rows()).toEqual(["NEW"]);
    // delisted: the overlap re-reads payment 1 without a name, and payment 2 is new
    st.markets = [];
    st.clock += 2 * 24 * HOUR;
    st.fundings.push(pay(2, 4));
    expect((await sync({ now: T0 + 4.5 * HOUR })).error).toMatch(/no longer lists/);
    expect(await rows()).toEqual(["NEW", "market-77"]);
    // a duplicate left by an earlier version is cleared too
    const [first] = await getDb().select().from(s.fundingEvents).where(eq(s.fundingEvents.coin, "NEW"));
    await getDb()
      .insert(s.fundingEvents)
      .values({ ...first, coin: "market-77", tradeId: null });
    st.markets = listed;
    st.clock += 2 * 24 * HOUR;
    expect((await sync({ now: T0 + 5 * HOUR })).error).toBeUndefined();
    expect(await rows()).toEqual(["NEW", "NEW"]);
    expect((await liveTrades())[0].funding).toBe(-2);
  });

  test("a wallet left out of the balance isn't marked on it either; a failed query's text never reaches the page", () => {
    const trade = {
      id: "t",
      displayPair: "BTC/USD",
      direction: "long" as const,
      netPnl: 50,
      fees: 0,
      notionalUsd: 1,
      entryTime: 1,
      exitTime: 5,
      r: null,
      walletId: "lt",
      source: "lighter" as const,
    };
    const flows = [{ t: 2, usd: 100, kind: "deposit" }];
    const at = (excludedIds: string[]) =>
      balanceCurve([trade], flows, [], { from: null, to: null, excludedIds }).filter((p) => p.trade).length;
    expect([at([]), at(["lt"])]).toEqual([1, 0]);
    expect(sanitizeError(new Error("Failed query: update x set y = ? params: secret"))).toBe(
      "database query failed",
    );
  });
});
const history1 = () => {
  const sim = simLighter();
  sim.fill("buy", 0.1, 60_000, T0);
  return sim.trades;
};

describe("funding", () => {
  test("stored once, signed by side, attributed to the trade that held it", async () => {
    const sim = simLighter();
    sim.fill("sell", 1, 60_000, T0);
    sim.fill("buy", 1, 59_000, T0 + 180 * MIN);
    const pay = (h: number, change: string) => ({
      timestamp: (T0 + h * 60 * MIN) / 1000,
      market_id: 1,
      funding_id: h,
      change,
      rate: "0.0001",
      position_size: "1",
      position_side: "short",
      discount: "0",
    });
    const { sync } = await connected({ trades: sim.trades, fundings: [pay(1, "1.5"), pay(2, "-0.5")] });
    expect(await sync()).toMatchObject({ fundingNew: 2 });
    expect(await sync()).toMatchObject({ fundingNew: 0 });
    const [t] = await liveTrades();
    expect([t.funding, Math.round(t.netPnl!)]).toEqual([1, 1001]);
  });
});

describe("orders", () => {
  const entry = () => {
    const sim = simLighter();
    const { order: parent } = sim.fill("buy", 0.5, 60_000, T0 + 60 * MIN);
    return { sim, parent };
  };
  const sec = (ms: number) => Math.floor(ms / 1000);
  const journal = async () => (await getDb().select().from(s.tradeJournal))[0];

  test("stop and take profit are found; a value you typed is never overwritten", async () => {
    const { sim } = entry();
    const at = sec(T0 + 60 * MIN);
    const c = await connected({
      trades: sim.trades,
      active: [
        order({ order_id: "10", trigger_price: "59000", created_at: at, updated_at: at }),
        order({
          order_id: "11",
          type: "take-profit",
          trigger_price: "63000",
          created_at: at,
          updated_at: at,
        }),
      ],
    });
    await c.sync();
    expect(await journal()).toMatchObject({ stopLoss: 59_000, stopLossSource: "auto", takeProfit: 63_000 });
    await getDb().update(s.tradeJournal).set({ stopLoss: 58_000, stopLossSource: "user" });
    await c.sync();
    expect((await journal()).stopLoss).toBe(58_000);
  });

  test("a stop attached to an entry order counts from the entry's fill, however early it was placed", async () => {
    const { sim, parent } = entry();
    const c = await connected({
      trades: sim.trades,
      active: [order({ order_id: "10", trigger_price: "59000", parent_order_id: String(parent) })],
    });
    await c.sync();
    expect(await journal()).toMatchObject({ stopLoss: 59_000 });
    await c.sync();
    expect((await getDb().select().from(s.orders))[0].placedAt).toBe(T0 + 60 * MIN);
  });

  test("a stop edited in place keeps the first price as the stop and shows the edit as a move", async () => {
    const { sim } = entry();
    const at = sec(T0 + 60 * MIN);
    const moved = sec(T0 + 90 * MIN);
    const c = await connected({
      trades: sim.trades,
      active: [order({ order_id: "10", trigger_price: "59000", created_at: at, updated_at: at })],
    });
    await c.sync({ now: T0 + 70 * MIN });
    c.st.active = [
      order({ order_id: "10", trigger_price: "58500", created_at: at, updated_at: moved, order_version: 1 }),
    ];
    for (let i = 0; i < 3; i++) await c.sync({ now: T0 + 100 * MIN }); // read again: no extra versions
    expect((await journal()).stopLoss).toBe(59_000);
    const moves = await getDb().select().from(s.stopMoves);
    expect(moves.map((m) => [m.price, m.time, m.oid])).toEqual([[58_500, T0 + 90 * MIN, 10]]);
    const rows = await getDb().select().from(s.orders);
    expect(rows.map((r) => [r.oid, r.status]).sort()).toEqual(
      [
        [versionOid(10, 59_000, T0 + 60 * MIN), "modified"],
        [10, "open"],
      ].sort(),
    );
    // then it fires
    c.st.active = [];
    c.st.inactive = [
      order({
        order_id: "10",
        trigger_price: "58500",
        status: "filled",
        created_at: at,
        updated_at: sec(T0 + 120 * MIN),
      }),
    ];
    await c.sync({ now: T0 + 130 * MIN });
    const fired = await getDb()
      .select()
      .from(s.orders)
      .where(and(eq(s.orders.oid, 10)));
    expect(fired[0]).toMatchObject({ status: "triggered", triggerPx: 58_500, placedAt: T0 + 90 * MIN });
    expect((await journal()).stopLoss).toBe(59_000);
  });
});

describe("cash flows and the balance check", () => {
  const dep = (id: string, amount: string, status = "completed") => ({
    id,
    amount,
    timestamp: T0 / 1000,
    status,
    l1_tx_hash: "h",
    asset_id: USDC,
  });
  test("deposits, withdrawals and transfers: only money that really moved counts", () => {
    expect(mapDeposit(dep("a", "100"), USDC)).toMatchObject({ kind: "deposit", usd: 100, time: T0 });
    expect(mapDeposit(dep("a", "100", "pending"), USDC).usd).toBe(0);
    expect(mapDeposit({ ...dep("a", "1"), asset_id: 1 }, USDC)).toMatchObject({ kind: "spot_only", usd: 0 });
    const wd = (status: string) =>
      mapWithdraw({ id: "w", amount: "40", timestamp: T0, status, asset_id: USDC }, USDC).usd;
    expect([wd("claimable"), wd("completed"), wd("failed"), wd("refunded")]).toEqual([-40, -40, 0, 0]);
    const tr = (type: string, from = "perps", to = "perps", unified = false) =>
      mapTransfer(
        {
          id: "t",
          amount: "10",
          fee: "3",
          timestamp: T0,
          type,
          asset_id: USDC,
          from_route: from,
          to_route: to,
        },
        USDC,
        unified,
      );
    expect(tr("L2TransferOutflow")).toMatchObject({ kind: "transfer_out", usd: -13 });
    expect(tr("L2TransferInflow")).toMatchObject({ kind: "transfer_in", usd: 10 });
    expect(tr("L2MintSharesOutflow").kind).toBe("vault");
    expect([
      tr("L2SelfTransfer", "spot", "perps").usd,
      tr("L2SelfTransfer", "perps", "spot").usd,
      tr("L2SelfTransfer", "spot", "perps", true).usd,
    ]).toEqual([10, -10, 0]);
  });

  test("the balance view waits until the books match Lighter, and a status change is picked up", async () => {
    const sim = simLighter();
    sim.fill("buy", 0.1, 60_000, T0);
    sim.fill("sell", 0.1, 60_100, T0 + MIN);
    const { sync, st, wallet } = await connected({
      trades: sim.trades,
      deposits: [dep("a", "1000", "pending")],
      collateral: "1010",
    });
    await sync();
    expect((await wallet()).ledgerCompletedAt).toBeNull();
    expect(await balanceInputs(getDb(), accountId)).toBeNull();
    st.deposits = [dep("a", "1000")];
    await sync();
    expect((await wallet()).ledgerCompletedAt).not.toBeNull();
    const b = (await balanceInputs(getDb(), accountId))!;
    expect(b.flows).toEqual([{ t: T0, usd: 1000, kind: "deposit" }]);
    expect(b.cash.reduce((a, c) => a + c.usd, 0)).toBeCloseTo(10, 6);
    // a mismatch is tolerated for a day (money in flight), then the view stops using the wallet
    st.collateral = "500";
    const t = T0 + 600 * MIN;
    await sync({ now: t + 60 * MIN });
    expect((await wallet()).ledgerCompletedAt).not.toBeNull();
    await sync({ now: t + 26 * 60 * MIN });
    expect((await wallet()).ledgerCompletedAt).toBeNull();
  });

  test("moving funds between exchanges folds into one flow worth the fee; totals never change", () => {
    const base = { hash: "" };
    const rows = [
      { ...base, walletId: "hl", exchange: "hyperliquid", t: 1000, usd: -501, kind: "withdraw" },
      { ...base, walletId: "lt", exchange: "lighter", t: 1000 + 30 * MIN, usd: 500, kind: "deposit" },
      { ...base, walletId: "lt", exchange: "lighter", t: 1000 + 40 * MIN, usd: 900, kind: "deposit" },
      { ...base, walletId: "hl", exchange: "hyperliquid", t: 1000 + 50 * MIN, usd: 901, kind: "deposit" },
    ];
    const out = foldOwnTransfers(rows);
    expect(out[0]).toEqual({ t: 1000, usd: -1, kind: "internal" });
    expect(out.map((f) => f.kind)).toEqual(["internal", "deposit", "deposit"]);
    expect(out.reduce((a, f) => a + f.usd, 0)).toBe(rows.reduce((a, f) => a + f.usd, 0));
    // too late, or same exchange: left alone
    const late = [rows[0], { ...rows[1], t: 1000 + 25 * 60 * MIN }];
    expect(foldOwnTransfers(late).map((f) => f.kind)).toEqual(["withdraw", "deposit"]);
    expect(foldOwnTransfers([rows[0], { ...rows[1], exchange: "hyperliquid" }]).map((f) => f.kind)).toEqual([
      "withdraw",
      "deposit",
    ]);
  });
});
