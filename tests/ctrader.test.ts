import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { useTempDb } from "./helpers/db";
import { getDb } from "@/server/db/client";
import { runMigrations, seedDefaults } from "@/server/db/bootstrap";
import * as s from "@/server/db/schema";
import { decryptToken, encryptToken } from "@/server/ctrader/crypto";
import { authorizeUrl, CtraderAuthError, exchangeCode, redirectUriFor } from "@/server/ctrader/oauth";
import { Deal, PT } from "@/server/ctrader/protocol";
import { positionTrade, toStoredDeal } from "@/server/ctrader/positions";
import { CtraderSession, openSession, type Transport } from "@/server/ctrader/session";
import {
  accessToken,
  discoverAccounts,
  saveConnection,
  syncCtrader,
  TradeScopeRefused,
  WINDOW_MS,
} from "@/server/ctrader/sync";
import { CFG, CTID, deal, fakeTransport, LOGIN, MD, serverState, type ServerState } from "./fixtures/ctrader";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 2, 9, 0); // 2 Nov 2026
const noSleep = async () => {};

// ─── pure parts ─────────────────────────────────────────────────────────────────────

describe("token encryption", () => {
  test("round-trips, and fails closed on a wrong key or tampering", () => {
    const enc = encryptToken("tok-123", CFG.tokenKey);
    expect(enc).not.toContain("tok-123");
    expect(decryptToken(enc, CFG.tokenKey)).toBe("tok-123");
    expect(encryptToken("tok-123", CFG.tokenKey)).not.toBe(enc); // fresh IV
    expect(() => decryptToken(enc, "z".repeat(40))).toThrow(/could not be decrypted/);
    const bad = enc.slice(0, -2) + (enc.endsWith("A") ? "BB" : "AA");
    expect(() => decryptToken(bad, CFG.tokenKey)).toThrow();
  });
});

describe("oauth", () => {
  test("the grant URL asks for view-only scope, never trading", () => {
    const u = new URL(
      authorizeUrl({
        clientId: "c",
        redirectUri: redirectUriFor("https://journal.example/x?y"),
        state: "st",
      }),
    );
    expect(u.origin + u.pathname).toBe("https://id.ctrader.com/my/settings/openapi/grantingaccess/");
    expect(u.searchParams.get("scope")).toBe("accounts");
    expect(u.searchParams.get("redirect_uri")).toBe("https://journal.example/api/ctrader/callback");
    expect(u.searchParams.get("state")).toBe("st");
    expect(u.toString()).not.toMatch(/trading/);
  });

  test("exchanges a code; refusals never echo the code or secret", async () => {
    const seen: string[] = [];
    const ok = (async (u: URL) => {
      seen.push(u.toString());
      return Response.json({
        accessToken: "A1",
        refreshToken: "R1",
        expiresIn: 2628000,
        tokenType: "bearer",
        errorCode: null,
      });
    }) as unknown as typeof fetch;
    const t = await exchangeCode(
      { code: "c0de", redirectUri: "https://j/cb", clientId: "id", clientSecret: "sec" },
      ok,
      1000,
    );
    expect(t).toEqual({ accessToken: "A1", refreshToken: "R1", expiresAt: 1000 + 2628000 * 1000 });
    expect(new URL(seen[0]).searchParams.get("grant_type")).toBe("authorization_code");

    const no = (async () =>
      Response.json({ errorCode: "ACCESS_DENIED", description: "bad code c0de" })) as unknown as typeof fetch;
    const err = await exchangeCode(
      { code: "c0de", redirectUri: "https://j/cb", clientId: "id", clientSecret: "sec" },
      no,
    ).catch((e) => e);
    expect(err).toBeInstanceOf(CtraderAuthError);
    expect(err.message).toContain("ACCESS_DENIED");
    expect(err.message).not.toMatch(/c0de|sec/);
  });
});

describe("protocol parsing", () => {
  test("int64 as numbers or strings, enums as numbers or names", () => {
    const a = Deal.parse(deal({ id: 1, pos: 9, side: "SELL", units: 1000, price: 1.1, t: T0 }));
    const b = Deal.parse({
      ...deal({ id: 1, pos: 9, side: 2, units: 1000, price: 1.1, t: T0, status: 2 }),
      positionId: 9,
    });
    expect(a.positionId).toBe(9);
    expect(a.tradeSide).toBe(2);
    expect(a.dealStatus).toBe(2);
    expect(b).toEqual(a);
  });
});

