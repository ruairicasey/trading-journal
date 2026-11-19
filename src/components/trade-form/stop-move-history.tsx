"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addStopMoveAction, deleteStopMoveAction, updateStopMoveAction } from "@/app/(app)/trades/[id]/actions";
import { fmtDateTime, fmtPrice, fmtR } from "@/lib/format";
import { classifyStopMoves, sortMoves, type StopMoveKind } from "@/lib/stop-moves";
import { fromTzInput, toTzInput } from "@/lib/tz-input";
import { cn } from "@/lib/utils";
import type { ProtectionState } from "./types";

type MoveRow = ProtectionState["stopMoves"][number];

const KIND: Record<StopMoveKind, { label: string; cls: string }> = {
  tighten: { label: "tightened", cls: "text-ink-2" },
  widen: { label: "widened", cls: "text-loss" },
  breakeven: { label: "to breakeven", cls: "text-gold-ink" },
  trail: { label: "trailing in profit", cls: "text-profit" },
  unchanged: { label: "re-placed", cls: "text-muted-foreground" },
};

type Props = {
  tradeId: string;
  direction: "long" | "short";
  entry: number | null;
  /** your stop loss: moves are classed against it, exactly as Analytics does (none = not classed) */
  initialStop: number | null;
  /** the detected initial stop order (shown as the first row) */
  detectedInitial: { price: number; placedAt: number } | null;
  /** your stop loss differs from the detected initial stop */
  initialDiffers: boolean;
  moves: MoveRow[];
  entryTime: number | null;
  tz: string;
  onMoves: (rows: MoveRow[]) => void;
};

type Edit = { id: string | null; when: string; price: string; note: string };

/** Stop-move timeline: the initial stop, then every move (from your exchange orders or added by you), each classed. */
export function StopMoveHistory(p: Props) {
  const [edit, setEdit] = useState<Edit | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const rows = sortMoves(p.moves);
  const classified =
    p.entry !== null && p.entry > 0 && p.initialStop !== null ? classifyStopMoves(p.direction, p.entry, p.initialStop, rows) : { moves: null, cls: null };
  const byTime = new Map<MoveRow, NonNullable<typeof classified.moves>[number]>();
  if (classified.moves) rows.forEach((m, i) => byTime.set(m, classified.moves![i]));

  const run = (fn: () => Promise<{ ok: true; moves: MoveRow[] } | { ok: false; error: string }>) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        p.onMoves(res.moves);
        setEdit(null);
        setConfirmDelete(null);
        setError(null);
      } else setError(res.error);
    });

  const save = () => {
    if (!edit) return;
    const input = { time: fromTzInput(edit.when, p.tz), price: Number(edit.price), note: edit.note };
    run(() => (edit.id ? updateStopMoveAction(edit.id, input) : addStopMoveAction(p.tradeId, input)));
  };

  const editor = edit && (
    <div className="bg-muted/40 mt-2 grid gap-2 rounded-md p-2 sm:grid-cols-[auto_8rem_1fr_auto]" data-testid="stop-move-editor">
      <Input type="datetime-local" className="h-8" aria-label={`Stop move time (${p.tz})`} value={edit.when} onChange={(e) => setEdit({ ...edit, when: e.target.value })} />
      <Input type="number" inputMode="decimal" step="any" min="0" className="h-8" aria-label="Stop price" value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} />
      <Input className="h-8" aria-label="Note" placeholder="Why (optional)" maxLength={500} value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
      <div className="flex gap-1">
        <Button type="button" size="sm" className="h-8" disabled={pending} onClick={save}>
          Save move
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-8" disabled={pending} onClick={() => (setEdit(null), setError(null))}>
          Cancel
        </Button>
      </div>
    </div>
  );

  return (
    <div className="mt-3 border-t pt-3" data-testid="stop-moves">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          Stop moves{classified.cls && rows.length ? <> · <span data-testid="stop-class">{CLASS_TEXT[classified.cls]}</span></> : null}
        </p>
        {!edit && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => setEdit({ id: null, when: toTzInput(p.entryTime ?? Date.now(), p.tz), price: "", note: "" })}
          >
            <Plus className="size-3" /> Add stop move
          </Button>
        )}
      </div>
      {(p.detectedInitial || rows.length > 0) && (
        <ol className="grid gap-1 text-xs">
          {p.detectedInitial && (
            <li className="flex flex-wrap gap-x-3">
              <span className="text-muted-foreground w-36 shrink-0">{fmtDateTime(p.detectedInitial.placedAt, p.tz)}</span>
              <span className="tabular-nums">{fmtPrice(p.detectedInitial.price)}</span>
              <span className="text-muted-foreground">initial stop{p.initialDiffers ? " (your stop loss differs)" : ""}</span>
            </li>
          )}
          {rows.map((m) => {
            const c = byTime.get(m);
            return (
              <li key={m.id} className="flex flex-wrap items-center gap-x-3" data-testid="stop-move-row">
                <span className="text-muted-foreground w-36 shrink-0">{fmtDateTime(m.time, p.tz)}</span>
                <span className="tabular-nums">→ {fmtPrice(m.price)}</span>
                {c && <span className={cn(KIND[c.kind].cls)} data-testid="stop-move-kind">{KIND[c.kind].label}</span>}
                {c && <span className="text-muted-foreground tabular-nums">{c.riskPct >= 0 ? `${c.riskPct.toFixed(2)}% risk` : `${(-c.riskPct).toFixed(2)}% in profit`}</span>}
                {c?.lockedR !== null && c?.lockedR !== undefined && <span className="text-muted-foreground tabular-nums">locks {fmtR(c.lockedR)}</span>}
                <span className="text-muted-foreground">{m.source === "user" ? "added by you" : "from your exchange orders"}</span>
                {m.note && <span className="text-muted-foreground italic">“{m.note}”</span>}
                {m.source === "user" && !edit && (
                  <span className="ml-auto flex gap-1">
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Edit stop move"
                      onClick={() => setEdit({ id: m.id, when: toTzInput(m.time, p.tz), price: String(m.price), note: m.note ?? "" })}
                    >
                      <Pencil className="size-3" />
                    </button>
                    {confirmDelete === m.id ? (
                      <span className="flex gap-1">
                        <button type="button" className="text-loss hover:underline" disabled={pending} onClick={() => run(() => deleteStopMoveAction(m.id))}>
                          Delete
                        </button>
                        <button type="button" className="text-muted-foreground hover:underline" onClick={() => setConfirmDelete(null)}>
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="text-muted-foreground hover:text-loss" aria-label="Delete stop move" onClick={() => setConfirmDelete(m.id)}>
                        <Trash2 className="size-3" />
                      </button>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {editor}
      {error && (
        <p className="mt-1 text-xs text-loss" role="alert">
          {error}
        </p>
      )}
      {rows.length > 0 && p.initialStop === null && (
        <p className="text-muted-foreground mt-1.5 text-[11px]" data-testid="stop-moves-unclassed">
          Add a stop loss to see what each move did (Analytics leaves trades without one out of Stop management).
        </p>
      )}
      {!p.detectedInitial && rows.some((m) => m.source === "auto") && (
        <p className="text-muted-foreground mt-1.5 text-[11px]">No stop on the risk side of entry, so no stop loss was set from these.</p>
      )}
    </div>
  );
}

const CLASS_TEXT = {
  widened: "stop widened",
  trailed: "trailed into profit",
  breakeven: "moved to breakeven",
  tightened: "tightened only",
  never_moved: "never moved",
} as const;
