import { cn } from "@/lib/utils";
import { fmtR, fmtSignedUsd, fmtUsd, pnlClass } from "@/lib/format";
import type { Kpis } from "@/lib/stats";

function Stat({ label, children, sub, testId }: { label: string; children: React.ReactNode; sub?: React.ReactNode; testId?: string }) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-0.5 truncate text-lg font-semibold tabular-nums">{children}</div>
      {sub && <div className="text-muted-foreground text-[11px] tabular-nums">{sub}</div>}
    </div>
  );
}

export function KpiCard({ k, unit, sinceLabel, periodLabel }: { k: Kpis; unit: "usd" | "r"; sinceLabel: string | null; periodLabel: string }) {
  const r = unit === "r";
  const pf = k.profitFactor === null ? "—" : k.profitFactor === Infinity ? "∞" : k.profitFactor.toFixed(2);
  const pct = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(1)}%`);
  const head = r ? k.totalR : k.net;
  return (
    <section className="rounded-lg border p-4" aria-label="Performance summary">
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-[1.4fr_repeat(5,1fr)]">
        <div className="col-span-2 min-w-0 sm:col-span-3 lg:col-span-1" data-testid="kpi-net">
          <div className="text-muted-foreground text-xs">{r ? "Total R" : "Net P&L"} · {periodLabel}</div>
          <div className={cn("mt-0.5 text-3xl font-semibold tracking-tight tabular-nums", !r && "money", pnlClass(head))}>
            {r ? fmtR(k.totalR) : fmtSignedUsd(k.net)}
          </div>
          <div className="text-muted-foreground text-xs">
            {k.count} closed trade{k.count === 1 ? "" : "s"}
            {sinceLabel ? ` since ${sinceLabel}` : ""}
            {r && k.count > 0 && ` · R from ${k.rCount} with a stop`}
          </div>
        </div>
        <Stat label="Win rate" testId="kpi-winrate" sub={`${k.wins}W / ${k.losses}L / ${k.breakeven}BE`}>
          {pct(k.winRate)}
        </Stat>
        <Stat label="Profit factor" sub="gross win ÷ gross loss">
          {pf}
        </Stat>
        <Stat label="Avg R" sub={k.rCount ? `${k.rCount} trade${k.rCount === 1 ? "" : "s"} with a stop` : "add stops to see R"}>
          <span className={pnlClass(k.avgR)}>{fmtR(k.avgR)}</span>
        </Stat>
        <Stat
          label="Avg trade"
          sub={
            r ? undefined : (
              <span className="money">
                win {fmtUsd(k.avgWin)} / loss {fmtUsd(k.avgLoss)}
              </span>
            )
          }
        >
          {r ? <span className={pnlClass(k.avgR)}>{fmtR(k.avgR)}</span> : <span className={cn("money", pnlClass(k.avgTrade))}>{fmtSignedUsd(k.avgTrade)}</span>}
        </Stat>
        <Stat label="Total fees" sub="maker rebates net off">
          <span className="money">{fmtUsd(k.fees)}</span>
        </Stat>
      </div>
    </section>
  );
}
