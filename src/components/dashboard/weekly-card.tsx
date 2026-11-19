import Link from "next/link";
import { CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtR, fmtSignedUsd, pnlClass } from "@/lib/format";
import { MISSING_KINDS, MISSING_LABELS, type MissingKind } from "@/lib/missing";
import { reviewHref, tradesHref } from "@/server/trades/filters";
import type { Week, WeekScore } from "@/lib/weekly";
import { WeeklyNoteButton } from "./weekly-note-button";
import { H2, SECTION } from "@/lib/ui";

type Note = { id: string; title: string | null; body: string; date: number };

export function WeeklyCard({
  week,
  score,
  missing,
  unit,
  tz,
  prevHref,
  nextHref,
  note,
  allTime,
}: {
  week: Week;
  score: WeekScore;
  missing: Record<MissingKind | "total", number>;
  unit: "usd" | "r";
  tz: string;
  prevHref: string;
  nextHref: string | null;
  note: Note | null;
  /** the dashboard looks past the journal start (All time): the links must too */
  allTime?: boolean;
}) {
  const r = unit === "r";
  const k = score.kpis;
  const range = new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "numeric", month: "short" });
  const ymd = (d: string) => new Date(`${d}T00:00:00Z`);
  const title = `${range.format(ymd(week.monday))} – ${range.format(ymd(week.sunday))} ${week.sunday.slice(0, 4)}`;
  const dayName = (d: string) =>
    new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric" }).format(ymd(d));
  const reviewed = missing.total - missing.review;
  const coverage = missing.total ? reviewed / missing.total : null;
  const base = {
    tab: "closed" as const,
    from: week.monday,
    to: week.sunday,
    dateBy: "exit" as const,
    ...(allTime ? { period: "all" as const } : {}),
  };
  const money = (v: number | null) => <span className={cn("money", pnlClass(v))}>{fmtSignedUsd(v)}</span>;

  const draft = {
    title: `Week of ${range.format(ymd(week.monday))} ${week.monday.slice(0, 4)}`,
    date: week.start,
    body: [
      `${k.count} trades, net ${fmtSignedUsd(k.net)}${k.avgR !== null ? `, avg ${fmtR(k.avgR)}` : ""}${k.winRate !== null ? `, win rate ${(k.winRate * 100).toFixed(0)}%` : ""}`,
      "",
      "What went well?",
      "",
      "What went wrong?",
      "",
      "Rules I broke, and why:",
      "",
      "One thing to focus on next week:",
      "",
    ].join("\n"),
  };

  return (
    <section className={SECTION} aria-label="Weekly reflection" data-testid="weekly-card">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className={H2}>Weekly reflection</h2>
        <div className="flex items-center gap-1">
          <Link
            href={prevHref}
            className="text-muted-foreground hover:text-foreground rounded p-0.5"
            aria-label="Previous week"
          >
            <ChevronLeft className="size-4" />
          </Link>
          <span className="text-xs tabular-nums" data-testid="weekly-range">
            {title}
          </span>
          {nextHref ? (
            <Link
              href={nextHref}
              className="text-muted-foreground hover:text-foreground rounded p-0.5"
              aria-label="Next week"
            >
              <ChevronRight className="size-4" />
            </Link>
          ) : (
            <span className="text-muted-foreground/40 p-0.5" aria-hidden>
              <ChevronRight className="size-4" />
            </span>
          )}
          {week.isCurrent && (
            <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px]">
              This week
            </span>
          )}
        </div>
        <div className="flex-1" />
        <WeeklyNoteButton existing={note} draft={draft} />
      </header>

      {k.count === 0 ? (
        <p className="text-muted-foreground py-6 text-center text-sm">No trades closed this week.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
            <Item label="Net">
              {r ? <span className={pnlClass(k.totalR)}>{fmtR(k.totalR)}</span> : money(k.net)}
            </Item>
            <Item label="Trades" sub={`${k.wins} won, ${k.losses} lost, ${k.breakeven} even`}>
              {k.count}
            </Item>
            <Item label="Win rate">{k.winRate === null ? "—" : `${(k.winRate * 100).toFixed(0)}%`}</Item>
            <Item
              label="Avg R"
              sub={k.rCount ? `median ${fmtR(k.medianR)}, ${k.rCount} with a stop` : "no stops"}
            >
              <span>{fmtR(k.avgR)}</span>
            </Item>
            <Item label="Best day" sub={score.bestDay ? dayName(score.bestDay.date) : undefined}>
              {score.bestDay ? money(score.bestDay.net) : "—"}
            </Item>
            <Item label="Worst day" sub={score.worstDay ? dayName(score.worstDay.date) : undefined}>
              {score.worstDay ? money(score.worstDay.net) : "—"}
            </Item>
            <Item label="Best trade" sub={score.bestTrade?.displayPair}>
              {score.bestTrade ? (
                <TradeLink id={score.bestTrade.id}>
                  {r ? fmtR(score.bestTrade.r) : money(score.bestTrade.netPnl)}
                </TradeLink>
              ) : (
                "—"
              )}
            </Item>
            <Item label="Worst trade" sub={score.worstTrade?.displayPair}>
              {score.worstTrade ? (
                <TradeLink id={score.worstTrade.id}>
                  {r ? fmtR(score.worstTrade.r) : money(score.worstTrade.netPnl)}
                </TradeLink>
              ) : (
                "—"
              )}
            </Item>
          </dl>

          <div className="mt-4 border-t pt-3">
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-muted-foreground">Review coverage</span>
              <span className="tabular-nums" data-testid="review-coverage">
                {reviewed} of {missing.total} reviewed
                {coverage !== null && `, ${(coverage * 100).toFixed(0)}%`}
              </span>
            </div>
            <div
              className="bg-muted mt-1.5 h-1.5 overflow-hidden rounded-full"
              role="progressbar"
              aria-valuenow={Math.round((coverage ?? 0) * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Review coverage"
            >
              <div
                className="bg-primary h-full rounded-full"
                style={{ width: `${(coverage ?? 0) * 100}%` }}
              />
            </div>
            <p className="text-muted-foreground mt-3 mb-1.5 text-xs">Missing context</p>
            <ul className="grid gap-1 text-xs sm:grid-cols-2" data-testid="missing-context">
              {MISSING_KINDS.filter((kind) => kind !== "review").map((kind) => (
                <li key={kind}>
                  {missing[kind] > 0 ? (
                    <Link
                      href={tradesHref(base, { missing: kind })}
                      className="hover:bg-muted flex items-center justify-between gap-2 rounded px-1.5 py-1"
                      title={MISSING_LABELS[kind].long}
                    >
                      <span>{MISSING_LABELS[kind].short}</span>
                      <span className="font-medium tabular-nums">{missing[kind]}</span>
                    </Link>
                  ) : (
                    <span className="text-muted-foreground flex items-center justify-between gap-2 px-1.5 py-1">
                      <span>{MISSING_LABELS[kind].short}</span>
                      <CheckCircle2 className="size-3.5" aria-label="none" />
                    </span>
                  )}
                </li>
              ))}
              {missing.review > 0 && (
                <li className="sm:col-span-2">
                  <Link href={reviewHref(base)} className="link px-1.5 text-xs" data-testid="review-week">
                    Review the {missing.review} unreviewed trade{missing.review === 1 ? "" : "s"}
                  </Link>
                </li>
              )}
            </ul>
          </div>
        </>
      )}
      <span className="sr-only">Times in {tz}</span>
    </section>
  );
}

function Item({ label, sub, children }: { label: string; sub?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-0.5 truncate font-semibold tabular-nums">{children}</dd>
      {sub && <dd className="text-muted-foreground truncate text-[11px]">{sub}</dd>}
    </div>
  );
}

function TradeLink({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <Link href={`/trades/${id}`} className="hover:underline">
      {children}
    </Link>
  );
}
