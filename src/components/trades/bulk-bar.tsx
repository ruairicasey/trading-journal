"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, MoreHorizontal, Tag, Trash2, X } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { GRADES } from "@/lib/enums";
import {
  bulkAddTagAction,
  bulkDeleteAction,
  bulkRestoreAction,
  bulkSetGradeAction,
  bulkSetStrategyAction,
  matchingTradeIdsAction,
  type BulkResult,
} from "@/app/(app)/trades/actions";

const BULK_MAX = 1000;
const plural = (n: number) => `${n} trade${n === 1 ? "" : "s"}`;

/** Runs after the bar has gone (the selection is cleared), so it reports by toast only. */
async function undoDelete(ids: string[]) {
  try {
    const r = await bulkRestoreAction(ids);
    if (r.ok) toast.success(`${plural(r.n)} restored`);
    else toast.error(`Undo failed: ${r.error}`);
  } catch {
    toast.error("Undo failed; the trades are still deleted");
  }
}

/** Shown while trades are selected: what's selected, "select all N matching", and the actions. */
export function BulkBar({
  selected,
  setSelected,
  pageIds,
  total,
  params,
  strategies,
}: {
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  pageIds: string[];
  total: number;
  params: Record<string, string>;
  strategies: { id: string; label: string }[];
}) {
  const [pending, start] = useTransition();
  const [tagOpen, setTagOpen] = useState(false);
  const [tag, setTag] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ids = [...selected];
  const n = ids.length;
  const pageAll = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  const run = (label: (n: number) => string, fn: () => Promise<BulkResult>, after?: (r: Extract<BulkResult, { ok: true }>) => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      // anything can change which trades match the filters: start again from what's on screen
      setSelected(new Set());
      if (after) after(r);
      else toast.success(label(r.n));
    });

  const selectAllMatching = () =>
    start(async () => {
      const all = await matchingTradeIdsAction(params);
      if (all.length > BULK_MAX) {
        toast.error(`That's more than ${BULK_MAX} trades; narrow the filters first.`);
        return;
      }
      setSelected(new Set(all));
    });

  const remove = () =>
    run(
      () => "",
      () => bulkDeleteAction(ids),
      (r) => {
        setConfirmDelete(false);
        const gone = r.ids ?? [];
        toast(`${plural(gone.length)} deleted`, { action: { label: "Undo", onClick: () => void undoDelete(gone) } });
      },
    );

  return (
    <div
      className="bg-background/95 sticky bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-20 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg backdrop-blur"
      data-testid="bulk-bar"
      role="region"
      aria-label="Selected trades"
    >
      <span className="font-medium tabular-nums" data-testid="bulk-count">
        {n} selected
      </span>
      {pageAll && total > n && (
        <Button variant="link" size="sm" className="h-7 px-1" onClick={selectAllMatching} disabled={pending}>
          Select all {total} matching
        </Button>
      )}
      <div className="flex-1" />
      {pending && <Loader2 className="text-muted-foreground size-4 animate-spin" />}
      <Button variant="secondary" size="sm" className="h-7" onClick={() => setTagOpen(true)} disabled={pending}>
        <Tag className="size-3.5" /> Add tag
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm" className="h-7" disabled={pending} aria-label="More bulk actions">
            <MoreHorizontal className="size-4" /> Set
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Grade</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {GRADES.map((g) => (
                <DropdownMenuItem key={g} onSelect={() => run((k) => `Grade ${g} set on ${plural(k)}`, () => bulkSetGradeAction(ids, g))}>
                  {g}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => run((k) => `Grade cleared on ${plural(k)}`, () => bulkSetGradeAction(ids, null))}>No grade</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Strategy</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
              {strategies.map((st) => (
                <DropdownMenuItem key={st.id} onSelect={() => run((k) => `${st.label} set on ${plural(k)}`, () => bulkSetStrategyAction(ids, st.id))}>
                  {st.label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => run((k) => `Strategy cleared on ${plural(k)}`, () => bulkSetStrategyAction(ids, null))}>
                No strategy
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setConfirmDelete(true)} className="text-destructive focus:text-destructive">
            <Trash2 className="size-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="ghost" size="icon" className="size-7" aria-label="Clear selection" onClick={() => setSelected(new Set())}>
        <X className="size-4" />
      </Button>

      <Dialog open={tagOpen} onOpenChange={setTagOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add a tag to {plural(n)}</DialogTitle>
            <DialogDescription>Trades that already have it stay as they are. Other tags are kept.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!tag.trim()) return;
              setTagOpen(false);
              run((k) => `#${tag.trim().replace(/^#/, "")} added to ${plural(k)}`, () => bulkAddTagAction(ids, tag));
              setTag("");
            }}
            className="grid gap-3"
          >
            <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. fomo" maxLength={40} aria-label="Tag" autoFocus />
            <DialogFooter>
              <Button type="submit" disabled={!tag.trim()}>
                Add tag
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {plural(n)}?</AlertDialogTitle>
            <AlertDialogDescription>
              They&apos;re hidden from lists and stats, and a re-sync won&apos;t bring them back. You can undo right after deleting.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => (e.preventDefault(), remove())} className="bg-destructive hover:bg-destructive/90 text-white">
              Delete {plural(n)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
