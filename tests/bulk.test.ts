import { beforeAll, describe, expect, test, vi } from "vitest";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { useTempDb } from "./helpers/db";
import { getDb } from "@/server/db/client";
import { runMigrations, seedDefaults } from "@/server/db/bootstrap";
import * as s from "@/server/db/schema";
import { DEFAULT_SESSIONS } from "@/server/db/seed-data";
import { DEMO_ADDRESS, generateDemoHistory } from "@/server/demo/generate";
import { seedDemoJournal } from "@/server/demo/journal";
import { createRng } from "@/server/demo/rng";
import { demoChartPng } from "@/server/demo/chart-png";
import { insertFills, rebuildTrades } from "@/server/reconstruct/persist";
import { listTrades, matchingTradeIds } from "@/server/db/queries/trades";
import { parseFilters } from "@/server/trades/filters";
import { BULK_MAX, BulkError, bulkAddTag, bulkRestore, bulkSetGrade, bulkSetStrategy, bulkSoftDelete } from "@/server/trades/bulk";
import { deleteSavedFilter, listSavedFilters, MAX_SAVED_FILTERS, saveFilter, SavedFilterError } from "@/server/trades/saved-filters";
import { fetchSnapshot, importSnapshot, parseSnapshotLink, snapshotImageUrl } from "@/server/tradingview";
import { ScreenshotError } from "@/server/screenshots";
import type { BlobStorage } from "@/server/storage";

const TZ = "Australia/Melbourne";
const END = Date.UTC(2026, 10, 9, 12);
let accountId: string;
let otherId: string;
let foreign: string; // a trade on another account

const closedIds = async (n: number) => (await matchingTradeIds(getDb(), accountId, parseFilters({ tab: "closed" }), { tz: TZ, now: END, limit: n }));
const journal = (ids: string[]) => getDb().select().from(s.tradeJournal).where(inArray(s.tradeJournal.tradeId, ids));

beforeAll(async () => {
  useTempDb();
  const db = getDb();
  await runMigrations(db);
  await seedDefaults(db);
  accountId = (await db.select().from(s.accounts))[0].id;
  const [w] = await db.insert(s.wallets).values({ accountId, address: DEMO_ADDRESS }).returning();
  const h = generateDemoHistory({ end: END });
  await insertFills(db, w.id, h.fills);
  await rebuildTrades(db, { walletId: w.id, accountId });
  await seedDemoJournal(db, createRng(7), { walletId: w.id, plans: h.plans, sessions: DEFAULT_SESSIONS });
  const [o] = await db.insert(s.accounts).values({ name: "Other" }).returning();
  otherId = o.id;
  const [t] = await db
    .insert(s.trades)
    .values({ accountId: otherId, source: "manual", coin: "BTC", displayPair: "BTC", direction: "long", status: "closed", flags: {} })
    .returning();
  foreign = t.id;
});

describe("select all matching", () => {
  test("returns exactly the trades the filters match, across every page", async () => {
    for (const p of [{}, { tab: "closed" }, { outcome: "loss" }, { dir: "short", tab: "closed" }]) {
      const f = parseFilters(p);
      const ids = await matchingTradeIds(getDb(), accountId, f, { tz: TZ, now: END, limit: 10_000 });
      const listed = await listTrades(getDb(), accountId, f, { tz: TZ, now: END });
      expect(ids.length).toBe(listed.total);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.slice(0, listed.rows.length)).toEqual(listed.rows.map((r) => r.id)); // same order as the list
    }
    expect((await matchingTradeIds(getDb(), accountId, parseFilters({}), { tz: TZ, now: END, limit: 3 })).length).toBe(3);
  });
});

