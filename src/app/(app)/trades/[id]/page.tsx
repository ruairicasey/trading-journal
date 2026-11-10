import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { fmtDateTime, fmtDuration, fmtPct, fmtPrice, fmtR, fmtSignedUsd, fmtSize, fmtUsd, pnlClass } from "@/lib/format";
import { rMultiple } from "@/lib/outcome";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { getActiveAccount, getSetting } from "@/server/db/queries/settings";
import * as s from "@/server/db/schema";

export default async function TradePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { active } = await getActiveAccount();
  const db = getDb();
  const trade = active
    ? await db.query.trades.findFirst({
        where: and(eq(s.trades.id, id), eq(s.trades.accountId, active.id), isNull(s.trades.deletedAt)),
      })
    : undefined;
  if (!trade) notFound();
  const [journal, legs, tz] = await Promise.all([
    db.query.tradeJournal.findFirst({ where: eq(s.tradeJournal.tradeId, id) }),
    db.select().from(s.tradeFills).where(eq(s.tradeFills.tradeId, id)).orderBy(asc(s.tradeFills.time)),
    getSetting("timezone", getConfig().timezone),
  ]);
  const r = rMultiple({ ...trade, stopLoss: journal?.stopLoss ?? null });

  return (
    <div className="mx-auto max-w-4xl space-y-4">
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
      </div>

      <div className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
        The full Edit Trade form (setup, analysis, notes, screenshots) arrives in step 8. Exchange fields below are read-only.
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border p-4 text-sm sm:grid-cols-4">
        <Item label="Entry">{fmtDateTime(trade.entryTime, tz)}</Item>
        <Item label="Exit">{trade.status === "open" ? "Open" : fmtDateTime(trade.exitTime, tz)}</Item>
        <Item label="Duration">{fmtDuration(trade.durationMs)}</Item>
        <Item label="Size">{fmtSize(trade.sizeUnits)}</Item>
        <Item label="Avg entry">{fmtPrice(trade.avgEntry ?? journal?.manualEntry)}</Item>
        <Item label="Avg exit">{fmtPrice(trade.avgExit)}</Item>
        <Item label="Gross P&L">{fmtSignedUsd(trade.grossPnl)}</Item>
        <Item label="Fees">{fmtUsd(trade.fees)}</Item>
        <Item label="Net P&L">
          <span className={pnlClass(trade.netPnl)}>
            {fmtSignedUsd(trade.netPnl)} ({fmtPct(trade.returnPct)})
          </span>
        </Item>
        <Item label="Stop loss">{fmtPrice(journal?.stopLoss)}</Item>
        <Item label="R multiple">{fmtR(r)}</Item>
        <Item label="Leverage">{trade.leverage ? `${trade.leverage}×` : "—"}</Item>
      </dl>

      {legs.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Fills ({legs.length})</h2>
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

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}
