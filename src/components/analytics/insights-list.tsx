import Link from "next/link";
import { cn } from "@/lib/utils";
import { fmtDateTime, fmtR, fmtSignedUsd, pnlClass } from "@/lib/format";
import type { Insight } from "@/lib/analytics/insights";

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

/** Insights ranked by cost. `compact` (dashboard): title, cost and count only. */
export function InsightsList({ items, tz, compact = false }: { items: Insight[]; tz: string; compact?: boolean }) {
  return (
    <ol className="grid gap-3" data-testid="insights">
      {items.map((i, k) => (
        <li key={i.id} data-testid="insight" data-insight={i.id} className={cn("rounded-lg border", compact ? "px-3 py-2" : "p-4")}>
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <span className="text-muted-foreground mr-2 text-xs tabular-nums">{k + 1}.</span>
              <span className="font-medium">{i.title}</span>
              <span className="text-muted-foreground ml-2 text-xs tabular-nums" data-testid="insight-n">
                {i.n} trade{i.n === 1 ? "" : "s"}
              </span>
            </div>
            <span className={cn("money shrink-0 font-semibold tabular-nums", pnlClass(i.impact))} data-testid="insight-impact">
              {fmtSignedUsd(i.impact)}
            </span>
          </div>
          {!compact && (
            <>
              <p className="text-muted-foreground mt-1 text-sm">{i.detail}</p>
              <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                <Stat label="Win rate">{pct(i.winRate)}</Stat>
                <Stat label="Avg trade">
                  <span className={cn("money", pnlClass(i.avg))}>{fmtSignedUsd(i.avg)}</span>
                </Stat>
                <Stat label="Other trades avg">
                  <span className={cn("money", pnlClass(i.avgOthers))}>{i.avgOthers === null ? "—" : fmtSignedUsd(i.avgOthers)}</span>
                </Stat>
                <Stat label="Total R">{i.totalR === null ? "—" : `${fmtR(i.totalR)} (${i.rCount} with a stop)`}</Stat>
              </dl>
              <p className="mt-2 text-sm">
                <span className="text-muted-foreground">Try: </span>
                {i.advice}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <span className="text-muted-foreground">Worst:</span>
                {i.worst.map((w) => (
                  <Link key={w.id} href={`/trades/${w.id}`} className="hover:underline">
                    {w.displayPair} <span className={cn("money", pnlClass(w.netPnl))}>{fmtSignedUsd(w.netPnl)}</span>{" "}
                    <span className="text-muted-foreground">{fmtDateTime(w.exitTime, tz)}</span>
                  </Link>
                ))}
              </div>
            </>
          )}
        </li>
      ))}
    </ol>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}