describe("wallet scope", () => {
  test("select all matching with a wallet picked leaves out the other wallet's trades", async () => {
    const db = getDb();
    const [main] = await db.select().from(s.wallets).where(eq(s.wallets.accountId, accountId));
    const [sub] = await db.insert(s.wallets).values({ accountId, address: "0x" + "e".repeat(40), label: "Sub" }).returning();
    const [moved] = await closedIds(1);
    await db.update(s.trades).set({ walletId: sub.id }).where(eq(s.trades.id, moved));
    try {
      const f = parseFilters({});
      const all = await matchingTradeIds(db, accountId, f, { tz: TZ, now: END, limit: 10_000 });
      const onMain = await matchingTradeIds(db, accountId, f, { tz: TZ, now: END, limit: 10_000, walletId: main.id });
      const onSub = await matchingTradeIds(db, accountId, f, { tz: TZ, now: END, limit: 10_000, walletId: sub.id });
      expect(onSub).toEqual([moved]);
      expect(onMain).not.toContain(moved);
      expect(onMain.length + onSub.length).toBe(all.length);
    } finally {
      await db.update(s.trades).set({ walletId: main.id }).where(eq(s.trades.id, moved));
      await db.delete(s.wallets).where(eq(s.wallets.id, sub.id));
    }
  });
});

describe("bulk actions", () => {
  test("grade, strategy and tags skip deleted trades", async () => {
    const db = getDb();
    const [gone] = await closedIds(1);
    await bulkSoftDelete(db, accountId, [gone]);
    const [before] = await journal([gone]);
    const [strat] = await db.select().from(s.vocabItems).where(and(eq(s.vocabItems.kind, "strategy"), eq(s.vocabItems.archived, false))).limit(1);
    expect(await bulkSetGrade(db, accountId, [gone], before?.grade === "D" ? "C" : "D")).toBe(0);
    expect(await bulkSetStrategy(db, accountId, [gone], strat.id)).toBe(0);
    expect(await bulkAddTag(db, accountId, [gone], "deleted-tag")).toBe(0);
    expect((await journal([gone]))[0]).toEqual(before);
    await bulkRestore(db, accountId, [gone]);
  });

  test("grade and strategy: set on this account's trades only, and journal rows are created where missing", async () => {
    const ids = await closedIds(30);
    const n = await bulkSetGrade(getDb(), accountId, [...ids, foreign, "nope", ids[0]], "B");
    expect(n).toBe(30);
    expect((await journal(ids)).every((j) => j.grade === "B")).toBe(true);
    expect(await journal([foreign])).toEqual([]);

    const [strat] = await getDb().select().from(s.vocabItems).where(and(eq(s.vocabItems.kind, "strategy"), eq(s.vocabItems.archived, false))).limit(1);
    const before = await journal(ids);
    await bulkSetStrategy(getDb(), accountId, ids, strat.id);
    const after = await journal(ids);
    expect(after.every((j) => j.strategyId === strat.id)).toBe(true);
    // nothing else on the journal changes
    const strip = (j: (typeof after)[number]) => ({ ...j, strategyId: null, updatedAt: 0 });
    expect(after.map(strip).sort((a, b) => a.tradeId.localeCompare(b.tradeId))).toEqual(before.map(strip).sort((a, b) => a.tradeId.localeCompare(b.tradeId)));

    await bulkSetStrategy(getDb(), accountId, ids, null);
    expect((await journal(ids)).every((j) => j.strategyId === null)).toBe(true);
    await expect(bulkSetStrategy(getDb(), accountId, ids, "missing")).rejects.toThrow(BulkError);
    const [mistake] = await getDb().select().from(s.vocabItems).where(eq(s.vocabItems.kind, "mistake")).limit(1);
    await expect(bulkSetStrategy(getDb(), accountId, ids, mistake.id)).rejects.toThrow(BulkError);
    // @ts-expect-error: not a grade
    await expect(bulkSetGrade(getDb(), accountId, ids, "Z")).rejects.toThrow(BulkError);
  });

  test("add tag reuses an existing tag case-insensitively and keeps other tags", async () => {
    const ids = await closedIds(10);
    const tagsOf = async () =>
      getDb().select({ trade: s.tradeTags.tradeId, name: s.tags.name }).from(s.tradeTags).innerJoin(s.tags, eq(s.tags.id, s.tradeTags.tagId)).where(inArray(s.tradeTags.tradeId, ids));
    const before = await tagsOf();
    expect(await bulkAddTag(getDb(), accountId, ids.slice(0, 4), "#Review-me")).toBe(4);
    expect(await bulkAddTag(getDb(), accountId, [...ids, foreign], "review-ME")).toBe(6); // 4 already had it
    const after = await tagsOf();
    expect(after.filter((t) => t.name === "Review-me").length).toBe(10);
    expect(after.length).toBe(before.length + 10);
    expect((await getDb().select().from(s.tags)).filter((t) => t.name.toLowerCase() === "review-me").length).toBe(1);
    expect(await getDb().select().from(s.tradeTags).where(eq(s.tradeTags.tradeId, foreign))).toEqual([]);
    await expect(bulkAddTag(getDb(), accountId, ids, "  ")).rejects.toThrow(BulkError);
  });

  test("delete hides the trades and Undo restores exactly those", async () => {
    const total = async () => (await listTrades(getDb(), accountId, parseFilters({}), { tz: TZ, now: END })).total;
    const start = await total();
    const ids = await closedIds(5);
    const gone = await bulkSoftDelete(getDb(), accountId, [...ids, foreign]);
    expect(gone.sort()).toEqual([...ids].sort());
    expect(await total()).toBe(start - 5);
    const live = await getDb().select().from(s.trades).where(and(eq(s.trades.id, foreign), isNull(s.trades.deletedAt)));
    expect(live).toHaveLength(1);
    // deleting again does nothing; restore brings back only the ones passed
    expect(await bulkSoftDelete(getDb(), accountId, ids)).toEqual([]);
    expect(await bulkRestore(getDb(), accountId, ids.slice(0, 2))).toBe(2);
    expect(await total()).toBe(start - 3);
    expect(await bulkRestore(getDb(), accountId, ids)).toBe(3);
    expect(await total()).toBe(start);
  });

  test("refuses more than the cap", async () => {
    const many = Array.from({ length: BULK_MAX + 1 }, (_, i) => `id${i}`);
    await expect(bulkSetGrade(getDb(), accountId, many, "A")).rejects.toThrow(BulkError);
  });
});

