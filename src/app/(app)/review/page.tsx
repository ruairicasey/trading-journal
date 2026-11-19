import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import { EmptyState } from "@/components/shell/empty-state";
import { ReviewFlow } from "@/components/review/review-flow";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { getActiveScope, getSetting } from "@/server/db/queries/settings";
import { matchingTradeIds } from "@/server/db/queries/trades";
import { loadTradeForEdit } from "@/server/trades/journal";
import { parseFilters, reviewHref, tradesHref, type TradeFilters } from "@/server/trades/filters";
import { periodPhrase } from "@/lib/dashboard-params";
import { weekOf } from "@/lib/weekly";

const MAX_QUEUE = 200;
// "YYYY-MM-DD" is already a local date: format it in UTC so no zone can shift the day
const day = (d: string) =>
  new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${d}T12:00:00Z`),
  );

/**
 * Step through unreviewed closed trades one at a time. Takes the Trades page's filters (the week card and the
 * dashboard link here with theirs); with none, this week's exits, or last week's if this week has none yet.
 * The queue is fixed when the page loads, so a saved trade keeps its place while you move back and forth.
 */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const { active, walletId } = await getActiveScope();
  if (!active)
    return (
      <EmptyState icon={ClipboardCheck} title="No account" body="Create an account in Settings first." />
    );
  const db = getDb();
  const tz = await getSetting("timezone", getConfig().timezone);
  const now = Date.now();

  const given = parseFilters(raw);
  const hasScope = given.from || given.to || given.period || given.pair || given.strategy || given.q;
  // every match (ids only), oldest first so you review in the order you traded; the cap keeps the oldest
  const queue = async (f: TradeFilters) =>
    (
      await matchingTradeIds(
        db,
        active.id,
        { ...f, tab: "closed", missing: "review", page: 1 },
        { tz, now, walletId, limit: 100_000, journalStart: active.journalStart },
      )
    ).reverse();

  if (!hasScope) {
    // no range given: this week's exits, or last week's if none yet. Redirect so the week stays fixed while you
    // review (a save re-renders this page, and the fallback would otherwise jump weeks once this one is done).
    const week = weekOf(undefined, now, tz);
    let pick = { ...given, from: week.monday, to: week.sunday, dateBy: "exit" as const };
    if ((await queue(pick)).length === 0) {
      const last = weekOf(week.prev, now, tz);
      pick = { ...given, from: last.monday, to: last.sunday, dateBy: "exit" };
    }
    redirect(reviewHref(pick));
  }
  const filters: TradeFilters = given;
  const all = await queue(filters);
  const ids = all.slice(0, MAX_QUEUE);

  const verb = filters.dateBy === "exit" ? "Closed" : "Opened";
  const scope =
    filters.from && filters.to
      ? `${verb} ${day(filters.from)} to ${day(filters.to)}`
      : filters.from
        ? `${verb} since ${day(filters.from)}`
        : filters.to
          ? `${verb} up to ${day(filters.to)}`
          : filters.period
            ? `Closed trades, ${periodPhrase({ period: filters.period })}`
            : "Closed trades";

  const first = ids.length ? await loadTradeForEdit(db, active.id, ids[0]) : null;

  return (
    <div className="mx-auto max-w-[1180px] space-y-7">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-22 font-semibold">Review</h1>
          <p className="text-muted-foreground text-13" data-testid="review-scope">
            {scope}
            {all.length > ids.length && `. The oldest ${ids.length} of ${all.length} unreviewed`}
          </p>
        </div>
        <Link href={tradesHref({ ...filters, tab: "closed" })} className="link text-sm">
          Back to trades
        </Link>
      </header>
      {/* keyed by the range: a save re-renders this page with a shorter queue, which the mounted flow ignores */}
      <ReviewFlow key={JSON.stringify(filters)} ids={ids} initial={first} tz={tz} />
    </div>
  );
}