const stored = (d: ReturnType<typeof deal>, symbol = "EURUSD") =>
  toStoredDeal(CTID, Deal.parse(d), symbol, MD);

describe("deals → trade (one per position)", () => {
  test("money is scaled by moneyDigits and volume from cents", () => {
    const x = stored(
      deal({ id: 1, pos: 1, side: "BUY", units: 10_000, price: 1.1, t: T0, commission: -3.5 }),
    );
    expect(x.volume).toBe(10_000);
    expect(x.commission).toBe(-3.5);
    expect(x.side).toBe("B");
    expect(x.close).toBeNull();
  });

  test("a long, scaled in and closed in two parts", () => {
    const ds = [
      deal({ id: 1, pos: 7, side: "BUY", units: 10_000, price: 1.1, t: T0, commission: -3 }),
      deal({ id: 2, pos: 7, side: "BUY", units: 10_000, price: 1.2, t: T0 + 60_000, commission: -3 }),
      deal({
        id: 3,
        pos: 7,
        side: "SELL",
        units: 5_000,
        price: 1.3,
        t: T0 + 120_000,
        close: { entry: 1.15, gross: 750, swap: -1, commission: -3, balance: 100_746 },
      }),
      deal({
        id: 4,
        pos: 7,
        side: "SELL",
        units: 15_000,
        price: 1.25,
        t: T0 + 180_000,
        close: { entry: 1.15, gross: 1500, swap: -2, commission: -9, balance: 102_235 },
      }),
      // a rejected deal on the same position is ignored
      deal({ id: 5, pos: 7, side: "SELL", units: 1_000, price: 1.25, t: T0 + 190_000, status: "REJECTED" }),
    ].map((d) => stored(d));
    const t = positionTrade(LOGIN, ds)!;
    expect(t.externalKey).toBe(`ctrader:${LOGIN}:7`);
    expect(t.direction).toBe("long");
    expect(t.status).toBe("closed");
    expect(t.avgEntry).toBeCloseTo(1.15, 10);
    expect(t.avgExit).toBeCloseTo((5_000 * 1.3 + 15_000 * 1.25) / 20_000, 10);
    expect(t.sizeUnits).toBe(20_000);
    expect(t.grossPnl).toBeCloseTo(2250, 6);
    expect(t.funding).toBeCloseTo(-3, 6);
    expect(t.fees).toBeCloseTo(12, 6); // the closing deals' realised commission for the closed volume
    // gross − fees + swap = the balance change across the two closes (+ the first close's own net)
    expect(t.grossPnl - t.fees + t.funding).toBeCloseTo(746 + (102_235 - 100_746), 6);
    expect(t.notionalUsd).toBeCloseTo(20_000 * 1.1, 6);
    expect(t.fillCount).toBe(4);
    expect(t.exitTime).toBe(T0 + 180_000);
  });

  test("a short still open after a partial close", () => {
    const t = positionTrade(LOGIN, [
      stored(deal({ id: 1, pos: 8, side: "SELL", units: 100, price: 2000, t: T0, commission: -2 }), "XAUUSD"),
      stored(
        deal({
          id: 2,
          pos: 8,
          side: "BUY",
          units: 40,
          price: 1990,
          t: T0 + 1000,
          close: { entry: 2000, gross: 400, commission: -1.6, balance: 100_398.4 },
        }),
        "XAUUSD",
      ),
    ])!;
    expect(t.direction).toBe("short");
    expect(t.status).toBe("open");
    expect(t.exitTime).toBeNull();
    expect(t.exitUnitsTotal).toBe(40);
    expect(t.coin).toBe("XAUUSD");
  });

  test("an open position with no close shows its opening commission", () => {
    const t = positionTrade(LOGIN, [
      stored(deal({ id: 1, pos: 9, side: "BUY", units: 1000, price: 1.1, t: T0, commission: -0.7 })),
    ])!;
    expect(t.status).toBe("open");
    expect(t.fees).toBeCloseTo(0.7, 9);
    expect(t.grossPnl).toBe(0);
  });

  test("only a closing deal (opened before the fetched history): direction from the close, flagged", () => {
    const t = positionTrade(LOGIN, [
      stored(
        deal({
          id: 2,
          pos: 10,
          side: "SELL",
          units: 1000,
          price: 1.2,
          t: T0,
          close: { entry: 1.1, gross: 100, balance: 100_100 },
        }),
      ),
    ])!;
    expect(t.direction).toBe("long");
    expect(t.status).toBe("closed");
    expect(t.partialHistory).toBe(true);
    expect(t.avgEntry).toBe(1.1);
  });

  test("nothing executed → no trade", () => {
    expect(
      positionTrade(LOGIN, [
        stored(deal({ id: 1, pos: 11, side: "BUY", units: 1000, price: 1, t: T0, status: "MISSED" })),
      ]),
    ).toBeNull();
  });
});