describe("saved filters", () => {
  test("save, list, replace by name, drop invalid values, delete; built-ins untouched", async () => {
    const db = getDb();
    const builtins = (await db.select().from(s.savedFilters).where(eq(s.savedFilters.builtin, true))).length;
    await saveFilter(db, "A longs", { ...parseFilters({ dir: "long", grade: "A", tab: "closed", page: "3", q: "btc" }) });
    let list = await listSavedFilters(db);
    expect(list.map((l) => [l.name, l.filters])).toEqual([["A longs", { tab: "closed", q: "btc", dir: "long", grade: "A" }]]);
    await saveFilter(db, "a LONGS", parseFilters({ dir: "long" }));
    list = await listSavedFilters(db);
    expect(list.map((l) => [l.name, l.filters])).toEqual([["a LONGS", { dir: "long" }]]);
    await expect(saveFilter(db, "Empty", parseFilters({ page: "2" }))).rejects.toThrow(SavedFilterError);
    await expect(saveFilter(db, "", parseFilters({ dir: "long" }))).rejects.toThrow(SavedFilterError);

    // a stored value that is no longer valid is dropped on read
    await db.update(s.savedFilters).set({ query: { dir: "sideways", grade: "B" } }).where(eq(s.savedFilters.id, list[0].id));
    expect((await listSavedFilters(db))[0].filters).toEqual({ grade: "B" });

    for (let i = 1; i < MAX_SAVED_FILTERS; i++) await saveFilter(db, `f${i}`, parseFilters({ grade: "C" }));
    await expect(saveFilter(db, "one more", parseFilters({ grade: "C" }))).rejects.toThrow(SavedFilterError);
    for (const l of await listSavedFilters(db)) expect(await deleteSavedFilter(db, l.id)).toBe(true);
    const [b] = await db.select().from(s.savedFilters).where(eq(s.savedFilters.builtin, true)).limit(1);
    if (b) expect(await deleteSavedFilter(db, b.id)).toBe(false);
    expect((await db.select().from(s.savedFilters).where(eq(s.savedFilters.builtin, true))).length).toBe(builtins);
    expect(await listSavedFilters(db)).toEqual([]);
  });
});

