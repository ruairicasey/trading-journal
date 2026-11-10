"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search, Settings2, Star, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type VocabOption = { id: string; label: string; categoryId: string | null; favorite: boolean; archived: boolean };
export type CategoryOption = { id: string; name: string };

/**
 * Grouped, searchable multi-select for journal vocab (confluences, SL/TP reasons, mistakes).
 * Favourites first, then categories in their configured order, then uncategorised items.
 */
export function VocabPicker({
  label,
  kind,
  items,
  categories,
  selected,
  onChange,
  placeholder = "Search…",
  testId,
}: {
  label: string;
  kind: string;
  items: VocabOption[];
  categories: CategoryOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  testId?: string;
}) {
  const [q, setQ] = useState("");
  const set = new Set(selected);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const toggle = (id: string) => onChange(set.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const visible = items.filter((i) => (!i.archived || set.has(i.id)) && (!needle || i.label.toLowerCase().includes(needle)));
    const out: { key: string; name: string; items: VocabOption[] }[] = [];
    const favs = visible.filter((i) => i.favorite);
    if (favs.length && !needle) out.push({ key: "fav", name: "Favourites", items: favs });
    for (const c of categories) {
      const xs = visible.filter((i) => i.categoryId === c.id);
      if (xs.length) out.push({ key: c.id, name: c.name, items: xs });
    }
    const known = new Set(categories.map((c) => c.id));
    const rest = visible.filter((i) => !i.categoryId || !known.has(i.categoryId));
    if (rest.length) out.push({ key: "other", name: categories.length ? "Other" : "", items: rest });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, categories, q, selected]);

  return (
    <div className="grid gap-2" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">
          {label} {selected.length > 0 && <span className="text-foreground">({selected.length})</span>}
        </span>
        <Link href={`/settings/journal?kind=${kind}`} className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[11px]">
          <Settings2 className="size-3" /> Manage list
        </Link>
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => toggle(id)}
              className="bg-primary text-primary-foreground flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
              aria-label={`Remove ${byId.get(id)?.label ?? "item"}`}
            >
              {byId.get(id)?.label ?? "Removed item"} <X className="size-3" />
            </button>
          ))}
        </div>
      )}

      <div className="relative">
        <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="h-8 pl-8" aria-label={`Search ${label}`} />
      </div>

      <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border p-2">
        {groups.length === 0 && <p className="text-muted-foreground px-1 text-xs">{q ? "No matches." : "No items yet. Add some under Manage list."}</p>}
        {groups.map((g) => (
          <div key={g.key}>
            {g.name && (
              <div className="text-muted-foreground mb-1 flex items-center gap-1 px-1 text-[10px] font-semibold tracking-wide uppercase">
                {g.key === "fav" && <Star className="size-3 fill-amber-400 text-amber-400" />}
                {g.name}
              </div>
            )}
            <div className="flex flex-wrap gap-1">
              {g.items.map((i) => {
                const on = set.has(i.id);
                return (
                  <button
                    key={`${g.key}-${i.id}`}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggle(i.id)}
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-xs transition-colors",
                      on ? "border-primary bg-primary/15 text-foreground" : "text-muted-foreground hover:text-foreground hover:border-foreground/30",
                      i.archived && "line-through opacity-60",
                    )}
                  >
                    {i.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Single-select chip row (emotions, grades…). Clicking the active chip clears it. */
export function ChipSelect<T extends string | number>({
  options,
  value,
  onChange,
  "aria-label": ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T | null) => void;
  "aria-label"?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-1">
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(on ? null : o.value)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs tabular-nums transition-colors",
              on ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Multi-select chip row (HTF timeframes). */
export function ChipMulti<T extends string>({
  options,
  value,
  onChange,
  "aria-label": ariaLabel,
}: {
  options: readonly T[];
  value: T[];
  onChange: (v: T[]) => void;
  "aria-label"?: string;
}) {
  const set = new Set(value);
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-1">
      {options.map((o) => {
        const on = set.has(o);
        return (
          <button
            key={o}
            type="button"
            role="checkbox"
            aria-checked={on}
            onClick={() => onChange(on ? value.filter((x) => x !== o) : options.filter((x) => set.has(x) || x === o))}
            className={cn(
              "rounded-md border px-2 py-1 text-xs transition-colors",
              on ? "border-primary bg-primary/15 text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}
