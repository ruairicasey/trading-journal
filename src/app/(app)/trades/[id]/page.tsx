import { SOURCE_LABEL } from "@/lib/enums";
import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { TradeForm } from "@/components/trade-form/trade-form";
import { cn } from "@/lib/utils";
import { fmtDateTime, fmtPct, fmtPrice, fmtSignedUsd, fmtSize, fmtUsd, pnlClass } from "@/lib/format";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { getActiveScope, getSessions, getSetting } from "@/server/db/queries/settings";
import * as s from "@/server/db/schema";
import { loadTradeForEdit } from "@/server/trades/journal";
import { Direction } from "@/components/trades/direction";

export default async function TradePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { active, accounts, wallets } = await getActiveScope();
  if (!active) notFound();
  const db = getDb();
  const data = await loadTradeForEdit(db, active.id, id);
  if (!data) notFound();
  const { trade } = data;
  const [tz, sessions, legs] = await Promise.all([
    getSetting("timezone", getConfig().timezone),
    getSessions(),
    db.select().from(s.tradeFills).where(eq(s.tradeFills.tradeId, id)).orderBy(asc(s.tradeFills.time)),
  ]);

  return (
    <div className="mx-auto max-w-[1180px] space-y-8">
      <header className="flex flex-col gap-3">
        <Link href="/trades" className="link w-fit text-sm">
          All trades
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-22 font-semibold">{trade.displayPair}</h1>
              <Direction dir={trade.direction} />
              {trade.status === "open" ? (
                <Badge className="bg-gold-tint text-gold-ink rounded-full px-2" data-testid="trade-status">
                  Open
                </Badge>
              ) : trade.status === "planned" ? (
                <Badge className="bg-subtle text-ink-2 rounded-full px-2" data-testid="trade-status">
                  Planned
                </Badge>
              ) : (
                <Badge className="bg-subtle text-ink-2 rounded-full px-2" data-testid="trade-status">
                  Closed
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground text-13">
              <span>
                {trade.source === "manual"
                  ? "Manual"
                  : trade.flags?.imported
                    ? "Imported from a cTrader file"
                    : `Synced from ${SOURCE_LABEL[trade.source]}`}
              </span>
              {wallets.length > 1 && trade.walletId && (
                <>
                  ,{" "}
                  <span data-testid="trade-wallet">
                    {wallets.find((w) => w.id === trade.walletId)?.label ?? "Other wallet"}
                  </span>
                </>
              )}
            </p>
          </div>
          {trade.status !== "planned" && (
            <div className="flex flex-col items-start gap-1 sm:items-end">
              <span className="text-muted-foreground text-sm">
                {trade.status === "open" ? "Realised so far" : "Net P&L"}
              </span>
              <span
                className={cn(
                  "money text-26 font-medium tracking-[-0.02em] tabular-nums",
                  trade.status === "closed" && pnlClass(trade.netPnl),
                )}
              >
                {fmtSignedUsd(trade.netPnl)}
              </span>
              <span className="text-muted-foreground text-13 tabular-nums">
                {fmtPct(trade.returnPct)} return
              </span>
            </div>
          )}
        </div>
      </header>

      <TradeForm
        data={data}
        tz={tz}
        sessions={sessions}
        accounts={accounts.map((a) => ({
          id: a.id,
          name: a.name,
          startingBalance: a.startingBalance,
          standardRiskPct: a.standardRiskPct,
        }))}
      />

      {legs.length > 0 && (
        <section className="border-rule flex flex-col gap-3.5 border-t pt-5">
          <h2 className="text-17 font-semibold tracking-[-0.01em]">
            Exchange fills <span className="text-muted-foreground font-normal">{legs.length}</span>
          </h2>
          <div className="overflow-x-auto">
            <table className="text-13 w-full">
              <thead className="text-muted-foreground text-left">
                <tr>
                  {["Time", "Role", "Price", "Size", "Closed P&L", "Fee"].map((h) => (
                    <th key={h} className="py-2 pr-4 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-rule-faint border-rule-faint divide-y border-t tabular-nums">
                {legs.map((l) => (
                  <tr key={`${l.tid}-${l.role}`}>
                    <td className="py-2 pr-4 whitespace-nowrap">{fmtDateTime(l.time, tz)}</td>
                    <td className="py-2 pr-4 capitalize">{l.role}</td>
                    <td className="py-2 pr-4">{fmtPrice(l.px)}</td>
                    <td className="py-2 pr-4">{fmtSize(l.sz)}</td>
                    <td className={cn("money py-2 pr-4", pnlClass(l.closedPnl))}>
                      {l.closedPnl ? fmtSignedUsd(l.closedPnl) : "—"}
                    </td>
                    <td className="money py-2 pr-4">{fmtUsd(l.fee, 4)}</td>
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
