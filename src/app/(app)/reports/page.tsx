import Link from "next/link";
import { Download, FileText } from "lucide-react";
import { DashboardControls } from "@/components/dashboard/controls";
import { EmptyState } from "@/components/shell/empty-state";
import { InsightsList } from "@/components/analytics/insights-list";
import { ScoresCard } from "@/components/analytics/scores-card";
import { PrintButton } from "@/components/reports/print-button";
import { insights } from "@/lib/analytics/insights";
import { scores } from "@/lib/analytics/scores";
import { computeKpis } from "@/lib/stats";
import { fmtPct, fmtR, fmtSignedUsd, fmtUsd, pnlClass } from "@/lib/format";
import { reportRange } from "@/lib/report-range";
import { cn } from "@/lib/utils";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { analyticsTrades } from "@/server/db/queries/analytics";
import { getActiveScope, getSetting } from "@/server/db/queries/settings";
import { localStamp, monthly, reportTrades, type ReportTrade } from "@/server/reports/export";

type SP = Record<string, string | string[] | undefined>;

/** Group net/count by a key, biggest loss first. Every trade lands in exactly one group, so they add up. */
function groupNet(trades: ReportTrade[], key: (t: ReportTrade) => string) {
  const by = new Map<string, { key: string; n: number; net: number; wins: number; losses: number }>();
  for (const t of trades) {
    const k = key(t);
    const g = by.get(k) ?? { key: k, n: 0, net: 0, wins: 0, losses: 0 };
    g.n++;
    g.net += t.netPnl;
    if (t.outcome === "win") g.wins++;
    if (t.outcome === "loss") g.losses++;
    by.set(k, g);
  }
  return [...by.values()].sort((a, b) => a.net - b.net || a.key.localeCompare(b.key));
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { active, wallet, walletId } = await getActiveScope();
  if (!active)
    return <EmptyState icon={FileText} title="No account" body="Create an account in Settings first." />;
  const tz = await getSetting("timezone", getConfig().timezone);
  const now = Date.now();
  const range = reportRange(sp, now, tz);
  const db = getDb();
  const [all, rich] = await Promise.all([
    reportTrades(db, active.id, walletId),
    analyticsTrades(db, active.id, walletId, { light: true }),
  ]);
  const trades = all.filter(range.inRange);
  const richIn = rich.filter(range.inRange);
  const k = computeKpis(trades.map((t) => ({ ...t, fees: t.fees ?? 0 })));
  const months = monthly(trades, tz);
  const pairs = groupNet(trades, (t) => t.displayPair);
  const dirs = groupNet(trades, (t) => t.direction);
  // pin the export to the moment this page was built, so "7D" or "this week" downloads the trades shown here
  const q = `?${range.qs ? `${range.qs}&` : ""}at=${now}`;
  const scope = `${active.name}${wallet ? ` · ${wallet.label}` : ""}`;
  const generated = localStamp(now, tz);

  return (
    <div className="report-print mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2" data-print="hide">
        <h1 className="text-lg font-semibold">Reports</h1>
        <div className="flex flex-wrap items-center gap-2">
          <DashboardControls params={range.params} base="/reports" defaultPeriod="month" showUnit={false} />
          <PrintButton />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs" data-print="hide">
        <span className="text-muted-foreground">Download CSV:</span>
        <a
          href={`/api/export/trades.csv${q}`}
          className="hover:bg-muted inline-flex items-center gap-1 rounded-md border px-2 py-1"
          data-testid="export-trades"
        >
          <Download className="size-3.5" /> Trades
        </a>
        <a
          href={`/api/export/monthly.csv${q}`}
          className="hover:bg-muted inline-flex items-center gap-1 rounded-md border px-2 py-1"
          data-testid="export-monthly"
        >
          <Download className="size-3.5" /> Monthly summary
        </a>
        <span className="text-muted-foreground">Closed trades exited in the period; times in {tz}.</span>
      </div>

      <header className="border-b pb-2">
        <h2 className="text-xl font-semibold">Trading report · {range.label}</h2>
        <p className="text-muted-foreground text-xs" data-testid="report-meta">
          {scope} · {trades.length} closed trade{trades.length === 1 ? "" : "s"} by exit time · generated{" "}
          {generated} ({tz})
        </p>
      </header>

      {trades.length === 0 ? (
        <EmptyState icon={FileText} title="No closed trades in this period" body="Pick a longer period." />
      ) : (
        <>
          <section
            className="grid grid-cols-2 gap-3 rounded-lg border p-4 sm:grid-cols-4"
            aria-label="Summary"
            data-testid="report-kpis"
          >
            <Kpi label="Net P&L" id="net">
              <span className={cn("money", pnlClass(k.net))}>{fmtSignedUsd(k.net)}</span>
            </Kpi>
            <Kpi label="Trades" id="count">
              {k.count}{" "}
              <span className="text-muted-foreground text-xs">
                ({k.wins}W / {k.losses}L / {k.breakeven}BE)
              </span>
            </Kpi>
            <Kpi label="Win rate" id="winrate">
              {k.winRate === null ? "—" : fmtPct(k.winRate * 100, 0).replace("+", "")}
            </Kpi>
            <Kpi label="Fees · funding" id="costs">
              <span className="money">{fmtUsd(k.fees)}</span> ·{" "}
              <span className={cn("money", pnlClass(k.funding))}>{fmtSignedUsd(k.funding)}</span>
            </Kpi>
          </section>

          <ScoresCard s={scores(richIn, rich, tz)} title="Scores" />

          <section className="rounded-lg border p-4" aria-label="Top leaks">
            <h2 className="mb-2 text-sm font-medium">Top leaks</h2>
            {(() => {
              const list = insights(richIn, rich, tz).list.slice(0, 5);
              return list.length ? (
                <InsightsList items={list} tz={tz} compact />
              ) : (
                <p className="text-muted-foreground text-sm">No losing patterns found.</p>
              );
            })()}
          </section>

          <Table
            title="By month"
            id="report-months"
            head={["Month", "Trades", "W / L / BE", "Fees", "Funding", "Net", "Total R"]}
            rows={months.map((m) => [
              m.month,
              m.trades,
              `${m.wins} / ${m.losses} / ${m.breakeven}`,
              <span key="f" className="money">
                {fmtUsd(m.fees)}
              </span>,
              <span key="u" className={cn("money", pnlClass(m.funding))}>
                {fmtSignedUsd(m.funding)}
              </span>,
              <span key="n" className={cn("money", pnlClass(m.net))} data-net={m.net}>
                {fmtSignedUsd(m.net)}
              </span>,
              m.rCount ? fmtR(m.totalR) : "—",
            ])}
            total={[
              "Total",
              k.count,
              `${k.wins} / ${k.losses} / ${k.breakeven}`,
              <span key="f" className="money">
                {fmtUsd(k.fees)}
              </span>,
              <span key="u" className={cn("money", pnlClass(k.funding))}>
                {fmtSignedUsd(k.funding)}
              </span>,
              <span key="n" className={cn("money", pnlClass(k.net))}>
                {fmtSignedUsd(k.net)}
              </span>,
              "",
            ]}
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <Table
              title="By pair"
              id="report-pairs"
              head={["Pair", "Trades", "W / L", "Net"]}
              rows={pairs.map((g) => [
                g.key,
                g.n,
                `${g.wins} / ${g.losses}`,
                <span key="n" className={cn("money", pnlClass(g.net))} data-net={g.net}>
                  {fmtSignedUsd(g.net)}
                </span>,
              ])}
              total={[
                "Total",
                k.count,
                `${k.wins} / ${k.losses}`,
                <span key="n" className={cn("money", pnlClass(k.net))}>
                  {fmtSignedUsd(k.net)}
                </span>,
              ]}
            />
            <Table
              title="By direction"
              id="report-dirs"
              head={["Direction", "Trades", "W / L", "Net"]}
              rows={dirs.map((g) => [
                g.key === "long" ? "Long" : "Short",
                g.n,
                `${g.wins} / ${g.losses}`,
                <span key="n" className={cn("money", pnlClass(g.net))} data-net={g.net}>
                  {fmtSignedUsd(g.net)}
                </span>,
              ])}
              total={[
                "Total",
                k.count,
                `${k.wins} / ${k.losses}`,
                <span key="n" className={cn("money", pnlClass(k.net))}>
                  {fmtSignedUsd(k.net)}
                </span>,
              ]}
            />
          </div>
          <Table
            title="Trades"
            id="report-trades"
            head={["Exit", "Pair", "Side", "Net", "R", "Strategy", "Grade"]}
            rows={[...trades].reverse().map((t) => [
              localStamp(t.exitTime, tz),
              <Link key="p" href={`/trades/${t.id}`} className="hover:underline">
                {t.displayPair}
              </Link>,
              t.direction,
              <span key="n" className={cn("money", pnlClass(t.netPnl))}>
                {fmtSignedUsd(t.netPnl)}
              </span>,
              fmtR(t.r),
              t.strategy ?? "—",
              t.grade ?? "—",
            ])}
          />
        </>
      )}
    </div>
  );
}

function Kpi({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5" data-testid={`report-${id}`}>
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{children}</span>
    </div>
  );
}

function Table({
  title,
  id,
  head,
  rows,
  total,
}: {
  title: string;
  id: string;
  head: string[];
  rows: React.ReactNode[][];
  total?: React.ReactNode[];
}) {
  return (
    <section className="rounded-lg border" aria-label={title} data-testid={id}>
      <h2 className="border-b px-4 py-2 text-sm font-medium">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead className="text-muted-foreground">
            <tr>
              {head.map((h, i) => (
                <th key={h} className={cn("px-4 py-1.5 font-normal", i === 0 ? "text-left" : "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t" data-testid="report-row">
                {r.map((c, k) => (
                  <td key={k} className={cn("px-4 py-1", k === 0 ? "text-left" : "text-right")}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {total && (
            <tfoot>
              <tr className="border-t font-medium" data-testid="report-total">
                {total.map((c, k) => (
                  <td key={k} className={cn("px-4 py-1.5", k === 0 ? "text-left" : "text-right")}>
                    {c}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}
