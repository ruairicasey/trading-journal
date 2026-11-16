"use client";

import { useTransition } from "react";
import { RotateCcw, Zap } from "lucide-react";
import { fmtDateTime, fmtPrice } from "@/lib/format";
import type { ProtectionField, ProtectionState } from "./types";

const same = (a: number | null, b: number | null) => a === b || (a !== null && b !== null && Math.abs(a - b) <= Math.abs(b) * 1e-12);
/** full precision: a rounded display could hide the difference the user is being told about */
const exact = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 10 });

/** Under SL / TP: where the value came from, and a way back to the exchange value. */
export function ProtectionHint({
  field,
  value,
  state,
  tz,
  onRevert,
}: {
  field: "stopLoss" | "takeProfit";
  value: number | null;
  state: ProtectionState;
  tz: string;
  onRevert: (f: ProtectionField) => Promise<void>;
}) {
  const [pending, start] = useTransition();
  const det = state.detected?.[field] ?? null;
  if (!det) return null;
  const what = field === "stopLoss" ? "stop" : "take-profit";
  const matches = same(value, det.price);
  const auto = state.sources[field] === "auto" && matches;
  return (
    <p className="text-muted-foreground flex items-start gap-1 text-[11px] leading-4" data-testid={`${field}-auto`}>
      <Zap className="mt-0.5 size-3 shrink-0 text-sky-400" />
      {auto ? (
        <span>
          Auto from your {what} order · placed {fmtDateTime(det.placedAt, tz)}
        </span>
      ) : matches ? (
        <span>Matches your {what} order</span>
      ) : (
        <span>
          Your {what} order was <span className="tabular-nums">{exact(det.price)}</span>{" "}
          <button
            type="button"
            className="inline-flex items-center gap-0.5 text-sky-400 hover:underline disabled:opacity-50"
            disabled={pending}
            onClick={() => start(() => onRevert(field))}
          >
            <RotateCcw className="size-3" /> Revert to auto
          </button>
        </span>
      )}
    </p>
  );
}

export function PartialsHint({
  rows,
  state,
  onRevert,
}: {
  rows: { price: number | null; pct: number | null }[];
  state: ProtectionState;
  onRevert: (f: ProtectionField) => Promise<void>;
}) {
  const [pending, start] = useTransition();
  const det = state.detected?.tpPartials ?? [];
  if (!det.length) return null;
  const matches = rows.length === det.length && rows.every((r, i) => same(r.price, det[i].price) && same(r.pct, det[i].pct));
  return (
    <p className="text-muted-foreground flex items-start gap-1 text-[11px] leading-4" data-testid="tpPartials-auto">
      <Zap className="mt-0.5 size-3 shrink-0 text-sky-400" />
      {matches ? (
        <span>{state.sources.tpPartials === "auto" ? "Auto from" : "Matches"} your {det.length} take-profit orders</span>
      ) : (
        <span>
          Your exchange orders had {det.length} take-profit levels{" "}
          <button
            type="button"
            className="inline-flex items-center gap-0.5 text-sky-400 hover:underline disabled:opacity-50"
            disabled={pending}
            onClick={() => start(() => onRevert("tpPartials"))}
          >
            <RotateCcw className="size-3" /> Use them
          </button>
        </span>
      )}
    </p>
  );
}

/** Read-only timeline: initial stop, then each move (from the exchange). */
export function StopMoves({ state, initial, tz }: { state: ProtectionState; initial: number | null; tz: string }) {
  if (!state.stopMoves.length) return null;
  const start = state.detected?.stopLoss ?? null;
  return (
    <div className="mt-3 border-t pt-3" data-testid="stop-moves">
      <p className="text-muted-foreground mb-1.5 text-xs">Stop moves (from your exchange orders)</p>
      <ol className="grid gap-1 text-xs">
        {start && (
          <li className="flex gap-3">
            <span className="text-muted-foreground w-36 shrink-0">{fmtDateTime(start.placedAt, tz)}</span>
            <span className="tabular-nums">{fmtPrice(start.price)}</span>
            <span className="text-muted-foreground">initial{initial !== null && !same(initial, start.price) ? " (your stop loss differs)" : ""}</span>
          </li>
        )}
        {state.stopMoves.map((m) => (
          <li key={m.id} className="flex gap-3">
            <span className="text-muted-foreground w-36 shrink-0">{fmtDateTime(m.time, tz)}</span>
            <span className="tabular-nums">→ {fmtPrice(m.price)}</span>
            {m.source === "user" && <span className="text-muted-foreground">added by you</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
