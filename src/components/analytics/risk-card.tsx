import { cn } from "@/lib/utils";
import { CARD, CARD_H2, H2, SECTION } from "@/lib/ui";
import { fmtR, fmtSignedUsd } from "@/lib/format";
import { MIN_SAMPLE, type RiskMetrics } from "@/lib/risk";

const num = (x: number | null, dp = 2) => (x === null || !Number.isFinite(x) ? "—" : x.toFixed(dp));
const pct = (x: number | null) =>
  x === null || !Number.isFinite(x) ? "—" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
// ratios, returns and drawdowns are read in ink with their sign: red/green is kept for realised money
const tone = (x: number | null) => (x === null ? "text-muted-foreground" : "");

/** Sharpe, Sortino, returns and drawdowns from daily returns; expectancy, payoff and SQN from trades. */
export function RiskCard({
  m,
  title,
  plain = false,
}: {
  m: RiskMetrics & { basis: "balance" | "trades" };
  title: string;
  /** the redesigned dashboard: no card border, a larger heading */
  plain?: boolean;
}) {
  const n = m.days.length;
  return (
    <section className={plain ? SECTION : CARD} aria-label="Risk-adjusted" data-testid="risk-card">
      <header className={cn("flex flex-wrap items-baseline justify-between gap-2", !plain && "mb-3")}>
        <h2 className={plain ? H2 : CARD_H2}>{title}</h2>
        <span className="text-muted-foreground text-xs" data-testid="risk-sample">
          {n} day{n === 1 ? "" : "s"} with capital, {m.trades} trade{m.trades === 1 ? "" : "s"}
          {m.smallDays || m.smallTrades ? `, small sample (under ${MIN_SAMPLE}): read with care` : ""}
        </span>
      </header>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat id="sharpe" label="Sharpe" sub="annualised, daily" cls={tone(m.sharpe)}>
          {num(m.sharpe)}
        </Stat>
        <Stat id="sortino" label="Sortino" sub="downside only" cls={tone(m.sortino)}>
          {num(m.sortino)}
        </Stat>
        <Stat
          id="return"
          label="Return"
          sub={m.annualised === null ? "time-weighted" : `time-weighted, ${pct(m.annualised)} a year`}
          cls={tone(m.totalReturn)}
        >
          {pct(m.totalReturn)}
        </Stat>
        <Stat
          id="maxdd"
          label="Max drawdown"
          sub={m.longestDrawdownDays === null ? "" : `longest ${m.longestDrawdownDays} days`}
          cls={tone(m.maxDrawdown)}
        >
          {pct(m.maxDrawdown)}
        </Stat>
        <Stat id="calmar" label="Calmar" sub="annual return ÷ max DD" cls={tone(m.calmar)}>
          {num(m.calmar)}
        </Stat>
        <Stat
          id="recovery"
          label="Recovery factor"
          sub="net P&L ÷ deepest $ drop"
          cls={tone(m.recoveryFactor)}
        >
          {num(m.recoveryFactor)}
        </Stat>
        <Stat
          id="expectancy"
          label="Expectancy"
          sub={
            m.expectancyR === null
              ? "per trade"
              : `${fmtR(m.expectancyR)} per trade (${m.rCount} with a stop)`
          }
          cls={tone(m.expectancy)}
        >
          <span className="money">{m.expectancy === null ? "—" : fmtSignedUsd(m.expectancy)}</span>
        </Stat>
        <Stat id="payoff" label="Payoff ratio" sub="avg win ÷ avg loss" cls="">
          {num(m.payoff)}
        </Stat>
        <Stat id="sqn" label="SQN" sub="R-based system quality" cls={tone(m.sqn)}>
          {num(m.sqn)}
        </Stat>
      </dl>
      <p className="text-muted-foreground mt-3 text-[11px]">
        {m.basis === "balance"
          ? "Daily trading returns on the real balance: deposits and withdrawals are taken out, days at $0 are skipped."
          : "Daily returns on the starting balance + realised P&L (the ledger isn't synced, so deposits are unknown)."}{" "}
        Whole days in your timezone; open positions not marked to market (a trade counts on the day it
        closes). 365-day year, risk-free rate 0; annualised figures need {MIN_SAMPLE}+ days.
      </p>
    </section>
  );
}

function Stat({
  id,
  label,
  sub,
  cls,
  children,
}: {
  id: string;
  label: string;
  sub: string;
  cls: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid content-start gap-0.5" data-testid={`risk-${id}`}>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className={cn("text-lg font-semibold tabular-nums", cls)} data-testid="risk-value">
        {children}
      </dd>
      {sub && <dd className="text-muted-foreground text-[11px]">{sub}</dd>}
    </div>
  );
}