describe("session", () => {
  test("matches responses by id, maps error responses, times out", async () => {
    let handler: (d: string) => void = () => {};
    const sent: { clientMsgId: string; payloadType: number }[] = [];
    const t: Transport = {
      send: (d) => sent.push(JSON.parse(d)),
      close() {},
      onMessage: (cb) => (handler = cb),
      onClose() {},
    };
    const sess = new CtraderSession(t, { timeoutMs: 50, historicalGapMs: 0, sleep: noSleep, now: Date.now });
    const { z } = await import("zod");
    const p1 = sess.request(PT.TRADER_REQ, {}, PT.TRADER_RES, z.object({ ok: z.number() }));
    const p2 = sess.request(PT.TRADER_REQ, {}, PT.TRADER_RES, z.unknown());
    // answer out of order
    handler(
      JSON.stringify({
        clientMsgId: sent[1].clientMsgId,
        payloadType: PT.OA_ERROR_RES,
        payload: { errorCode: "CH_ACCESS_TOKEN_INVALID" },
      }),
    );
    handler(
      JSON.stringify({ clientMsgId: sent[0].clientMsgId, payloadType: PT.TRADER_RES, payload: { ok: 1 } }),
    );
    await expect(p1).resolves.toEqual({ ok: 1 });
    await expect(p2).rejects.toMatchObject({ code: "CH_ACCESS_TOKEN_INVALID" });
    await expect(sess.request(PT.TRADER_REQ, {}, PT.TRADER_RES, z.unknown())).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    sess.close();
    await expect(sess.request(PT.TRADER_REQ, {}, PT.TRADER_RES, z.unknown())).rejects.toMatchObject({
      code: "DISCONNECTED",
    });
  });

  test("a wrong client secret fails the app auth", async () => {
    const st = serverState();
    await expect(
      openSession(
        "wss://demo.x:5036",
        { clientId: "c", clientSecret: "nope" },
        { transport: fakeTransport(st) },
      ),
    ).rejects.toMatchObject({
      code: "CH_CLIENT_AUTH_FAILURE",
    });
  });
});

// ─── against the DB ─────────────────────────────────────────────────────────────────

let st: ServerState;
let clock = T0;
const deps = (over: Record<string, unknown> = {}) => ({
  cfg: CFG,
  transport: fakeTransport(st),
  sleep: noSleep,
  now: () => clock,
  ...over,
});

async function connect(expiresAt = clock + 30 * DAY) {
  await saveConnection(getDb(), CFG, { accessToken: "AT-1", refreshToken: "RT-1", expiresAt });
}

beforeAll(async () => {
  useTempDb();
  await runMigrations(getDb());
  await seedDefaults(getDb());
});

beforeEach(async () => {
  const db = getDb();
  await db.delete(s.tradeJournal);
  await db.delete(s.trades);
  await db.delete(s.ctraderDeals);
  await db.delete(s.ctraderAccounts);
  await db.delete(s.ctraderConnections);
  clock = T0;
  st = serverState({ registeredAt: T0 - 20 * DAY });
});

const ctTrades = () => getDb().select().from(s.trades).where(eq(s.trades.source, "ctrader"));

