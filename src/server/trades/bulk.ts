/**
 * Bulk actions on the Trades page. Each one runs in a single transaction on the trades of ONE account (ids from
 * another account, deleted or unknown are skipped) and writes journal fields only: the owner is choosing these
 * values, and sync never writes them.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { GRADES } from "../../lib/enums";

export const BULK_MAX = 1000;
type Grade = (typeof GRADES)[number];

export class BulkError extends Error {}

/** The ids that belong to this account and aren't deleted (or, for restore, are deleted). */
async function owned(db: Pick<DB, "select">, accountId: string, ids: string[], deleted = false) {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return [];
  if (uniq.length > BULK_MAX) throw new BulkError(`Select up to ${BULK_MAX} trades at a time.`);
  const rows = await db
    .select({ id: s.trades.id })
    .from(s.trades)
    .where(
      and(
        eq(s.trades.accountId, accountId),
        inArray(s.trades.id, uniq),
        deleted ? sql`${s.trades.deletedAt} is not null` : isNull(s.trades.deletedAt),
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * One multi-row upsert (not a statement per trade): a few round trips to Turso however many trades are selected.
 * Only the chosen field (and updated_at) is written on trades that already have a journal row.
 */
async function setJournal(db: DB, accountId: string, ids: string[], set: { grade?: Grade | null; strategyId?: string | null }) {
  return db.transaction(async (tx) => {
    const mine = await owned(tx, accountId, ids);
    if (!mine.length) return 0;
    const now = Date.now();
    const update: Record<string, unknown> = { updatedAt: sql`excluded.updated_at` };
    for (const k of Object.keys(set) as (keyof typeof set)[]) update[k] = sql.raw(`excluded.${s.tradeJournal[k].name}`);
    await tx
      .insert(s.tradeJournal)
      .values(mine.map((tradeId) => ({ tradeId, ...set, updatedAt: now })))
      .onConflictDoUpdate({ target: s.tradeJournal.tradeId, set: update });
    return mine.length;
  });
}

export async function bulkSetGrade(db: DB, accountId: string, ids: string[], grade: Grade | null) {
  if (grade !== null && !GRADES.includes(grade)) throw new BulkError("Unknown grade.");
  return setJournal(db, accountId, ids, { grade });
}

export async function bulkSetStrategy(db: DB, accountId: string, ids: string[], strategyId: string | null) {
  if (strategyId !== null) {
    const item = await db.query.vocabItems.findFirst({ where: and(eq(s.vocabItems.id, strategyId), eq(s.vocabItems.kind, "strategy"), eq(s.vocabItems.archived, false)) });
    if (!item) throw new BulkError("That strategy no longer exists.");
  }
  return setJournal(db, accountId, ids, { strategyId });
}

/** Adds the tag (reusing an existing one case-insensitively); trades that already have it are unchanged. */
export async function bulkAddTag(db: DB, accountId: string, ids: string[], name: string) {
  const tag = name.trim().replace(/^#/, "");
  if (!tag || tag.length > 40) throw new BulkError("A tag is 1–40 characters.");
  return db.transaction(async (tx) => {
    const mine = await owned(tx, accountId, ids);
    if (!mine.length) return 0;
    const found = await tx.query.tags.findFirst({ where: sql`lower(${s.tags.name}) = ${tag.toLowerCase()}` });
    const tagId = found?.id ?? (await tx.insert(s.tags).values({ name: tag }).returning({ id: s.tags.id }))[0].id;
    const added = await tx
      .insert(s.tradeTags)
      .values(mine.map((tradeId) => ({ tradeId, tagId })))
      .onConflictDoNothing()
      .returning({ id: s.tradeTags.tradeId });
    return added.length;
  });
}

/** Soft delete (a re-sync never brings them back); returns the ids deleted, for Undo. */
export async function bulkSoftDelete(db: DB, accountId: string, ids: string[], now = Date.now()) {
  return db.transaction(async (tx) => {
    const mine = await owned(tx, accountId, ids);
    if (mine.length) await tx.update(s.trades).set({ deletedAt: now }).where(inArray(s.trades.id, mine));
    return mine;
  });
}

export async function bulkRestore(db: DB, accountId: string, ids: string[]) {
  return db.transaction(async (tx) => {
    const mine = await owned(tx, accountId, ids, true);
    if (mine.length) await tx.update(s.trades).set({ deletedAt: null }).where(inArray(s.trades.id, mine));
    return mine.length;
  });
}
