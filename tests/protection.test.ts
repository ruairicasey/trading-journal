import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { useTempDb } from "./helpers/db";
import { getDb } from "@/server/db/client";
import { runMigrations, seedDefaults } from "@/server/db/bootstrap";
import * as s from "@/server/db/schema";
import { historyRows, type SynthOrder } from "@/server/demo/hl-orders";
import { mergeOrderRows, storeOrders } from "@/server/hyperliquid/orders";
import { HistoricalOrdersSchema } from "@/server/hyperliquid/schemas";
import { applyProtection, revertToAuto } from "@/server/protection/apply";
import { detectProtection, type ProtectionOrder, type ProtectionTrade } from "@/server/protection/detect";
import { insertFills, rebuildTrades } from "@/server/reconstruct/persist";
import { saveTradeBasic } from "@/server/trades/journal";
import { addStopMove, deleteStopMove, updateStopMove } from "@/server/trades/stop-moves";
import { analyticsTrades } from "@/server/db/queries/analytics";
import { DEMO_WALLET, MIN, T0, resetTids, sim } from "./fixtures/fills";

const rows = (orders: SynthOrder[]) => HistoricalOrdersSchema.parse(historyRows(orders));
const merged = (orders: SynthOrder[]) => mergeOrderRows("w", rows(orders)) as unknown as ProtectionOrder[];
const at = (m: number) => T0 + m * MIN;

const long: ProtectionTrade = { coin: "BTC", direction: "long", avgEntry: 100, sizeUnits: 2, entryTime: at(0), exitTime: at(120) };
const short: ProtectionTrade = { ...long, direction: "short" };

describe("merging history rows", () => {
  test("one record per oid: placement time, latest status, trigger price kept after it fires", () => {
    const m = mergeOrderRows(
      "w",
      rows([
        { oid: 1, coin: "BTC", side: "A", orderType: "Stop Market", triggerPx: 95, placedAt: at(1), end: { status: "triggered", at: at(50) } },
        { oid: 2, coin: "BTC", side: "A", orderType: "Take Profit Market", triggerPx: 110, placedAt: at(1), end: { status: "reduceOnlyCanceled", at: at(50) } },
        { oid: 3, coin: "BTC", side: "A", orderType: "Stop Market", triggerPx: 96, placedAt: at(2) },
      ]),
    );
    expect(m).toHaveLength(3);
    const byOid = new Map(m.map((r) => [r.oid, r]));
    expect(byOid.get(1)).toMatchObject({ isTrigger: true, triggerPx: 95, placedAt: at(1), status: "triggered", endedAt: at(50), isPositionTpsl: true });
    expect(byOid.get(2)).toMatchObject({ status: "reduceOnlyCanceled", endedAt: at(50) });
    expect(byOid.get(3)).toMatchObject({ status: "open", endedAt: null });
  });

  test('a fired trigger ends "triggered" even though its "filled" twin shares the timestamp and comes first', () => {
    const r = rows([{ oid: 4, coin: "BTC", side: "A", orderType: "Stop Market", triggerPx: 95, placedAt: at(1), end: { status: "triggered", at: at(50) } }]);
    expect(r.map((x) => x.status)).toEqual(["filled", "triggered", "open"]);
    expect(mergeOrderRows("w", r)[0]).toMatchObject({ status: "triggered", endedAt: at(50) });
    // and when the filled row is (rarely) later than triggered
    const late = r.map((x) => (x.status === "filled" ? { ...x, statusTimestamp: at(51) } : x));
    expect(mergeOrderRows("w", late)[0].status).toBe("triggered");
  });

  test("on a status-timestamp tie the terminal status beats the open snapshot", () => {
    const r = rows([{ oid: 9, coin: "BTC", side: "B", orderType: "Market", placedAt: at(0), end: { status: "filled", at: at(0) } }]);
    expect(mergeOrderRows("w", r)[0]).toMatchObject({ status: "filled", endedAt: at(0) });
    expect(mergeOrderRows("w", [...r].reverse())[0]).toMatchObject({ status: "filled" });
  });

  test("nested children (which carry the parent's oid) never create or clobber records", () => {
    const m = mergeOrderRows(
      "w",
      rows([
        {
          oid: 5,
          coin: "BTC",
          side: "B",
          orderType: "Market",
          placedAt: at(0),
          end: { status: "filled", at: at(0) },
          children: [{ oid: 0, coin: "BTC", side: "A", orderType: "Stop Market", triggerPx: 95, placedAt: at(0), sz: 2 }],
        },
      ]),
    );
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ oid: 5, orderType: "Market", isTrigger: false, status: "filled" });
  });
});

