/**
 * Regression for the R audit of real data (Phase 2, item 1 follow-up): profit-side stops had become the
 * "stop loss" and produced absurd R (e.g. −160R on a few dollars of "risk"). Synthetic numbers only.
 */
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { useTempDb } from "./helpers/db";
import { getDb } from "@/server/db/client";
import { runMigrations, seedDefaults } from "@/server/db/bootstrap";
import * as s from "@/server/db/schema";
import { historyRows, type SynthOrder } from "@/server/demo/hl-orders";
import { storeOrders } from "@/server/hyperliquid/orders";
import { HistoricalOrdersSchema } from "@/server/hyperliquid/schemas";
import { applyProtection, detectForTrade } from "@/server/protection/apply";
import { auditTrade, summarize, type AuditRow } from "@/server/protection/audit";
import { LATE_STOP_MS } from "@/server/protection/detect";
import { insertFills, rebuildTrades } from "@/server/reconstruct/persist";
import { DEMO_WALLET, MIN, T0, resetTids, sim } from "./fixtures/fills";

let accountId: string;
let walletId: string;
const db = () => getDb();
const at = (m: number) => T0 + m * MIN;
let oid = 1;
const stop = (coin: string, side: "A" | "B", px: number, placedMin: number, endMin?: number, fired = false): SynthOrder => ({
  oid: oid++,
  coin,
  side,
  orderType: "Stop Market",
  triggerPx: px,
  placedAt: at(placedMin),
  ...(endMin !== undefined ? { end: { status: fired ? ("triggered" as const) : ("canceled" as const), at: at(endMin) } } : {}),
});

beforeAll(async () => {
  useTempDb();
  await runMigrations(getDb());
  await seedDefaults(getDb());
  accountId = (await getDb().select().from(s.accounts))[0].id;
});

beforeEach(async () => {
  resetTids();
  for (const t of [s.stopMoves, s.tradePartials, s.tradeFills, s.tradeJournal, s.trades, s.fills, s.orders, s.wallets]) await db().delete(t);
  walletId = (await db().insert(s.wallets).values({ accountId, address: DEMO_WALLET }).returning())[0].id;
});

/** Four trades shaped like the audit's cases, on separate coins so they don't interact. */
async function scenario() {
  const fills = [
    // A: BTC short, only profit-side stops (placed 3.6h in, moved twice), big loss on a manual close
    ...sim("BTC").sell(1, 100_000, 0).buy(1, 102_000, 600).fills,
    // B: ETH long, one profit-side stop placed 37h after entry
    ...sim("ETH").buy(10, 3_000, 0).sell(10, 2_998, 2_400).fills,
    // C: SOL long, a risk-side stop placed 3h after entry, stopped out
    ...sim("SOL").buy(100, 200, 0).sell(100, 196, 400).fills,
    // D: HYPE long, risk-side stop at entry, a clean −1R
    ...sim("HYPE").buy(100, 40, 0).sell(100, 39, 300).fills,
  ];
  const orders: SynthOrder[] = [
    stop("BTC", "B", 99_990, 216, 300),
    stop("BTC", "B", 99_500, 300, 420),
    stop("BTC", "B", 99_000, 420, 600),
    stop("ETH", "A", 3_005, 37 * 60, 2_400),
    stop("SOL", "A", 196, 180, 400, true),
    stop("HYPE", "A", 39, 0, 300, true),
  ];
  await insertFills(db(), walletId, fills);
  await rebuildTrades(db(), { walletId, accountId });
  await storeOrders(db(), walletId, HistoricalOrdersSchema.parse(historyRows(orders)));
  const trades = await db().select().from(s.trades);
  const by = (coin: string) => trades.find((t) => t.coin === coin)!;
  return { A: by("BTC"), B: by("ETH"), C: by("SOL"), D: by("HYPE") };
}
const journal = async (id: string) => db().query.tradeJournal.findFirst({ where: eq(s.tradeJournal.tradeId, id) });

