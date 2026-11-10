/**
 * Trade and note mutations (plain functions so they're unit-testable; wrapped by server actions).
 * Synced trades are only ever SOFT-deleted, so a re-sync never brings them back and journal data survives.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { DB } from "../db/client";
import * as s from "../db/schema";

/** Vocab kinds that describe the setup (copied on duplicate). Review kinds (mistakes, checklist ticks) are not. */
const SETUP_VOCAB_KINDS: s.VocabKind[] = ["confluence", "sl_reason", "tp_reason"];

export async function softDeleteTrade(db: DB, accountId: string, id: string, now = Date.now()) {
  const res = await db
    .update(s.trades)
    .set({ deletedAt: now })
    .where(and(eq(s.trades.id, id), eq(s.trades.accountId, accountId), isNull(s.trades.deletedAt)))
    .returning({ id: s.trades.id });
  return res.length === 1;
}

export async function restoreTrade(db: DB, accountId: string, id: string) {
  const res = await db
    .update(s.trades)
    .set({ deletedAt: null })
    .where(and(eq(s.trades.id, id), eq(s.trades.accountId, accountId)))
    .returning({ id: s.trades.id });
  return res.length === 1;
}

/** Copy a trade as a new MANUAL, PLANNED trade with its setup (not its execution or review). */
export async function duplicateAsPlanned(db: DB, accountId: string, id: string): Promise<string | null> {
  const src = await db.query.trades.findFirst({ where: and(eq(s.trades.id, id), eq(s.trades.accountId, accountId)) });
  if (!src) return null;
  const journal = await db.query.tradeJournal.findFirst({ where: eq(s.tradeJournal.tradeId, id) });
  const newId = nanoid();
  await db.transaction(async (tx) => {
    await tx.insert(s.trades).values({
      id: newId,
      accountId,
      walletId: null,
      source: "manual",
      externalKey: null,
      coin: src.coin,
      displayPair: src.displayPair,
      dex: src.dex,
      marketType: src.marketType,
      direction: src.direction,
      status: "planned",
      flags: {},
    });
    await tx.insert(s.tradeJournal).values({
      tradeId: newId,
      manualEntry: src.avgEntry,
      // setup only
      strategyId: journal?.strategyId ?? null,
      stopLoss: journal?.stopLoss ?? null,
      takeProfit: journal?.takeProfit ?? null,
      sizeMode: journal?.sizeMode ?? "position",
      entryTimeframe: journal?.entryTimeframe ?? null,
      timeframeClass: journal?.timeframeClass ?? null,
      htfTimeframes: journal?.htfTimeframes ?? [],
      tradeType: "planned",
    });
    const links = await tx
      .select()
      .from(s.tradeVocab)
      .where(and(eq(s.tradeVocab.tradeId, id), inArray(s.tradeVocab.kind, SETUP_VOCAB_KINDS)));
    if (links.length) {
      await tx.insert(s.tradeVocab).values(links.map((l) => ({ tradeId: newId, itemId: l.itemId, kind: l.kind })));
    }
  });
  return newId;
}

// ─── notes ───────────────────────────────────────────────────────────────────────────
export type NoteInput = { title?: string | null; body: string; date: number };

export async function createNote(db: DB, accountId: string, input: NoteInput) {
  const [row] = await db
    .insert(s.notes)
    .values({ accountId, title: input.title?.trim() || null, body: input.body, date: input.date })
    .returning({ id: s.notes.id });
  return row.id;
}

export async function updateNote(db: DB, accountId: string, id: string, input: NoteInput) {
  const res = await db
    .update(s.notes)
    .set({ title: input.title?.trim() || null, body: input.body, date: input.date })
    .where(and(eq(s.notes.id, id), eq(s.notes.accountId, accountId)))
    .returning({ id: s.notes.id });
  return res.length === 1;
}

export async function deleteNote(db: DB, accountId: string, id: string) {
  const res = await db
    .delete(s.notes)
    .where(and(eq(s.notes.id, id), eq(s.notes.accountId, accountId)))
    .returning({ id: s.notes.id });
  return res.length === 1;
}