describe("detection", () => {
  const stop = (oid: number, px: number, placed: number, end?: number, extra: Partial<SynthOrder> = {}): SynthOrder => ({
    oid,
    coin: "BTC",
    side: "A",
    orderType: "Stop Market",
    triggerPx: px,
    placedAt: at(placed),
    ...(end !== undefined ? { end: { status: "canceled" as const, at: at(end) } } : {}),
    ...extra,
  });
  const tp = (oid: number, px: number, placed: number, end?: number, extra: Partial<SynthOrder> = {}): SynthOrder => ({
    ...stop(oid, px, placed, end, extra),
    orderType: "Take Profit Market",
  });

  test("long: first stop in force is the SL, later replacements are stop moves", () => {
    const d = detectProtection(long, merged([stop(1, 95, 1, 30), stop(2, 98, 30, 60), stop(3, 101, 60)]), at(200));
    expect(d.stopLoss).toMatchObject({ price: 95, oid: 1, placedAt: at(1) });
    expect(d.stopMoves).toEqual([
      { time: at(30), price: 98, oid: 2 },
      { time: at(60), price: 101, oid: 3 },
    ]);
  });

  test("short: buy-side stops above entry and TPs below", () => {
    const o = merged([
      { ...stop(1, 105, 1), side: "B" },
      { ...tp(2, 90, 1), side: "B" },
      stop(3, 95, 1), // wrong (opening) side for a short → ignored
    ]);
    const d = detectProtection(short, o, at(200));
    expect(d.stopLoss?.price).toBe(105);
    expect(d.takeProfit?.price).toBe(90);
  });

  test("falls back to price vs entry when the order type is unknown", () => {
    const o = merged([stop(1, 95, 1)]).map((x) => ({ ...x, orderType: "Trigger" }));
    expect(detectProtection(long, o, at(200)).stopLoss?.price).toBe(95);
    const above = merged([stop(2, 120, 1)]).map((x) => ({ ...x, orderType: "Trigger" }));
    expect(detectProtection(long, above, at(200))).toMatchObject({ stopLoss: null, takeProfit: { price: 120 } });
  });

  test("ignores other coins, orders outside the window, and orders that ended before entry", () => {
    const o = merged([
      { ...stop(1, 95, 1), coin: "ETH" },
      stop(2, 90, -10, -5), // previous trade's stop, gone before entry
      stop(3, 91, -3), // placed > 2 min before entry
      stop(4, 92, 130), // after exit
      stop(5, 93, -1), // within the 2-minute grace (attached at entry)
    ]);
    const d = detectProtection(long, o, at(200));
    expect(d.stopLoss).toMatchObject({ price: 93, oid: 5 });
    expect(d.stopMoves).toEqual([]);
  });

  test("open trades use `now` as the end of the window", () => {
    const open = { ...long, exitTime: null };
    expect(detectProtection(open, merged([stop(1, 95, 500)]), at(400)).stopLoss).toBeNull();
    expect(detectProtection(open, merged([stop(1, 95, 500)]), at(600)).stopLoss?.price).toBe(95);
  });

  test("a stop re-placed at the same price is not a move", () => {
    const d = detectProtection(long, merged([stop(1, 95, 1, 10), stop(2, 95, 10, 20), stop(3, 97, 20)]), at(200));
    expect(d.stopMoves.map((m) => m.price)).toEqual([97]);
  });

  test("a TP ladder that covers the position becomes partials; the TP is the farthest", () => {
    const d = detectProtection(long, merged([tp(1, 110, 1, undefined, { sz: 1 }), tp(2, 120, 1, undefined, { sz: 0.6 }), tp(3, 130, 1, undefined, { sz: 0.4 })]), at(200));
    expect(d.tpPartials).toEqual([
      { price: 110, pct: 50, oid: 1 },
      { price: 120, pct: 30, oid: 2 },
      { price: 130, pct: 20, oid: 3 },
    ]);
    expect(d.takeProfit?.price).toBe(130);
    expect(d.tpPartials.reduce((a, p) => a + p.pct, 0)).toBe(100);
  });

  test("a replaced TP is not a ladder, and a ladder that doesn't cover the position isn't either", () => {
    const replaced = detectProtection(long, merged([tp(1, 110, 1, 30, { sz: 2 }), tp(2, 115, 30, undefined, { sz: 2 })]), at(200));
    expect(replaced.tpPartials).toEqual([]);
    expect(replaced.takeProfit?.price).toBe(110);
    const half = detectProtection(long, merged([tp(1, 110, 1, undefined, { sz: 0.5 }), tp(2, 120, 1, undefined, { sz: 0.5 })]), at(200));
    expect(half.tpPartials).toEqual([]);
  });
});