describe("discovery", () => {
  test("adds each account once, as a prop journal account starting at its balance", async () => {
    await connect();
    const r = await discoverAccounts(getDb(), deps());
    expect(r).toEqual({ found: 1, added: 1 });
    const [a] = await getDb().select().from(s.ctraderAccounts);
    expect(a).toMatchObject({
      ctid: CTID,
      isLive: false,
      traderLogin: LOGIN,
      currency: "USD",
      moneyDigits: MD,
      enabled: true,
    });
    const acct = await getDb().query.accounts.findFirst({ where: eq(s.accounts.id, a.accountId) });
    expect(acct).toMatchObject({ type: "prop", currency: "USD", startingBalance: 100_000 });
    expect(acct!.name).toContain("demo");
    // demo accounts are only ever authorised on the demo host
    expect(
      st.log.filter((l) => l.payloadType === PT.ACCOUNT_AUTH_REQ).every((l) => l.url.includes("demo.")),
    ).toBe(true);
    expect(await discoverAccounts(getDb(), deps())).toEqual({ found: 1, added: 0 });
  });

  test("refuses a grant with trading scope", async () => {
    await connect();
    st.scope = 1;
    await expect(discoverAccounts(getDb(), deps())).rejects.toBeInstanceOf(TradeScopeRefused);
    expect(await getDb().select().from(s.ctraderAccounts)).toHaveLength(0);
  });

  test("live accounts go to the live host", async () => {
    await connect();
    st.accounts = [{ ctidTraderAccountId: 42, isLive: true, traderLogin: 77, brokerTitleShort: "PropCo" }];
    await discoverAccounts(getDb(), deps());
    expect(st.log.filter((l) => l.payloadType === PT.ACCOUNT_AUTH_REQ).map((l) => l.url)).toEqual([
      "wss://live.ctraderapi.com:5036",
    ]);
  });
});

describe("tokens", () => {
  test("refreshes near expiry, stores the rotated pair encrypted, and holds a lease", async () => {
    await connect(clock + 2 * DAY);
    const calls: URL[] = [];
    const f = (async (u: URL) => {
      calls.push(u);
      return Response.json({ accessToken: "AT-2", refreshToken: "RT-2", expiresIn: 2628000 });
    }) as unknown as typeof fetch;
    const tok = await accessToken(getDb(), deps({ fetch: f }));
    expect(tok!.token).toBe("AT-2");
    expect(calls[0].searchParams.get("grant_type")).toBe("refresh_token");
    expect(calls[0].searchParams.get("refresh_token")).toBe("RT-1");
    const row = (await getDb().query.ctraderConnections.findFirst())!;
    expect(decryptToken(row.refreshTokenEnc, CFG.tokenKey)).toBe("RT-2");
    expect(row.accessTokenEnc).not.toContain("AT-2");
    expect(row.refreshingUntil).toBeNull();
    // fresh again: no second refresh
    await accessToken(getDb(), deps({ fetch: f }));
    expect(calls).toHaveLength(1);
  });

  test("a run holding stale tokens doesn't refresh with a refresh token another run already rotated", async () => {
    await connect(clock + DAY);
    const db = getDb();
    const stale = (await db.query.ctraderConnections.findFirst())!;
    // another run rotates first
    await saveConnection(db, CFG, { accessToken: "AT-9", refreshToken: "RT-9", expiresAt: clock + 30 * DAY });
    const orig = db.query.ctraderConnections.findFirst.bind(db.query.ctraderConnections);
    let first = true;
    db.query.ctraderConnections.findFirst = ((...args: Parameters<typeof orig>) => {
      if (first) {
        first = false;
        return Promise.resolve(stale);
      }
      return orig(...args);
    }) as typeof orig;
    const f = (async () => Response.json({ errorCode: "ACCESS_DENIED" })) as unknown as typeof fetch;
    try {
      expect((await accessToken(db, deps({ fetch: f })))!.token).toBe("AT-9");
    } finally {
      db.query.ctraderConnections.findFirst = orig;
    }
    expect((await db.query.ctraderConnections.findFirst())!.lastError).toBeNull();
  });

  test("a revoked refresh token asks you to reconnect", async () => {
    await connect(clock + DAY);
    const f = (async () => Response.json({ errorCode: "ACCESS_DENIED" })) as unknown as typeof fetch;
    await expect(accessToken(getDb(), deps({ fetch: f }))).rejects.toThrow(/connect again/);
    const row = (await getDb().query.ctraderConnections.findFirst())!;
    expect(row.lastError).toMatch(/connect again/);
    expect(row.refreshingUntil).toBeNull();
  });

  test("while another run holds the refresh lease, a still-valid token is used as is", async () => {
    await connect(clock + DAY);
    await getDb()
      .update(s.ctraderConnections)
      .set({ refreshingUntil: clock + 30_000 });
    const f = (async () => {
      throw new Error("must not refresh");
    }) as unknown as typeof fetch;
    expect((await accessToken(getDb(), deps({ fetch: f })))!.token).toBe("AT-1");
  });
});

