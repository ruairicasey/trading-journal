import { desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../client";
import * as s from "../schema";

/**
 * Scheduled sync runs hourly via GitHub Actions, which in practice drops many runs (observed gaps of 3–4.5h),
 * so only warn after 6 hours without a successful sync.
 */
export const STALE_AFTER_MS = 6 * 60 * 60_000;

export type SyncStatus = Awaited<ReturnType<typeof getSyncStatus>>;

/** Everything the header widget and Settings → Wallets need, in one query batch. */
export async function getSyncStatus(now = Date.now()) {
  const db = getDb();
  const wallets = await db.select().from(s.wallets).where(eq(s.wallets.enabled, true));
  const ids = wallets.map((w) => w.id);
  // the newest run of EACH wallet: one exchange's success must not hide another's failure
  const runs = await Promise.all(
    ids.map(async (id) => (await db.select().from(s.syncRuns).where(eq(s.syncRuns.walletId, id)).orderBy(desc(s.syncRuns.startedAt)).limit(1))[0]),
  );
  const labelOf = new Map(wallets.map((w) => [w.id, w.label]));
  const newest = runs.filter((r) => !!r).sort((a, b) => b.startedAt - a.startedAt);
  const failing = newest.filter((r) => r.status === "error");
  const lastRun = failing[0] ?? newest[0];
  const isStale = (w: (typeof wallets)[number]) => !w.lastSuccessAt || now - w.lastSuccessAt > STALE_AFTER_MS;
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
  return {
    hasWallets: wallets.length > 0,
    autoSync: wallets.some((w) => w.autoSync),
    autoSyncMinutes: Number(autoMinutesRow?.value ?? 5),
    lastSyncedAt: wallets.reduce<number | null>((m, w) => (w.lastSyncedAt && (!m || w.lastSyncedAt > m) ? w.lastSyncedAt : m), null),
    /** oldest "last success" across wallets — the one that matters for staleness */
    lastSuccessAt,
    stale: wallets.some(isStale),
    /** which wallets the warnings are about; empty with a single wallet, where it goes without saying */
    staleWallets: wallets.length > 1 ? wallets.filter(isStale).map((w) => w.label) : [],
    failedWallets: wallets.length > 1 ? failing.map((r) => labelOf.get(r.walletId) ?? "?") : [],
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
