import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { BreakdownWidget } from "@/components/analytics/breakdown-widget";
import { CustomizeWidgets } from "@/components/analytics/customize";
import { DashboardControls } from "@/components/dashboard/controls";
import { EmptyState } from "@/components/shell/empty-state";
import { DASH_PERIODS, type DashParams } from "@/lib/dashboard-params";
import { setupBreakdowns, SETUP_WIDGETS } from "@/lib/analytics/setup";
import { cn } from "@/lib/utils";
import { dayBoundsLocal, periodRange, PERIODS, type Period } from "@/lib/periods";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { analyticsTrades } from "@/server/db/queries/analytics";
import { getActiveAccount, getSetting } from "@/server/db/queries/settings";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const SECTIONS = [
  { id: "setup", label: "Setup" },
  { id: "timing", label: "Timing", soon: true },
  { id: "risk", label: "Risk & execution", soon: true },
  { id: "behaviour", label: "Behaviour", soon: true },
] as const;

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { active } = await getActiveAccount();
  if (!active) return <EmptyState icon={BarChart3} title="No account" body="Create an account in Settings first." />;
  const tz = await getSetting("timezone", getConfig().timezone);
  const hidden = await getSetting<string[]>("analytics_hidden", []);
  const now = Date.now();

  const rawPeriod = one(sp.period) ?? "all";
  const from = one(sp.from);
  const to = one(sp.to);
  const custom = rawPeriod === "custom" && !!from && DATE.test(from);
  const period = custom ? "custom" : (PERIODS as readonly string[]).includes(rawPeriod) ? rawPeriod : "all";
  const unit = one(sp.unit) === "r" ? "r" : "usd";
  const params: DashParams = { period, from: custom ? from : undefined, to: custom && to && DATE.test(to) ? to : undefined, unit };

  let start: number | null = null;
  let end: number | null = null;
  if (custom) {
    start = dayBoundsLocal(from!, tz)!.start;
    end = params.to ? (dayBoundsLocal(params.to, tz)?.end ?? null) : null;
  } else {
    start = periodRange(period as Period, now, tz).from;
  }

  const all = await analyticsTrades(getDb(), active.id);
  const trades = all.filter((t) => (start === null || t.exitTime >= start) && (end === null || t.exitTime < end));
  const setup = setupBreakdowns(trades);
  const periodLabel = custom ? `${from} → ${params.to ?? "now"}` : (DASH_PERIODS.find((p) => p.id === period)?.label ?? period);
  const visible = SETUP_WIDGETS.filter((w) => !hidden.includes(w.id));

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Analytics</h1>
        <div className="flex flex-wrap items-center gap-2">
          <DashboardControls params={params} base="/analytics" defaultPeriod="all" />
          <CustomizeWidgets widgets={SETUP_WIDGETS} hidden={hidden} />
        </div>
      </div>

      <nav aria-label="Analytics sections" className="flex flex-wrap gap-1 border-b">
        {SECTIONS.map((s) =>
          "soon" in s && s.soon ? (
            <span key={s.id} className="text-muted-foreground/60 px-3 py-1.5 text-sm" title="Coming in the next update">
              {s.label} <span className="text-[10px]">soon</span>
            </span>
          ) : (
            <Link key={s.id} href="#" aria-current="page" className={cn("border-primary -mb-px border-b-2 px-3 py-1.5 text-sm font-medium")}>
              {s.label}
            </Link>
          ),
        )}
      </nav>

      <p className="text-muted-foreground text-xs" data-testid="analytics-summary">
        {trades.length} closed trade{trades.length === 1 ? "" : "s"} · {periodLabel} · by exit time · bars show {unit === "r" ? "average R (trades with a stop)" : "net P&L"}
      </p>

      {trades.length === 0 ? (
        <EmptyState icon={BarChart3} title="No closed trades in this period" body="Pick a longer period, or sync your wallet." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {visible.map((w) => (
            <BreakdownWidget key={w.id} id={w.id} title={w.title} description={w.description} data={setup[w.id]} unit={unit} hidden={hidden} />
          ))}
          {visible.length === 0 && <p className="text-muted-foreground text-sm">All widgets are hidden. Use “Widgets” to show them again.</p>}
        </div>
      )}
    </div>
  );
}
