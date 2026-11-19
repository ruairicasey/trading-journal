"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { getActiveAccount, getActiveScope, getSetting } from "@/server/db/queries/settings";
import { matchingTradeIds, searchEverything } from "@/server/db/queries/trades";
import * as bulk from "@/server/trades/bulk";
import { parseFilters } from "@/server/trades/filters";
import * as saved from "@/server/trades/saved-filters";
import * as m from "@/server/trades/mutations";

const id = z.string().min(1).max(64);

async function accountId() {
  const { active } = await getActiveAccount();
  if (!active) throw new Error("No account");
  return active.id;
}

function done() {
  revalidatePath("/trades");
  revalidatePath("/dashboard");
}

export async function deleteTradeAction(tradeId: string) {
  const ok = await m.softDeleteTrade(getDb(), await accountId(), id.parse(tradeId));
  done();
  return ok;
}

export async function restoreTradeAction(tradeId: string) {
  const ok = await m.restoreTrade(getDb(), await accountId(), id.parse(tradeId));
  done();
  return ok;
}

export async function duplicateTradeAction(tradeId: string) {
  const newId = await m.duplicateAsPlanned(getDb(), await accountId(), id.parse(tradeId));
  done();
  return newId;
}

const Note = z.object({
  title: z.string().trim().max(200).nullish(),
  body: z.string().max(20_000),
  date: z.number().int().min(0),
});

export async function saveNoteAction(input: { id?: string } & z.input<typeof Note>) {
  const { id: noteId, ...rest } = input;
  const p = Note.parse(rest);
  const acc = await accountId();
  if (noteId) await m.updateNote(getDb(), acc, id.parse(noteId), p);
  else await m.createNote(getDb(), acc, p);
  done();
}

export async function deleteNoteAction(noteId: string) {
  await m.deleteNote(getDb(), await accountId(), id.parse(noteId));
  done();
}

export async function commandSearchAction(q: string) {
  const query = z.string().trim().max(100).parse(q);
  const tz = await getSetting("timezone", getConfig().timezone);
  const { active, walletId } = await getActiveScope();
  if (!active) throw new Error("No account");
  return searchEverything(getDb(), active.id, query, { tz, walletId });
}

// ─── bulk actions ─────────────────────────────────────────────────────────────────────
const ids = z.array(id).max(bulk.BULK_MAX);
export type BulkResult = { ok: true; n: number; ids?: string[] } | { ok: false; error: string };

async function runBulk(fn: (acc: string) => Promise<number | string[]>): Promise<BulkResult> {
  try {
    const out = await fn(await accountId());
    done();
    revalidatePath("/analytics");
    return Array.isArray(out) ? { ok: true, n: out.length, ids: out } : { ok: true, n: out };
  } catch (e) {
    if (e instanceof bulk.BulkError || e instanceof z.ZodError)
      return { ok: false, error: e instanceof z.ZodError ? "Invalid selection" : e.message };
    throw e;
  }
}

export async function bulkAddTagAction(tradeIds: string[], tag: string) {
  return runBulk((acc) => bulk.bulkAddTag(getDb(), acc, ids.parse(tradeIds), z.string().max(60).parse(tag)));
}
export async function bulkSetGradeAction(tradeIds: string[], grade: string | null) {
  return runBulk((acc) =>
    bulk.bulkSetGrade(getDb(), acc, ids.parse(tradeIds), grade as Parameters<typeof bulk.bulkSetGrade>[3]),
  );
}
export async function bulkSetStrategyAction(tradeIds: string[], strategyId: string | null) {
  return runBulk((acc) =>
    bulk.bulkSetStrategy(
      getDb(),
      acc,
      ids.parse(tradeIds),
      strategyId === null ? null : id.parse(strategyId),
    ),
  );
}
export async function bulkDeleteAction(tradeIds: string[]) {
  return runBulk((acc) => bulk.bulkSoftDelete(getDb(), acc, ids.parse(tradeIds)));
}
export async function bulkRestoreAction(tradeIds: string[]) {
  return runBulk((acc) => bulk.bulkRestore(getDb(), acc, ids.parse(tradeIds)));
}

/** "Select all N matching": the ids for the current filters and wallet, across pages (capped at BULK_MAX + 1 so the UI can say "too many"). */
export async function matchingTradeIdsAction(params: Record<string, string>) {
  const tz = await getSetting("timezone", getConfig().timezone);
  const { active, walletId } = await getActiveScope();
  if (!active) throw new Error("No account");
  const f = parseFilters(z.record(z.string(), z.string().max(200)).parse(params));
  return matchingTradeIds(
    getDb(),
    active.id,
    { ...f, page: 1 },
    { tz, walletId, limit: bulk.BULK_MAX + 1, journalStart: active.journalStart },
  );
}

// ─── saved filters ────────────────────────────────────────────────────────────────────
export async function saveFilterAction(
  name: string,
  params: Record<string, string>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await saved.saveFilter(
      getDb(),
      z.string().max(60).parse(name),
      parseFilters(z.record(z.string(), z.string().max(200)).parse(params)),
    );
    revalidatePath("/trades");
    return { ok: true };
  } catch (e) {
    if (e instanceof saved.SavedFilterError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function deleteSavedFilterAction(filterId: string) {
  const ok = await saved.deleteSavedFilter(getDb(), id.parse(filterId));
  revalidatePath("/trades");
  return ok;
}