// ─── database: storage + applying without overwriting the user ─────────────────────
let accountId: string;
let walletId: string;
const db = () => getDb();

beforeAll(async () => {
  useTempDb();
  await runMigrations(getDb());
  await seedDefaults(getDb());
  accountId = (await getDb().select().from(s.accounts))[0].id;
});

beforeEach(async () => {
  resetTids();
  const d = db();
  for (const t of [s.stopMoves, s.tradePartials, s.tradeFills, s.tradeJournal, s.trades, s.fills, s.orders, s.wallets]) await d.delete(t);
  walletId = (await d.insert(s.wallets).values({ accountId, address: DEMO_WALLET }).returning())[0].id;
});

async function oneLongTrade() {
  const f = sim("BTC").buy(2, 100, 0).sell(2, 110, 120).fills;
  await insertFills(db(), walletId, f);
  await rebuildTrades(db(), { walletId, accountId });
  return (await db().select().from(s.trades))[0];
}
const journal = async (tradeId: string) => db().query.tradeJournal.findFirst({ where: eq(s.tradeJournal.tradeId, tradeId) });

const SL1: SynthOrder = { oid: 11, coin: "BTC", side: "A", orderType: "Stop Market", triggerPx: 95, placedAt: at(0), end: { status: "canceled", at: at(30) } };
const SL2: SynthOrder = { oid: 12, coin: "BTC", side: "A", orderType: "Stop Market", triggerPx: 99, placedAt: at(30), end: { status: "reduceOnlyCanceled", at: at(120) } };
const TP1: SynthOrder = { oid: 13, coin: "BTC", side: "A", orderType: "Take Profit Market", triggerPx: 110, placedAt: at(0), end: { status: "triggered", at: at(120) } };

