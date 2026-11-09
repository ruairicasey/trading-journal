import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { useTempDb } from "./helpers/db";
import { getDb } from "@/server/db/client";
import { runMigrations, seedDefaults } from "@/server/db/bootstrap";
import * as s from "@/server/db/schema";
import { insertFills, rebuildTrades } from "@/server/reconstruct/persist";
import { DEMO_WALLET, resetTids, sim } from "./fixtures/fills";

let walletId: string;
let accountId: string;

beforeAll(async () => {
  useTempDb();
  const db = getDb();
  await runMigrations(db);
  await seedDefaults(db);
  accountId = (await db.select().from(s.accounts))[0].id;
});

beforeEach(async () => {
  resetTids();
  const db = getDb();
  // fresh wallet per test
  await db.delete(s.tradeFills);
  await db.delete(s.tradeJournal);
  await db.delete(s.trades);
  await db.delete(s.fills);
  await db.delete(s.wallets);
  const [w] = await db.insert(s.wallets).values({ accountId, address: DEMO_WALLET }).returning();
  walletId = w.id;
});

const trades = () => getDb().select().from(s.trades).where(eq(s.trades.walletId, walletId));

describe("17. idempotent ingest + rebuild", () => {
  test("same fills ingested twice → no duplicate fills or trades", async () => {
    const db = getDb();
    const btc = sim("BTC").buy(1, 60000, 0).sell(1, 60500, 10).buy(2, 60000, 20).sell(3, 61000, 30);
    const r1 = await insertFills(db, walletId, btc.fills);
    expect(r1.inserted).toBe(4);
    expect(r1.coins).toEqual(["BTC"]);
    const b1 = await rebuildTrades(db, { walletId, accountId });
    expect(b1).toMatchObject({ created: 3, updated: 0, superseded: 0 }); // long, long→short flip, short open

    const r2 = await insertFills(db, walletId, btc.fills);
    expect(r2.inserted).toBe(0);
    const b2 = await rebuildTrades(db, { walletId, accountId });
    expect(b2).toMatchObject({ created: 0, updated: 3, superseded: 0 });
    expect(await db.select().from(s.fills)).toHaveLength(4);
    expect(await trades()).toHaveLength(3);
    expect(b2.tradeIds).toEqual(b1.tradeIds);
  });

  test("overlapping / out-of-order pages give the same trades as one clean page", async () => {
    const db = getDb();
    const s1 = sim("ETH").buy(2, 3000, 0).buy(1, 2990, 5).sell(3, 3100, 10).sell(1, 3050, 20).buy(1, 3000, 30);
    const f = s1.fills;
    await insertFills(db, walletId, [f[3], f[4], f[2]]); // later page first
    await rebuildTrades(db, { walletId, accountId, coins: ["ETH"] });
    await insertFills(db, walletId, [f[0], f[1], f[2], f[3]]); // overlapping earlier page
    await rebuildTrades(db, { walletId, accountId, coins: ["ETH"] });

    const live = (await trades()).filter((t) => !t.flags.superseded).sort((a, b) => a.entryTime! - b.entryTime!);
    expect(live.map((t) => [t.direction, t.status, t.grossPnl])).toEqual([
      ["long", "closed", 310], // avg entry (2·3000 + 2990)/3, exit 3100 × 3
      ["short", "closed", 50],
    ]);
    const legs = await db.select().from(s.tradeFills);
    expect(legs).toHaveLength(5);
  });
});

describe("18. journal data survives rebuilds", () => {
  test("journal row is kept and untouched across rebuilds; open trade updates in place", async () => {
    const db = getDb();
    const s1 = sim("SOL").buy(10, 100, 0);
    await insertFills(db, walletId, s1.fills);
    await rebuildTrades(db, { walletId, accountId });
    const [open] = await trades();
    expect(open.status).toBe("open");

    await db.insert(s.tradeJournal).values({
      tradeId: open.id,
      stopLoss: 95,
      grade: "A",
      timeframeClass: "MTF",
      rationale: "VAL retest with acceptance",
    });

    s1.sell(10, 110, 60);
    await insertFills(db, walletId, s1.fills);
    await rebuildTrades(db, { walletId, accountId, coins: ["SOL"] });

    const [closed] = await trades();
    expect(closed.id).toBe(open.id);
    expect(closed.status).toBe("closed");
    expect(closed.grossPnl).toBe(100);
    const j = await db.query.tradeJournal.findFirst({ where: eq(s.tradeJournal.tradeId, open.id) });
    expect(j).toMatchObject({ stopLoss: 95, grade: "A", timeframeClass: "MTF", rationale: "VAL retest with acceptance" });
  });

  test("a trade no longer produced is flagged superseded, never deleted", async () => {
    const db = getDb();
    // We only have the tail of a position (history mid-position)…
    const full = sim("BTC").buy(1, 60000, 0).sell(1, 61000, 30);
    await insertFills(db, walletId, [full.fills[1]]);
    await rebuildTrades(db, { walletId, accountId });
    const [partial] = await trades();
    expect(partial.flags.partialHistory).toBe(true);
    await db.insert(s.tradeJournal).values({ tradeId: partial.id, rationale: "keep me" });

    // …then the earlier fill arrives: the round trip gets a new identity (first tid changed).
    await insertFills(db, walletId, [full.fills[0]]);
    const r = await rebuildTrades(db, { walletId, accountId });
    expect(r).toMatchObject({ created: 1, superseded: 1 });

    const all = await trades();
    expect(all).toHaveLength(2);
    const old = all.find((t) => t.id === partial.id)!;
    expect(old.flags.superseded).toBe(true);
    expect(old.deletedAt).toBeNull();
    // its legs moved to the replacement trade, so no fill is counted twice
    expect(await db.select().from(s.tradeFills).where(eq(s.tradeFills.tradeId, partial.id))).toHaveLength(0);
    const j = await db.query.tradeJournal.findFirst({ where: eq(s.tradeJournal.tradeId, partial.id) });
    expect(j?.rationale).toBe("keep me");

    // re-running doesn't re-count it
    expect((await rebuildTrades(db, { walletId, accountId })).superseded).toBe(0);
  });

  test("soft-deleted trades stay deleted after a rebuild", async () => {
    const db = getDb();
    await insertFills(db, walletId, sim("ETH").buy(1, 3000, 0).sell(1, 3100, 5).fills);
    await rebuildTrades(db, { walletId, accountId });
    const [t] = await trades();
    await db.update(s.trades).set({ deletedAt: Date.now() }).where(eq(s.trades.id, t.id));
    await rebuildTrades(db, { walletId, accountId });
    const [after] = await trades();
    expect(after.deletedAt).not.toBeNull();
  });
});
