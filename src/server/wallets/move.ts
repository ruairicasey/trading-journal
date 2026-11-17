import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";

/**
 * Move a wallet and its trades to another (non-archived) account in one transaction. Only trades still on the
 * wallet's current account move: one you put on a different account yourself (trade form) stays there.
 * Deleted and superseded trades move too (they belong to the wallet); the count is of the live ones, as shown.
 */
export async function moveWalletTo(db: DB, walletId: string, accountId: string): Promise<{ trades: number }> {
  return db.transaction(async (tx) => {
    const [wallet] = await tx.select({ id: s.wallets.id, accountId: s.wallets.accountId }).from(s.wallets).where(eq(s.wallets.id, walletId));
    if (!wallet) throw new Error("That wallet no longer exists.");
    const [account] = await tx
      .select({ id: s.accounts.id })
      .from(s.accounts)
      .where(and(eq(s.accounts.id, accountId), eq(s.accounts.archived, false)));
    if (!account) throw new Error("Pick an active journal account.");
    if (wallet.accountId === accountId) return { trades: 0 };
    await tx.update(s.wallets).set({ accountId }).where(eq(s.wallets.id, walletId));
    const moved = await tx
      .update(s.trades)
      .set({ accountId })
      .where(and(eq(s.trades.walletId, walletId), eq(s.trades.accountId, wallet.accountId)))
      .returning({ deletedAt: s.trades.deletedAt, flags: s.trades.flags });
    return { trades: moved.filter((t) => t.deletedAt === null && !(t.flags as { superseded?: boolean } | null)?.superseded).length };
  });
}
