"use client";

import { SOURCE_LABEL } from "@/lib/enums";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy, MoreHorizontal, PenLine, Pencil, RefreshCw, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkBar } from "@/components/trades/bulk-bar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { firstSnippet, type Seg } from "@/lib/search";
import {
  fmtDateTime,
  fmtDuration,
  fmtPct,
  fmtPrice,
  fmtR,
  fmtSignedUsd,
  fmtSize,
  fmtUsd,
  pnlClass,
} from "@/lib/format";
import type { TradeRow } from "@/server/db/queries/trades";
import { deleteTradeAction, duplicateTradeAction, restoreTradeAction } from "@/app/(app)/trades/actions";
import { Direction } from "@/components/trades/direction";

/** Columns on lg+ screens (narrower widths stack): select, pair, side, opened, stop, review, return, net, actions. Phones stack. */
const COLS =
  "lg:grid lg:grid-cols-[1.75rem_minmax(0,1.4fr)_5rem_minmax(0,1.3fr)_4.5rem_6.5rem_5rem_6.5rem_3.5rem] lg:items-center lg:gap-x-3";

type BulkProps = {
  total: number;
  params: Record<string, string>;
  strategies: { id: string; label: string }[];
};

/**
 * `walletLabels` is passed only when the account has two or more wallets: each row then says which one.
 * `bulk` turns on row checkboxes and the bulk-action bar. The selection survives paging; the page re-keys the
 * list when the filters change, which clears it.
 */
