import Link from "next/link";
import { ListOrdered, SearchX } from "lucide-react";
import { X } from "lucide-react";
import { MISSING_LABELS, type MissingKind } from "@/lib/missing";
import { EmptyState } from "@/components/shell/empty-state";
import { NotesList, AddNoteButton } from "@/components/trades/notes-list";
import { TradeList } from "@/components/trades/trade-list";
import { TradesToolbar } from "@/components/trades/trades-toolbar";
import { SavedFilters } from "@/components/trades/saved-filters";
import { listSavedFilters, pickSaved } from "@/server/trades/saved-filters";
import { parseSearch } from "@/lib/search";
import { cn } from "@/lib/utils";
import { PERIOD_LABELS } from "@/lib/periods";
import { journalFloor, SINCE_START } from "@/lib/journal-start";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { getActiveScope, getSessions, getSetting } from "@/server/db/queries/settings";
import { countNotes, filterOptions, listNotes, listTrades } from "@/server/db/queries/trades";
import {
  activeFilterCount,
  CHIPS,
  chipActive,
  FILTER_KEYS,
  parseFilters,
  TABS,
  toggleChipHref,
  tradesHref,
  type TradeFilters,
} from "@/server/trades/filters";

const TAB_LABELS: Record<(typeof TABS)[number], string> = {
  all: "All",
  planned: "Planned",
  open: "Open",
  closed: "Closed",
  notes: "Notes",
};