describe("storing and applying", () => {
  test("storage is idempotent across overlapping and out-of-order windows", async () => {
    const all = rows([SL1, SL2, TP1]);
    await storeOrders(db(), walletId, all.slice(3)); // older half first: only the open snapshots of some
    await storeOrders(db(), walletId, all);
    await storeOrders(db(), walletId, all.slice(0, 2)); // a newer window again
    // a later window holding only the fired stop's "filled" row must not downgrade "triggered"
    await storeOrders(db(), walletId, all.filter((x) => x.order.oid === 13 && x.status === "filled"));
    const stored = await db().select().from(s.orders);
    expect(stored).toHaveLength(3);
    const tp = stored.find((o) => o.oid === 13)!;
    expect(tp).toMatchObject({ status: "triggered", isTrigger: true, triggerPx: 110, placedAt: at(0) });
    expect(stored.find((o) => o.oid === 11)).toMatchObject({ status: "canceled", endedAt: at(30) });
  });

  test("fills empty fields as auto, with stop moves, and R picks up the initial stop", async () => {
    const t = await oneLongTrade();
    await storeOrders(db(), walletId, rows([SL1, SL2, TP1]));
    const r = await applyProtection(db(), walletId);
    expect(r).toMatchObject({ trades: 1, stopLoss: 1, takeProfit: 1 });
    expect(await journal(t.id)).toMatchObject({ stopLoss: 95, stopLossSource: "auto", takeProfit: 110, takeProfitSource: "auto" });
    const moves = await db().select().from(s.stopMoves).where(eq(s.stopMoves.tradeId, t.id));
    expect(moves).toMatchObject([{ price: 99, time: at(30), source: "auto", oid: 12 }]);
    // second run: nothing changes
    expect((await applyProtection(db(), walletId)).trades).toBe(0);
  });

  test("never overwrites the user's values, including a deliberately cleared one", async () => {
    const t = await oneLongTrade();
    await db().insert(s.tradeJournal).values({ tradeId: t.id, stopLoss: 90, stopLossSource: "user", takeProfit: null, takeProfitSource: "user" });
    await storeOrders(db(), walletId, rows([SL1, TP1]));
    await applyProtection(db(), walletId);
    expect(await journal(t.id)).toMatchObject({ stopLoss: 90, stopLossSource: "user", takeProfit: null, takeProfitSource: "user" });
  });

  test("values typed before this feature (no source) are kept", async () => {
    const t = await oneLongTrade();
    await db().insert(s.tradeJournal).values({ tradeId: t.id, stopLoss: 91 });
    await storeOrders(db(), walletId, rows([SL1, TP1]));
    await applyProtection(db(), walletId);
    expect(await journal(t.id)).toMatchObject({ stopLoss: 91, takeProfit: 110, takeProfitSource: "auto" });
  });

  test("auto values follow later syncs; the Edit form marks only changed fields as yours", async () => {
    const t = await oneLongTrade();
    await storeOrders(db(), walletId, rows([{ ...SL1, triggerPx: 97 }]));
    await applyProtection(db(), walletId);
    expect((await journal(t.id))?.stopLoss).toBe(97);
    // the exchange record is corrected (same oid, new price) → auto value follows
    await db().update(s.orders).set({ triggerPx: 95 }).where(eq(s.orders.oid, 11));
    await applyProtection(db(), walletId);
    expect((await journal(t.id))?.stopLoss).toBe(95);

    // saving the form without touching SL leaves it auto…
    const base = { stopLoss: 95, takeProfit: null, tpPartials: [] };
    const input = {
      accountId,
      strategyId: null,
      stopLoss: 95,
      takeProfit: null,
      sizeMode: "position",
      plannedRiskUsd: null,
      leverageOverride: null,
      session: null,
      tradeType: null,
      feeOverride: null,
      checklist: [],
      tpPartials: [],
    };
    expect((await saveTradeBasic(db(), accountId, t.id, input, base)).ok).toBe(true);
    expect(await journal(t.id)).toMatchObject({ stopLoss: 95, stopLossSource: "auto" });
    // …even if a sync changed it meanwhile (the stale page doesn't clobber the newer auto value)
    await db().update(s.tradeJournal).set({ stopLoss: 96 }).where(eq(s.tradeJournal.tradeId, t.id));
    await saveTradeBasic(db(), accountId, t.id, input, base);
    expect((await journal(t.id))?.stopLoss).toBe(96);
    // typing a new SL makes it yours, and sync stops touching it
    await saveTradeBasic(db(), accountId, t.id, { ...input, stopLoss: 93 }, base);
    expect(await journal(t.id)).toMatchObject({ stopLoss: 93, stopLossSource: "user", takeProfitSource: null });
    await applyProtection(db(), walletId);
    expect((await journal(t.id))?.stopLoss).toBe(93);

    // Revert to auto hands it back
    const rev = await revertToAuto(db(), accountId, t.id, "stopLoss");
    expect(rev).toMatchObject({ ok: true, stopLoss: 95 });
    expect((await journal(t.id))?.stopLossSource).toBe("auto");
  });

  test("auto TP partials are written only when there are none of the user's", async () => {
    const t = await oneLongTrade();
    const ladder: SynthOrder[] = [
      { oid: 21, coin: "BTC", side: "A", orderType: "Take Profit Market", triggerPx: 105, placedAt: at(1), sz: 1 },
      { oid: 22, coin: "BTC", side: "A", orderType: "Take Profit Market", triggerPx: 110, placedAt: at(1), sz: 1 },
    ];
    await storeOrders(db(), walletId, rows(ladder));
    await applyProtection(db(), walletId);
    const tps = await db().select().from(s.tradePartials).where(eq(s.tradePartials.tradeId, t.id));
    expect(tps.map((p) => [p.price, p.pct])).toEqual([
      [105, 50],
      [110, 50],
    ]);
    expect(await journal(t.id)).toMatchObject({ tpPartialsSource: "auto", takeProfit: 110 });

    // user edits the partials → theirs from now on
    await db().update(s.tradeJournal).set({ tpPartialsSource: "user" }).where(eq(s.tradeJournal.tradeId, t.id));
    await db().delete(s.tradePartials);
    await applyProtection(db(), walletId);
    expect(await db().select().from(s.tradePartials)).toHaveLength(0);
  });

  test("superseded and deleted trades are left alone", async () => {
    const t = await oneLongTrade();
    await db().update(s.trades).set({ deletedAt: Date.now() }).where(eq(s.trades.id, t.id));
    await storeOrders(db(), walletId, rows([SL1]));
    expect((await applyProtection(db(), walletId)).trades).toBe(0);
    expect(await journal(t.id)).toBeUndefined();
  });
});

