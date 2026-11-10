import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import { useTempDb } from "./helpers/db";
import { getDb } from "@/server/db/client";
import { runMigrations, seedDefaults } from "@/server/db/bootstrap";
import * as s from "@/server/db/schema";
import { insertFills, rebuildTrades } from "@/server/reconstruct/persist";
import { createStrategy, loadTradeForEdit, saveTradeBasic, type BasicInput } from "@/server/trades/journal";
import {
  manualMetrics,
  rewardRisk,
  riskUsd,
  sizeFromRisk,
  stopOnCorrectSide,
  tpAllocation,
  unitsToUsd,
  usdToUnits,
  weightedAvg,
} from "@/lib/trade-math";
import { DEMO_WALLET, resetTids, sim } from "./fixtures/fills";

describe("trade maths", () => {
  test("weighted average, risk, size from risk, R:R, conversions", () => {
    expect(weightedAvg([{ price: 100, size: 1 }, { price: 90, size: 3 }])).toBe(92.5);
    expect(weightedAvg([{ price: null, size: 1 }])).toBeNull();
    expect(riskUsd(100, 95, 2)).toBe(10);
    expect(riskUsd(100, 100, 2)).toBeNull();
    expect(sizeFromRisk(250, 60000, 59500)).toBe(0.5);
    expect(sizeFromRisk(250, 60000, null)).toBeNull();
    expect(rewardRisk("long", 100, 95, 115)).toBe(3);
    expect(rewardRisk("short", 100, 105, 90)).toBe(2);
    expect(rewardRisk("long", 100, 105, 115)).toBeNull(); // stop on the wrong side
    expect(stopOnCorrectSide("long", 100, 95)).toBe(true);
    expect(stopOnCorrectSide("short", 100, 95)).toBe(false);
    expect(usdToUnits(30000, 60000)).toBe(0.5);
    expect(unitsToUsd(0.5, 60000)).toBe(30000);
    expect(tpAllocation([{ pct: 50 }, { pct: 30 }, { pct: 20 }])).toEqual({ total: 100, valid: true });
    expect(tpAllocation([{ pct: 50 }, { pct: 30 }]).valid).toBe(false);
    expect(tpAllocation([]).valid).toBe(true);
  });

  test("manual metrics for long and short", () => {
    const long = manualMetrics({ direction: "long", entry: 100, exit: 110, size: 5, fees: 2, entryTime: 0, exitTime: 3_600_000, closed: true });
    expect(long).toMatchObject({ grossPnl: 50, netPnl: 48, notionalUsd: 500, durationMs: 3_600_000 });
    expect(long.returnPct).toBeCloseTo(9.6, 9);
    const short = manualMetrics({ direction: "short", entry: 100, exit: 110, size: 5, fees: 0, entryTime: 0, exitTime: 1, closed: true });
    expect(short.grossPnl).toBe(-50);
    const open = manualMetrics({ direction: "long", entry: 100, exit: null, size: 5, fees: null, entryTime: 0, exitTime: null, closed: false });
    expect(open).toMatchObject({ grossPnl: null, netPnl: null, exitTime: null, durationMs: null });
  });
});