export default async function TradesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);
  const { active, wallets, walletId } = await getActiveScope();
  if (!active)
    return <EmptyState icon={ListOrdered} title="No account" body="Create an account in Settings first." />;

  const db = getDb();
  const [tz, sessions, options, savedFilters] = await Promise.all([
    getSetting("timezone", getConfig().timezone),
    getSessions(),
    filterOptions(db, active.id, walletId),
    listSavedFilters(db),
  ]);
  // the current filters as plain strings (no page): what "save filter" stores and "select all matching" re-runs
  const current = pickSaved(filters);
  const params = Object.fromEntries(Object.entries(current).map(([k, v]) => [k, String(v)]));
  const sameAs = (f: Record<string, unknown>) =>
    Object.keys(f).length === Object.keys(current).length &&
    Object.entries(f).every(([k, v]) => params[k] === String(v));
  const savedChips = savedFilters.map((sf) => ({
    id: sf.id,
    name: sf.name,
    href: tradesHref(sf.filters),
    active: sameAs(sf.filters),
  }));
  const isNotes = filters.tab === "notes";
  const [trades, notesCount, notes] = await Promise.all([
    listTrades(db, active.id, isNotes ? { ...filters, page: 1 } : filters, {
      tz,
      walletId,
      journalStart: active.journalStart,
    }),
    countNotes(db, active.id, filters.q),
    isNotes ? listNotes(db, active.id, filters) : Promise.resolve(null),
  ]);
  const counts = { ...trades.counts, notes: notesCount };
  const total = isNotes ? notes!.total : trades.total;
  const page = filters.page;
  const pageSize = trades.pageSize;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const labelFor = (k: (typeof FILTER_KEYS)[number], v: unknown) => {
    if (k === "pair") return options.pairs.find((p) => p.coin === v)?.displayPair ?? String(v);
    if (k === "strategy") return options.strategies.find((s) => s.id === v)?.label ?? "Strategy";
    if (k === "period") return PERIOD_LABELS[v as keyof typeof PERIOD_LABELS];
    if (k === "minR") return `R ≥ ${v}`;
    if (k === "maxR") return `R ≤ ${v}`;
    if (k === "from") return `${filters.dateBy === "exit" ? "Exited from" : "From"} ${v}`;
    if (k === "to") return `${filters.dateBy === "exit" ? "Exited to" : "To"} ${v}`;
    if (k === "outcome") return { win: "Wins", loss: "Losses", be: "Breakeven" }[v as string];
    if (k === "dir") return v === "long" ? "Longs" : "Shorts";
    if (k === "grade") return `Grade ${v}`;
    if (k === "type") return v === "planned" ? "Planned setups" : "Reactive";
    if (k === "missing") return MISSING_LABELS[v as MissingKind]?.short ?? String(v);
    return String(v);
  };
  const pills = FILTER_KEYS.filter((k) => filters[k] !== undefined);
  // the journal start hides older trades unless the filter asks for All time
  const floor = journalFloor(active.journalStart, filters.period ?? SINCE_START);
  const floorLabel =
    floor === null
      ? null
      : new Intl.DateTimeFormat("en-AU", {
          timeZone: tz,
          day: "numeric",
          month: "short",
          year: "numeric",
        }).format(floor);

  return (
    <div className="mx-auto max-w-[1180px] space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-22 font-semibold">Trades</h1>
        <div className="flex gap-2.5">
          {isNotes ? (
            <AddNoteButton />
          ) : (
            <a
              href={`/api/export/trades.csv?period=${filters.period ?? (active.journalStart !== null ? SINCE_START : "all")}`}
              className="bg-subtle hover:bg-hover text-ink rounded-[9px] px-3.5 py-2 text-sm"
              data-testid="trades-export"
              title="CSV of the trades that closed in this period (the same file as Reports)"
            >
              Export closed trades
            </a>
          )}
        </div>
      </header>

      <nav className="flex gap-6 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--rule)]" aria-label="Trade tabs">
        {TABS.map((tab) => (
          <Link
            key={tab}
            href={tradesHref(filters, { tab })}
            aria-current={filters.tab === tab ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-1.5 pb-3 text-sm",
              filters.tab === tab
                ? "text-ink font-medium shadow-[inset_0_-2px_0_var(--ink)]"
                : "text-ink-2 hover:text-ink",
            )}
          >
            {TAB_LABELS[tab]}
            <span className="text-muted-foreground font-normal tabular-nums">{counts[tab]}</span>
          </Link>
        ))}
      </nav>

      {floorLabel && (
        <p className="text-muted-foreground text-xs" data-testid="journal-start-note">
          Trades opened from {floorLabel}, your journal start.{" "}
          <Link href={tradesHref(filters, { period: "all", page: 1 })} className="link">
            Show all time
          </Link>
        </p>
      )}

      <TradesToolbar
        filters={filters}
        options={{
          pairs: options.pairs,
          strategies: options.strategies,
          sessions: sessions.map((s) => s.name),
        }}
        activeCount={activeFilterCount(filters)}
      />

      {!isNotes && (
        <div className="flex flex-wrap items-center gap-2">
          {CHIPS.map((chip) => {
            const on = chipActive(filters, chip);
            return (
              <Link
                key={chip.id}
                href={toggleChipHref(filters, chip)}
                aria-pressed={on}
                className={cn(
                  "text-13 flex h-8 items-center rounded-full px-3 transition-colors",
                  on
                    ? "bg-ink text-white"
                    : "text-ink-2 hover:text-ink shadow-[inset_0_0_0_1px_var(--rule-ring)]",
                )}
              >
                {chip.label}
              </Link>
            );
          })}
          <SavedFilters chips={savedChips} params={params} canSave={pills.length > 0 || !!filters.q} />
          {pills.length > 0 && <span className="bg-border mx-1 h-4 w-px" />}
          {pills.map((k) => (
            <Link
              key={k}
              href={tradesHref(filters, { [k]: undefined } as Partial<TradeFilters>)}
              className="bg-subtle text-ink text-13 flex h-8 items-center gap-1 rounded-full px-3 hover:opacity-80"
            >
              {labelFor(k, filters[k])} <X className="size-3" />
            </Link>
          ))}
          {(pills.length > 0 || filters.q) && (
            <Link
              href={tradesHref({ tab: filters.tab })}
              className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
            >
              Clear all
            </Link>
          )}
        </div>
      )}

      {isNotes ? (
        notes!.rows.length ? (
          <NotesList notes={notes!.rows} tz={tz} terms={parseSearch(filters.q)} />
        ) : (
          <EmptyState
            icon={filters.q ? SearchX : ListOrdered}
            title={filters.q ? "No matching notes" : "No notes yet"}
            body={
              filters.q
                ? "Try a different search."
                : "Notes are for anything not tied to one trade: market reads, weekly reviews, rules."
            }
          />
        )
      ) : trades.rows.length ? (
        <TradeList
          key={JSON.stringify(params) + (walletId ?? "")}
          rows={trades.rows}
          tz={tz}
          walletLabels={
            wallets.length > 1 ? Object.fromEntries(wallets.map((w) => [w.id, w.label])) : undefined
          }
          bulk={{ total: trades.total, params, strategies: options.strategies }}
          terms={parseSearch(filters.q)}
        />
      ) : counts.all === 0 && !filters.q && pills.length === 0 ? (
        <EmptyState
          icon={ListOrdered}
          title="No trades yet"
          body="Add a Hyperliquid wallet under Settings → Wallets & sync, or run npm run dev:demo to explore fake data."
        />
      ) : (
        <EmptyState icon={SearchX} title="No trades match" body="Loosen the filters or clear the search." />
      )}

      {total > 0 && (
        <div className="text-13 flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground tabular-nums" data-testid="trades-showing">
            Showing{" "}
            {total > pageSize ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)}` : total} of{" "}
            {total} {isNotes ? (total === 1 ? "note" : "notes") : total === 1 ? "trade" : "trades"}
          </span>
          {total > pageSize && (
            <div className="flex gap-1">
              <PageLink
                href={tradesHref(filters, { page: page - 1 })}
                disabled={page <= 1}
                label="Previous"
              />
              <span className="text-muted-foreground px-2 py-1 tabular-nums">
                {page} / {pages}
              </span>
              <PageLink
                href={tradesHref(filters, { page: page + 1 })}
                disabled={page >= pages}
                label="Next"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PageLink({ href, disabled, label }: { href: string; disabled: boolean; label: string }) {
  if (disabled)
    return <span className="text-muted-foreground/50 bg-subtle rounded-lg px-3 py-1.5">{label}</span>;
  return (
    <Link href={href} className="bg-subtle hover:bg-hover rounded-lg px-3 py-1.5">
      {label}
    </Link>
  );
}