async function auditAll(): Promise<AuditRow[]> {
  const rows: AuditRow[] = [];
  for (const t of await db().select().from(s.trades)) {
    const j = await journal(t.id);
    const d = await detectForTrade(db(), t);
    const a = auditTrade({ ...t, stopLoss: j?.stopLoss ?? null, stopLossSource: j?.stopLossSource ?? null, stopPlaced: d?.stopLoss?.placedAt ?? null, addedAfterStop: 0 });
    if (a) rows.push(a);
  }
  return rows;
}

describe("stop-loss rule: first risk-side stop only", () => {
  test("profit-side stops are never the stop loss, only stop moves; no risk-side stop → no stop loss", async () => {
    const { A, B } = await scenario();
    await applyProtection(db(), walletId);
    expect((await journal(A.id))?.stopLoss ?? null).toBeNull();
    expect((await journal(B.id))?.stopLoss ?? null).toBeNull();
    const moves = await db().select().from(s.stopMoves).where(eq(s.stopMoves.tradeId, A.id));
    expect(moves.map((m) => m.price)).toEqual([99_990, 99_500, 99_000]);
  });

  test("a late risk-side stop is kept, and detection reports how late it was placed", async () => {
    const { C } = await scenario();
    await applyProtection(db(), walletId);
    expect(await journal(C.id)).toMatchObject({ stopLoss: 196, stopLossSource: "auto" });
    const d = await detectForTrade(db(), C);
    expect(d!.stopLoss!.placedAt - C.entryTime!).toBeGreaterThan(LATE_STOP_MS);
  });

  test("re-running clears auto values the new rule rejects, never the user's", async () => {
    const { A, B } = await scenario();
    // as the old rule left them: A auto-set to a profit-side stop; B set to one by the user
    await db().insert(s.tradeJournal).values([
      { tradeId: A.id, stopLoss: 99_990, stopLossSource: "auto" },
      { tradeId: B.id, stopLoss: 3_005, stopLossSource: "user" },
    ]);
    await applyProtection(db(), walletId);
    expect(await journal(A.id)).toMatchObject({ stopLoss: null, stopLossSource: null });
    expect(await journal(B.id)).toMatchObject({ stopLoss: 3_005, stopLossSource: "user" });
  });

  test("the debug:r audit on the result: no profit-side stops, late stop flagged, clean −1R median", async () => {
    await scenario();
    await applyProtection(db(), walletId);
    const sum = summarize(await auditAll());
    expect(sum.n).toBe(2); // C and D; A and B have no stop loss now
    expect(sum.byFlag["profit-side"].n).toBe(0);
    expect(sum.byFlag.late.n).toBe(1);
    expect(sum.unflagged.n).toBe(1);
    expect(sum.unflagged.median).toBeCloseTo(-1, 1);
    expect(sum.median!).toBeGreaterThan(-1.2);
  });
});

describe("audit flags", () => {
  const base = { direction: "long" as const, avgEntry: 100, sizeUnits: 10, netPnl: -50, entryTime: T0, stopLossSource: "auto", stopPlaced: T0, addedAfterStop: 0 };
  test("profit-side, breakeven, tight, late, added-after and beyond-stop", () => {
    expect(auditTrade({ ...base, stopLoss: 100.5 })!.flags).toEqual(["profit-side"]);
    expect(auditTrade({ ...base, stopLoss: 99.97 })!.flags).toEqual(["breakeven"]);
    expect(auditTrade({ ...base, stopLoss: 99.9 })!.flags).toEqual(["tight"]);
    expect(auditTrade({ ...base, stopLoss: 95, stopPlaced: T0 + LATE_STOP_MS + 1 })!.flags).toEqual(["late"]);
    expect(auditTrade({ ...base, stopLoss: 95, addedAfterStop: 1 })!.flags).toEqual(["added-after"]);
    expect(auditTrade({ ...base, stopLoss: 99, netPnl: -20 })!.flags).toEqual(["beyond-stop"]);
    expect(auditTrade({ ...base, stopLoss: 95, stopLossSource: "user", stopPlaced: T0 + 10 * LATE_STOP_MS })!.flags).toEqual([]);
    expect(auditTrade({ ...base, stopLoss: null })).toBeNull();
  });
});