export function TradeList({
  rows,
  tz,
  walletLabels,
  bulk,
  terms = [],
}: {
  rows: TradeRow[];
  tz: string;
  walletLabels?: Record<string, string>;
  bulk?: BulkProps;
  /** search terms: each row shows where its text matched */
  terms?: string[];
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const pageIds = rows.map((r) => r.id);
  const pageAll = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const pageSome = pageIds.some((id) => selected.has(id));
  const select = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const selectPage = (on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      for (const id of pageIds) {
        if (on) n.add(id);
        else n.delete(id);
      }
      return n;
    });
  const [confirm, setConfirm] = useState<TradeRow | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const duplicate = (row: TradeRow) =>
    start(async () => {
      const id = await duplicateTradeAction(row.id);
      if (id) {
        toast.success(`Planned copy of ${row.displayPair} created`, {
          action: { label: "Open", onClick: () => router.push(`/trades/${id}`) },
        });
      } else toast.error("Could not duplicate trade");
    });

  const remove = (row: TradeRow) =>
    start(async () => {
      await deleteTradeAction(row.id);
      setConfirm(null);
      toast(`${row.displayPair} trade deleted`, {
        action: {
          label: "Undo",
          onClick: () => start(async () => void (await restoreTradeAction(row.id))),
        },
      });
    });

  return (
    <>
      <div>
        {/* header row (lg+): the first cell selects the page; phones get a plain "Select page" line */}
        <div className={cn("text-muted-foreground text-13 flex items-center pb-2.5 lg:pb-2.5", COLS)}>
          <span className="flex items-center">
            {bulk && (
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={pageAll ? true : pageSome ? "indeterminate" : false}
                  onCheckedChange={(v) => selectPage(v === true)}
                  aria-label="Select all trades on this page"
                />
                <span className="lg:hidden">Select page</span>
              </label>
            )}
          </span>
          <span className="hidden lg:inline">Pair</span>
          <span className="hidden lg:inline">Side</span>
          <span className="hidden lg:inline">Opened</span>
          <span className="hidden lg:inline">Stop</span>
          <span className="hidden lg:inline">Review</span>
          <span className="hidden text-right lg:inline">Return</span>
          <span className="hidden text-right lg:inline">Net P&L</span>
          <span />
        </div>
        <ul
          className={cn("divide-rule-faint border-rule-faint divide-y border-t", pending && "opacity-70")}
          data-testid="trade-list"
        >
          {rows.map((r) => (
            <TradeItem
              key={r.id}
              row={r}
              tz={tz}
              walletLabel={
                walletLabels
                  ? r.walletId
                    ? (walletLabels[r.walletId] ?? "Other wallet")
                    : "Manual"
                  : undefined
              }
              expanded={open.has(r.id)}
              selected={bulk ? selected.has(r.id) : undefined}
              terms={terms}
              onSelect={(on) => select(r.id, on)}
              onToggle={() => toggle(r.id)}
              onDuplicate={() => duplicate(r)}
              onDelete={() => setConfirm(r)}
            />
          ))}
        </ul>
      </div>
      {bulk && selected.size > 0 && (
        <BulkBar
          selected={selected}
          setSelected={setSelected}
          pageIds={pageIds}
          total={bulk.total}
          params={bulk.params}
          strategies={bulk.strategies}
        />
      )}
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this trade?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.displayPair} {confirm?.direction === "short" ? "short" : "long"} from{" "}
              {fmtDateTime(confirm?.entryTime, tz)}. It&apos;s hidden from lists and stats, and a re-sync
              won&apos;t bring it back. You can undo right after deleting.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirm && remove(confirm)}
              className="bg-destructive hover:bg-destructive/90 text-white"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function TradeItem({
  row: r,
  tz,
  walletLabel,
  expanded,
  selected,
  terms,
  onSelect,
  onToggle,
  onDuplicate,
  onDelete,
}: {
  row: TradeRow;
  tz: string;
  walletLabel?: string;
  expanded: boolean;
  /** undefined: no checkbox */
  selected?: boolean;
  terms: string[];
  onSelect: (on: boolean) => void;
  onToggle: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const synced = r.source !== "manual";
  const time = r.entryTime ?? null;
  return (
    <li data-testid="trade-row" data-trade-id={r.id}>
      <div
        className={cn(
          "hover:bg-hover flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm",
          COLS,
          selected && "bg-gold-tint/40",
        )}
      >
        <span className="flex items-center">
          {selected !== undefined && (
            <Checkbox
              checked={selected}
              onCheckedChange={(v) => onSelect(v === true)}
              aria-label={`Select ${r.displayPair} trade`}
              data-testid="trade-select"
            />
          )}
        </span>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          data-testid="trade-expand"
          aria-label={`${r.displayPair}${walletLabel ? `, ${walletLabel}` : ""}, ${r.direction}, ${r.status}, ${time ? `opened ${fmtDateTime(time, tz)}` : "not entered"}: details`}
          className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none lg:flex-none"
        >
          <span className="truncate font-medium">{r.displayPair}</span>
          {r.status === "open" && (
            <Badge className="bg-gold-tint text-gold-ink h-5 rounded-full px-2 text-xs">Open</Badge>
          )}
          {r.status === "planned" && (
            <Badge className="bg-subtle text-ink-2 h-5 rounded-full px-2 text-xs">Planned</Badge>
          )}
          {walletLabel && (
            <span className="text-muted-foreground max-w-24 truncate text-xs" data-testid="trade-wallet">
              {walletLabel}
            </span>
          )}
        </button>
        <Direction dir={r.direction} />
        <span className="condensed text-ink-2 order-last w-full truncate lg:order-none lg:w-auto">
          {time ? fmtDateTime(time, tz) : "Not entered"}
          {/* narrower screens: the hidden columns' essentials on the second line */}
          <span className="lg:hidden">
            {r.status !== "planned" && `, ${fmtPct(r.returnPct)}`}
            {r.stopLoss === null && <span className="text-loss-ink">, no stop</span>}
          </span>
        </span>
        <span className={cn("hidden lg:inline", r.stopLoss === null ? "text-loss-ink" : "text-ink")}>
          <span className="sr-only">Stop: </span>
          {r.stopLoss === null ? "None" : "Set"}
        </span>
        <span className={cn("hidden lg:inline", r.reviewedAt ? "text-ink" : "text-muted-foreground")}>
          <span className="sr-only">Review: </span>
          {r.status !== "closed" ? "—" : r.reviewedAt ? "Reviewed" : "Not reviewed"}
        </span>
        <span className="text-muted-foreground hidden text-right tabular-nums lg:inline">
          <span className="sr-only">Return: </span>
          {r.status === "planned" ? "" : fmtPct(r.returnPct)}
        </span>
        <span
          className={cn(
            "money ml-auto text-right font-medium tabular-nums lg:ml-0",
            r.status === "closed" && pnlClass(r.netPnl),
          )}
        >
          {r.status === "planned" ? "—" : fmtSignedUsd(r.netPnl)}
        </span>
        <div className="flex shrink-0 items-center justify-end gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="text-muted-foreground"
                aria-label={
                  synced
                    ? `Synced from ${SOURCE_LABEL[r.source]}`
                    : "Manual trade"
                }
              >
                {synced ? <RefreshCw className="size-3.5" /> : <PenLine className="size-3.5" />}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {synced ? `Synced from ${SOURCE_LABEL[r.source]}` : "Manual trade"}
            </TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7" aria-label="Trade actions">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/trades/${r.id}`}>
                  <Pencil className="size-4" /> Edit
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onDuplicate}>
                <Copy className="size-4" /> Duplicate as planned
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive">
                <Trash2 className="size-4" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {terms.length > 0 && <MatchLine row={r} terms={terms} />}
      {expanded && <TradeDetails row={r} tz={tz} />}
    </li>
  );
}

