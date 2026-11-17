import { normalizeSessions, type SessionDef } from "../../../lib/sessions";
import { asc, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "../client";
import * as s from "../schema";

export const ACTIVE_ACCOUNT_COOKIE = "tj_account";
/** The wallet chosen in the sidebar switcher; absent (or not on the active account) = all wallets. */
export const ACTIVE_WALLET_COOKIE = "tj_wallet";

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

export type WalletOption = { id: string; label: string; kind: string; enabled: boolean };

/**
 * The active account plus the wallet scope inside it. `walletId` is null for "All wallets", and always
 * belongs to the active account (a stale cookie from another account, or a moved wallet, reads as all).
 */
export async function getActiveScope() {
  const { accounts, active } = await getActiveAccount();
  const wallets: WalletOption[] = active
    ? await getDb()
        .select({ id: s.wallets.id, label: s.wallets.label, kind: s.wallets.kind, enabled: s.wallets.enabled })
        .from(s.wallets)
        .where(eq(s.wallets.accountId, active.id))
        .orderBy(asc(s.wallets.createdAt), asc(s.wallets.id))
    : [];
  const chosen = (await cookies()).get(ACTIVE_WALLET_COOKIE)?.value;
  const wallet = wallets.length > 1 ? (wallets.find((w) => w.id === chosen) ?? null) : null;
  return { accounts, active, wallets, wallet, walletId: wallet?.id ?? null };
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await getDb().query.settings.findFirst({ where: eq(s.settings.key, key) });
  return (row?.value as T | undefined) ?? fallback;
}

/** Session definitions, normalised (old fixed-UTC shapes read as UTC; untouched old defaults upgraded). */
export async function getSessions(): Promise<SessionDef[]> {
  return normalizeSessions(await getSetting<unknown>("sessions", null));
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
