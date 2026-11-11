import { LayoutDashboard } from "lucide-react";
import { TZDate } from "@date-fns/tz";
import { DashboardControls } from "@/components/dashboard/controls";
import { DASH_PERIODS, dashHref, type DashParams } from "@/lib/dashboard-params";
import { EquityChart } from "@/components/dashboard/equity-chart";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { OpenTradesBanner } from "@/components/dashboard/open-trades-banner";
import { PnlCalendar } from "@/components/dashboard/pnl-calendar";
import { RecentTrades } from "@/components/dashboard/recent-trades";
import { EmptyState } from "@/components/shell/empty-state";
import { dayBoundsLocal, periodRange, PERIODS, type Period } from "@/lib/periods";
import { calendarMonth, computeKpis, equityCurve } from "@/lib/stats";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { closedTrades, openTrades } from "@/server/db/queries/dashboard";
import { getActiveAccount, getSetting } from "@/server/db/queries/settings";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { active } = await getActiveAccount();
  if (!active) return <EmptyState icon={LayoutDashboard} title="No account" body="Create an account in Settings first." />;
  const tz = await getSetting("timezone", getConfig().timezone);
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
  const [cy, cm] = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam.split("-").map(Number) : [localNow.getFullYear(), localNow.getMonth() + 1];
  const params: DashParams = { period, from: custom ? from : undefined, to: custom && to && DATE.test(to) ? to : undefined, unit, month: monthParam };

  // ── range [start, end) by exit time ──
  let start: number | null = null;
  let end: number | null = null;
  if (custom) {
    start = dayBoundsLocal(from!, tz)!.start;
    end = params.to ? (dayBoundsLocal(params.to, tz)?.end ?? null) : null;
  } else {
    start = periodRange(period as Period, now, tz).from;
  }

  const db = getDb();
  const [all, open] = await Promise.all([closedTrades(db, active.id), openTrades(db, active.id)]);
  if (all.length === 0 && open.length === 0) {
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
  const inRange = all.filter((t) => (start === null || t.exitTime >= start) && (end === null || t.exitTime < end));
  const k = computeKpis(inRange);
  const curve = equityCurve(end === null ? all : all.filter((t) => t.exitTime < end), active.startingBalance, start);
  const cal = calendarMonth(all, cy, cm, tz);
  const shift = (d: number) => {
    const m = cm + d;
    const y = cy + Math.floor((m - 1) / 12);
    const mm = ((((m - 1) % 12) + 12) % 12) + 1;
    return `${y}-${String(mm).padStart(2, "0")}`;
  };
  const recent = [...all].sort((a, b) => b.exitTime - a.exitTime).slice(0, 7);
  const dateFmt = new Intl.DateTimeFormat("en-AU", { timeZone: tz, day: "numeric", month: "short", year: "numeric" });
  const periodLabel = custom ? `${from} → ${params.to ?? "now"}` : (DASH_PERIODS.find((p) => p.id === period)?.label ?? period);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <DashboardControls params={params} />
      </div>

      <OpenTradesBanner trades={open} demo={getConfig().isDemo} />

      <KpiCard k={k} unit={unit} periodLabel={periodLabel} sinceLabel={k.since ? dateFmt.format(k.since) : null} />

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-lg border p-4 lg:col-span-2" aria-label="Equity curve">
          <header className="mb-2 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium">{unit === "r" ? "Cumulative R" : "Equity curve"}</h2>
            <span className="text-muted-foreground text-xs">
              {unit === "r" ? "Trades without a stop count as 0R" : <>from starting balance <span className="money">${active.startingBalance.toLocaleString()}</span></>}
            </span>
          </header>
          <EquityChart points={curve} unit={unit} baseline={active.startingBalance} tz={tz} />
        </section>
        <RecentTrades trades={recent} tz={tz} unit={unit} />
      </div>

      <PnlCalendar cal={cal} unit={unit} prevHref={dashHref(params, { month: shift(-1) })} nextHref={dashHref(params, { month: shift(1) })} />
    </div>
  );
}