function TradeDetails({ row: r, tz }: { row: TradeRow; tz: string }) {
  const flags = r.flags ?? {};
  const flagBadges = [
    flags.partialHistory && "Partial history",
    flags.gap && "Coverage gap",
    flags.liquidated && "Liquidated",
    flags.liquidationCounterparty && "Filled against a liquidation",
    flags.nonUsdcFee && "Non-USD fee",
  ].filter(Boolean) as string[];
  const entry = r.avgEntry ?? r.manualEntry;

  return (
    <div className="bg-muted/20 border-t px-4 py-3 pl-9 text-xs" data-testid="trade-details">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        <Field label="Entry and exit">
          {fmtDateTime(r.entryTime, tz)}
          <br />
          to {r.status === "open" ? "open" : fmtDateTime(r.exitTime, tz)}
        </Field>
        <Field label="Duration">
          {r.status === "open" && r.entryTime
            ? fmtDuration(Date.now() - r.entryTime) + " (open)"
            : fmtDuration(r.durationMs)}
        </Field>
        <Field label="Entry / exit price">
          {fmtPrice(entry)} / {fmtPrice(r.avgExit)}
        </Field>
        <Field label="Size">
          {fmtSize(r.sizeUnits)}{" "}
          {r.notionalUsd ? (
            <span className="money text-muted-foreground">({fmtUsd(r.notionalUsd, 0)})</span>
          ) : null}
        </Field>
        <Field label="Net P&L">
          <span className={cn("money", pnlClass(r.netPnl))}>
            {fmtSignedUsd(r.netPnl)} ({fmtPct(r.returnPct)})
          </span>
        </Field>
        <Field label="Fees">
          <span className="money">{fmtUsd(r.fees)}</span>
        </Field>
        <Field label="Funding">
          <span className={cn("money", pnlClass(r.funding))}>
            {r.funding ? fmtSignedUsd(r.funding) : "—"}
          </span>
        </Field>
        <Field label="R multiple">
          {r.stopLoss === null ? (
            <span className="text-muted-foreground">add a stop to see R</span>
          ) : (
            fmtR(r.r)
          )}
        </Field>
        <Field label="Setup">
          {[r.strategyLabel, r.grade && `Grade ${r.grade}`, r.session].filter(Boolean).join(", ") || "—"}
        </Field>
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {r.entryTimeframe && (
          <Badge variant="secondary" className="text-[10px]">
            {r.entryTimeframe}
          </Badge>
        )}
        {r.timeframeClass && (
          <Badge variant="secondary" className="text-[10px]">
            {r.timeframeClass}
          </Badge>
        )}
        <Badge variant="outline" className="text-[10px]">
          {r.source === "manual" ? "manual" : r.source === "ctrader" ? "ctrader sync" : `${r.source} auto-sync`}
        </Badge>
        {r.tags.map((t) => (
          <Badge key={t} variant="outline" className="text-muted-foreground text-[10px]">
            #{t}
          </Badge>
        ))}
        {flagBadges.map((f) => (
          <Badge key={f} className="bg-gold-tint text-gold-ink text-[10px]">
            {f}
          </Badge>
        ))}
      </div>
      {r.rationale && <p className="text-muted-foreground mt-2 line-clamp-2 max-w-3xl">{r.rationale}</p>}
      <Link
        href={`/trades/${r.id}`}
        className="text-primary mt-2 inline-block text-xs font-medium hover:underline"
      >
        Edit trade
      </Link>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}

/** Where a search hit: the first matching text field, with the terms highlighted. */
function MatchLine({ row: r, terms }: { row: TradeRow; terms: string[] }) {
  const m = firstSnippet(
    [
      ["Notes", r.rationale],
      ["Review", r.postNotes],
      ...Object.values(r.reflection ?? {}).map((v) => ["Reflection", v] as [string, string]),
      ["Tags", r.tags.map((t) => `#${t}`).join(" ")],
      ["Strategy", r.strategyLabel],
    ],
    terms,
  );
  if (!m) return null;
  return (
    <p className="text-muted-foreground -mt-1 truncate px-3 pb-2 pl-9 text-[11px]" data-testid="trade-match">
      <span className="mr-1 font-medium">{m.label}:</span>
      <Highlight segs={m.segs} />
    </p>
  );
}

export function Highlight({ segs }: { segs: Seg[] }) {
  return (
    <>
      {segs.map((x, i) =>
        x.hit ? (
          <mark key={i} className="text-foreground bg-gold-tint rounded-sm px-0.5">
            {x.text}
          </mark>
        ) : (
          <span key={i}>{x.text}</span>
        ),
      )}
    </>
  );
}
