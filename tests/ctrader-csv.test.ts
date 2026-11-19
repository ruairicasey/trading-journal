import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { useTempDb } from "./helpers/db";
import { getDb } from "@/server/db/client";
import { runMigrations, seedDefaults } from "@/server/db/bootstrap";
import * as s from "@/server/db/schema";
import { parseCsv, parseNumber, parseTime, previewCsv } from "@/server/ctrader/csv";
import { positionTrade, toStoredDeal } from "@/server/ctrader/positions";
import { Deal } from "@/server/ctrader/protocol";
import { upsertPositionTrades } from "@/server/ctrader/sync";
import { CTID, deal, LOGIN, MD } from "./fixtures/ctrader";

// Synthetic export in the shape third-party importers document for cTrader's History export (English headers).
const HEADER =
  "ID,Symbol,Opening Direction,Closing Direction,Opening Time,Closing Time,Entry Price,Closing Price,Closing Quantity,Commission,Swap,Gross USD,Net USD,Label";
const FILE = [
  "Statement for account,,,,,,,,,,,,,",
  HEADER,
  '1001,EURUSD,Buy,Sell,02/11/2026 09:00:00.000,02/11/2026 10:00:00.000,1.10000,1.12000,"10,000",-6.00,-1.00,200.00,193.00,vwap',
  // a position closed in two parts → one trade
  "1002,XAUUSD,Sell,Buy,03/11/2026 09:00:00.000,03/11/2026 11:00:00.000,2000.00,1990.00,20,-0.80,0,200.00,199.20,",
  "1002,XAUUSD,Sell,Buy,03/11/2026 09:00:00.000,03/11/2026 12:30:00.000,2000.00,2010.00,30,-1.20,0,-300.00,-301.20,",
  // net doesn't add up → flagged, imported using Net
  "1003,US30,Buy,Sell,04/11/2026 14:00:00,04/11/2026 15:00:00,44000,44100,1,-2.00,0,100.00,90.00,",
  // unreadable → skipped with a reason
  "abc,EURUSD,Flat,Sell,soon,later,1,1,1,0,0,0,x,",
  ",,,,,,,,,,,Total,82.00,",
].join("\r\n");

describe("csv parsing", () => {
  test("quotes, doubled quotes, CRLF, BOM and ; delimiters", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
    ]);
    expect(parseCsv("a;b;c\n1;2,5;3")).toEqual([
      ["a", "b", "c"],
      ["1", "2,5", "3"],
    ]);
  });

  test("numbers in the formats an export can use", () => {
    expect(parseNumber("1,234.56")).toBe(1234.56);
    expect(parseNumber("1.234,56")).toBe(1234.56);
    expect(parseNumber("12,5")).toBe(12.5);
    expect(parseNumber("10,000")).toBe(10000);
    expect(parseNumber("−12.30")).toBe(-12.3);
    expect(parseNumber("(7.50)")).toBe(-7.5);
    expect(parseNumber("$ 1,000.00")).toBe(1000);
    expect(parseNumber("x")).toBeNull();
    expect(parseNumber("")).toBeNull();
  });

  test("times: ISO and day-first, in the chosen zone; nonsense is rejected", () => {
    expect(parseTime("2026-11-02 09:00:00", "UTC")).toBe(Date.UTC(2026, 10, 2, 9));
    expect(parseTime("02/11/2026 09:00:00.250", "UTC")).toBe(Date.UTC(2026, 10, 2, 9, 0, 0, 250));
    expect(parseTime("02.11.2026 09:00", "UTC")).toBe(Date.UTC(2026, 10, 2, 9));
    expect(parseTime("2026-11-02 09:00:00", "Australia/Melbourne")).toBe(Date.UTC(2026, 10, 1, 22));
    expect(parseTime("31/02/2026 09:00", "UTC")).toBeNull();
    expect(parseTime("soon", "UTC")).toBeNull();
  });
});

