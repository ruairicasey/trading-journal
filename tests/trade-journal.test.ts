import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { useTempDb } from "./helpers/db";
import { getDb } from "@/server/db/client";
import { runMigrations, seedDefaults } from "@/server/db/bootstrap";
import * as s from "@/server/db/schema";
import { insertFills, rebuildTrades } from "@/server/reconstruct/persist";
import { loadTradeForEdit, saveTrade, type TradeInput } from "@/server/trades/journal";
import { addScreenshot, deleteScreenshot, moveScreenshot, MAX_BYTES, sniffImage, updateCaption } from "@/server/screenshots";
import { LocalStorage } from "@/server/storage/local";
import { DEMO_WALLET, resetTids, sim } from "./fixtures/fills";

let accountId: string;
let walletId: string;
let tradeId: string;
const vocab: Record<string, string[]> = {};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1]);

beforeAll(async () => {
  useTempDb();
  const db = getDb();
  await runMigrations(db);
  await seedDefaults(db);
  accountId = (await db.select().from(s.accounts))[0].id;
  for (const k of ["confluence", "sl_reason", "tp_reason", "mistake", "emotion", "exit_reason"]) {
    vocab[k] = (await db.select().from(s.vocabItems).where(eq(s.vocabItems.kind, k as s.VocabKind))).map((v) => v.id);
  }
});

beforeEach(async () => {
  resetTids();
  const db = getDb();
  for (const t of [s.screenshots, s.tradeTags, s.tags, s.tradePartials, s.tradeVocab, s.tradeJournal, s.tradeFills, s.trades, s.fills, s.wallets]) await db.delete(t);
  [{ id: walletId }] = await db.insert(s.wallets).values({ accountId, address: DEMO_WALLET }).returning({ id: s.wallets.id });
  await insertFills(db, walletId, sim("ETH").buy(2, 3000, 0).sell(2, 3060, 45).fills);
  await rebuildTrades(db, { walletId, accountId });
  tradeId = (await db.select().from(s.trades))[0].id;
});

const base = (over: Partial<TradeInput> = {}): TradeInput => ({
  accountId,
  strategyId: null,
  stopLoss: 2970,
  takeProfit: null,
  sizeMode: "position",
  plannedRiskUsd: null,
  leverageOverride: null,
  session: null,
  tradeType: null,
  feeOverride: null,
  checklist: [],
  tpPartials: [],
  analysis: {
    entryTimeframe: "15m",
    timeframeClass: "MTF",
    marketCondition: "ranging",
    htfTimeframes: ["4H", "1D", "4H"],
    emotionBeforeId: vocab.emotion[0],
    grade: "A",
    entryRetests: 2,
    maxRReached: 2.5,
    riskMultiplier: 0.5,
    confluences: [vocab.confluence[0], vocab.confluence[3], vocab.mistake[0]], // wrong-kind id slipped in
    slReasons: [vocab.sl_reason[1]],
    tpReasons: [vocab.tp_reason[2]],
  },
  notes: {
    rationale: "VAL reclaim with acceptance",
    postNotes: null,
    reflection: { lesson: "Wait for the retest", saw: "   " },
    tags: ["A-Setup", "a-setup", " fomc "],
    rulesFollowed: null,
    exitReasonId: null,
    emotionAfterId: vocab.confluence[0], // wrong kind → dropped
    processCompliant: null,
    mistakes: [],
  },
  ...over,
});

