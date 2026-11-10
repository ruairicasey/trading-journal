import { desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../client";
import * as s from "../schema";

/** Scheduled sync runs hourly and GitHub can delay runs, so warn only after 3 hours without a success. */
export const STALE_AFTER_MS = 3 * 60 * 60_000;

export type SyncStatus = Awaited<ReturnType<typeof getSyncStatus>>;

/** Everything the header widget and Settings → Wallets need, in one query batch. */
export async function getSyncStatus(now = Date.now()) {
  const db = getDb();
  const wallets = await db.select().from(s.wallets).where(eq(s.wallets.enabled, true));
  const ids = wallets.map((w) => w.id);
  const [lastRun] = ids.length
    ? await db.select().from(s.syncRuns).where(inArray(s.syncRuns.walletId, ids)).orderBy(desc(s.syncRuns.startedAt)).limit(1)
    : [];
  const [flagCounts] = ids.length
    ? await db
        .select({
          gaps: sql<number>`sum(case when json_extract(${s.trades.flags}, '$.gap') = 1 and ${s.trades.deletedAt} is null then 1 else 0 end)`,
          partial: sql<number>`sum(case when json_extract(${s.trades.flags}, '$.partialHistory') = 1 and ${s.trades.deletedAt} is null then 1 else 0 end)`,
          superseded: sql<number>`sum(case when json_extract(${s.trades.flags}, '$.superseded') = 1 then 1 else 0 end)`,
        })
        .from(s.trades)
        .where(inArray(s.trades.walletId, ids))
    : [];
  const autoMinutesRow = await db.query.settings.findFirst({ where: eq(s.settings.key, "auto_sync_minutes") });

  const lastSuccessAt = wallets.reduce<number | null>((m, w) => (w.lastSuccessAt && (!m || w.lastSuccessAt < m) ? w.lastSuccessAt : m), null);
  const neverSynced = wallets.some((w) => !w.lastSuccessAt);
  return {
    hasWallets: wallets.length > 0,
    autoSync: wallets.some((w) => w.autoSync),
    autoSyncMinutes: Number(autoMinutesRow?.value ?? 5),
    lastSyncedAt: wallets.reduce<number | null>((m, w) => (w.lastSyncedAt && (!m || w.lastSyncedAt > m) ? w.lastSyncedAt : m), null),
    /** oldest "last success" across wallets — the one that matters for staleness */
    lastSuccessAt,
    stale: wallets.length > 0 && (neverSynced || !lastSuccessAt || now - lastSuccessAt > STALE_AFTER_MS),
    lastRun: lastRun
      ? {
          status: lastRun.status,
          startedAt: lastRun.startedAt,
          fillsNew: lastRun.fillsNew,
          tradesTouched: lastRun.tradesTouched,
          gapsDetected: lastRun.gapsDetected,
          done: lastRun.done,
          error: lastRun.error,
        }
      : null,
    backfillPending: wallets.some((w) => !w.backfillCompletedAt),
    historyTruncated: wallets.some((w) => w.historyTruncated),
    gapTrades: Number(flagCounts?.gaps ?? 0),
    partialHistoryTrades: Number(flagCounts?.partial ?? 0),
    supersededTrades: Number(flagCounts?.superseded ?? 0),
  };
}