describe("your own stop moves", () => {
  test("add, edit and delete; validated against the trade's entry and exit; note trimmed", async () => {
    const t = await oneLongTrade(); // entry at(0), exit at(120)
    const add = await addStopMove(db(), accountId, t.id, { time: at(10), price: 98, note: "  under the last low  " });
    expect(add).toMatchObject({ ok: true, moves: [{ time: at(10), price: 98, source: "user", note: "under the last low" }] });
    const id = add.ok ? add.moves[0].id : "";
    expect(await updateStopMove(db(), accountId, id, { time: at(20), price: 99.5, note: "" })).toMatchObject({ ok: true, moves: [{ time: at(20), price: 99.5, note: null }] });

    expect(await addStopMove(db(), accountId, t.id, { time: at(-2), price: 98 })).toEqual({ ok: false, error: "A stop move can't be before the entry" });
    expect(await addStopMove(db(), accountId, t.id, { time: at(0) - 30_000, price: 98 })).toMatchObject({ ok: true }); // a minute-rounded input
    expect(await addStopMove(db(), accountId, t.id, { time: at(122), price: 98 })).toEqual({ ok: false, error: "A stop move can't be after the exit" });
    expect(await addStopMove(db(), accountId, t.id, { time: at(121), price: 98 })).toMatchObject({ ok: true }); // within a minute of the exit
    for (const bad of [{ time: at(10), price: 0 }, { time: at(10), price: -1 }, { time: at(10), price: Number.NaN }, { time: at(10), price: 98, note: "x".repeat(501) }, { price: 98 }, null])
      expect((await addStopMove(db(), accountId, t.id, bad)).ok).toBe(false);

    expect(await deleteStopMove(db(), accountId, id)).toMatchObject({ ok: true });
    expect((await db().select().from(s.stopMoves)).map((m) => m.time).sort((a, b) => a - b)).toEqual([at(0) - 30_000, at(121)]);
  });

  test("another account can't touch them; exchange (auto) moves can't be edited or deleted; deleted trades refuse", async () => {
    const t = await oneLongTrade();
    await storeOrders(db(), walletId, rows([SL1, SL2]));
    await applyProtection(db(), walletId);
    const [auto] = await db().select().from(s.stopMoves);
    expect(auto.source).toBe("auto");
    expect(await updateStopMove(db(), accountId, auto.id, { time: at(30), price: 1 })).toEqual({ ok: false, error: "Only your own stop moves can be edited" });
    expect(await deleteStopMove(db(), accountId, auto.id)).toEqual({ ok: false, error: "Only your own stop moves can be deleted" });

    const other = (await db().insert(s.accounts).values({ name: "Someone else" }).returning())[0].id;
    expect(await addStopMove(db(), other, t.id, { time: at(10), price: 98 })).toEqual({ ok: false, error: "Trade not found" });
    const mine = await addStopMove(db(), accountId, t.id, { time: at(10), price: 98 });
    const mineId = mine.ok ? mine.moves.find((m) => m.source === "user")!.id : "";
    expect((await updateStopMove(db(), other, mineId, { time: at(11), price: 97 })).ok).toBe(false);
    expect((await deleteStopMove(db(), other, mineId)).ok).toBe(false);

    await db().update(s.trades).set({ deletedAt: Date.now() }).where(eq(s.trades.id, t.id));
    expect(await addStopMove(db(), accountId, t.id, { time: at(12), price: 98 })).toEqual({ ok: false, error: "Trade not found" });
  });

  test("re-syncs and rebuilds replace exchange moves but never yours", async () => {
    const t = await oneLongTrade();
    await storeOrders(db(), walletId, rows([SL1, SL2]));
    await applyProtection(db(), walletId);
    await addStopMove(db(), accountId, t.id, { time: at(60), price: 100, note: "BE by hand" });
    // the exchange history changes (a later window adds a third stop): auto rows are rebuilt
    const SL3: SynthOrder = { oid: 14, coin: "BTC", side: "A", orderType: "Stop Market", triggerPx: 104, placedAt: at(90), end: { status: "canceled", at: at(120) } };
    await storeOrders(db(), walletId, rows([SL1, SL2, SL3]));
    await applyProtection(db(), walletId);
    await rebuildTrades(db(), { walletId, accountId });
    const moves = await db().select().from(s.stopMoves).where(eq(s.stopMoves.tradeId, t.id));
    expect(moves.filter((m) => m.source === "auto").map((m) => m.price).sort((a, b) => a - b)).toEqual([99, 104]);
    expect(moves.filter((m) => m.source === "user")).toMatchObject([{ price: 100, note: "BE by hand", time: at(60) }]);
  });
});