describe("preview", () => {
  test("groups partial closes, checks every row, and nets to the file's Net column", () => {
    const p = previewCsv(FILE, { login: String(LOGIN), tz: "UTC" });
    expect(p.missing).toEqual([]);
    expect(p.rows).toBe(4);
    expect(p.trades.map((t) => [t.externalKey, t.coin, t.direction, t.fillCount])).toEqual([
      [`ctrader:${LOGIN}:1001`, "EURUSD", "long", 1],
      [`ctrader:${LOGIN}:1002`, "XAUUSD", "short", 2],
      [`ctrader:${LOGIN}:1003`, "US30", "long", 1],
    ]);
    const x = p.trades[1];
    expect(x.sizeUnits).toBe(50);
    expect(x.avgExit).toBeCloseTo((20 * 1990 + 30 * 2010) / 50, 9);
    expect(x.entryTime).toBe(Date.UTC(2026, 10, 3, 9));
    expect(x.exitTime).toBe(Date.UTC(2026, 10, 3, 12, 30));
    expect(x.grossPnl - x.fees + x.funding).toBeCloseTo(199.2 - 301.2, 9);
    expect(p.trades[0].fees).toBeCloseTo(6, 9);
    expect(p.trades[0].funding).toBeCloseTo(-1, 9);
    expect(p.net).toBeCloseTo(193 + 199.2 - 301.2 + 90, 9);
    expect(p.issues.map((i) => i.row)).toEqual([6, 7]);
    expect(p.issues[0].problem).toMatch(/≠ net/);
    expect(p.issues[1].problem).toMatch(/position ID.*direction.*opening time.*closing time.*net/);
  });

  test("names the columns it couldn't find", () => {
    const p = previewCsv("Symbol,Profit\nEURUSD,1", { login: "1", tz: "UTC" });
    expect(p.trades).toEqual([]);
    expect(p.missing).toEqual([
      "ID / Position ID",
      "Opening Direction",
      "Opening Time",
      "Closing Time",
      "Net",
    ]);
  });
});

describe("import", () => {
  let accountId: string;
  beforeAll(async () => {
    useTempDb();
    await runMigrations(getDb());
    await seedDefaults(getDb());
    accountId = (await getDb().select().from(s.accounts))[0].id;
  });
  beforeEach(async () => {
    await getDb().delete(s.tradeJournal);
    await getDb().delete(s.trades);
  });
  const rows = () => getDb().select().from(s.trades).where(eq(s.trades.source, "ctrader"));

  test("re-importing changes nothing; the API's version replaces an import, never the other way", async () => {
    const p = previewCsv(FILE, { login: String(LOGIN), tz: "UTC" });
    expect(await upsertPositionTrades(getDb(), accountId, p.trades, { imported: true })).toMatchObject({
      created: 3,
      updated: 0,
    });
    const again = await upsertPositionTrades(getDb(), accountId, p.trades, { imported: true });
    expect(again).toMatchObject({ created: 0, updated: 3 });
    expect(await rows()).toHaveLength(3);
    const imported = (await rows()).find((t) => t.externalKey === `ctrader:${LOGIN}:1001`)!;
    expect(imported.flags).toEqual({ imported: true });
    expect(imported.netPnl).toBeCloseTo(193, 9);
    await getDb().insert(s.tradeJournal).values({ tradeId: imported.id, postNotes: "kept" });

    // the API sync later sees position 1001: same key, so it updates the imported trade in place
    const api = positionTrade(LOGIN, [
      toStoredDeal(
        CTID,
        Deal.parse(
          deal({
            id: 1,
            pos: 1001,
            side: "BUY",
            units: 10_000,
            price: 1.1,
            t: Date.UTC(2026, 10, 2, 9),
            commission: -3,
          }),
        ),
        "EURUSD",
        MD,
      ),
      toStoredDeal(
        CTID,
        Deal.parse(
          deal({
            id: 2,
            pos: 1001,
            side: "SELL",
            units: 10_000,
            price: 1.12,
            t: Date.UTC(2026, 10, 2, 10),
            close: { entry: 1.1, gross: 200, swap: -1, commission: -6, balance: 100_193 },
          }),
        ),
        "EURUSD",
        MD,
      ),
    ])!;
    expect(await upsertPositionTrades(getDb(), accountId, [api])).toMatchObject({ created: 0, updated: 1 });
    const synced = (await rows()).find((t) => t.id === imported.id)!;
    expect(synced.flags).toEqual({});
    expect(synced.netPnl).toBeCloseTo(193, 9);
    expect(synced.notionalUsd).toBeCloseTo(11_000, 6);
    expect(
      await getDb().query.tradeJournal.findFirst({ where: eq(s.tradeJournal.tradeId, imported.id) }),
    ).toMatchObject({ postNotes: "kept" });

    // importing the file again now skips it: the API's figures win
    expect(await upsertPositionTrades(getDb(), accountId, p.trades, { imported: true })).toMatchObject({
      created: 0,
      updated: 2,
      skipped: 1,
    });
    expect((await rows()).find((t) => t.id === imported.id)!.flags).toEqual({});
  });
});
