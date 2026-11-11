import Link from "next/link";
import { ListOrdered, SearchX } from "lucide-react";
import { X } from "lucide-react";
import { EmptyState } from "@/components/shell/empty-state";
import { NotesList, AddNoteButton } from "@/components/trades/notes-list";
import { TradeList } from "@/components/trades/trade-list";
import { TradesToolbar } from "@/components/trades/trades-toolbar";
import { cn } from "@/lib/utils";
import { PERIOD_LABELS } from "@/lib/periods";
import type { SessionDef } from "@/lib/sessions";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { getActiveAccount, getSetting } from "@/server/db/queries/settings";
import { countNotes, filterOptions, listNotes, listTrades } from "@/server/db/queries/trades";
import { DEFAULT_SESSIONS } from "@/server/db/seed-data";
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

export default async function TradesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseFilters(await searchParams);
  const { active } = await getActiveAccount();
  if (!active) return <EmptyState icon={ListOrdered} title="No account" body="Create an account in Settings first." />;

  const db = getDb();
  const [tz, sessions, options] = await Promise.all([
    getSetting("timezone", getConfig().timezone),
    getSetting<SessionDef[]>("sessions", DEFAULT_SESSIONS),
    filterOptions(db, active.id),
  ]);
  const isNotes = filters.tab === "notes";
  const [trades, notesCount, notes] = await Promise.all([
    listTrades(db, active.id, isNotes ? { ...filters, page: 1 } : filters, { tz }),
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
    return String(v);
  };
  const pills = FILTER_KEYS.filter((k) => filters[k] !== undefined);

  return (
    <div className="mx-auto max-w-5xl space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Trades</h1>
        {isNotes && <AddNoteButton />}
      </div>

      <nav className="-mx-1 flex gap-1 overflow-x-auto border-b px-1" aria-label="Trade tabs">
        {TABS.map((tab) => (
          <Link
            key={tab}
            href={tradesHref(filters, { tab })}
            aria-current={filters.tab === tab ? "page" : undefined}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm",
              filters.tab === tab ? "border-primary text-foreground" : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {TAB_LABELS[tab]}
            <span className="bg-muted rounded px-1.5 text-[11px] tabular-nums">{counts[tab]}</span>
          </Link>
        ))}
      </nav>

      <TradesToolbar
        filters={filters}
        options={{ pairs: options.pairs, strategies: options.strategies, sessions: sessions.map((s) => s.name) }}
        activeCount={activeFilterCount(filters)}
      />

      {!isNotes && (
        <div className="flex flex-wrap items-center gap-1.5">
          {CHIPS.map((chip) => {
            const on = chipActive(filters, chip);
            return (
              <Link
                key={chip.id}
                href={toggleChipHref(filters, chip)}
                aria-pressed={on}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                  on ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {chip.label}
              </Link>
            );
          })}
          {pills.length > 0 && <span className="bg-border mx-1 h-4 w-px" />}
          {pills.map((k) => (
            <Link
              key={k}
              href={tradesHref(filters, { [k]: undefined } as Partial<TradeFilters>)}
              className="bg-secondary text-secondary-foreground flex items-center gap-1 rounded-full px-2 py-0.5 text-xs hover:opacity-80"
            >
              {labelFor(k, filters[k])} <X className="size-3" />
            </Link>
          ))}
          {(pills.length > 0 || filters.q) && (
            <Link href={tradesHref({ tab: filters.tab })} className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline">
              Clear all
            </Link>
          )}
        </div>
      )}

      {isNotes ? (
        notes!.rows.length ? (
          <NotesList notes={notes!.rows} tz={tz} />
        ) : (
          <EmptyState
            icon={filters.q ? SearchX : ListOrdered}
            title={filters.q ? "No matching notes" : "No notes yet"}
            body={filters.q ? "Try a different search." : "Notes are for anything not tied to one trade: market reads, weekly reviews, rules."}
          />
        )
      ) : trades.rows.length ? (
        <TradeList rows={trades.rows} tz={tz} />
      ) : counts.all === 0 && !filters.q && pills.length === 0 ? (
        <EmptyState
          icon={ListOrdered}
          title="No trades yet"
          body="Add a Hyperliquid wallet under Settings → Wallets & sync, or run npm run dev:demo to explore fake data."
        />
      ) : (
        <EmptyState icon={SearchX} title="No trades match" body="Loosen the filters or clear the search." />
      )}

      {total > pageSize && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground tabular-nums">
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
          </span>
          <div className="flex gap-1">
            <PageLink href={tradesHref(filters, { page: page - 1 })} disabled={page <= 1} label="Previous" />
            <span className="text-muted-foreground px-2 py-1 tabular-nums">
              {page} / {pages}
            </span>
            <PageLink href={tradesHref(filters, { page: page + 1 })} disabled={page >= pages} label="Next" />
          </div>
        </div>
      )}
    </div>
  );
}

function PageLink({ href, disabled, label }: { href: string; disabled: boolean; label: string }) {
  if (disabled) return <span className="text-muted-foreground/50 rounded-md border px-2 py-1">{label}</span>;
  return (
    <Link href={href} className="hover:bg-muted rounded-md border px-2 py-1">
      {label}
    </Link>
  );
}