describe("sync", () => {
  async function setup() {
    await connect();
    await discoverAccounts(getDb(), deps());
  }
  const d0 = T0 - 10 * DAY;

  test("fetches deals in weekly windows, pages, and builds one trade per position", async () => {
    await setup();
    st.pageSize = 2;
    st.deals = [
      deal({ id: 1, pos: 100, side: "BUY", units: 10_000, price: 1.1, t: d0, commission: -3 }),
      deal({
        id: 2,
        pos: 100,
        side: "SELL",
        units: 10_000,
        price: 1.12,
        t: d0 + 3_600_000,
        close: { entry: 1.1, gross: 200, swap: -1, commission: -6, balance: 100_193 },
      }),
      deal({
        id: 3,
        pos: 101,
        side: "SELL",
        units: 50,
        price: 2000,
        t: d0 + 2 * DAY,
        symbolId: 2,
        commission: -1,
      }),
      deal({
        id: 4,
        pos: 101,
        side: "BUY",
        units: 50,
        price: 2010,
        t: d0 + 2 * DAY + 60_000,
        symbolId: 2,
        close: { entry: 2000, gross: -500, commission: -2, balance: 99_691 },
      }),
      deal({ id: 5, pos: 102, side: "BUY", units: 1000, price: 1.2, t: T0 - 3_600_000, symbolId: 3 }),
    ];
    const r = await syncCtrader(getDb(), deps());
    expect(r.done).toBe(true);
    expect(r.results[0]).toMatchObject({ status: "success", dealsFetched: 5 });
    const deals = st.log.filter((l) => l.payloadType === PT.DEAL_LIST_REQ);
    expect(
      deals.every((l) => Number(l.payload.toTimestamp) - Number(l.payload.fromTimestamp) <= WINDOW_MS),
    ).toBe(true);

    const ts = (await ctTrades()).sort((a, b) => a.entryTime! - b.entryTime!);
    expect(ts.map((t) => [t.coin, t.direction, t.status])).toEqual([
      ["EURUSD", "long", "closed"],
      ["XAUUSD", "short", "closed"],
      ["OLDSYM", "long", "open"],
    ]);
    expect(ts[0].netPnl).toBeCloseTo(200 - 6 - 1, 9); // funding (swap) in net by default
    expect(ts[1].netPnl).toBeCloseTo(-502, 9);
    // Σ closed net = the balance change from the first close's balance before to the last close's balance after
    expect(ts[0].netPnl! + ts[1].netPnl!).toBeCloseTo(99_691 - 100_000, 9);
    expect(ts.every((t) => t.walletId === null && t.marketType === "cfd")).toBe(true);
    const acct = (await getDb().select().from(s.ctraderAccounts))[0];
    expect(acct.dealsSyncedTo).toBe(clock);
    expect(acct.lastError).toBeNull();
  });

  test("re-syncs are idempotent and never touch the journal, the account you moved it to, or a delete", async () => {
    await setup();
    st.deals = [
      deal({ id: 1, pos: 200, side: "BUY", units: 1000, price: 1.1, t: d0 }),
      deal({
        id: 2,
        pos: 200,
        side: "SELL",
        units: 1000,
        price: 1.2,
        t: d0 + 1000,
        close: { entry: 1.1, gross: 100, balance: 100_100 },
      }),
      deal({ id: 3, pos: 201, side: "BUY", units: 1000, price: 1.1, t: d0 + 5000 }),
    ];
    await syncCtrader(getDb(), deps());
    const db = getDb();
    const [a, b] = (await ctTrades()).sort((x, y) => x.entryTime! - y.entryTime!);
    await db
      .insert(s.tradeJournal)
      .values({ tradeId: a.id, postNotes: "mine", stopLoss: 1.05, stopLossSource: "user" });
    const [other] = await db.insert(s.accounts).values({ name: "Other" }).returning();
    await db.update(s.trades).set({ accountId: other.id }).where(eq(s.trades.id, a.id));
    await db.update(s.trades).set({ deletedAt: 123 }).where(eq(s.trades.id, b.id));

    // the open position closes later; run again from the cursor
    clock = T0 + DAY;
    st.deals.push(
      deal({
        id: 4,
        pos: 201,
        side: "SELL",
        units: 1000,
        price: 1.0,
        t: T0 + 3_600_000,
        close: { entry: 1.1, gross: -100, balance: 100_000 },
      }),
    );
    await syncCtrader(db, deps());
    await syncCtrader(db, deps());
    const after = await ctTrades();
    expect(after).toHaveLength(2);
    const a2 = after.find((t) => t.id === a.id)!;
    const b2 = after.find((t) => t.id === b.id)!;
    expect(a2.accountId).toBe(other.id);
    expect(b2.deletedAt).toBe(123);
    expect(b2.status).toBe("closed");
    expect(b2.netPnl).toBeCloseTo(-100, 9);
    expect(await db.query.tradeJournal.findFirst({ where: eq(s.tradeJournal.tradeId, a.id) })).toMatchObject({
      postNotes: "mine",
      stopLoss: 1.05,
      stopLossSource: "user",
    });
    expect(await db.select().from(s.ctraderDeals)).toHaveLength(4);
  });

  test("stops at the time budget and resumes from the saved cursor", async () => {
    await connect();
    st.registeredAt = T0 - 60 * DAY;
    await discoverAccounts(getDb(), deps());
    st.deals = [deal({ id: 1, pos: 300, side: "BUY", units: 1000, price: 1, t: T0 - 55 * DAY })];
    // no budget left: still one window of progress, then it stops
    const r1 = await syncCtrader(getDb(), deps({ budgetMs: 0, now: () => clock++ }));
    expect(r1.done).toBe(false);
    const cursor = (await getDb().select().from(s.ctraderAccounts))[0].dealsSyncedTo!;
    expect(cursor).toBeLessThan(T0 - 40 * DAY);
    clock = T0;
    const r2 = await syncCtrader(getDb(), deps());
    expect(r2.done).toBe(true);
    expect(await ctTrades()).toHaveLength(1);
  });

  test("a full reply splits the window until every deal is read, whichever end the server keeps", async () => {
    await setup();
    st.pageSize = 3;
    st.deals = Array.from({ length: 10 }, (_, i) =>
      deal({ id: 100 + i, pos: 500 + i, side: "BUY", units: 1000, price: 1, t: d0 + i * 60_000 }),
    );
    st.deals.push(
      ...Array.from({ length: 4 }, (_, i) =>
        deal({ id: 200 + i, pos: 600 + i, side: "BUY", units: 1000, price: 1, t: d0 + DAY }),
      ),
    );
    const r = await syncCtrader(getDb(), deps());
    expect(r.results[0]).toMatchObject({ status: "success", dealsFetched: 13 }); // 4 in one millisecond: 3 kept
    expect(await getDb().select().from(s.ctraderDeals)).toHaveLength(13);
  });

  test("running out of budget mid-window keeps the cursor before that window", async () => {
    await setup();
    st.pageSize = 1;
    st.deals = Array.from({ length: 8 }, (_, i) =>
      deal({ id: 100 + i, pos: 500 + i, side: "BUY", units: 1000, price: 1, t: d0 + i * 60_000 }),
    );
    let reads = 0;
    const r1 = await syncCtrader(getDb(), deps({ budgetMs: 5, now: () => clock + reads++ }));
    expect(r1.done).toBe(false);
    const cursor = (await getDb().select().from(s.ctraderAccounts))[0].dealsSyncedTo;
    expect(cursor === null || cursor <= d0).toBe(true);
    const r2 = await syncCtrader(getDb(), deps());
    expect(r2.done).toBe(true);
    expect(await getDb().select().from(s.ctraderDeals)).toHaveLength(8);
  });

  test("an account found with closes behind it starts at the balance before its first close", async () => {
    await connect();
    st.accounts[0].lastClosingDealTimestamp = d0;
    await discoverAccounts(getDb(), deps());
    st.deals = [
      deal({ id: 1, pos: 1, side: "BUY", units: 1000, price: 1.1, t: d0 }),
      deal({
        id: 2,
        pos: 1,
        side: "SELL",
        units: 1000,
        price: 1.2,
        t: d0 + 1000,
        close: { entry: 1.1, gross: 100, commission: -4, balance: 50_096 },
      }),
    ];
    await syncCtrader(getDb(), deps());
    const [a] = await getDb().select().from(s.ctraderAccounts);
    expect(
      (await getDb().query.accounts.findFirst({ where: eq(s.accounts.id, a.accountId) }))!.startingBalance,
    ).toBeCloseTo(50_000, 6);
  });

  test("never fills the starting balance of an account you pointed it at (e.g. your main one)", async () => {
    await connect();
    st.accounts[0].lastClosingDealTimestamp = d0;
    await discoverAccounts(getDb(), deps());
    const [main] = await getDb()
      .insert(s.accounts)
      .values({ name: "Main-ish", startingBalance: 0 })
      .returning();
    await getDb().update(s.ctraderAccounts).set({ accountId: main.id });
    st.deals = [
      deal({
        id: 2,
        pos: 1,
        side: "SELL",
        units: 1000,
        price: 1.2,
        t: d0 + 1000,
        close: { entry: 1.1, gross: 100, balance: 50_100 },
      }),
    ];
    await syncCtrader(getDb(), deps());
    expect(
      (await getDb().query.accounts.findFirst({ where: eq(s.accounts.id, main.id) }))!.startingBalance,
    ).toBe(0);
    expect((await getDb().select().from(s.ctraderAccounts))[0].startingBalancePending).toBe(false);
  });

  test("an invalid token is reported per account and asks for a reconnect", async () => {
    await setup();
    st.accountAuthError = "CH_ACCESS_TOKEN_INVALID";
    const r = await syncCtrader(getDb(), deps());
    expect(r.results[0].status).toBe("error");
    const conn = (await getDb().query.ctraderConnections.findFirst())!;
    expect(conn.lastError).toMatch(/connect again/);
    expect((await getDb().select().from(s.ctraderAccounts))[0].lastError).toMatch(/CH_ACCESS_TOKEN_INVALID/);
  });

  test("does nothing when not configured, not connected, or the account is off", async () => {
    expect(await syncCtrader(getDb(), deps({ cfg: { ...CFG, configured: false } }))).toEqual({
      done: true,
      results: [],
    });
    await setup();
    await getDb().update(s.ctraderAccounts).set({ enabled: false });
    expect(await syncCtrader(getDb(), deps())).toEqual({ done: true, results: [] });
  });
});