describe("saving the Basic tab", () => {
  let accountId: string;
  let otherAccountId: string;
  let walletId: string;
  let checklist: string[];

  beforeAll(async () => {
    useTempDb();
    const db = getDb();
    await runMigrations(db);
    await seedDefaults(db);
    accountId = (await db.select().from(s.accounts))[0].id;
    [{ id: otherAccountId }] = await db.insert(s.accounts).values({ name: "Second" }).returning({ id: s.accounts.id });
    checklist = (await db.select().from(s.vocabItems).where(eq(s.vocabItems.kind, "checklist"))).map((v) => v.id);
  });

  beforeEach(async () => {
    resetTids();
    const db = getDb();
    for (const t of [s.tradePartials, s.tradeVocab, s.tradeJournal, s.tradeFills, s.trades, s.fills, s.wallets]) await db.delete(t);
    [{ id: walletId }] = await db.insert(s.wallets).values({ accountId, address: DEMO_WALLET }).returning({ id: s.wallets.id });
  });

  const base = (over: Partial<BasicInput> = {}): BasicInput => ({
    accountId,
    strategyId: null,
    stopLoss: null,
    takeProfit: null,
    sizeMode: "position",
    plannedRiskUsd: null,
    leverageOverride: null,
    session: null,
    tradeType: null,
    feeOverride: null,
    checklist: [],
    tpPartials: [],
    ...over,
  });

  async function syncedTrade() {
    const db = getDb();
    await insertFills(db, walletId, sim("BTC").buy("0.5", 60000, 0).sell("0.5", 61000, 30).fills);
    await rebuildTrades(db, { walletId, accountId });
    return (await db.select().from(s.trades))[0];
  }

  test("synced trade: journal saves, exchange fields are ignored even if sent", async () => {
    const db = getDb();
    const t = await syncedTrade();
    const strategyId = await createStrategy(db, "VWAP reclaim");
    const res = await saveTradeBasic(db, accountId, t.id, {
      ...base({ strategyId, stopLoss: 59500, takeProfit: 62000, session: "London", tradeType: "planned", checklist: checklist.slice(0, 2) }),
      tpPartials: [{ price: 61000, pct: 50 }, { price: 62000, pct: 50 }],
      // a tampering client tries to rewrite exchange data:
      manual: { coin: "ETH", direction: "short", status: "open", entry: 1, exit: 2, size: 99, entryTime: 0, exitTime: 1, dca: [] },
      feeOverride: -1000,
    });
    expect(res).toMatchObject({ ok: true });
    const after = (await db.select().from(s.trades).where(eq(s.trades.id, t.id)))[0];
    expect(after).toMatchObject({ coin: "BTC", direction: "long", status: "closed", avgEntry: 60000, avgExit: 61000, grossPnl: 500, fees: t.fees });
    const loaded = (await loadTradeForEdit(db, accountId, t.id))!;
    expect(loaded.journal).toMatchObject({ strategyId, stopLoss: 59500, takeProfit: 62000, session: "London", tradeType: "planned", feeOverride: null });
    expect(loaded.checklistIds.sort()).toEqual(checklist.slice(0, 2).sort());
    expect(loaded.tpPartials).toEqual([{ price: 61000, pct: 50 }, { price: 62000, pct: 50 }]);
    expect(loaded.entryLegs).toEqual([{ time: t.entryTime, price: 60000, size: 0.5 }]);
  });

  test("re-saving replaces checklist and partials; a re-sync keeps journal and account", async () => {
    const db = getDb();
    const t = await syncedTrade();
    await saveTradeBasic(db, accountId, t.id, base({ checklist, tpPartials: [{ price: 61000, pct: 100 }], stopLoss: 59000 }));
    await saveTradeBasic(db, accountId, t.id, base({ checklist: [checklist[0]], tpPartials: [], stopLoss: 59000, accountId: otherAccountId }));
    const links = await db.select().from(s.tradeVocab).where(and(eq(s.tradeVocab.tradeId, t.id), eq(s.tradeVocab.kind, "checklist")));
    expect(links.map((l) => l.itemId)).toEqual([checklist[0]]);
    expect(await db.select().from(s.tradePartials).where(eq(s.tradePartials.tradeId, t.id))).toHaveLength(0);

    await rebuildTrades(db, { walletId, accountId });
    const after = (await db.select().from(s.trades).where(eq(s.trades.id, t.id)))[0];
    expect(after.accountId).toBe(otherAccountId); // the move survives a rebuild
    expect((await db.query.tradeJournal.findFirst({ where: eq(s.tradeJournal.tradeId, t.id) }))?.stopLoss).toBe(59000);
    expect(await loadTradeForEdit(db, accountId, t.id)).toBeNull(); // now belongs to the other account
  });

  test("validation: TP split must total 100%, unknown ids rejected, other accounts' trades unreachable", async () => {
    const db = getDb();
    const t = await syncedTrade();
    const bad = await saveTradeBasic(db, accountId, t.id, base({ tpPartials: [{ price: 61000, pct: 60 }] }));
    expect(bad).toEqual({ ok: false, errors: { tpPartials: "Take-profit allocations must add up to 100%" } });
    expect((await saveTradeBasic(db, accountId, t.id, base({ strategyId: checklist[0] }))).ok).toBe(false);
    expect((await saveTradeBasic(db, accountId, t.id, base({ accountId: "nope" }))).ok).toBe(false);
    expect((await saveTradeBasic(db, otherAccountId, t.id, base())).ok).toBe(false);
    expect((await saveTradeBasic(db, accountId, t.id, { ...base(), stopLoss: -5 })).ok).toBe(false);
    // a checklist id that isn't a checklist item is silently dropped
    const strat = await createStrategy(db, "Range deviation");
    await saveTradeBasic(db, accountId, t.id, base({ checklist: [strat, checklist[1]] }));
    expect((await loadTradeForEdit(db, accountId, t.id))!.checklistIds).toEqual([checklist[1]]);
  });

  async function manualTrade() {
    const db = getDb();
    const [t] = await db
      .insert(s.trades)
      .values({ accountId, source: "manual", coin: "SOL", displayPair: "SOL/USD", direction: "long", status: "planned", flags: {} })
      .returning();
    return t;
  }

  test("manual trade: fields are editable and metrics are recomputed", async () => {
    const db = getDb();
    const t = await manualTrade();
    const res = await saveTradeBasic(db, accountId, t.id, {
      ...base({ feeOverride: 1.5 }),
      manual: { coin: "xyz:SPX", direction: "short", status: "closed", entry: 6000, exit: 5950, size: 2, entryTime: 1000, exitTime: 61_000, dca: [] },
    });
    expect(res.ok).toBe(true);
    const after = (await db.select().from(s.trades).where(eq(s.trades.id, t.id)))[0];
    expect(after).toMatchObject({
      coin: "xyz:SPX",
      displayPair: "SPX/USD · xyz",
      marketType: "hip3",
      direction: "short",
      status: "closed",
      grossPnl: 100,
      fees: 1.5,
      netPnl: 98.5,
      durationMs: 60_000,
    });
  });

  test("manual DCA entries set the weighted entry; risk mode derives size from the stop", async () => {
    const db = getDb();
    const t = await manualTrade();
    await saveTradeBasic(db, accountId, t.id, {
      ...base(),
      manual: { coin: "SOL", direction: "long", status: "open", entry: null, exit: null, size: null, entryTime: 1000, exitTime: null, dca: [{ price: 100, size: 10 }, { price: 90, size: 30 }] },
    });
    let after = (await db.select().from(s.trades).where(eq(s.trades.id, t.id)))[0];
    expect(after).toMatchObject({ avgEntry: 92.5, sizeUnits: 40, status: "open", netPnl: null });
    expect((await loadTradeForEdit(db, accountId, t.id))!.dca).toEqual([{ price: 100, size: 10 }, { price: 90, size: 30 }]);

    await saveTradeBasic(db, accountId, t.id, {
      ...base({ sizeMode: "risk", plannedRiskUsd: 200, stopLoss: 96 }),
      manual: { coin: "SOL", direction: "long", status: "open", entry: 100, exit: null, size: null, entryTime: 1000, exitTime: null, dca: [] },
    });
    after = (await db.select().from(s.trades).where(eq(s.trades.id, t.id)))[0];
    expect(after.sizeUnits).toBe(50); // $200 / $4 per unit
  });

  test("manual validation: closed needs exit and size; exit can't precede entry", async () => {
    const db = getDb();
    const t = await manualTrade();
    const m = { coin: "SOL", direction: "long" as const, entryTime: 5000, dca: [] };
    expect(
      await saveTradeBasic(db, accountId, t.id, { ...base(), manual: { ...m, status: "closed", entry: 100, exit: null, size: 1, exitTime: 6000 } }),
    ).toMatchObject({ ok: false, errors: { manual: expect.stringMatching(/exit price/) } });
    expect(
      await saveTradeBasic(db, accountId, t.id, { ...base(), manual: { ...m, status: "closed", entry: 100, exit: 101, size: 1, exitTime: 1000 } }),
    ).toMatchObject({ ok: false, errors: { manual: expect.stringMatching(/before entry/) } });
  });

  test("createStrategy dedupes case-insensitively and un-archives", async () => {
    const db = getDb();
    const a = await createStrategy(db, "Failed auction");
    await db.update(s.vocabItems).set({ archived: true }).where(eq(s.vocabItems.id, a));
    const b = await createStrategy(db, "failed AUCTION");
    expect(b).toBe(a);
    expect((await db.query.vocabItems.findFirst({ where: eq(s.vocabItems.id, a) }))?.archived).toBe(false);
  });
});
