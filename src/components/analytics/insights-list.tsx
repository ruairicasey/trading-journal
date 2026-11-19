import Link from "next/link";
import { cn } from "@/lib/utils";
import { fmtDateTime, fmtR, fmtSignedUsd, pnlClass } from "@/lib/format";
import type { Insight } from "@/lib/analytics/insights";

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

/** Insights ranked by cost. `compact` (dashboard): title, cost and count only. */
export function InsightsList({
  items,
  tz,
  compact = false,
}: {
  items: Insight[];
  tz: string;
  compact?: boolean;
}) {
  // the bar compares each pattern's cost with the worst one
  const max = Math.max(...items.map((i) => Math.abs(i.impact)), 0);
  return (
    <ol className="flex flex-col" data-testid="insights">
      {items.map((i) => (
        <li
          key={i.id}
          data-testid="insight"
          data-insight={i.id}
          className={cn("border-rule-faint flex flex-col gap-2 border-b", compact ? "py-3.5" : "py-5")}
        >
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-15 min-w-0">
              <span className="font-medium">{i.title}</span>{" "}
              <span className="text-muted-foreground" data-testid="insight-n">
                {i.n} trade{i.n === 1 ? "" : "s"}
              </span>
            </div>
            <span
              className={cn("money text-15 shrink-0 font-medium tabular-nums", pnlClass(i.impact))}
              data-testid="insight-impact"
            >
              {fmtSignedUsd(i.impact)}
            </span>
          </div>
          <span className="bg-hover block h-1.5 overflow-hidden rounded-full" aria-hidden="true">
            <span
              className="bg-leak block h-full rounded-full"
              style={{ width: `${max > 0 ? Math.max(2, Math.round((Math.abs(i.impact) / max) * 100)) : 0}%` }}
            />
          </span>
          {compact && <p className="text-muted-foreground text-13">{i.detail}</p>}
          {!compact && (
            <>
              <p className="text-muted-foreground text-sm">{i.detail}</p>
              <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
                <Stat label="Win rate">{pct(i.winRate)}</Stat>
                <Stat label="Avg trade">
                  <span className="money">{fmtSignedUsd(i.avg)}</span>
                </Stat>
                <Stat label="Other trades avg">
                  <span className="money">{i.avgOthers === null ? "—" : fmtSignedUsd(i.avgOthers)}</span>
                </Stat>
                <Stat label="Total R">
                  {i.totalR === null ? "—" : `${fmtR(i.totalR)} (${i.rCount} with a stop)`}
                </Stat>
              </dl>
              <p className="text-sm">
                <span className="text-muted-foreground">Try: </span>
                {i.advice}
              </p>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <span className="text-muted-foreground">Worst:</span>
                {i.worst.map((w) => (
                  <Link key={w.id} href={`/trades/${w.id}`} className="hover:underline">
                    {w.displayPair}{" "}
                    <span className={cn("money", pnlClass(w.netPnl))}>{fmtSignedUsd(w.netPnl)}</span>{" "}
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