describe("OAuth callback route", () => {
  const env = {
    CTRADER_CLIENT_ID: CFG.clientId,
    CTRADER_CLIENT_SECRET: CFG.clientSecret,
    CTRADER_TOKEN_KEY: CFG.tokenKey,
  };
  async function call(url: string, cookie?: string, fetchImpl?: typeof fetch) {
    const { resetConfigForTests } = await import("@/server/config");
    Object.assign(process.env, env);
    resetConfigForTests();
    const real = globalThis.fetch;
    if (fetchImpl) globalThis.fetch = fetchImpl;
    try {
      const { GET } = await import("@/app/api/ctrader/callback/route");
      const res = await GET(new Request(url, { headers: cookie ? { cookie } : {} }));
      return new URL(res.headers.get("location")!);
    } finally {
      globalThis.fetch = real;
      for (const k of Object.keys(env)) delete process.env[k];
      resetConfigForTests();
    }
  }
  const never = (async () => {
    throw new Error("must not call cTrader");
  }) as unknown as typeof fetch;

  test("rejects a missing or mismatched state before touching cTrader", async () => {
    expect(
      (
        await call("https://j.example/api/ctrader/callback?code=c&state=abc", undefined, never)
      ).searchParams.get("error"),
    ).toBe("state");
    expect(
      (
        await call(
          "https://j.example/api/ctrader/callback?code=c&state=abc",
          "ctrader_oauth_state=abd",
          never,
        )
      ).searchParams.get("error"),
    ).toBe("state");
    expect(await getDb().select().from(s.ctraderConnections)).toHaveLength(0);
  });

  test("a matching state exchanges the code with the exact redirect URI; a refusal stores nothing", async () => {
    const seen: URL[] = [];
    const f = (async (u: URL) => {
      seen.push(u);
      return Response.json({ errorCode: "ACCESS_DENIED" });
    }) as unknown as typeof fetch;
    const back = await call(
      "https://j.example/api/ctrader/callback?code=c0de&state=abc",
      "x=1; ctrader_oauth_state=abc",
      f,
    );
    expect(back.pathname).toBe("/settings/ctrader");
    expect(back.searchParams.get("error")).toBe("token");
    expect(back.toString()).not.toContain("c0de");
    expect(seen[0].searchParams.get("redirect_uri")).toBe("https://j.example/api/ctrader/callback");
    expect(await getDb().select().from(s.ctraderConnections)).toHaveLength(0);
  });
});
