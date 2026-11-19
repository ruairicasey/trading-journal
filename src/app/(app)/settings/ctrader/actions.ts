"use server";

import { and, eq, like } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { MAX_CSV_BYTES, previewCsv } from "@/server/ctrader/csv";
import {
  discoverAccounts,
  syncCtrader,
  TradeScopeRefused,
  upsertPositionTrades,
} from "@/server/ctrader/sync";
import { ctraderKey } from "@/server/ctrader/positions";

const live = () => {
  const cfg = getConfig();
  if (cfg.isDemo) throw new Error("cTrader is disabled for the demo account.");
  return cfg;
};

export async function refreshCtraderAccounts() {
  const cfg = live();
  if (!cfg.ctrader.configured) throw new Error("cTrader isn't configured yet.");
  try {
    const r = await discoverAccounts(getDb(), { cfg: cfg.ctrader });
    revalidatePath("/", "layout");
    return r;
  } catch (e) {
    if (e instanceof TradeScopeRefused) throw e;
    throw new Error(`Couldn't list your cTrader accounts: ${(e as Error).message}`);
  }
}

export async function syncCtraderNow() {
  const cfg = live();
  const r = await syncCtrader(getDb(), { cfg: cfg.ctrader, budgetMs: 40_000 });
  revalidatePath("/", "layout");
  return r;
}

/** Enable/disable syncing, or send the account's trades to another journal account (existing ones move with it). */
export async function updateCtraderAccount(input: { ctid: number; enabled?: boolean; accountId?: string }) {
  live();
  const p = z
    .object({
      ctid: z.number().int().positive(),
      enabled: z.boolean().optional(),
      accountId: z.string().min(1).max(64).optional(),
    })
    .parse(input);
  const db = getDb();
  const acct = await db.query.ctraderAccounts.findFirst({ where: eq(s.ctraderAccounts.ctid, p.ctid) });
  if (!acct) throw new Error("Unknown cTrader account.");
  if (p.accountId && p.accountId !== acct.accountId) {
    const target = await db.query.accounts.findFirst({ where: eq(s.accounts.id, p.accountId) });
    if (!target) throw new Error("Unknown journal account.");
    await db.transaction(async (tx) => {
      // its trades that are still on its old account (ones you moved elsewhere yourself stay put)
      await tx
        .update(s.trades)
        .set({ accountId: p.accountId! })
        .where(
          and(
            eq(s.trades.source, "ctrader"),
            eq(s.trades.accountId, acct.accountId),
            like(s.trades.externalKey, `${ctraderKey(acct.traderLogin ?? acct.ctid, "")}%`),
          ),
        );
      await tx
        .update(s.ctraderAccounts)
        .set({ accountId: p.accountId! })
        .where(eq(s.ctraderAccounts.ctid, p.ctid));
    });
  }
  if (p.enabled !== undefined)
    await db.update(s.ctraderAccounts).set({ enabled: p.enabled }).where(eq(s.ctraderAccounts.ctid, p.ctid));
  revalidatePath("/", "layout");
}

/** Forget the tokens. Accounts, deals and trades stay; connecting again picks up where it left off. */
export async function disconnectCtrader() {
  live();
  const db = getDb();
  await db.update(s.ctraderAccounts).set({ connectionId: null });
  await db.delete(s.ctraderConnections);
  revalidatePath("/", "layout");
}

const CsvInput = z.object({
  text: z.string().max(MAX_CSV_BYTES, "That file is over 900 KB: export a shorter date range."),
  accountId: z.string().min(1).max(64),
  login: z
    .string()
    .trim()
    .regex(/^\d{1,12}$/, "Enter the account's login number (digits only)."),
  tz: z.string().min(1).max(64),
  commit: z.boolean().default(false),
});

/** Preview (commit: false) or import (commit: true) a cTrader history CSV. Returns totals only, never file contents. */
export async function importCtraderCsv(input: z.input<typeof CsvInput>) {
  live();
  const p = CsvInput.parse(input);
  try {
    new Intl.DateTimeFormat("en", { timeZone: p.tz });
  } catch {
    throw new Error("Unknown timezone.");
  }
  const db = getDb();
  if (!(await db.query.accounts.findFirst({ where: eq(s.accounts.id, p.accountId) })))
    throw new Error("Unknown journal account.");
  const pre = previewCsv(p.text, { login: p.login, tz: p.tz });
  const summary = {
    rows: pre.rows,
    trades: pre.trades.length,
    net: pre.net,
    missing: pre.missing,
    issues: pre.issues.slice(0, 20),
    issueCount: pre.issues.length,
    first: pre.trades[0]?.exitTime ?? null,
    last: pre.trades.at(-1)?.exitTime ?? null,
  };
  if (!p.commit || pre.missing.length || !pre.trades.length) return { ...summary, imported: null };
  const r = await upsertPositionTrades(db, p.accountId, pre.trades, { imported: true });
  revalidatePath("/", "layout");
  return { ...summary, imported: { created: r.created, updated: r.updated, skipped: r.skipped } };
}
