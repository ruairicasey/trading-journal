"use client";

import { useState, useTransition } from "react";
import { BarChart3, EyeOff, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtR, fmtSignedUsd } from "@/lib/format";
import type { Breakdown, Bucket } from "@/lib/analytics/types";
import { setAnalyticsHiddenAction } from "@/app/(app)/analytics/actions";

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

/**
 * One analytics breakdown: diverging bars around zero (net $ or avg R), with sample size and win rate on
 * every row, small samples greyed, and a full table view. A single measure per chart, so no legend.
 */
export function BreakdownWidget({
  id,
  title,
  description,
  data,
  unit,
  hidden,
}: {
  id: string;
  title: string;
  description: string;
  data: Breakdown;
  unit: "usd" | "r";
  hidden: string[];
}) {
  const [view, setView] = useState<"bars" | "table">("bars");
  const [pending, start] = useTransition();
  const r = unit === "r";
  const metric = (b: Bucket) => (r ? b.avgR : b.net);
  const max = Math.max(0, ...data.buckets.map((b) => Math.abs(metric(b) ?? 0)));
  const fmt = (v: number | null) => (r ? fmtR(v) : fmtSignedUsd(v));

  return (
    <section className="rounded-lg border p-4" aria-label={title} data-testid={`widget-${id}`}>
      <header className="mb-3 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium">{title}</h2>
          <p className="text-muted-foreground text-xs">{description}</p>
        </div>
        <div className="bg-muted/40 inline-flex shrink-0 rounded-md border p-0.5">
          <button type="button" aria-label="Bar view" aria-pressed={view === "bars"} onClick={() => setView("bars")} className={cn("rounded p-1", view === "bars" ? "bg-background shadow-sm" : "text-muted-foreground")}>
            <BarChart3 className="size-3.5" />
          </button>
          <button type="button" aria-label="Table view" aria-pressed={view === "table"} onClick={() => setView("table")} className={cn("rounded p-1", view === "table" ? "bg-background shadow-sm" : "text-muted-foreground")}>
            <Table2 className="size-3.5" />
          </button>
        </div>
        <button
          type="button"
          aria-label={`Hide ${title}`}
          title="Hide this widget"
          disabled={pending}
          className="text-muted-foreground hover:text-foreground shrink-0 rounded p-1"
          onClick={() => start(() => setAnalyticsHiddenAction([...hidden, id]))}
        >
          <EyeOff className="size-3.5" />
        </button>
      </header>

      {data.buckets.length === 0 ? (
        <p className="text-muted-foreground py-6 text-center text-sm">No data yet{data.total ? " (fill this in on your trades to see it)" : ""}.</p>
      ) : view === "bars" ? (
        <ul className="grid gap-1.5" role="list">
          <li className="text-muted-foreground grid grid-cols-[minmax(0,5.25rem)_1fr_4.25rem_1.75rem_2.25rem] sm:grid-cols-[minmax(0,7.5rem)_1fr_4.5rem_2.25rem_2.5rem] gap-2 text-[10px] tracking-wide uppercase">
            <span />
            <span />
            <span className="text-right whitespace-nowrap">{r ? "avg R" : "net"}</span>
            <span className="text-right">n</span>
            <span className="text-right">win</span>
          </li>
          {data.buckets.map((b) => {
            const v = metric(b);
            const w = max > 0 && v !== null ? (Math.abs(v) / max) * 50 : 0;
            const tip = `${b.label}: ${b.n} trade${b.n === 1 ? "" : "s"} · ${b.wins}W/${b.losses}L/${b.breakeven}BE · win ${pct(b.winRate)} · ${r ? `avg ${fmtR(b.avgR)} (${b.rCount} with a stop)` : `net ${fmtSignedUsd(b.net)}`}${b.small ? ` · fewer than ${data.minN} trades` : ""}`;
            return (
              <li
                key={b.key}
                title={tip}
                data-small={b.small || undefined}
                className={cn("hover:bg-muted/50 grid grid-cols-[minmax(0,5.25rem)_1fr_4.25rem_1.75rem_2.25rem] sm:grid-cols-[minmax(0,7.5rem)_1fr_4.5rem_2.25rem_2.5rem] items-center gap-2 rounded px-0.5 text-xs", b.small && "opacity-45")}
              >
                <span className="truncate">{b.label}</span>
                <span className="bg-muted/30 relative h-3.5 rounded-sm" aria-hidden>
                  <span className="bg-border absolute inset-y-0 left-1/2 w-px" />
                  {v !== null && w > 0 && (
                    <span
                      className={cn("absolute inset-y-0.5 rounded-[3px]", v > 0 ? "bg-profit/70 left-1/2" : "bg-loss/70 right-1/2")}
                      style={{ width: `${Math.max(w, 0.8)}%` }}
                    />
                  )}
                </span>
                <span className={cn("text-right tabular-nums", !r && "money", v !== null && (v > 0 ? "text-profit" : v < 0 ? "text-loss" : ""))}>{fmt(v)}</span>
                <span className="text-muted-foreground text-right tabular-nums">{b.n}</span>
                <span className="text-right tabular-nums">{pct(b.winRate)}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="text-muted-foreground text-left">
              <tr className="border-b">
                <th className="py-1 pr-2 font-normal">Bucket</th>
                <th className="px-2 py-1 text-right font-normal">Trades</th>
                <th className="px-2 py-1 text-right font-normal">W / L / BE</th>
                <th className="px-2 py-1 text-right font-normal">Win rate</th>
                <th className="px-2 py-1 text-right font-normal">Net</th>
                <th className="px-2 py-1 text-right font-normal">Avg trade</th>
                <th className="py-1 pl-2 text-right font-normal">Avg R (n)</th>
              </tr>
            </thead>
            <tbody>
              {data.buckets.map((b) => (
                <tr key={b.key} className={cn("border-b last:border-0", b.small && "opacity-45")}>
                  <td className="max-w-40 truncate py-1 pr-2">{b.label}</td>
                  <td className="px-2 py-1 text-right">{b.n}</td>
                  <td className="px-2 py-1 text-right">
                    {b.wins} / {b.losses} / {b.breakeven}
                  </td>
                  <td className="px-2 py-1 text-right">{pct(b.winRate)}</td>
                  <td className={cn("money px-2 py-1 text-right", b.net > 0 ? "text-profit" : b.net < 0 ? "text-loss" : "")}>{fmtSignedUsd(b.net)}</td>
                  <td className="money px-2 py-1 text-right">{fmtSignedUsd(b.avgTrade)}</td>
                  <td className="py-1 pl-2 text-right">
                    {fmtR(b.avgR)} <span className="text-muted-foreground">({b.rCount})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.buckets.some((b) => b.small) && (
        <p className="text-muted-foreground mt-2 text-[11px]">Greyed: fewer than {data.minN} trades, too few to read much into.</p>
      )}
    </section>
  );
}
