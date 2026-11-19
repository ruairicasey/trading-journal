import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import { useTempDb } from "./helpers/db";
import { getDb } from "@/server/db/client";
import { runMigrations, seedDefaults } from "@/server/db/bootstrap";
import * as s from "@/server/db/schema";
import { insertFills, rebuildTrades } from "@/server/reconstruct/persist";
import { saveTradeReview, type ReviewFields } from "@/server/trades/review";
import { DEMO_WALLET, resetTids, sim } from "./fixtures/fills";

let accountId: string;
let tradeId: string;
const vocab: Record<string, string[]> = {};

beforeAll(async () => {
  useTempDb();
  const db = getDb();
  await runMigrations(db);
  await seedDefaults(db);
  accountId = (await db.select().from(s.accounts))[0].id;
  for (const k of ["mistake", "emotion", "exit_reason", "confluence"]) {
    vocab[k] = (await db.select().from(s.vocabItems).where(eq(s.vocabItems.kind, k as s.VocabKind))).map((v) => v.id);
  }
});

beforeEach(async () => {
  resetTids();
  const db = getDb();
  for (const t of [s.tradeVocab, s.tradeJournal, s.tradeFills, s.trades, s.fills, s.wallets]) await db.delete(t);
  const [{ id: walletId }] = await db.insert(s.wallets).values({ accountId, address: DEMO_WALLET }).returning({ id: s.wallets.id });
  await insertFills(db, walletId, sim("ETH").buy(2, 3000, 0).sell(2, 3060, 45).fills);
  await rebuildTrades(db, { walletId, accountId });
  tradeId = (await db.select().from(s.trades))[0].id;
});

const empty: ReviewFields = {
  grade: null,
  strategyId: null,
  emotionBeforeId: null,
  emotionAfterId: null,
  exitReasonId: null,
  mistakes: [],
  postNotes: null,
};
const journal = async () => (await getDb().query.tradeJournal.findFirst({ where: eq(s.tradeJournal.tradeId, tradeId) }))!;
const mistakes = async () =>
  (await getDb().select().from(s.tradeVocab).where(and(eq(s.tradeVocab.tradeId, tradeId), eq(s.tradeVocab.kind, "mistake")))).map((r) => r.itemId);

describe("review flow save", () => {
  test("marks the trade reviewed once, even when only the grade was set", async () => {
    const r1 = await saveTradeReview(getDb(), accountId, tradeId, { ...empty, grade: "B" }, empty, 1000);
    expect(r1).toEqual({ ok: true, reviewedAt: 1000 });
    expect(await journal()).toMatchObject({ grade: "B", reviewedAt: 1000 });
    const r2 = await saveTradeReview(getDb(), accountId, tradeId, { ...empty, grade: "A" }, { ...empty, grade: "B" }, 2000);
    expect(r2).toEqual({ ok: true, reviewedAt: 1000 });
    expect((await journal()).grade).toBe("A");
  });

  test("never touches fields it didn't change, including ones edited elsewhere since the flow loaded", async () => {
    const db = getDb();
    // the owner edits rationale, grade, a mistake and the stop in another tab after the flow loaded `empty`
    await db.insert(s.tradeJournal).values({ tradeId, rationale: "Edited elsewhere", grade: "C", stopLoss: 2950, stopLossSource: "user" });
    await db.insert(s.tradeVocab).values({ tradeId, itemId: vocab.mistake[0], kind: "mistake" });
    await db.insert(s.tradeVocab).values({ tradeId, itemId: vocab.confluence[0], kind: "confluence" });
    // the flow only changes the notes
    const res = await saveTradeReview(db, accountId, tradeId, { ...empty, postNotes: "Late entry" }, empty);
    expect(res.ok).toBe(true);
    expect(await journal()).toMatchObject({ rationale: "Edited elsewhere", grade: "C", stopLoss: 2950, stopLossSource: "user", postNotes: "Late entry" });
    expect(await mistakes()).toEqual([vocab.mistake[0]]);
    const conf = await db.select().from(s.tradeVocab).where(and(eq(s.tradeVocab.tradeId, tradeId), eq(s.tradeVocab.kind, "confluence")));
    expect(conf).toHaveLength(1);
  });

  test("clearing a field in the flow clears it; mistakes are replaced as a set", async () => {
    const db = getDb();
    const before = { ...empty, exitReasonId: vocab.exit_reason[0], mistakes: [vocab.mistake[0]] };
    await saveTradeReview(db, accountId, tradeId, before, empty);
    expect(await mistakes()).toEqual([vocab.mistake[0]]);
    await saveTradeReview(db, accountId, tradeId, { ...before, exitReasonId: null, mistakes: [vocab.mistake[1]] }, before);
    expect((await journal()).exitReasonId).toBeNull();
    expect(await mistakes()).toEqual([vocab.mistake[1]]);
  });

  test("rejects wrong-kind vocab, other accounts and deleted trades", async () => {
    const db = getDb();
    expect(await saveTradeReview(db, accountId, tradeId, { ...empty, mistakes: [vocab.confluence[0]] }, empty)).toMatchObject({ ok: false });
    expect(await saveTradeReview(db, accountId, tradeId, { ...empty, emotionAfterId: vocab.mistake[0] }, empty)).toMatchObject({ ok: false });
    expect(await saveTradeReview(db, "other", tradeId, { ...empty, grade: "A" }, empty)).toMatchObject({ ok: false });
    await db.update(s.trades).set({ deletedAt: 1 }).where(eq(s.trades.id, tradeId));
    expect(await saveTradeReview(db, accountId, tradeId, { ...empty, grade: "A" }, empty)).toMatchObject({ ok: false });
    expect(await db.query.tradeJournal.findFirst({ where: eq(s.tradeJournal.tradeId, tradeId) })).toBeUndefined();
  });
});
