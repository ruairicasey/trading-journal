import { cn } from "@/lib/utils";
import { fmtR, fmtSignedUsd, fmtUsd, pnlClass } from "@/lib/format";
import type { Kpis } from "@/lib/stats";

/** One figure in the readout strip: label, value, a condensed note; hairline rules between figures. */
function Stat({
  label,
  children,
  sub,
  testId,
}: {
  label: string;
  children: React.ReactNode;
  sub?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="border-rule flex min-w-0 flex-col gap-1.5 border-b py-4 pr-5 sm:border-r sm:border-b-0"
      data-testid={testId}
    >
      <div className="text-muted-foreground text-13">{label}</div>
      <div className="text-22 font-medium tracking-[-0.015em] tabular-nums">{children}</div>
      {sub && <div className="condensed text-muted-foreground text-13 tabular-nums">{sub}</div>}
    </div>
  );
}

/** The period's net P&L (or total R) for the hero. The three divs (label, value, note) are read by e2e tests. */
export function NetFigure({
  k,
  unit,
  sinceLabel,
  periodLabel,
}: {
  k: Kpis;
  unit: "usd" | "r";
  sinceLabel: string | null;
  periodLabel: string;
}) {
  const r = unit === "r";
  const head = r ? k.totalR : k.net;
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-testid="kpi-net">
      <div className="text-muted-foreground text-sm">
        {r ? "Total R" : "Net P&L"}, {periodLabel}
      </div>
      <div
        className={cn("text-26 font-medium tracking-[-0.02em] tabular-nums", !r && "money", pnlClass(head))}
      >
        {r ? fmtR(k.totalR) : fmtSignedUsd(k.net)}
      </div>
      <div className="text-muted-foreground text-13">
        {k.count} closed trade{k.count === 1 ? "" : "s"}
        {sinceLabel ? ` since ${sinceLabel}` : ""}
        {r && k.count > 0 && `, R from ${k.rCount} with a stop`}
      </div>
    </div>
  );
}

/** Win rate, profit factor, R, average trade, fees and funding: a ruled strip under the hero. Ink throughout. */
export function KpiStrip({
  k,
  unit,
  fundingInNet = true,
}: {
  k: Kpis;
  unit: "usd" | "r";
  fundingInNet?: boolean;
}) {
  const r = unit === "r";
  const pf = k.profitFactor === null ? "—" : k.profitFactor === Infinity ? "∞" : k.profitFactor.toFixed(2);
  const pct = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(1)}%`);
  const sameMedian = k.medianR === null || k.avgR === null || fmtR(k.medianR) === fmtR(k.avgR);
  const withStop = k.rCount
    ? `${k.rCount} trade${k.rCount === 1 ? "" : "s"} with a stop`
    : "add stops to see R";
  return (
    <section
      aria-label="Performance summary"
      className="border-rule grid grid-cols-1 border-y sm:grid-cols-2 sm:gap-x-5 lg:grid-cols-[repeat(auto-fit,minmax(150px,1fr))] [&>*:last-child]:border-0"
    >
      <Stat
        label="Win rate"
        testId="kpi-winrate"
        sub={`${k.wins} won, ${k.losses} lost, ${k.breakeven} even`}
      >
        {pct(k.winRate)}
      </Stat>
      <Stat label="Profit factor" sub="gross won ÷ gross lost">
        {pf}
      </Stat>
      <Stat
        label="Average R"
        testId="kpi-r"
        sub={sameMedian ? withStop : `median ${fmtR(k.medianR)}, ${withStop}`}
      >
        {fmtR(k.avgR)}
      </Stat>
      <Stat
        label="Average trade"
        sub={
          r ? undefined : (
            <span className="money">
              won {fmtUsd(k.avgWin)}, lost {fmtUsd(k.avgLoss)}
            </span>
          )
        }
      >
        {r ? fmtR(k.avgR) : <span className="money">{fmtSignedUsd(k.avgTrade)}</span>}
      </Stat>
      <Stat label="Fees" testId="kpi-fees" sub="after maker rebates">
        <span className="money">{fmtUsd(k.fees)}</span>
      </Stat>
      <Stat label="Funding" sub={`${fundingInNet ? "included" : "not included"} in net P&L`}>
        <span
          className="money"
          data-testid="kpi-funding"
          title="Funding attributed to these trades (negative = you paid)"
        >
          {fmtSignedUsd(k.funding)}
        </span>
      </Stat>
    </section>
  );
}
