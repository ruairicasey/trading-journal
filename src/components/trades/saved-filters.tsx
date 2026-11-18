"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { BookmarkPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { deleteSavedFilterAction, saveFilterAction } from "@/app/(app)/trades/actions";

export type SavedChip = { id: string; name: string; href: string; active: boolean };

/** The owner's saved filters as chips (× removes one), plus "Save filter" when filters or a search are set. */
export function SavedFilters({ chips, params, canSave }: { chips: SavedChip[]; params: Record<string, string>; canSave: boolean }) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const current = chips.find((c) => c.active);

  return (
    <>
      {chips.map((c) => (
        <span
          key={c.id}
          data-testid="saved-filter"
          className={cn(
            "flex items-center rounded-full border text-xs transition-colors",
            c.active ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground border-dashed",
          )}
        >
          <Link href={c.active ? `/trades${params.tab && params.tab !== "all" ? `?tab=${params.tab}` : ""}` : c.href} aria-pressed={c.active} className="py-0.5 pl-2.5 pr-1">
            {c.name}
          </Link>
          <button
            type="button"
            aria-label={`Remove saved filter ${c.name}`}
            disabled={pending}
            className="rounded-full p-0.5 pr-1.5 opacity-60 hover:opacity-100"
            onClick={() =>
              start(async () => {
                await deleteSavedFilterAction(c.id);
                toast(`Removed "${c.name}"`);
              })
            }
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {canSave && !current && (
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setOpen(true)}>
          <BookmarkPlus className="size-3.5" /> Save filter
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Save this filter</DialogTitle>
            <DialogDescription>It keeps the tab, search and filters, and shows as a chip above the list. Saving under an existing name replaces it.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const r = await saveFilterAction(name, params);
                if (!r.ok) return void toast.error(r.error);
                toast.success(`Saved "${name.trim()}"`);
                setOpen(false);
                setName("");
              });
            }}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. A+ longs" maxLength={40} aria-label="Filter name" autoFocus />
            <DialogFooter>
              <Button type="submit" disabled={!name.trim() || pending}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