describe("Analysis and Notes save", () => {
  test("saves every field, drops wrong-kind vocab ids, de-dupes tags and HTFs", async () => {
    const db = getDb();
    expect(await saveTrade(db, accountId, tradeId, base())).toMatchObject({ ok: true });
    const d = (await loadTradeForEdit(db, accountId, tradeId))!;
    expect(d.journal).toMatchObject({
      entryTimeframe: "15m",
      timeframeClass: "MTF",
      marketCondition: "ranging",
      grade: "A",
      entryRetests: 2,
      maxRReached: 2.5,
      riskMultiplier: 0.5,
      emotionBeforeId: vocab.emotion[0],
      emotionAfterId: null,
      rationale: "VAL reclaim with acceptance",
      reflection: { lesson: "Wait for the retest" },
      reviewedAt: null, // nothing review-ish filled yet
    });
    expect(d.journal?.htfTimeframes).toEqual(["4H", "1D"]);
    expect(d.selected.confluences.sort()).toEqual([vocab.confluence[0], vocab.confluence[3]].sort());
    expect(d.selected.slReasons).toEqual([vocab.sl_reason[1]]);
    expect(d.selected.tpReasons).toEqual([vocab.tp_reason[2]]);
    expect(d.tags).toEqual(["A-Setup", "fomc"]);
    expect(d.vocab.confluence.length).toBeGreaterThan(50);
    expect(d.categories.some((c) => c.kind === "confluence" && c.name === "VWAP")).toBe(true);
  });

  test("tags are reused across trades case-insensitively; replaced on re-save", async () => {
    const db = getDb();
    await saveTrade(db, accountId, tradeId, base());
    await saveTrade(db, accountId, tradeId, base({ notes: { ...base().notes!, tags: ["a-SETUP", "range"] } }));
    expect((await db.select().from(s.tags)).map((t) => t.name).sort()).toEqual(["A-Setup", "fomc", "range"]);
    expect((await loadTradeForEdit(db, accountId, tradeId))!.tags).toEqual(["A-Setup", "range"]);
    expect((await loadTradeForEdit(db, accountId, tradeId))!.tagSuggestions).toContain("fomc");
  });

  test("reviewedAt is stamped the first time review data appears, then kept", async () => {
    const db = getDb();
    await saveTrade(db, accountId, tradeId, base());
    const review = { ...base().notes!, rulesFollowed: "yes" as const, exitReasonId: vocab.exit_reason[0], mistakes: [vocab.mistake[1]] };
    await saveTrade(db, accountId, tradeId, base({ notes: review }));
    const first = (await loadTradeForEdit(db, accountId, tradeId))!;
    expect(first.journal?.reviewedAt).toBeGreaterThan(0);
    expect(first.journal?.exitReasonId).toBe(vocab.exit_reason[0]);
    expect(first.selected.mistakes).toEqual([vocab.mistake[1]]);
    await new Promise((r) => setTimeout(r, 5));
    await saveTrade(db, accountId, tradeId, base({ notes: { ...review, postNotes: "Exited early" } }));
    expect((await loadTradeForEdit(db, accountId, tradeId))!.journal?.reviewedAt).toBe(first.journal?.reviewedAt);
  });

  test("a payload without analysis/notes leaves them untouched (older clients)", async () => {
    const db = getDb();
    await saveTrade(db, accountId, tradeId, base());
    const { analysis: _a, notes: _n, ...basicOnly } = base({ stopLoss: 2960 });
    void _a;
    void _n;
    await saveTrade(db, accountId, tradeId, basicOnly);
    const d = (await loadTradeForEdit(db, accountId, tradeId))!;
    expect(d.journal?.stopLoss).toBe(2960);
    expect(d.journal?.grade).toBe("A");
    expect(d.selected.confluences).toHaveLength(2);
    expect(d.tags).toHaveLength(2);
  });

  test("everything survives a re-sync rebuild", async () => {
    const db = getDb();
    await saveTrade(db, accountId, tradeId, base());
    await rebuildTrades(db, { walletId, accountId });
    const d = (await loadTradeForEdit(db, accountId, tradeId))!;
    expect(d.journal?.grade).toBe("A");
    expect(d.selected.confluences).toHaveLength(2);
    expect(d.tags).toEqual(["A-Setup", "fomc"]);
  });

  test("invalid analysis values are rejected", async () => {
    const db = getDb();
    const bad = (a: Partial<NonNullable<TradeInput["analysis"]>>) => saveTrade(db, accountId, tradeId, { ...base(), analysis: { ...base().analysis!, ...a } });
    expect((await bad({ entryRetests: 99 })).ok).toBe(false);
    expect((await bad({ riskMultiplier: 0 })).ok).toBe(false);
    expect((await bad({ entryTimeframe: "7m" as never })).ok).toBe(false);
    expect((await saveTrade(db, accountId, tradeId, { ...base(), notes: { ...base().notes!, tags: Array(21).fill("x") } })).ok).toBe(false);
  });
});

describe("screenshots", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tj-shots-"));
  const store = new LocalStorage(root);

  test("magic-byte sniffing", () => {
    expect(sniffImage(PNG)?.ext).toBe("png");
    expect(sniffImage(JPG)?.ext).toBe("jpg");
    expect(sniffImage(WEBP)?.ext).toBe("webp");
    expect(sniffImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("<!doctype html><script>"))).toBeNull();
  });

  test("add, caption, reorder and delete (removes the stored file)", async () => {
    const db = getDb();
    const a = await addScreenshot(db, store, { accountId, tradeId, bytes: PNG, width: 1600, height: 900, caption: " entry " });
    const b = await addScreenshot(db, store, { accountId, tradeId, bytes: WEBP });
    expect(a.url).toMatch(new RegExp(`^/api/files/screenshots/${tradeId}/[\\w-]+\\.png$`));
    expect(b.url.endsWith(".webp")).toBe(true);
    expect(a).toMatchObject({ caption: "entry", width: 1600, height: 900 });
    await updateCaption(db, accountId, b.id, "exit");
    await moveScreenshot(db, accountId, b.id, "left");
    const order = (await loadTradeForEdit(db, accountId, tradeId))!.screenshots;
    expect(order.map((x) => x.id)).toEqual([b.id, a.id]);
    expect(order[0].caption).toBe("exit");

    const key = a.url.replace("/api/files/", "");
    expect(await store.get(key)).not.toBeNull();
    await deleteScreenshot(db, store, accountId, a.id);
    expect(await store.get(key)).toBeNull();
    expect((await loadTradeForEdit(db, accountId, tradeId))!.screenshots.map((x) => x.id)).toEqual([b.id]);
  });

  test("rejects non-images, oversize files, other accounts and more than 20 per trade", async () => {
    const db = getDb();
    await expect(addScreenshot(db, store, { accountId, tradeId, bytes: new TextEncoder().encode("<svg/>") })).rejects.toMatchObject({ status: 422 });
    const huge = new Uint8Array(MAX_BYTES + 1);
    huge.set(PNG);
    await expect(addScreenshot(db, store, { accountId, tradeId, bytes: huge })).rejects.toMatchObject({ status: 413 });
    await expect(addScreenshot(db, store, { accountId: "someone-else", tradeId, bytes: PNG })).rejects.toMatchObject({ status: 404 });
    for (let i = 0; i < 20; i++) await addScreenshot(db, store, { accountId, tradeId, bytes: JPG });
    await expect(addScreenshot(db, store, { accountId, tradeId, bytes: JPG })).rejects.toMatchObject({ status: 409 });
    const shot = (await loadTradeForEdit(db, accountId, tradeId))!.screenshots[0];
    await expect(deleteScreenshot(db, store, "someone-else", shot.id)).rejects.toMatchObject({ status: 404 });
  });
});
