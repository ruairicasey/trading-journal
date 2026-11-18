import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { BreakdownWidget } from "@/components/analytics/breakdown-widget";
import { CustomizeWidgets } from "@/components/analytics/customize";
import { DashboardControls } from "@/components/dashboard/controls";
import { EmptyState } from "@/components/shell/empty-state";
import { DASH_PERIODS, dashHref, type DashParams } from "@/lib/dashboard-params";
import { setupBreakdowns, SETUP_WIDGETS } from "@/lib/analytics/setup";
import { TIMING_WIDGETS, timingBreakdowns } from "@/lib/analytics/timing";
import { RISK_WIDGETS, riskBreakdowns } from "@/lib/analytics/risk";
import { BEHAVIOUR_WIDGETS, behaviourBreakdowns, dailySeries, rolling, streaks } from "@/lib/analytics/behaviour";
import { InsightsList } from "@/components/analytics/insights-list";
import { insights, INSIGHT_RULES } from "@/lib/analytics/insights";
import { DailyWidget, RollingWidget, StreaksWidget } from "@/components/analytics/behaviour-widgets";
import { localDateKey } from "@/lib/periods";
import { fmtUsd } from "@/lib/format";
import type { Breakdown } from "@/lib/analytics/types";
import { describeSession, sessionHoursIn } from "@/lib/sessions";
import { cn } from "@/lib/utils";
import { dayBoundsLocal, periodRange, PERIODS, type Period } from "@/lib/periods";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { analyticsTrades } from "@/server/db/queries/analytics";
import { getActiveScope, getSessions, getSetting } from "@/server/db/queries/settings";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const SECTIONS = [
  { id: "setup", label: "Setup" },
  { id: "timing", label: "Timing" },
  { id: "risk", label: "Risk & execution" },
  { id: "behaviour", label: "Behaviour" },
  { id: "insights", label: "Insights" },
] as const;

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { active, walletId } = await getActiveScope();
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
  const rawSection = one(sp.section);
  const section = rawSection === "timing" || rawSection === "risk" || rawSection === "behaviour" || rawSection === "insights" ? rawSection : "setup";
  const params: DashParams = {
    period,
    from: custom ? from : undefined,
    to: custom && to && DATE.test(to) ? to : undefined,
    unit,
    section: section === "setup" ? undefined : section,
  };

  let start: number | null = null;
  let end: number | null = null;
  if (custom) {
    start = dayBoundsLocal(from!, tz)!.start;
    end = params.to ? (dayBoundsLocal(params.to, tz)?.end ?? null) : null;
  } else {
    start = periodRange(period as Period, now, tz).from;
  }

  const all = await analyticsTrades(getDb(), active.id, walletId);
  const trades = all.filter((t) => (start === null || t.exitTime >= start) && (end === null || t.exitTime < end));
  const sessions = await getSessions();
  const hours = (ms: number | null) => (ms === null ? "—" : ms < 3_600_000 ? `${Math.round(ms / 60_000)}m` : ms < 172_800_000 ? `${(ms / 3_600_000).toFixed(1)}h` : `${(ms / 86_400_000).toFixed(1)}d`);
  let widgets: { id: string; title: string; description: string }[];
  let data: Record<string, Breakdown>;
  const footers: Record<string, React.ReactNode> = {};
  const customWidgets: Record<string, React.ReactNode> = {};
  if (section === "timing") {
    const tb = timingBreakdowns(trades, { tz, sessions, context: all });
    widgets = TIMING_WIDGETS;
    data = Object.fromEntries(TIMING_WIDGETS.map((w) => [w.id, tb[w.id]]));
    footers.session = (
      <div className="grid gap-0.5" data-testid="session-hours">
        <span>
          Hours used (first match wins){tb.sessionFromTrade ? ` · ${tb.sessionFromTrade} trade${tb.sessionFromTrade === 1 ? " uses" : "s use"} the session set on the trade` : ""}:
        </span>
        {sessions.map((x) => (
          <span key={x.name} className="tabular-nums">
            <span className="text-foreground">{x.name}</span> {describeSession(x)} · now {sessionHoursIn(x, now, "UTC")} UTC · {sessionHoursIn(x, now, tz)} yours
          </span>
        ))}
        <Link href="/settings" className="text-sky-400 hover:underline">
          Edit sessions in Settings →
        </Link>
      </div>
    );
    footers.hold = (
      <span data-testid="hold-avg">
        Average hold: winners <span className="text-foreground tabular-nums">{hours(tb.holdWin)}</span> · losers{" "}
        <span className="text-foreground tabular-nums">{hours(tb.holdLoss)}</span>
      </span>
    );
  } else if (section === "insights") {
    widgets = [];
    data = {};
  } else if (section === "behaviour") {
    widgets = BEHAVIOUR_WIDGETS;
    const inPeriod = (t: (typeof all)[number]) => (start === null || t.exitTime >= start) && (end === null || t.exitTime < end);
    const st = streaks(all, inPeriod);
    data = behaviourBreakdowns(trades, { tz, context: all });
    const DAY = 86_400_000;
    const lastTs = Math.min(end === null ? now : end - 1, now);
    const toDate = localDateKey(lastTs, tz);
    const firstExit = trades[0]?.exitTime ?? lastTs;
    const periodFrom = localDateKey(start ?? firstExit, tz);
    // rolling windows need up to 30 days of history before the period starts
    const days = dailySeries(all, tz, localDateKey((start ?? firstExit) - 31 * DAY, tz), toDate);
    const keep = <T extends { date: string }>(xs: T[]) => xs.filter((x) => x.date >= periodFrom);
    const dailyFrom = [localDateKey(lastTs - 29 * DAY, tz), localDateKey(start ?? firstExit, tz)].sort().at(-1)!;
    const common = (id: string) => {
      const w = BEHAVIOUR_WIDGETS.find((x) => x.id === id)!;
      return { id, title: w.title, description: w.description, hidden, unit, tz } as const;
    };
    const pick = (t: (typeof all)[number] | null) => (t ? { id: t.id, displayPair: t.displayPair, netPnl: t.netPnl, r: t.r } : null);
    customWidgets.streaks = <StreaksWidget {...common("streaks")} current={st.current} longestWin={st.longestWin} longestLoss={st.longestLoss} best={pick(st.best)} worst={pick(st.worst)} />;
    customWidgets.rolling = <RollingWidget {...common("rolling")} series7={keep(rolling(days, 7))} series30={keep(rolling(days, 30))} />;
    customWidgets.daily = <DailyWidget {...common("daily")} days={dailySeries(trades, tz, dailyFrom, toDate)} />;
    footers["after-streak"] = <span>The run is counted in exit order across all your trades, so it can start before this period. Breakevens don&apos;t break a run.</span>;
    footers.stacking = <span>Counts any other trade (any pair) still open at the moment you entered.</span>;
  } else if (section === "risk") {
    const rb = riskBreakdowns(trades);
    widgets = RISK_WIDGETS;
    data = rb.breakdowns;
    const pctOf = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
    footers["risk-size"] = (
      <span data-testid="typical-risk">
        Typical (median) risk <span className="money text-foreground tabular-nums">{rb.typicalRisk === null ? "—" : fmtUsd(rb.typicalRisk)}</span> across{" "}
        {rb.withStop} trade{rb.withStop === 1 ? "" : "s"} with a stop. Trades without a stop are left out.
      </span>
    );
    footers["exit-by"] = <span>&quot;Take-profit&quot; and &quot;stop&quot; mean the final exit filled one of your trigger orders; anything else counts as by hand.</span>;
    footers["loser-max-r"] = (
      <span data-testid="losers-1r">
        <span className="text-foreground tabular-nums">{pctOf(rb.losersReached1R)}</span> of losers with max R recorded ({rb.losersWithMax} of {rb.losers}) were 1R+ in profit
        before they lost.
      </span>
    );
    footers.capture = (
      <span data-testid="avg-capture">
        On average you kept <span className="text-foreground tabular-nums">{pctOf(rb.avgCapture)}</span> of the max R reached ({rb.winnersWithMax} winner
        {rb.winnersWithMax === 1 ? "" : "s"} with max R recorded).
      </span>
    );
  } else {
    widgets = SETUP_WIDGETS;
    data = setupBreakdowns(trades);
  }
  const periodLabel = custom ? `${from} → ${params.to ?? "now"}` : (DASH_PERIODS.find((p) => p.id === period)?.label ?? period);
  const visible = widgets.filter((w) => !hidden.includes(w.id));

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Analytics</h1>
        <div className="flex flex-wrap items-center gap-2">
          <DashboardControls params={params} base="/analytics" defaultPeriod="all" />
          {section !== "insights" && <CustomizeWidgets widgets={widgets} hidden={hidden} />}
        </div>
      </div>

      <nav aria-label="Analytics sections" className="flex flex-wrap gap-1 border-b">
        {SECTIONS.map((s) =>
          "soon" in s && s.soon ? (
            <span key={s.id} className="text-muted-foreground/60 px-3 py-1.5 text-sm" title="Coming in the next update">
              {s.label} <span className="text-[10px]">soon</span>
            </span>
          ) : (
            <Link
              key={s.id}
              href={dashHref(params, { section: s.id === "setup" ? undefined : s.id }, "/analytics", "all")}
              aria-current={section === s.id ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 px-3 py-1.5 text-sm",
                section === s.id ? "border-primary font-medium" : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              {s.label}
            </Link>
          ),
        )}
      </nav>

      <p className="text-muted-foreground text-xs" data-testid="analytics-summary">
        {trades.length} closed trade{trades.length === 1 ? "" : "s"} · {periodLabel} · by exit time{section === "timing" ? ` · day, hour and session by entry time (${tz})` : ""}
        {section === "insights" ? " · ranked by net P&L, with total R alongside" : ` · bars show ${unit === "r" ? "average R (trades with a stop)" : "net P&L"}`}
      </p>

      {section === "insights" && trades.length > 0 ? (
        <InsightsSection list={insights(trades, all, tz).list} tz={tz} />
      ) : trades.length === 0 ? (
        <EmptyState icon={BarChart3} title="No closed trades in this period" body="Pick a longer period, or sync your wallet." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {visible.map((w) =>
            customWidgets[w.id] ? (
              <div key={w.id}>{customWidgets[w.id]}</div>
            ) : (
              <BreakdownWidget key={w.id} id={w.id} title={w.title} description={w.description} data={data[w.id]} unit={unit} hidden={hidden} footer={footers[w.id]} />
            ),
          )}
          {visible.length === 0 && <p className="text-muted-foreground text-sm">All widgets are hidden. Use “Widgets” to show them again.</p>}
        </div>
      )}
    </div>
  );
}

function InsightsSection({ list, tz }: { list: ReturnType<typeof insights>["list"]; tz: string }) {
  return (
    <div className="grid gap-3">
      <p className="text-muted-foreground text-xs">
        Patterns that lost money in this period, worst first ({INSIGHT_RULES.length} rules checked; 3+ trades each). A trade can match several, so the
        amounts overlap and don&apos;t add up to your total.
      </p>
      {list.length ? (
        <InsightsList items={list} tz={tz} />
      ) : (
        <p className="rounded-lg border p-4 text-sm" data-testid="insights-none">
          No losing patterns found in this period.
        </p>
      )}
      <details className="text-muted-foreground text-xs">
        <summary className="cursor-pointer">The rules</summary>
        <ul className="mt-1 grid gap-0.5">
          {INSIGHT_RULES.map((r) => (
            <li key={r.id}>
              <span className="text-foreground">{r.title}:</span> {r.rule}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