describe("stop class in analytics", () => {
  test("from your saved stop loss and every move (exchange and yours, in time then id order); null without a stop", async () => {
    const t = await oneLongTrade(); // long, entry 100
    const cls = async () => (await analyticsTrades(db(), accountId)).find((x) => x.id === t.id)!.stopClass;
    expect(await cls()).toBeNull(); // no stop loss yet
    await db().insert(s.tradeJournal).values({ tradeId: t.id, stopLoss: 95, stopLossSource: "user" });
    expect(await cls()).toBe("never_moved");
    await storeOrders(db(), walletId, rows([SL1, SL2])); // exchange: 95 → 99 at at(30)
    await applyProtection(db(), walletId);
    expect(await cls()).toBe("tightened");
    await addStopMove(db(), accountId, t.id, { time: at(60), price: 100 }); // yours: to breakeven
    expect(await cls()).toBe("breakeven");
    await addStopMove(db(), accountId, t.id, { time: at(90), price: 106 });
    expect(await cls()).toBe("trailed");
    await addStopMove(db(), accountId, t.id, { time: at(100), price: 103 }); // gives back profit
    expect(await cls()).toBe("widened");
    // clearing the stop loss takes the trade out of the widget, as the timeline says
    await db().update(s.tradeJournal).set({ stopLoss: null }).where(eq(s.tradeJournal.tradeId, t.id));
    expect(await cls()).toBeNull();
  });
});
