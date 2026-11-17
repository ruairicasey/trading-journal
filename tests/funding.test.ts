import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { useTempDb } from "./helpers/db";
import { getDb } from "@/server/db/client";
import { runMigrations, seedDefaults } from "@/server/db/bootstrap";
import { setSetting } from "@/server/db/queries/settings";
import * as s from "@/server/db/schema";
import { assignFunding, attributeFunding, INCLUDE_FUNDING_KEY, recomputeNet } from "@/server/funding/attribute";
import { insertFills, rebuildTrades } from "@/server/reconstruct/persist";
import { DEMO_WALLET, MIN, T0, resetTids, sim } from "./fixtures/fills";


describe("daily funding aggregates (older history)", () => {
  const D0 = Date.UTC(2026, 8, 25); // 00:00 UTC
  const h = (x: number) => D0 + x * 3_600_000;
  test("a 00:00 UTC row with no trade open at that instant goes to the trade open most hours that day", () => {
    const a = { id: "A", coin: "SUI", direction: "long" as const, entryTime: h(18.3), exitTime: h(30) }; // 19:00–23:00 = 5h that day
    const b = { id: "B", coin: "SUI", direction: "long" as const, entryTime: h(2.5), exitTime: h(4.5) }; // 03:00, 04:00 = 2h
    const pay = { coin: "SUI", time: D0, szi: "300", usdc: "-1" };
    expect(assignFunding([a, b], [pay])).toEqual(["A"]);
    // a trade open AT 00:00 still matches exactly (hourly rows at midnight)
    const c = { id: "C", coin: "SUI", direction: "long" as const, entryTime: h(-2), exitTime: h(1) };
    expect(assignFunding([a, b, c], [pay])).toEqual(["C"]);
    // not midnight, nothing open: stays unattributed; other direction: unattributed
    expect(assignFunding([a], [{ ...pay, time: h(12) }])).toEqual([null]);
    expect(assignFunding([a], [{ ...pay, szi: "-300" }])).toEqual([null]);
  });
});

describe("which trade a funding payment belongs to", () => {
  const long = { id: "L", coin: "BTC", direction: "long" as const, entryTime: T0, exitTime: T0 + 90 * MIN };
  const short = { id: "S", coin: "BTC", direction: "short" as const, entryTime: T0 + 90 * MIN, exitTime: null };
  const pay = (min: number, szi: string, coin = "BTC") => ({ coin, time: T0 + min * MIN, szi, usdc: "-1" });

  test("by coin, time window and the payment's position sign (a flip inside one funding hour)", () => {
    expect(assignFunding([long, short], [pay(60, "1"), pay(90, "-1"), pay(120, "-1"), pay(60, "-1"), pay(-10, "1"), pay(60, "1", "ETH"), pay(60, "0")])).toEqual([
      "L", // held long at 01:00
      "S", // the flip fill's millisecond: the short side is what the payment's size says
      "S", // the open short keeps collecting
      null, // short size while only the long was open: no match
      null, // before any trade
      null, // another coin
      null, // zero size
    ]);
  });
});

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
  for (const t of [s.stopMoves, s.tradePartials, s.tradeFills, s.tradeJournal, s.trades, s.fills, s.fundingEvents, s.orders, s.ledgerEvents, s.wallets]) await db().delete(t);
  walletId = (await db().insert(s.wallets).values({ accountId, address: DEMO_WALLET }).returning())[0].id;
  await setSetting(INCLUDE_FUNDING_KEY, true);
});

const funding = (min: number, usdc: string, szi: string, coin = "BTC") => ({ walletId, hash: "0x" + "0".repeat(64), coin, time: T0 + min * MIN, usdc, szi, fundingRate: "0.00001" });
const byCoin = async (coin: string) => (await db().select().from(s.trades).where(eq(s.trades.coin, coin)))[0];

describe("attribution into trades", () => {
  test("rebuild attributes funding; net includes it; payments outside trades stay unattributed", async () => {
    await insertFills(db(), walletId, sim("BTC").buy(1, 100, 0).sell(1, 110, 180).fills); // 3h long, +10 gross
    await db().insert(s.fundingEvents).values([funding(60, "-0.5", "1.0"), funding(120, "-0.25", "1.0"), funding(300, "-9", "1.0")]);
    await rebuildTrades(db(), { walletId, accountId });
    const t = await byCoin("BTC");
    expect(t.funding).toBeCloseTo(-0.75, 12);
    expect(t.netPnl).toBeCloseTo((t.grossPnl ?? 0) - (t.fees ?? 0) - 0.75, 10);
    expect(t.returnPct).toBeCloseTo((t.netPnl! / t.notionalUsd!) * 100, 10);
    const evs = await db().select().from(s.fundingEvents);
    expect(evs.filter((e) => e.tradeId === t.id)).toHaveLength(2);
    expect(evs.find((e) => e.time === T0 + 300 * MIN)?.tradeId).toBeNull();
  });

  test("'Include funding in net' off: net is gross − fees, funding still stored", async () => {
    await insertFills(db(), walletId, sim("BTC").buy(1, 100, 0).sell(1, 110, 180).fills);
    await db().insert(s.fundingEvents).values([funding(60, "-2", "1.0")]);
    await rebuildTrades(db(), { walletId, accountId });
    await setSetting(INCLUDE_FUNDING_KEY, false);
    await recomputeNet(db());
    const t = await byCoin("BTC");
    expect(t.funding).toBe(-2);
    expect(t.netPnl).toBeCloseTo((t.grossPnl ?? 0) - (t.fees ?? 0), 10);
    await setSetting(INCLUDE_FUNDING_KEY, true);
    await recomputeNet(db());
    expect((await byCoin("BTC")).netPnl).toBeCloseTo((t.grossPnl ?? 0) - (t.fees ?? 0) - 2, 10);
  });

  test("a rebuild keeps funding (idempotent), and an open trade keeps collecting it", async () => {
    await insertFills(db(), walletId, sim("ETH").sell(2, 3000, 0).fills); // open short
    await db().insert(s.fundingEvents).values([funding(60, "0.4", "-2.0", "ETH"), funding(120, "0.4", "-2.0", "ETH")]);
    await rebuildTrades(db(), { walletId, accountId });
    await rebuildTrades(db(), { walletId, accountId });
    const r = await attributeFunding(db(), walletId);
    expect(r).toMatchObject({ payments: 2, attributed: 2, unattributed: 0, tradesChanged: 0 });
    const t = await byCoin("ETH");
    expect(t.status).toBe("open");
    expect(t.funding).toBeCloseTo(0.8, 12);
  });

  test("manual trades are never touched", async () => {
    const [m] = await db()
      .insert(s.trades)
      .values({ accountId, source: "manual", coin: "BTC", displayPair: "BTC/USD", direction: "long", status: "closed", grossPnl: 5, fees: 1, netPnl: 4, funding: 0 })
      .returning();
    await recomputeNet(db());
    expect((await db().select().from(s.trades).where(eq(s.trades.id, m.id)))[0].netPnl).toBe(4);
  });
});
