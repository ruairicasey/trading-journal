import { sql } from "drizzle-orm";
import { WalletsEditor } from "@/components/settings/wallets-editor";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { getSetting, listAccounts } from "@/server/db/queries/settings";
import * as s from "@/server/db/schema";
import { recentRuns } from "@/server/hyperliquid/sync";

export default async function WalletsPage() {
  const db = getDb();
  const [wallets, accounts, timezone] = await Promise.all([
    db.select().from(s.wallets).orderBy(s.wallets.createdAt),
    listAccounts(),
    getSetting("timezone", getConfig().timezone),
  ]);
  const [lighter, runs, fillCounts, tradeCounts] = await Promise.all([
    // never the token itself, only whether there is one and until when
    db
      .select({
        walletId: s.lighterState.walletId,
        hasToken: sql<number>`${s.lighterState.tokenEnc} is not null`,
        expiresAt: s.lighterState.tokenExpiresAt,
        reconciledAt: s.lighterState.reconciledAt,
      })
      .from(s.lighterState),
    recentRuns(
      db,
      wallets.map((w) => w.id),
      15,
    ),
    db.select({ walletId: s.fills.walletId, n: sql<number>`count(*)` }).from(s.fills).groupBy(s.fills.walletId),
    db
      .select({ walletId: s.trades.walletId, n: sql<number>`count(*)` })
      .from(s.trades)
      // trades on the wallet's own account: the ones a move takes with it (not ones you put on another account)
      .innerJoin(s.wallets, sql`${s.wallets.id} = ${s.trades.walletId} and ${s.wallets.accountId} = ${s.trades.accountId}`)
      .where(sql`${s.trades.deletedAt} is null and coalesce(json_extract(${s.trades.flags}, '$.superseded'), 0) = 0`)
      .groupBy(s.trades.walletId),
  ]);
  const fillsBy = new Map(fillCounts.map((r) => [r.walletId, Number(r.n)]));
  const tradesBy = new Map(tradeCounts.map((r) => [r.walletId, Number(r.n)]));
  const lighterBy = new Map(lighter.map((l) => [l.walletId, l]));
  const labelBy = new Map(wallets.map((w) => [w.id, w.label]));

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        Add a Hyperliquid wallet address to import its fills. An address gives <strong>read-only</strong> access to
        public on-chain data; never enter a private key. Addresses are stored only in your private database. A Lighter
        account needs a <strong>read-only token</strong> instead: it can&apos;t trade or withdraw, and it&apos;s stored
        encrypted.
      </p>
      <WalletsEditor
        isDemo={getConfig().isDemo}
        timezone={timezone}
        accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
        wallets={wallets.map((w) => ({
          id: w.id,
          exchange: w.exchange,
          accountIndex: w.accountIndex,
          lighter: lighterBy.has(w.id)
            ? {
                hasToken: !!lighterBy.get(w.id)!.hasToken,
                expiresAt: lighterBy.get(w.id)!.expiresAt,
                reconciledAt: lighterBy.get(w.id)!.reconciledAt,
              }
            : null,
          address: w.address,
          label: w.label,
          kind: w.kind,
          accountId: w.accountId,
          enabled: w.enabled,
          autoSync: w.autoSync,
          lastSyncedAt: w.lastSyncedAt,
          lastSuccessAt: w.lastSuccessAt,
          oldestFillTime: w.oldestFillTime,
          lastFillTime: w.lastFillTime,
          backfillCompletedAt: w.backfillCompletedAt,
          historyTruncated: w.historyTruncated,
          fills: fillsBy.get(w.id) ?? 0,
          trades: tradesBy.get(w.id) ?? 0,
        }))}
        runs={runs.map((r) => ({
          id: r.id,
          wallet: labelBy.get(r.walletId) ?? "?",
          trigger: r.trigger,
          status: r.status,
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
          pages: r.pages,
          fillsNew: r.fillsNew,
          tradesTouched: r.tradesTouched,
          gapsDetected: r.gapsDetected,
          done: r.done,
          error: r.error,
        }))}
      />
    </div>
  );
}
