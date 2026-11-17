/**
 * Non-funding ledger sync (deposits, withdrawals, transfers, vault flows) → ledger_events. Resumable like
 * funding: ≤2000 entries per page, ascending, inclusive start; the cursor is saved after every page and a
 * call keeps to the time budget. Entries are classified for the wallet's account mode; if the mode changes,
 * every stored entry is re-classified.
 */
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import type { HlClient } from "./client";
import { classifyLedger } from "./ledger";
import { LEDGER_PAGE_LIMIT, type HlLedgerEntry } from "./schemas";

type Wallet = typeof s.wallets.$inferSelect;

const stable = (v: unknown): string =>
  v && typeof v === "object" && !Array.isArray(v)
    ? `{${Object.keys(v as object)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
        .join(",")}}`
    : JSON.stringify(v);

/** Stable identity of an entry: one transaction hash can carry several entries. */
export const ledgerUid = (e: HlLedgerEntry) => createHash("sha256").update(`${e.time}|${e.hash}|${stable(e.delta)}`).digest("hex").slice(0, 32);

export async function reclassifyLedger(db: DB, wallet: Pick<Wallet, "id" | "address">, unified: boolean) {
  const rows = await db.select().from(s.ledgerEvents).where(eq(s.ledgerEvents.walletId, wallet.id));
  let changed = 0;
  for (const r of rows) {
    const c = classifyLedger({ time: r.time, hash: r.hash, delta: r.delta as HlLedgerEntry["delta"] }, wallet.address, { unified });
    if (c.kind !== r.kind || Math.abs(c.perpUsd - r.usd) > 1e-9) {
      await db.update(s.ledgerEvents).set({ kind: c.kind, usd: c.perpUsd }).where(and(eq(s.ledgerEvents.walletId, wallet.id), eq(s.ledgerEvents.uid, r.uid)));
      changed++;
    }
  }
  return changed;
}

export async function syncLedger(
  db: DB,
  client: HlClient,
  wallet: Wallet,
  ctx: { outOfTime: () => boolean; onProgress?: (detail: string) => void },
): Promise<{ done: boolean; pages: number; inserted: number; mode: string | null }> {
  // account mode decides how spot transfers count; keep the stored one if the lookup fails
  let mode = wallet.accountMode ?? null;
  try {
    mode = await client.userAbstraction(wallet.address);
  } catch {
    /* keep the stored mode */
  }
  const unified = mode === "unifiedAccount";
  if (mode !== (wallet.accountMode ?? null)) {
    await db.update(s.wallets).set({ accountMode: mode }).where(eq(s.wallets.id, wallet.id));
    await reclassifyLedger(db, wallet, unified);
  }

  const fresh = await db.query.wallets.findFirst({ where: eq(s.wallets.id, wallet.id) });
  let start = fresh?.lastLedgerTime ?? 0;
  let pages = 0;
  let inserted = 0;
  for (;;) {
    if (pages > 0 && ctx.outOfTime()) return { done: false, pages, inserted, mode };
    const page = await client.userNonFundingLedgerUpdates(wallet.address, start);
    pages++;
    if (page.length) {
      const rows = page.map((e) => {
        const c = classifyLedger(e, wallet.address, { unified });
        return { walletId: wallet.id, uid: ledgerUid(e), time: e.time, hash: e.hash, type: String(e.delta.type), delta: e.delta, kind: c.kind, usd: c.perpUsd };
      });
      for (let i = 0; i < rows.length; i += 100) {
        const res = await db.insert(s.ledgerEvents).values(rows.slice(i, i + 100)).onConflictDoNothing().returning({ uid: s.ledgerEvents.uid });
        inserted += res.length;
      }
    }
    const done = page.length < LEDGER_PAGE_LIMIT;
    if (page.length) {
      const last = page[page.length - 1].time;
      start = !done && last <= start ? start + 1 : last;
    }
    await db
      .update(s.wallets)
      .set({ lastLedgerTime: start, ...(done && !fresh?.ledgerCompletedAt ? { ledgerCompletedAt: Date.now() } : {}) })
      .where(eq(s.wallets.id, wallet.id));
    ctx.onProgress?.(`${inserted} new ledger entr${inserted === 1 ? "y" : "ies"}`);
    if (done) return { done: true, pages, inserted, mode };
  }
}
