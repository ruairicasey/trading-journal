"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { tradesHref, type TradeFilters } from "@/server/trades/filters";

type Options = {
  pairs: { coin: string; displayPair: string }[];
  strategies: { id: string; label: string }[];
  sessions: string[];
};

export function TradesToolbar({ filters, options, activeCount }: { filters: TradeFilters; options: Options; activeCount: number }) {
  const router = useRouter();
  const [q, setQ] = useState(filters.q ?? "");
  const [sheet, setSheet] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => setQ(filters.q ?? ""), [filters.q]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(el.tagName) && !el.isContentEditable) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex items-center gap-2">
      <form
        className="relative flex-1 sm:max-w-sm"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(tradesHref(filters, { q: q.trim() || undefined }));
        }}
      >
        <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={filters.tab === "notes" ? "Search notes…" : "Search pair, tag, notes…"}
          className="h-8 pr-14 pl-8"
          aria-label="Search trades"
        />
        {q ? (
          <button
            type="button"
            aria-label="Clear search"
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
            onClick={() => {
              setQ("");
              router.push(tradesHref(filters, { q: undefined }));
            }}
          >
            <X className="size-4" />
          </button>
        ) : (
          <kbd className="text-muted-foreground pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border px-1 text-[10px]">
            /
          </kbd>
        )}
      </form>
      {filters.tab !== "notes" && (
        <Button variant="secondary" size="sm" className="h-8" onClick={() => setSheet(true)}>
          <SlidersHorizontal className="size-4" /> Filters
          {activeCount > 0 && <Badge className="ml-1 h-4 min-w-4 px-1 text-[10px]">{activeCount}</Badge>}
        </Button>
      )}
      <FilterSheet open={sheet} onOpenChange={setSheet} filters={filters} options={options} />
    </div>
  );
}

const ANY = "__any";

function FilterSheet({
  open,
  onOpenChange,
  filters,
  options,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  filters: TradeFilters;
  options: Options;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Partial<TradeFilters>>(filters);
  useEffect(() => {
    if (open) setDraft(filters);
  }, [open, filters]);
  const set = (k: keyof TradeFilters, v: unknown) => setDraft((d) => ({ ...d, [k]: v === ANY || v === "" ? undefined : v }));

  const sel = (k: keyof TradeFilters, label: string, items: { value: string; label: string }[]) => (
    <div className="grid gap-1.5">
      <Label className="text-muted-foreground text-xs">{label}</Label>
      <Select value={(draft[k] as string | undefined) ?? ANY} onValueChange={(v) => set(k, v)}>
        <SelectTrigger className="h-8 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Any</SelectItem>
          {items.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>Narrow the trade list. Dates use your account timezone.</SheetDescription>
        </SheetHeader>
        <div className="grid gap-3 px-4">
          {sel("pair", "Pair", options.pairs.map((p) => ({ value: p.coin, label: p.displayPair })))}
          {sel("dir", "Direction", [
            { value: "long", label: "Long" },
            { value: "short", label: "Short" },
          ])}
          {sel("outcome", "Outcome (closed trades)", [
            { value: "win", label: "Win" },
            { value: "loss", label: "Loss" },
            { value: "be", label: "Breakeven" },
          ])}
          {sel("strategy", "Strategy", options.strategies.map((s) => ({ value: s.id, label: s.label })))}
          {sel("grade", "Grade", ["A+", "A", "B", "C", "D"].map((g) => ({ value: g, label: g })))}
          {sel("session", "Session", options.sessions.map((s) => ({ value: s, label: s })))}
          {sel("type", "Trade type", [
            { value: "planned", label: "Planned" },
            { value: "reactive", label: "Reactive" },
          ])}
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label className="text-muted-foreground text-xs">From</Label>
              <Input type="date" className="h-8" value={draft.from ?? ""} onChange={(e) => set("from", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-muted-foreground text-xs">To</Label>
              <Input type="date" className="h-8" value={draft.to ?? ""} onChange={(e) => set("to", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-muted-foreground text-xs">Min R</Label>
              <Input
                type="number"
                step="0.1"
                className="h-8"
                value={draft.minR ?? ""}
                onChange={(e) => set("minR", e.target.value === "" ? undefined : Number(e.target.value))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-muted-foreground text-xs">Max R</Label>
              <Input
                type="number"
                step="0.1"
                className="h-8"
                value={draft.maxR ?? ""}
                onChange={(e) => set("maxR", e.target.value === "" ? undefined : Number(e.target.value))}
              />
            </div>
          </div>
          <p className="text-muted-foreground text-[11px]">R filters only include trades with a stop loss.</p>
        </div>
        <SheetFooter className="flex-row gap-2">
          <Button
            variant="ghost"
            className="flex-1"
            onClick={() => {
              onOpenChange(false);
              router.push(tradesHref({ tab: filters.tab, q: filters.q }));
            }}
          >
            Reset
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              onOpenChange(false);
              router.push(tradesHref({ ...draft, tab: filters.tab, q: filters.q }));
            }}
          >
            Apply
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
