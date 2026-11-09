import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import { useTempDb } from "./helpers/db";
import { getDb } from "@/server/db/client";
import { runMigrations, seedDefaults } from "@/server/db/bootstrap";
import * as s from "@/server/db/schema";
import { createHlClient, WeightLimiter } from "@/server/hyperliquid/client";
import { syncAll, syncWallet } from "@/server/hyperliquid/sync";
import type { FillInput } from "@/server/reconstruct/types";
import { DEMO_WALLET, MIN, T0, resetTids, sim } from "./fixtures/fills";

// ─── fake Hyperliquid info API (documented semantics, verified 2026-11-09) ─────────────
type Fake = {
  fills: FillInput[];
  funding: { time: number; hash: string; delta: Record<string, unknown> }[];
  positions: Record<string, unknown[]>; // by dex
  dexes: (null | { name: string })[];
  calls: { type: string; body: Record<string, unknown> }[];
  failNext: number[]; // status codes to return before succeeding
};

function fakeHl(init: Partial<Fake> = {}) {
  const st: Fake = { fills: [], funding: [], positions: {}, dexes: [null, { name: "xyz" }], calls: [], failNext: [], ...init };
  const fetchImpl = (async (_url: string, req: { body: string }) => {
    const body = JSON.parse(req.body);
    st.calls.push({ type: body.type, body });
    const fail = st.failNext.shift();
    if (fail) return new Response("err", { status: fail });
    const inRange = (t: number) => t >= body.startTime && (body.endTime === undefined || t <= body.endTime);
    let json: unknown;
    switch (body.type) {
      case "userFillsByTime":
        json = st.fills
          .filter((f) => inRange(f.time))
          .sort((a, b) => a.time - b.time || a.tid - b.tid)
          .slice(0, 2000)
          .map(({ builderFee, liquidation, ...f }) => ({
            ...f,
            ...(builderFee ? { builderFee } : {}),
            ...(liquidation ? { liquidation } : {}),
          }));
        break;
      case "userFunding":
        json = st.funding.filter((f) => inRange(f.time)).sort((a, b) => a.time - b.time).slice(0, 500);
        break;
      case "perpDexs":
        json = st.dexes;
        break;
      case "clearinghouseState":
        json = {
          assetPositions: (st.positions[body.dex ?? ""] ?? []).map((position) => ({ position, type: "oneWay" })),
          marginSummary: { accountValue: "1000.0", totalNtlPos: "0.0", totalRawUsd: "1000.0", totalMarginUsed: "0.0" },
          time: Date.now(),
        };
        break;
      default:
        return new Response("unknown", { status: 422 });
    }
    return new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  const client = createHlClient({ apiUrl: "https://hl.test", fetchImpl, weightBudgetPerMin: 1e9, sleep: async () => {} });
  return { st, client };
}

/** n BTC round trips; fills share milliseconds in groups of 3 so page boundaries overlap. */
function roundTrips(n: number) {
  const b = sim("BTC");
  for (let i = 0; i < n; i++) {
    const t0 = Math.floor((2 * i) / 3);
    const t1 = Math.floor((2 * i + 1) / 3);
    b.buy(1, 60000 + i, undefined, {}).sell(1, 60010 + i, undefined, {});
    b.fills[2 * i].time = T0 + t0 * 1000;
    b.fills[2 * i + 1].time = T0 + t1 * 1000;
  }
  return b.fills;
}

let accountId: string;
let wallet: typeof s.wallets.$inferSelect;
const db = () => getDb();
const count = async (table: typeof s.fills | typeof s.trades | typeof s.fundingEvents) =>
  (await db().select().from(table)).length;

beforeAll(async () => {
  useTempDb();
  await runMigrations(getDb());
  await seedDefaults(getDb());
  accountId = (await getDb().select().from(s.accounts))[0].id;
});

beforeEach(async () => {
  resetTids();
  const d = db();
  for (const t of [s.tradeFills, s.tradeJournal, s.trades, s.fills, s.fundingEvents, s.syncRuns, s.wallets]) await d.delete(t);
  [wallet] = await d.insert(s.wallets).values({ accountId, address: DEMO_WALLET }).returning();
});

const freshWallet = async () => (await db().query.wallets.findFirst({ where: eq(s.wallets.id, wallet.id) }))!;

describe("19. fills pagination", () => {
  test("pages of 2000 with same-ms overlap, short final page, then stop", async () => {
    const fills = roundTrips(2250); // 4500 fills
    const { st, client } = fakeHl({ fills });
    const r = await syncWallet(db(), client, wallet, { trigger: "manual" });

    expect(r.status).toBe("success");
    expect(r.done).toBe(true);
    const fillCalls = st.calls.filter((c) => c.type === "userFillsByTime");
    expect(fillCalls.length).toBe(3); // 2000, 2000 (overlapping), short page
    expect(fillCalls[1].body.startTime).toBe(fills[1999].time); // next page starts at last timestamp
    expect(r.fillsFetched).toBeGreaterThan(4500); // overlap re-fetched…
    expect(r.fillsNew).toBe(4500); // …but deduped
    expect(await count(s.fills)).toBe(4500);
    expect(await count(s.trades)).toBe(2250);
    const w = await freshWallet();
    expect(w.backfillCompletedAt).not.toBeNull();
    expect(w.lastFillTime).toBe(fills.at(-1)!.time);
    expect(w.lastSuccessAt).not.toBeNull();
  });

  test("re-running is idempotent and incremental", async () => {
    const { st, client } = fakeHl({ fills: roundTrips(50) });
    await syncWallet(db(), client, wallet, { trigger: "manual" });
    const ids = (await db().select({ id: s.trades.id }).from(s.trades)).map((t) => t.id).sort();
    st.calls.length = 0;
    const r2 = await syncWallet(db(), client, await freshWallet(), { trigger: "auto" });
    expect(r2.fillsNew).toBe(0);
    const call = st.calls.find((c) => c.type === "userFillsByTime")!;
    expect(call.body.startTime).toBe((await freshWallet()).lastFillTime! - 10 * MIN); // incremental with overlap
    expect((await db().select({ id: s.trades.id }).from(s.trades)).map((t) => t.id).sort()).toEqual(ids);
  });

  test("backfill resumes across calls via the saved cursor when the time budget runs out", async () => {
    const { client } = fakeHl({ fills: roundTrips(2250) });
    const results = [];
    for (let i = 0; i < 10; i++) {
      const r = await syncWallet(db(), client, await freshWallet(), { trigger: "backfill", budgetMs: 0 });
      results.push(r);
      if (r.done) break;
    }
    expect(results[0]).toMatchObject({ status: "partial", done: false, pages: 1 });
    expect(results.at(-1)!.done).toBe(true);
    expect(results.length).toBeGreaterThanOrEqual(3);
    expect(await count(s.fills)).toBe(4500);
    expect(await count(s.trades)).toBe(2250);
    const runs = await db().select().from(s.syncRuns).where(eq(s.syncRuns.walletId, wallet.id));
    expect(runs.map((x) => x.status)).toContain("partial");
  });

  test("a full page sharing one millisecond cannot loop forever", async () => {
    const b = sim("ETH");
    for (let i = 0; i < 1001; i++) b.buy(1, 3000).sell(1, 3001);
    for (const f of b.fills) f.time = T0 + 5_000; // 2002 fills, same ms
    const { client } = fakeHl({ fills: b.fills });
    const r = await syncWallet(db(), client, wallet, { trigger: "manual" });
    expect(r.done).toBe(true);
    expect(r.gapsDetected).toBeGreaterThanOrEqual(1);
    expect(r.pages).toBeLessThan(10);
  });
});

describe("safety", () => {
  test("a custom-range resync never touches journal fields", async () => {
    const fills = roundTrips(20);
    const { client } = fakeHl({ fills });
    await syncWallet(db(), client, wallet, { trigger: "manual" });
    const [t] = await db().select().from(s.trades).limit(1);
    await db().insert(s.tradeJournal).values({ tradeId: t.id, grade: "A+", rationale: "keep", stopLoss: 59000 });

    const r = await syncAll(db(), client, { trigger: "range", range: { start: 0, end: fills.at(-1)!.time } });
    expect(r.done).toBe(true);
    const j = await db().query.tradeJournal.findFirst({ where: eq(s.tradeJournal.tradeId, t.id) });
    expect(j).toMatchObject({ grade: "A+", rationale: "keep", stopLoss: 59000 });
    expect(await count(s.trades)).toBe(20);
  });

  test("a second concurrent sync for the same wallet is skipped", async () => {
    const { client } = fakeHl({ fills: roundTrips(3) });
    await db().insert(s.syncRuns).values({ walletId: wallet.id, trigger: "auto", startedAt: Date.now(), status: "running" });
    const r = await syncWallet(db(), client, wallet, { trigger: "manual" });
    expect(r.status).toBe("skipped");
    expect(await count(s.fills)).toBe(0);
  });

  test("HTTP 429 is retried; persistent errors are stored without the address", async () => {
    const a = fakeHl({ fills: roundTrips(2), failNext: [429, 503] });
    const ok = await syncWallet(db(), a.client, wallet, { trigger: "manual" });
    expect(ok.status).toBe("success");

    const b = fakeHl({ fills: roundTrips(2), failNext: [500, 500, 500, 500, 500, 500] });
    const bad = await syncWallet(db(), b.client, await freshWallet(), { trigger: "manual" });
    expect(bad.status).toBe("error");
    const run = (await db().select().from(s.syncRuns).where(eq(s.syncRuns.status, "error")))[0];
    expect(run.error).toMatch(/HTTP 500/);
    expect(run.error).not.toContain(DEMO_WALLET);
  });
});

describe("positions, HIP-3 and data quirks", () => {
  test("per-dex clearinghouseState sets leverage on an open HIP-3 trade", async () => {
    const spx = sim("xyz:SPX").buy(2, 6000, 0);
    const { st, client } = fakeHl({
      fills: spx.fills,
      positions: { xyz: [{ coin: "xyz:SPX", szi: "2.0", entryPx: "6000.0", leverage: { type: "isolated", value: 5 }, liquidationPx: "5000.5" }] },
    });
    const r = await syncWallet(db(), client, wallet, { trigger: "manual" });
    expect(st.calls.filter((c) => c.type === "clearinghouseState").map((c) => c.body.dex ?? "")).toEqual(["", "xyz"]);
    expect(r.openPositions).toBe(1);
    expect(r.gapsDetected).toBe(0);
    const [t] = await db().select().from(s.trades);
    expect(t).toMatchObject({ status: "open", leverage: 5, liqPx: 5000.5, displayPair: "SPX/USD · xyz" });
  });

  test("exchange position with no matching open trade counts as a coverage gap", async () => {
    const { client } = fakeHl({ positions: { "": [{ coin: "ETH", szi: "1.5" }] } });
    const r = await syncWallet(db(), client, wallet, { trigger: "manual" });
    expect(r.gapsDetected).toBe(1);
  });

  test('padded strings like " USDC" are trimmed (no false non-USDC fee flag)', async () => {
    const f = sim("xyz:SPX").buy(1, 6000, 0).sell(1, 6010, 5).fills;
    f[0].feeToken = " USDC";
    f[1].fee = " 2.7045";
    const { client } = fakeHl({ fills: f });
    await syncWallet(db(), client, wallet, { trigger: "manual" });
    const [t] = await db().select().from(s.trades);
    expect(t.flags.nonUsdcFee).toBeUndefined();
    const stored = await db().select().from(s.fills).where(and(eq(s.fills.walletId, wallet.id), eq(s.fills.tid, f[0].tid)));
    expect(stored[0].feeToken).toBe("USDC");
  });
});

describe("funding sync", () => {
  const fundingRows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      time: T0 + i * 3_600_000,
      hash: "0x" + i.toString(16).padStart(64, "0"),
      delta: { type: "funding", coin: i % 2 ? "BTC" : "xyz:SPX", usdc: " -0.42", szi: "1.0", fundingRate: "0.0000125", nSamples: null },
    }));

  test("paginates by 500, trims values, and is idempotent", async () => {
    const { st, client } = fakeHl({ funding: fundingRows(1200) });
    const r = await syncWallet(db(), client, wallet, { trigger: "manual" });
    expect(r.fundingNew).toBe(1200);
    expect(st.calls.filter((c) => c.type === "userFunding")).toHaveLength(3);
    const [row] = await db().select().from(s.fundingEvents).limit(1);
    expect(row.usdc).toBe("-0.42");
    const r2 = await syncWallet(db(), client, await freshWallet(), { trigger: "auto" });
    expect(r2.fundingNew).toBe(0);
    expect(await count(s.fundingEvents)).toBe(1200);
  });

  test("saves last_funding_time after every page and resumes under a time budget", async () => {
    const { client } = fakeHl({ funding: fundingRows(1200), fills: roundTrips(2) });
    const cursors: (number | null)[] = [];
    let done = false;
    for (let i = 0; i < 10 && !done; i++) {
      const r = await syncWallet(db(), client, await freshWallet(), { trigger: "auto", budgetMs: 0 });
      cursors.push((await freshWallet()).lastFundingTime);
      done = r.done;
    }
    expect(done).toBe(true);
    expect(cursors.length).toBeGreaterThanOrEqual(3); // one funding page per call
    expect(cursors[0]).toBe(T0 + 499 * 3_600_000);
    expect(new Set(cursors).size).toBe(cursors.length); // advanced every call
    expect(await count(s.fundingEvents)).toBe(1200);
  });
});

describe("rate limiter", () => {
  test("waits when the weight budget is exhausted, refills over time", async () => {
    let t = 0;
    const slept: number[] = [];
    const lim = new WeightLimiter(120, () => t, async (ms) => {
      slept.push(ms);
      t += ms;
    });
    await lim.take(100);
    await lim.take(20);
    expect(slept).toEqual([]);
    await lim.take(60); // needs 60 more → 30s at 120/min
    expect(slept[0]).toBe(30_000);
    lim.charge(100); // per-item extra weight after a response
    expect(lim.available).toBeLessThan(0);
  });
});
