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
  const [runs, fillCounts, tradeCounts] = await Promise.all([
    recentRuns(
      db,
      wallets.map((w) => w.id),
      15,
    ),
    db.select({ walletId: s.fills.walletId, n: sql<number>`count(*)` }).from(s.fills).groupBy(s.fills.walletId),
    db
      .select({ walletId: s.trades.walletId, n: sql<number>`count(*)` })
      .from(s.trades)
      .where(sql`${s.trades.deletedAt} is null and coalesce(json_extract(${s.trades.flags}, '$.superseded'), 0) = 0`)
      .groupBy(s.trades.walletId),
  ]);
  const fillsBy = new Map(fillCounts.map((r) => [r.walletId, Number(r.n)]));
  const tradesBy = new Map(tradeCounts.map((r) => [r.walletId, Number(r.n)]));
  const labelBy = new Map(wallets.map((w) => [w.id, w.label]));

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        Add a Hyperliquid wallet address to import its fills. An address gives <strong>read-only</strong> access to
        public on-chain data; never enter a private key. Addresses are stored only in your private database.
      </p>
      <WalletsEditor
        isDemo={getConfig().isDemo}
        timezone={timezone}
        accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
        wallets={wallets.map((w) => ({
          id: w.id,
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