describe("TradingView snapshot links", () => {
  test("parses only real snapshot links", () => {
    expect(parseSnapshotLink("https://www.tradingview.com/x/AbCd1234/")).toBe("AbCd1234");
    expect(parseSnapshotLink("tradingview.com/x/AbCd1234")).toBe("AbCd1234");
    expect(parseSnapshotLink("https://uk.tradingview.com/x/AbCd1234/")).toBe("AbCd1234");
    expect(parseSnapshotLink("https://s3.tradingview.com/snapshots/a/AbCd1234.png")).toBe("AbCd1234");
    for (const bad of [
      "https://s3.tradingview.com/snapshots/b/AbCd1234.png",
      "https://evil.com/x/AbCd1234/",
      "https://tradingview.com.evil.com/x/AbCd1234/",
      "https://www.tradingview.com/x/../../etc/",
      "https://www.tradingview.com/chart/AbCd1234/",
      "https://www.tradingview.com/x/ab/",
      "javascript:alert(1)",
      "",
    ])
      expect(parseSnapshotLink(bad)).toBeNull();
    expect(snapshotImageUrl("AbCd1234")).toBe("https://s3.tradingview.com/snapshots/a/AbCd1234.png");
  });

  const png = demoChartPng(createRng(1), { entry: 100, stop: 98, target: 104, direction: "long", width: 120, height: 80 });
  const res = (body: Uint8Array | null, status = 200, headers: Record<string, string> = {}) => new Response(body as BodyInit | null, { status, headers });

  test("fetches only the snapshot host, with no redirects, and caps the size", async () => {
    const f = vi.fn(async () => res(png));
    expect(await fetchSnapshot("AbCd1234", f as unknown as typeof fetch)).toEqual(png);
    expect(f).toHaveBeenCalledWith("https://s3.tradingview.com/snapshots/a/AbCd1234.png", expect.objectContaining({ redirect: "error" }));
    await expect(fetchSnapshot("../x", f as unknown as typeof fetch)).rejects.toThrow(ScreenshotError);
    await expect(fetchSnapshot("AbCd1234", (async () => res(null, 404)) as unknown as typeof fetch)).rejects.toThrow(/no snapshot/);
    await expect(fetchSnapshot("AbCd1234", (async () => { throw new TypeError("redirect"); }) as unknown as typeof fetch)).rejects.toThrow(/reach/);
    const big = new Uint8Array(4 * 1024 * 1024 + 1);
    await expect(fetchSnapshot("AbCd1234", (async () => res(big)) as unknown as typeof fetch)).rejects.toThrow(/4 MB/);
    await expect(fetchSnapshot("AbCd1234", (async () => res(big, 200, { "content-length": "1" })) as unknown as typeof fetch)).rejects.toThrow(/4 MB/);
  });

  test("imports onto the trade with its source link; refuses non-images and other accounts' trades", async () => {
    const stored = new Map<string, Uint8Array>();
    const storage = { put: async (k: string, b: Uint8Array) => void stored.set(k, b), delete: async () => {} } as unknown as BlobStorage;
    const [tradeId] = await closedIds(1);
    const shot = await importSnapshot(getDb(), storage, { accountId, tradeId, link: "https://www.tradingview.com/x/AbCd1234/" }, async () => png);
    expect([shot.width, shot.height]).toEqual([120, 80]);
    const [row] = await getDb().select().from(s.screenshots).where(eq(s.screenshots.id, shot.id));
    expect(row.sourceUrl).toBe("https://www.tradingview.com/x/AbCd1234/");
    expect(stored.get(row.storageKey)).toEqual(png);
    await expect(importSnapshot(getDb(), storage, { accountId, tradeId, link: "https://www.tradingview.com/x/AbCd1234/" }, async () => new TextEncoder().encode("<svg/>"))).rejects.toThrow(/Only PNG/);
    await expect(importSnapshot(getDb(), storage, { accountId, tradeId: foreign, link: "https://www.tradingview.com/x/AbCd1234/" }, async () => png)).rejects.toThrow(/not found/);
    await expect(importSnapshot(getDb(), storage, { accountId, tradeId, link: "https://example.com/a.png" }, async () => png)).rejects.toThrow(/isn't a TradingView/);
  });
});
