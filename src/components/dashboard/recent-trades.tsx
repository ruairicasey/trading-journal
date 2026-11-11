import Link from "next/link";
import { cn } from "@/lib/utils";
import { fmtDateTime, fmtR, fmtSignedUsd, pnlClass } from "@/lib/format";
import type { ClosedTrade } from "@/lib/stats";

export function RecentTrades({ trades, tz, unit }: { trades: ClosedTrade[]; tz: string; unit: "usd" | "r" }) {
  return (
    <section className="flex flex-col rounded-lg border p-4" aria-label="Recent trades">
      <header className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium">Recent trades</h2>
        <Link href="/trades?tab=closed" className="text-muted-foreground hover:text-foreground text-xs">
          View all →
        </Link>
      </header>
      {trades.length === 0 ? (
        <p className="text-muted-foreground text-sm">No closed trades yet.</p>
      ) : (
        <ul className="divide-y" data-testid="recent-trades">
          {trades.map((t) => (
            <li key={t.id}>
              <Link href={`/trades/${t.id}`} className="hover:bg-muted/40 -mx-2 flex items-center gap-2 rounded px-2 py-1.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">
                    {t.displayPair} <span className={cn("text-[10px] font-semibold uppercase", t.direction === "long" ? "text-long" : "text-short")}>{t.direction}</span>
                  </span>
                  <span className="text-muted-foreground block text-[11px]">{fmtDateTime(t.exitTime, tz)}</span>
                </span>
                <span className={cn("text-sm tabular-nums", unit === "usd" && "money", pnlClass(unit === "r" ? t.r : t.netPnl))}>
                  {unit === "r" ? fmtR(t.r) : fmtSignedUsd(t.netPnl)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
