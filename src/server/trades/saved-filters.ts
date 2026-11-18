/**
 * Custom saved filters on the Trades page: a name plus the URL filter values, in `saved_filters` (builtin = false;
 * the built-in chips are CHIPS in filters.ts). Stored values are re-parsed on read, so a value that's no longer
 * valid is dropped rather than breaking the page.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { FILTER_KEYS, parseFilters, type TradeFilters } from "./filters";

export const MAX_SAVED_FILTERS = 20;
/** what a saved filter keeps: the tab, the search, every filter and which date the range applies to (never the page) */
const SAVED_KEYS = ["tab", "q", "dateBy", ...FILTER_KEYS] as const;

export type SavedFilter = { id: string; name: string; filters: Partial<TradeFilters> };

export class SavedFilterError extends Error {}

export function pickSaved(f: Partial<TradeFilters>): Partial<TradeFilters> {
  const out: Record<string, unknown> = {};
  for (const k of SAVED_KEYS) {
    const v = f[k];
    if (v === undefined || v === null || v === "" || (k === "tab" && v === "all")) continue;
    out[k] = v;
  }
  return out as Partial<TradeFilters>;
}

export async function listSavedFilters(db: DB): Promise<SavedFilter[]> {
  const rows = await db
    .select()
    .from(s.savedFilters)
    .where(eq(s.savedFilters.builtin, false))
    .orderBy(asc(s.savedFilters.sort), asc(s.savedFilters.name));
  return rows.map((r) => {
    const raw = Object.fromEntries(Object.entries(r.query ?? {}).map(([k, v]) => [k, v === null || v === undefined ? undefined : String(v)]));
    return { id: r.id, name: r.name, filters: pickSaved(parseFilters(raw)) };
  });
}

/** Saves the filters under a name; saving under an existing name (any case) replaces that one. */
export async function saveFilter(db: DB, name: string, f: Partial<TradeFilters>) {
  const label = name.trim();
  if (!label || label.length > 40) throw new SavedFilterError("A name is 1–40 characters.");
  const query = pickSaved(f);
  if (!Object.keys(query).length) throw new SavedFilterError("Set a filter or a search first.");
  return db.transaction(async (tx) => {
    const same = await tx.query.savedFilters.findFirst({
      where: and(eq(s.savedFilters.builtin, false), sql`lower(${s.savedFilters.name}) = ${label.toLowerCase()}`),
    });
    if (same) {
      await tx.update(s.savedFilters).set({ name: label, query }).where(eq(s.savedFilters.id, same.id));
      return same.id;
    }
    const [{ n, max }] = await tx
      .select({ n: sql<number>`count(*)`, max: sql<number>`coalesce(max(${s.savedFilters.sort}), -1)` })
      .from(s.savedFilters)
      .where(eq(s.savedFilters.builtin, false));
    if (Number(n) >= MAX_SAVED_FILTERS) throw new SavedFilterError(`Up to ${MAX_SAVED_FILTERS} saved filters; remove one first.`);
    const [row] = await tx.insert(s.savedFilters).values({ name: label, query, builtin: false, sort: Number(max) + 1 }).returning({ id: s.savedFilters.id });
    return row.id;
  });
}

export async function deleteSavedFilter(db: DB, id: string) {
  const res = await db
    .delete(s.savedFilters)
    .where(and(eq(s.savedFilters.id, id), eq(s.savedFilters.builtin, false)))
    .returning({ id: s.savedFilters.id });
  return res.length === 1;
}
