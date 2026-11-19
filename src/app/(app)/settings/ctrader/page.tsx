import { sql } from "drizzle-orm";
import { CtraderSettings } from "@/components/settings/ctrader-settings";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { getSetting, listAccounts } from "@/server/db/queries/settings";
import * as s from "@/server/db/schema";

export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function CtraderPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const cfg = getConfig();
  const db = getDb();
  const [conn, accts, journalAccounts, timezone, counts] = await Promise.all([
    db.query.ctraderConnections.findFirst(),
    db.select().from(s.ctraderAccounts).orderBy(s.ctraderAccounts.createdAt),
    listAccounts(),
    getSetting("timezone", cfg.timezone),
    db
      .select({ ctid: s.ctraderDeals.ctid, n: sql<number>`count(*)` })
      .from(s.ctraderDeals)
      .groupBy(s.ctraderDeals.ctid),
  ]);
  const dealsBy = new Map(counts.map((c) => [c.ctid, Number(c.n)]));
  return (
    <CtraderSettings
      isDemo={cfg.isDemo}
      configured={cfg.ctrader.configured}
      timezone={timezone}
      flash={{
        connected: one(sp.connected) ?? null,
        added: one(sp.added) ?? null,
        error: one(sp.error) ?? null,
      }}
      connection={
        conn ? { since: conn.createdAt, expiresAt: conn.accessExpiresAt, lastError: conn.lastError } : null
      }
      journalAccounts={journalAccounts.map((a) => ({ id: a.id, name: a.name }))}
      accounts={accts.map((a) => ({
        ctid: a.ctid,
        login: a.traderLogin,
        broker: a.broker,
        isLive: a.isLive,
        currency: a.currency,
        accountId: a.accountId,
        enabled: a.enabled,
        connected: !!a.connectionId,
        lastSyncedAt: a.lastSyncedAt,
        lastSuccessAt: a.lastSuccessAt,
        lastError: a.lastError,
        dealsSyncedTo: a.dealsSyncedTo,
        deals: dealsBy.get(a.ctid) ?? 0,
      }))}
    />
  );
}
