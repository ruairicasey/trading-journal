"use client";

import { useMemo, useState, useTransition } from "react";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Check, Pencil, Plus, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { VocabList } from "@/server/db/queries/settings";
import {
  addVocabCategory,
  addVocabItem,
  moveVocabItem,
  updateVocabCategory,
  updateVocabItem,
} from "@/app/(app)/settings/actions";

type Item = VocabList["items"][number];
type Category = VocabList["categories"][number];

export function VocabEditor({ kind, data }: { kind: string; data: VocabList }) {
  const [showArchived, setShowArchived] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });

  const groups = useMemo(() => {
    const cats = data.categories.filter((c) => showArchived || !c.archived);
    const visible = data.items.filter((i) => showArchived || !i.archived);
    const out: { category: Category | null; items: Item[] }[] = [];
    const uncategorised = visible.filter((i) => !i.categoryId || !data.categories.some((c) => c.id === i.categoryId));
    if (uncategorised.length || cats.length === 0) out.push({ category: null, items: uncategorised });
    for (const c of cats) out.push({ category: c, items: visible.filter((i) => i.categoryId === c.id) });
    return out;
  }, [data, showArchived]);

  return (
    <div className={cn("space-y-4", pending && "opacity-70")}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Switch id="show-archived" checked={showArchived} onCheckedChange={setShowArchived} />
          <Label htmlFor="show-archived" className="text-muted-foreground text-xs">
            Show archived
          </Label>
        </div>
        <NewText
          placeholder="New category"
          buttonLabel="Add category"
          onSubmit={(name) => run(() => addVocabCategory({ kind, name }))}
        />
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}

      {groups.map(({ category, items }) => (
        <section key={category?.id ?? "none"} className="rounded-lg border">
          {category && (
            <CategoryHeader category={category} onChange={(patch) => run(() => updateVocabCategory({ id: category.id, ...patch }))} />
          )}
          <ul className="divide-y">
            {items.map((item, idx) => (
              <ItemRow
                key={item.id}
                item={item}
                first={idx === 0}
                last={idx === items.length - 1}
                onChange={(patch) => run(() => updateVocabItem({ id: item.id, ...patch }))}
                onMove={(direction) => run(() => moveVocabItem({ id: item.id, direction }))}
              />
            ))}
            {items.length === 0 && <li className="text-muted-foreground px-3 py-2 text-xs">No items</li>}
          </ul>
          <div className="border-t px-3 py-2">
            <NewText
              placeholder="Add item…"
              buttonLabel="Add"
              onSubmit={(label) => run(() => addVocabItem({ kind, label, categoryId: category?.id ?? null }))}
            />
          </div>
        </section>
      ))}
    </div>
  );
}

function CategoryHeader({
  category,
  onChange,
}: {
  category: Category;
  onChange: (p: { name?: string; archived?: boolean }) => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="bg-muted/40 flex items-center gap-2 border-b px-3 py-1.5">
      {editing ? (
        <InlineEdit
          initial={category.name}
          onCancel={() => setEditing(false)}
          onSave={(name) => {
            setEditing(false);
            onChange({ name });
          }}
        />
      ) : (
        <>
          <h3 className={cn("flex-1 text-xs font-semibold tracking-wide uppercase", category.archived && "line-through opacity-60")}>
            {category.name}
          </h3>
          <IconBtn label="Rename category" onClick={() => setEditing(true)}>
            <Pencil />
          </IconBtn>
          <IconBtn
            label={category.archived ? "Restore category" : "Archive category"}
            onClick={() => onChange({ archived: !category.archived })}
          >
            {category.archived ? <ArchiveRestore /> : <Archive />}
          </IconBtn>
        </>
      )}
    </div>
  );
}

function ItemRow({
  item,
  first,
  last,
  onChange,
  onMove,
}: {
  item: Item;
  first: boolean;
  last: boolean;
  onChange: (p: { label?: string; favorite?: boolean; archived?: boolean }) => void;
  onMove: (d: "up" | "down") => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="group flex items-center gap-1 px-3 py-1">
      {editing ? (
        <InlineEdit
          initial={item.label}
          onCancel={() => setEditing(false)}
          onSave={(label) => {
            setEditing(false);
            onChange({ label });
          }}
        />
      ) : (
        <>
          <IconBtn label={item.favorite ? "Unfavourite" : "Favourite"} onClick={() => onChange({ favorite: !item.favorite })}>
            <Star className={cn(item.favorite && "fill-amber-400 text-amber-400")} />
          </IconBtn>
          <button
            type="button"
            className={cn("flex-1 truncate py-1 text-left text-sm", item.archived && "text-muted-foreground line-through")}
            onDoubleClick={() => setEditing(true)}
          >
            {item.label}
          </button>
          <div className="flex items-center opacity-60 transition-opacity group-hover:opacity-100">
            <IconBtn label="Move up" disabled={first} onClick={() => onMove("up")}>
              <ArrowUp />
            </IconBtn>
            <IconBtn label="Move down" disabled={last} onClick={() => onMove("down")}>
              <ArrowDown />
            </IconBtn>
            <IconBtn label="Rename" onClick={() => setEditing(true)}>
              <Pencil />
            </IconBtn>
            <IconBtn label={item.archived ? "Restore" : "Archive"} onClick={() => onChange({ archived: !item.archived })}>
              {item.archived ? <ArchiveRestore /> : <Archive />}
            </IconBtn>
          </div>
        </>
      )}
    </li>
  );
}

function InlineEdit({ initial, onSave, onCancel }: { initial: string; onSave: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  const save = () => (v.trim() && v.trim() !== initial ? onSave(v.trim()) : onCancel());
  return (
    <form
      className="flex flex-1 items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Input
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        className="h-7"
      />
      <IconBtn label="Save" type="submit">
        <Check />
      </IconBtn>
      <IconBtn label="Cancel" onClick={onCancel}>
        <X />
      </IconBtn>
    </form>
  );
}

function NewText({ placeholder, buttonLabel, onSubmit }: { placeholder: string; buttonLabel: string; onSubmit: (v: string) => void }) {
  const [v, setV] = useState("");
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (!v.trim()) return;
        onSubmit(v.trim());
        setV("");
      }}
    >
      <Input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} className="h-7 w-56" />
      <Button type="submit" size="sm" variant="secondary" className="h-7">
        <Plus className="size-3.5" />
        {buttonLabel}
      </Button>
    </form>
  );
}

function IconBtn({
  label,
  children,
  ...props
}: { label: string; children: React.ReactNode } & React.ComponentProps<typeof Button>) {
  return (
    <Button type="button" variant="ghost" size="icon" className="size-7 [&_svg]:size-3.5" aria-label={label} title={label} {...props}>
      {children}
    </Button>
  );
}
