import { asc, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "../client";
import * as s from "../schema";

export const ACTIVE_ACCOUNT_COOKIE = "tj_account";

export async function listAccounts() {
  return getDb()
    .select()
    .from(s.accounts)
    .where(eq(s.accounts.archived, false))
    .orderBy(asc(s.accounts.sort), asc(s.accounts.createdAt));
}

/** The account chosen in the sidebar switcher (cookie), falling back to the first account. */
export async function getActiveAccount() {
  const all = await listAccounts();
  const chosen = (await cookies()).get(ACTIVE_ACCOUNT_COOKIE)?.value;
  return { accounts: all, active: all.find((a) => a.id === chosen) ?? all[0] ?? null };
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await getDb().query.settings.findFirst({ where: eq(s.settings.key, key) });
  return (row?.value as T | undefined) ?? fallback;
}

export async function setSetting(key: string, value: unknown) {
  await getDb()
    .insert(s.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: s.settings.key, set: { value, updatedAt: Date.now() } });
}

export async function listVocab(kind: s.VocabKind) {
  const db = getDb();
  const [categories, items] = await Promise.all([
    db
      .select()
      .from(s.vocabCategories)
      .where(eq(s.vocabCategories.kind, kind))
      .orderBy(asc(s.vocabCategories.sort), asc(s.vocabCategories.name)),
    db
      .select()
      .from(s.vocabItems)
      .where(eq(s.vocabItems.kind, kind))
      .orderBy(asc(s.vocabItems.sort), asc(s.vocabItems.label)),
  ]);
  return { categories, items };
}

export type VocabList = Awaited<ReturnType<typeof listVocab>>;
