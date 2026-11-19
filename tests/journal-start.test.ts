import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { useTempDb } from "./helpers/db";
import { getDb } from "@/server/db/client";
import { runMigrations, seedDefaults } from "@/server/db/bootstrap";
import * as s from "@/server/db/schema";
import { clampStart, fromFloor, journalFloor } from "@/lib/journal-start";
import { dayBoundsLocal } from "@/lib/periods";
import { reportRange } from "@/lib/report-range";
import { listTrades, matchingTradeIds } from "@/server/db/queries/trades";
import { closedTrades } from "@/server/db/queries/dashboard";
import { parseFilters } from "@/server/trades/filters";

const TZ = "Australia/Melbourne";
const START = dayBoundsLocal("2026-04-01", TZ)!.start; // 1 Apr 2026 00:00 Melbourne

describe("floor rules", () => {
  test("applies to every period but All time and custom dates", () => {
    for (const p of ["7d", "30d", "week", "month", "year", "start"])
      expect(journalFloor(START, p), p).toBe(START);
    expect(journalFloor(START, "all")).toBeNull();
    expect(journalFloor(START, "custom")).toBeNull();
    expect(journalFloor(null, "start")).toBeNull();
  });
  test("by entry time; a range start is raised to it", () => {
    const xs = [{ entryTime: START - 1 }, { entryTime: START }, { entryTime: null }];
    expect(fromFloor(xs, START)).toEqual([{ entryTime: START }]);
    expect(fromFloor(xs, null)).toHaveLength(3);
    expect(clampStart(null, START)).toBe(START);
    expect(clampStart(START + 5, START)).toBe(START + 5);
    expect(clampStart(START - 5, START)).toBe(START);
    expect(clampStart(7, null)).toBe(7);
  });
  test("reports: a trade opened before the start but closed after it is left out, except in All time", () => {
    const now = Date.UTC(2026, 10, 18);
    const t = { entryTime: START - 3_600_000, exitTime: START + 3_600_000 };
    expect(reportRange({ period: "year" }, now, TZ, "month", START).inRange(t)).toBe(false);
    expect(reportRange({ period: "start" }, now, TZ, "month", START).inRange(t)).toBe(false);
    expect(reportRange({ period: "all" }, now, TZ, "month", START).inRange(t)).toBe(true);
    expect(
      reportRange({ period: "start" }, now, TZ, "month", START).inRange({
        entryTime: START,
        exitTime: START + 1,
      }),
    ).toBe(true);
    expect(reportRange({ period: "year" }, now, TZ, "month", START).start).toBe(START);
  });
});

describe("queries", () => {
  let accountId: string;
  beforeAll(async () => {
    useTempDb();
    await runMigrations(getDb());
    await seedDefaults(getDb());
    accountId = (await getDb().select().from(s.accounts))[0].id;
  });
  beforeEach(async () => {
    await getDb().delete(s.trades);
    const base = {
      accountId,
      source: "manual" as const,
      coin: "BTC",
      displayPair: "BTC/USD",
      direction: "long" as const,
    };
    await getDb()
      .insert(s.trades)
      .values([
        {
          ...base,
          status: "closed",
          entryTime: START - 86_400_000,
          exitTime: START - 3_600_000,
          netPnl: -50,
        },
        { ...base, status: "closed", entryTime: START - 3_600_000, exitTime: START + 3_600_000, netPnl: -20 },
        { ...base, status: "closed", entryTime: START, exitTime: START + 7_200_000, netPnl: 30 },
        {
          ...base,
          status: "closed",
          entryTime: START + 86_400_000,
          exitTime: START + 90_000_000,
          netPnl: 100,
        },
        { ...base, status: "planned" },
      ]);
  });

  test("trade list: the floor by default (dates included), everything with All time; before + after = all", async () => {
    const db = getDb();
    const list = (q: Record<string, string>) =>
      listTrades(db, accountId, parseFilters({ tab: "closed", ...q }), { tz: TZ, journalStart: START });
    expect((await list({})).total).toBe(2);
    expect((await list({ period: "all" })).total).toBe(4);
    expect((await list({ from: "2026-03-01" })).total).toBe(2);
    expect((await list({ period: "all", to: "2026-03-31" })).total).toBe(2); // opened before the start
    // a closed manual trade with no entry time: hidden by the floor in the list, like in the stats
    await db
      .insert(s.trades)
      .values({
        accountId,
        source: "manual",
        coin: "X",
        displayPair: "X",
        direction: "long",
        status: "closed",
        exitTime: START + 5,
        netPnl: 1,
      });
    expect((await list({})).total).toBe(2);
    expect(
      (await listTrades(db, accountId, parseFilters({ tab: "all" }), { tz: TZ, journalStart: START })).total,
    ).toBe(3); // planned kept
    expect(
      await matchingTradeIds(db, accountId, parseFilters({ tab: "closed" }), {
        tz: TZ,
        limit: 10,
        journalStart: START,
      }),
    ).toHaveLength(2);

    const all = await closedTrades(db, accountId);
    const after = fromFloor(all, START);
    const before = all.filter((t) => !after.includes(t));
    expect(before.length + after.length).toBe(all.length);
    expect(before.reduce((a, t) => a + t.netPnl, 0) + after.reduce((a, t) => a + t.netPnl, 0)).toBe(
      all.reduce((a, t) => a + t.netPnl, 0),
    );
    expect(after.map((t) => t.netPnl)).toEqual([30, 100]);
  });
});

describe("balance at the floor without a ledger", () => {
  test("starting balance + the net of the trades the floor hides", async () => {
    const { baseAtFloor } = await import("@/lib/journal-start");
    const { equityCurve } = await import("@/lib/stats");
    const trades = [
      { entryTime: START - 10, netPnl: 8000 },
      { entryTime: START + 10, netPnl: -500 },
    ];
    expect(baseAtFloor(trades, START, 100_000)).toBe(108_000);
    expect(baseAtFloor(trades, null, 100_000)).toBe(100_000);
    const curve = equityCurve(
      [
        {
          id: "b",
          displayPair: "X",
          direction: "long",
          netPnl: -500,
          fees: 0,
          funding: 0,
          notionalUsd: 1,
          entryTime: START + 10,
          exitTime: START + 20,
          r: null,
        },
      ],
      baseAtFloor(trades, START, 100_000),
      START,
    );
    expect(curve[0].equity).toBe(108_000);
    expect(curve.at(-1)!.equity).toBe(107_500);
  });
});
