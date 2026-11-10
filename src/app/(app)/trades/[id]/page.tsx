import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TradeForm } from "@/components/trade-form/trade-form";
import { cn } from "@/lib/utils";
import { fmtDateTime, fmtPct, fmtPrice, fmtSignedUsd, fmtSize, fmtUsd, pnlClass } from "@/lib/format";
import type { SessionDef } from "@/lib/sessions";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { getActiveAccount, getSetting } from "@/server/db/queries/settings";
import * as s from "@/server/db/schema";
import { DEFAULT_SESSIONS } from "@/server/db/seed-data";
import { loadTradeForEdit } from "@/server/trades/journal";

export default async function TradePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { active, accounts } = await getActiveAccount();
  if (!active) notFound();
  const db = getDb();
  const data = await loadTradeForEdit(db, active.id, id);
  if (!data) notFound();
  const { trade } = data;
  const [tz, sessions, legs] = await Promise.all([
    getSetting("timezone", getConfig().timezone),
    getSetting<SessionDef[]>("sessions", DEFAULT_SESSIONS),
    db.select().from(s.tradeFills).where(eq(s.tradeFills.tradeId, id)).orderBy(asc(s.tradeFills.time)),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link href="/trades" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs">
        <ArrowLeft className="size-3.5" /> Trades
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">{trade.displayPair}</h1>
        <Badge variant="outline" className={trade.direction === "long" ? "border-long/40 text-long" : "border-short/40 text-short"}>
          {trade.direction.toUpperCase()}
        </Badge>
        <Badge variant="secondary" className="capitalize">
          {trade.status}
        </Badge>
        <Badge variant="outline">{trade.source === "hyperliquid" ? "Synced from Hyperliquid" : "Manual"}</Badge>
        <div className="flex-1" />
        {trade.status !== "planned" && (
          <span className={cn("text-sm font-medium tabular-nums", pnlClass(trade.netPnl))}>
            {fmtSignedUsd(trade.netPnl)} <span className="text-xs">({fmtPct(trade.returnPct)})</span>
          </span>
        )}
      </div>

      <TradeForm
        data={data}
        tz={tz}
        sessions={sessions}
        accounts={accounts.map((a) => ({ id: a.id, name: a.name, startingBalance: a.startingBalance, standardRiskPct: a.standardRiskPct }))}
      />

      {legs.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Exchange fills ({legs.length})</h2>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground text-left">
                <tr>
                  {["Time", "Role", "Price", "Size", "Closed P&L", "Fee"].map((h) => (
                    <th key={h} className="px-3 py-1.5 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y tabular-nums">
                {legs.map((l) => (
                  <tr key={`${l.tid}-${l.role}`}>
                    <td className="px-3 py-1.5 whitespace-nowrap">{fmtDateTime(l.time, tz)}</td>
                    <td className="px-3 py-1.5 capitalize">{l.role}</td>
                    <td className="px-3 py-1.5">{fmtPrice(l.px)}</td>
                    <td className="px-3 py-1.5">{fmtSize(l.sz)}</td>
                    <td className={cn("px-3 py-1.5", pnlClass(l.closedPnl))}>{l.closedPnl ? fmtSignedUsd(l.closedPnl) : "—"}</td>
                    <td className="px-3 py-1.5">{fmtUsd(l.fee, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
