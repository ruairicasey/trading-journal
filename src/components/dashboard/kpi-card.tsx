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
        {r ? "Total R" : "Net P&L"} · {periodLabel}
      </div>
      <div
        className={cn("text-26 font-medium tracking-[-0.02em] tabular-nums", !r && "money", pnlClass(head))}
      >
        {r ? fmtR(k.totalR) : fmtSignedUsd(k.net)}
      </div>
      <div className="text-muted-foreground text-13">
        {k.count} closed trade{k.count === 1 ? "" : "s"}
        {sinceLabel ? ` since ${sinceLabel}` : ""}
        {r && k.count > 0 && ` · R from ${k.rCount} with a stop`}
      </div>
    </div>
  );
}

/** Win rate, profit factor, R, average trade, fees and funding: a ruled strip under the hero. */
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
  return (
    <section
      aria-label="Performance summary"
      className="border-rule grid grid-cols-1 border-y sm:grid-cols-2 sm:gap-x-5 lg:grid-cols-[repeat(auto-fit,minmax(170px,1fr))] [&>*:last-child]:border-0"
    >
      <Stat label="Win rate" testId="kpi-winrate" sub={`${k.wins}W / ${k.losses}L / ${k.breakeven}BE`}>
        {pct(k.winRate)}
      </Stat>
      <Stat label="Profit factor" sub="gross win ÷ gross loss">
        {pf}
      </Stat>
      <Stat
        label="Avg R · median"
        testId="kpi-r"
        sub={k.rCount ? `${k.rCount} trade${k.rCount === 1 ? "" : "s"} with a stop` : "add stops to see R"}
      >
        <span className={pnlClass(k.avgR)}>{fmtR(k.avgR)}</span>
        <span className="text-muted-foreground"> · </span>
        <span
          className={cn("text-17", pnlClass(k.medianR))}
          title="Median R: half your trades with a stop did better, half worse"
        >
          {fmtR(k.medianR)}
        </span>
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
        {r ? (
          <span className={pnlClass(k.avgR)}>{fmtR(k.avgR)}</span>
        ) : (
          <span className={cn("money", pnlClass(k.avgTrade))}>{fmtSignedUsd(k.avgTrade)}</span>
        )}
      </Stat>
      <Stat
        label="Fees · funding"
        testId="kpi-fees"
        sub={<>maker rebates net off · funding {fundingInNet ? "in" : "not in"} net</>}
      >
        <span className="money">{fmtUsd(k.fees)}</span>
        <span className="text-muted-foreground"> · </span>
        <span
          className={cn("money text-17", pnlClass(k.funding))}
          data-testid="kpi-funding"
          title="Funding attributed to these trades (negative = you paid)"
        >
          {fmtSignedUsd(k.funding)}
        </span>
      </Stat>
    </section>
  );
}
