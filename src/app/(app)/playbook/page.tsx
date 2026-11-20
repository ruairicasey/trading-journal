import Link from "next/link";
import { BookOpen } from "lucide-react";
import { DashboardControls } from "@/components/dashboard/controls";
import { EmptyState } from "@/components/shell/empty-state";
import { PlaybookEditor } from "@/components/playbook/playbook-editor";
import { periodPhrase } from "@/lib/dashboard-params";
import { fmtR, fmtSignedUsd, pnlClass } from "@/lib/format";
import { fromFloor } from "@/lib/journal-start";
import { NO_STRATEGY, playbook, type PlaybookRow } from "@/lib/analytics/playbook";
import { DEFAULT_MIN_N } from "@/lib/analytics/types";
import { H2 } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { resolveView, wholeDays } from "@/lib/view-period";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { analyticsTrades } from "@/server/db/queries/analytics";
import { getActiveScope, getSetting } from "@/server/db/queries/settings";
import { listStrategies } from "@/server/playbook/playbook";
import { tradesHref } from "@/server/trades/filters";

type SP = Record<string, string | string[] | undefined>;
const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x)}%`);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export default async function PlaybookPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { active, walletId } = await getActiveScope();
  if (!active)
    return <EmptyState icon={BookOpen} title="No account" body="Create an account in Settings first." />;
  const tz = await getSetting("timezone", getConfig().timezone);
  const view = resolveView(sp, Date.now(), tz, active.journalStart);
  const db = getDb();
  const [all, strategies] = await Promise.all([
    analyticsTrades(db, active.id, walletId, { light: true }),
    listStrategies(db),
  ]);
  const days = wholeDays(view, tz);
  const trades = fromFloor(all, view.floor).filter(days.inPeriod);
  const book = playbook(trades, strategies);
  const phrase = periodPhrase(view.params);

  // the Trades page shows the same trades: closed, by exit date over whole local days, with the same floor
  const listHref = (id: string) => tradesHref({ tab: "closed", strategy: id, ...days.filters });

  return (
    <div className="mx-auto max-w-[1180px] space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-22 font-semibold">Playbook</h1>
          <p className="text-muted-foreground text-sm">
            Your strategies, their rules and their record, {phrase}.
          </p>
        </div>
        <DashboardControls
          params={view.params}
          base="/playbook"
          defaultPeriod={view.defaultPeriod}
          showUnit={false}
          hasStart={active.journalStart !== null}
        />
      </div>

      {book.rows.length === 0 && (
        <p
          className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm"
          data-testid="playbook-empty"
        >
          No strategies yet.{" "}
          <Link className="underline" href="/settings/journal?kind=strategy">
            Add the setups you trade
          </Link>
          , then write each one&apos;s rules here.
        </p>
      )}

      <p className="text-muted-foreground text-sm" data-testid="playbook-total">
        {plural(book.total.n, "closed trade")} {phrase}, net{" "}
        <span className={cn("money", pnlClass(book.total.net))}>{fmtSignedUsd(book.total.net)}</span>
        {book.none ? ` · ${book.none.stats.n} without a strategy` : ""}
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {book.rows.map((r) => (
          <StrategyCard
            key={r.id}
            r={r}
            href={listHref(r.id)}
            editable={strategies.some((s) => s.id === r.id)}
          />
        ))}
        {book.none && <StrategyCard r={book.none} href={null} editable={false} />}
      </div>
    </div>
  );
}

function StrategyCard({ r, href, editable }: { r: PlaybookRow; href: string | null; editable: boolean }) {
  const s = r.stats;
  const c = r.compliance;
  const notFollowed = { n: c.partial.n + c.broken.n, net: c.partial.net + c.broken.net };
  return (
    <section
      className="flex min-w-0 flex-col gap-3.5 rounded-lg border p-4"
      data-testid="strategy-card"
      data-strategy={r.id}
      aria-label={r.label}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={H2}>
          {r.label}
          {r.archived && <span className="text-muted-foreground ml-2 text-xs font-normal">archived</span>}
        </h2>
        {href && s.n > 0 && (
          <Link href={href} className="text-ink-2 text-sm underline" data-testid="strategy-trades">
            View {plural(s.n, "trade")}
          </Link>
        )}
      </div>
      {r.id === NO_STRATEGY ? (
        <p className="text-muted-foreground text-sm">
          Closed trades with no strategy set. Pick one on each trade so it counts toward a playbook.
        </p>
      ) : (
        r.description && <p className="text-ink-2 text-sm">{r.description}</p>
      )}

      <dl className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        <Stat label="Trades" value={String(s.n)} id="n" />
        <Stat
          label="Win rate"
          value={s.winRate === null ? "—" : `${Math.round(s.winRate * 100)}%`}
          id="win"
        />
        <Stat label="Net" value={fmtSignedUsd(s.net)} cls={cn("money", pnlClass(s.net))} id="net" />
        <Stat
          label="Avg trade"
          value={s.avgTrade === null ? "—" : fmtSignedUsd(s.avgTrade)}
          cls={cn("money", pnlClass(s.avgTrade))}
          id="avg"
        />
        <Stat label={`Avg R (${s.rCount})`} value={s.avgR === null ? "—" : fmtR(s.avgR)} id="r" />
      </dl>
      {s.small && s.n > 0 && (
        <p className="text-muted-foreground text-xs">
          Fewer than {DEFAULT_MIN_N} trades: too few to judge yet.
        </p>
      )}

      {s.n > 0 && (
        <div className="text-sm" data-testid="strategy-compliance">
          <p>
            Rules followed <span className="font-medium">{pct(c.score)}</span>{" "}
            <span className="text-muted-foreground">
              ({c.marked} of {s.n} marked)
            </span>
          </p>
          <ul className="text-ink-2 mt-1 space-y-0.5">
            <Split label="Followed" part={c.followed} id="followed" />
            <Split label="Partly or not followed" part={notFollowed} id="not-followed" />
            <Split label="Not marked" part={c.unmarked} id="unmarked" />
          </ul>
        </div>
      )}

      {r.id !== NO_STRATEGY && (
        <div className="flex flex-col gap-2">
          {r.rules.length ? (
            <ol className="list-decimal space-y-0.5 pl-5 text-sm" data-testid="strategy-rules">
              {r.rules.map((rule, i) => {
                const st = r.ruleStats[i];
                return (
                  <li key={i}>
                    <span data-testid="rule-text">{rule}</span>
                    {st && st.of > 0 && (
                      <span
                        className="text-muted-foreground ml-2 text-xs tabular-nums"
                        data-testid="rule-kept"
                      >
                        kept {st.kept} of {st.of}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="text-muted-foreground text-sm">No rules written yet.</p>
          )}
          {editable && (
            <div>
              <PlaybookEditor id={r.id} description={r.description ?? ""} rules={r.rulesText ?? ""} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, cls, id }: { label: string; value: string; cls?: string; id: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className={cn("text-15 font-medium tabular-nums", cls)} data-testid={`stat-${id}`}>
        {value}
      </dd>
    </div>
  );
}

function Split({ label, part, id }: { label: string; part: { n: number; net: number }; id: string }) {
  return (
    <li className="flex justify-between gap-3" data-testid={`split-${id}`}>
      <span>
        {label} <span className="text-muted-foreground">({part.n})</span>
      </span>
      <span className={cn("money tabular-nums", part.n ? pnlClass(part.net) : "text-muted-foreground")}>
        {part.n ? fmtSignedUsd(part.net) : "—"}
      </span>
    </li>
  );
}
