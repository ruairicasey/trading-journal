import Link from "next/link";
import { LayoutDashboard } from "lucide-react";
import { TZDate } from "@date-fns/tz";
import { DashboardControls } from "@/components/dashboard/controls";
import { DASH_PERIODS, dashHref, type DashParams } from "@/lib/dashboard-params";
import { EquityChart } from "@/components/dashboard/equity-chart";
import { KpiStrip, NetFigure } from "@/components/dashboard/kpi-card";
import { OpenTradesBanner } from "@/components/dashboard/open-trades-banner";
import { PnlCalendar } from "@/components/dashboard/pnl-calendar";
import { RecentTrades } from "@/components/dashboard/recent-trades";
import { EmptyState } from "@/components/shell/empty-state";
import { dayBoundsLocal, periodRange, PERIODS, type Period } from "@/lib/periods";
import { balanceCurve, calendarMonth, computeKpis, equityCurve, type BalancePoint } from "@/lib/stats";
import { drawdownStats, sliceUnderwater, underwaterSeries } from "@/lib/drawdown";
import { weekOf, weekScore } from "@/lib/weekly";
import { DrawdownCard } from "@/components/dashboard/drawdown-card";
import { WeeklyCard } from "@/components/dashboard/weekly-card";
import { InsightsList } from "@/components/analytics/insights-list";
import { insights } from "@/lib/analytics/insights";
import { scores } from "@/lib/analytics/scores";
import { computeRisk } from "@/lib/risk";
import { RiskCard } from "@/components/analytics/risk-card";
import { ScoresCard } from "@/components/analytics/scores-card";
import { analyticsTrades } from "@/server/db/queries/analytics";
import { missingCounts } from "@/server/db/queries/trades";
import { weeklyNote } from "@/server/trades/mutations";
import { INCLUDE_FUNDING_KEY } from "@/server/funding/attribute";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { balanceInputs, closedTrades, openTrades } from "@/server/db/queries/dashboard";
import { getActiveScope, getSetting } from "@/server/db/queries/settings";
import { fmtR, fmtUsd, pnlClass } from "@/lib/format";
import { cn } from "@/lib/utils";
import { H2, SECTION } from "@/lib/ui";
import { baseAtFloor, clampStart, fromFloor, journalFloor, SINCE_START } from "@/lib/journal-start";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { active, walletId } = await getActiveScope();
  if (!active)
    return (
      <EmptyState icon={LayoutDashboard} title="No account" body="Create an account in Settings first." />
    );
  const tz = await getSetting("timezone", getConfig().timezone);
  const fundingInNet = (await getSetting<boolean>(INCLUDE_FUNDING_KEY, true)) !== false;
  const now = Date.now();

  // ── params ──
  const rawPeriod = one(sp.period) ?? "30d";
  const from = one(sp.from);
  const to = one(sp.to);
  const custom = rawPeriod === "custom" && from && DATE.test(from);
  const period = custom ? "custom" : (PERIODS as readonly string[]).includes(rawPeriod) ? rawPeriod : "30d";
  const unit = one(sp.unit) === "r" ? "r" : "usd";
  const localNow = new TZDate(now, tz);
  const monthParam = one(sp.month);
  const [cy, cm] =
    monthParam && /^\d{4}-\d{2}$/.test(monthParam)
      ? monthParam.split("-").map(Number)
      : [localNow.getFullYear(), localNow.getMonth() + 1];
  const weekParam = one(sp.week);
  const params: DashParams = {
    period,
    from: custom ? from : undefined,
    to: custom && to && DATE.test(to) ? to : undefined,
    unit,
    month: monthParam,
    week: weekParam && DATE.test(weekParam) ? weekParam : undefined,
  };

  // ── range [start, end) by exit time ──
  let start: number | null = null;
  let end: number | null = null;
  if (custom) {
    start = dayBoundsLocal(from!, tz)!.start;
    end = params.to ? (dayBoundsLocal(params.to, tz)?.end ?? null) : null;
  } else {
    start = periodRange(period as Period, now, tz).from;
  }

  // the starting balance is the whole account's: one wallet on its own starts from $0 (realised P&L only)
  const startBal = walletId ? 0 : active.startingBalance;
  const db = getDb();
  const [allTrades, open, bal, richAll] = await Promise.all([
    closedTrades(db, active.id, walletId),
    openTrades(db, active.id, walletId),
    balanceInputs(db, active.id, walletId),
    analyticsTrades(db, active.id, walletId, { light: true }),
  ]);
  // journal start: views hide trades opened before it unless the period is All time (src/lib/journal-start.ts)
  const floor = journalFloor(active.journalStart, period);
  start = clampStart(start, floor);
  const all = fromFloor(allTrades, floor);
  // without a ledger the curve is rebuilt from trades: start it at the real balance at the floor
  const base = baseAtFloor(allTrades, floor, startBal);
  const rich = fromFloor(richAll, floor);
  if (allTrades.length === 0 && open.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <EmptyState
          icon={LayoutDashboard}
          title="No trades yet"
          body="Add a Hyperliquid wallet under Settings → Wallets & sync, or run npm run dev:demo to explore with fake data."
        />
      </div>
    );
  }
  const inRange = all.filter(
    (t) => (start === null || t.exitTime >= start) && (end === null || t.exitTime < end),
  );
  const k = computeKpis(inRange);
  // $ mode: the real account balance when the ledger is synced; otherwise starting balance + realised P&L
  const balanceView = unit === "usd" && bal !== null;
  const curve = balanceView
    ? balanceCurve(all, bal.flows, bal.cash, { from: start, to: end })
    : equityCurve(end === null ? all : all.filter((t) => t.exitTime < end), base, start);
  const lastPoint = curve.at(-1);
  const deposited: number | null = balanceView && lastPoint ? (lastPoint as BalancePoint).deposited : null;
  const cal = calendarMonth(all, cy, cm, tz);
  const shift = (d: number) => {
    const m = cm + d;
    const y = cy + Math.floor((m - 1) / 12);
    const mm = ((((m - 1) % 12) + 12) % 12) + 1;
    return `${y}-${String(mm).padStart(2, "0")}`;
  };
  // drawdown: computed over all history (the running peak includes earlier trades), shown for the period
  const underwater = underwaterSeries(
    end === null ? all : all.filter((t) => t.exitTime < end),
    startBal > 0 ? base : startBal,
  );
  const dd = drawdownStats(underwater, { from: start, to: end, now });
  const ddPoints = sliceUnderwater(underwater, start);

  // weekly reflection (Monday-first, by exit time)
  let week = weekOf(params.week, now, tz);
  let score = weekScore(all, week, tz);
  if (!params.week && score.kpis.count === 0) {
    // nothing closed yet this week (e.g. Monday morning): reflect on last week instead
    week = weekOf(week.prev, now, tz);
    score = weekScore(all, week, tz);
  }
  const [missing, note] = await Promise.all([
    missingCounts(db, active.id, week.start, week.end, walletId, floor),
    weeklyNote(db, active.id, week.start, week.end),
  ]);
  const richInRange = rich.filter(
    (t) => (start === null || t.exitTime >= start) && (end === null || t.exitTime < end),
  );
  const leaks = insights(richInRange, rich, tz).list.slice(0, 3);
  const sc = richInRange.length ? scores(richInRange, rich, tz) : null;
  const risk = inRange.length ? computeRisk(all, bal, base, { from: start, to: end, tz, now }) : null;

  const recent = [...all].sort((a, b) => b.exitTime - a.exitTime).slice(0, 7);
  const dateFmt = new Intl.DateTimeFormat("en-AU", {
    timeZone: tz,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const periodLabel = custom
    ? `${from} → ${params.to ?? "now"}`
    : (DASH_PERIODS.find((p) => p.id === period)?.label ?? period);

  // the hero names exactly what its figure is: the curve's last point (at the range end when a custom range has one)
  const on = params.to ? ` on ${params.to}` : "";
  const heroLabel =
    unit === "r"
      ? `Cumulative R${params.to ? ` to ${params.to}` : ""}`
      : balanceView
        ? params.to
          ? `Balance${on}`
          : "Account balance"
        : walletId
          ? `Realised P&L from $0${on}`
          : `Realised equity${on}`;
  const heroValue = lastPoint ? (unit === "r" ? fmtR(lastPoint.cumR) : fmtUsd(lastPoint.equity)) : null;

  return (
    <div className="mx-auto max-w-[1180px] space-y-9">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-22 font-semibold">Dashboard</h1>
        <DashboardControls params={params} hasStart={active.journalStart !== null} />
      </header>

      {/* hero: where the account stands, then the curve */}
      <section className="flex flex-col gap-5" aria-label="Equity curve">
        <div className="flex flex-wrap items-end gap-x-14 gap-y-6">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-muted-foreground text-sm font-normal">{heroLabel}</h2>
            {heroValue !== null ? (
              <span
                className={cn(
                  "sm:text-52 text-[40px] leading-none font-medium tracking-[-0.035em]",
                  unit === "usd" && "money",
                  unit === "r" && pnlClass(lastPoint?.cumR),
                )}
                data-testid={balanceView ? "balance-now" : "hero-figure"}
              >
                {heroValue}
              </span>
            ) : (
              <span className="text-muted-foreground text-17">
                {balanceView ? "No balance changes in this period" : "No closed trades in this period"}
              </span>
            )}
          </div>
          <NetFigure
            k={k}
            unit={unit}
            periodLabel={periodLabel}
            sinceLabel={k.since ? dateFmt.format(k.since) : null}
          />
          {balanceView && deposited !== null && (
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-sm">Net deposits</span>
              <span className="money text-26 font-medium tracking-[-0.02em]" data-testid="balance-deposited">
                {fmtUsd(deposited)}
              </span>
              <span className="text-muted-foreground text-13">dashed line</span>
            </div>
          )}
        </div>
        <OpenTradesBanner trades={open} demo={getConfig().isDemo} />
        <div>
          <EquityChart points={curve} unit={unit} baseline={base} tz={tz} />
          <p className="text-muted-foreground text-13 mt-2" data-testid="equity-subtitle">
            {unit === "r" ? (
              "Trades without a stop count as 0R"
            ) : balanceView ? (
              "Deposits, withdrawals and transfers included · open positions not marked to market"
            ) : walletId ? (
              "This wallet's realised P&L from $0 (the starting balance is the whole account's)"
            ) : (
              <>
                From starting balance{" "}
                <span className="money">${active.startingBalance.toLocaleString()}</span>
              </>
            )}
          </p>
        </div>
      </section>

      <KpiStrip k={k} unit={unit} fundingInNet={fundingInNet} />

      {/* the month and the week on the wide side; leaks and discipline beside them */}
      <div className="grid gap-12 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-10">
          <PnlCalendar
            cal={cal}
            unit={unit}
            prevHref={dashHref(params, { month: shift(-1) })}
            nextHref={dashHref(params, { month: shift(1) })}
          />
          <WeeklyCard
            allTime={floor === null && active.journalStart !== null}
            week={week}
            score={score}
            missing={missing}
            unit={unit}
            tz={tz}
            note={note}
            prevHref={dashHref(params, { week: week.prev })}
            nextHref={week.next ? dashHref(params, { week: week.next }) : null}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-10">
          {leaks.length > 0 && (
            <section className={SECTION} aria-label="Top leaks" data-testid="leaks-card">
              <header className="flex items-baseline justify-between gap-2">
                <h2 className={H2}>
                  Where you lose the most
                  <span className="text-muted-foreground font-normal"> · {periodLabel}</span>
                  {unit === "r" && (
                    <span className="text-muted-foreground ml-2 text-xs font-normal">
                      (in $; total R on the Insights page)
                    </span>
                  )}
                </h2>
                <Link
                  href={dashHref(
                    { ...params, month: undefined, week: undefined },
                    { section: "insights" },
                    "/analytics",
                    active.journalStart !== null ? SINCE_START : "all", // Analytics' own default, so All time survives
                  )}
                  className="link text-sm"
                >
                  All insights
                </Link>
              </header>
              <InsightsList items={leaks} tz={tz} compact />
            </section>
          )}
          {sc && <ScoresCard s={sc} title={`Scores · ${periodLabel}`} plain />}
          <RecentTrades trades={recent} tz={tz} unit={unit} />
        </div>
      </div>

      {risk && <RiskCard m={risk} title={`Risk-adjusted · ${periodLabel}`} plain />}

      <DrawdownCard stats={dd} points={ddPoints} unit={unit} tz={tz} periodLabel={periodLabel} />
    </div>
  );
}
