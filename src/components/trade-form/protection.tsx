"use client";

import { useTransition } from "react";
import { RotateCcw, Zap } from "lucide-react";
import { fmtDateTime, fmtPrice } from "@/lib/format";
import { LATE_STOP_MS } from "@/server/protection/detect";
import type { ProtectionField, ProtectionState } from "./types";

/** "40m", "3.6h", "2.1d" */
export function lateBy(ms: number) {
  const m = ms / 60_000;
  if (m < 120) return `${Math.round(m)}m`;
  if (m < 48 * 60) return `${(m / 60).toFixed(1)}h`;
  return `${(m / 1440).toFixed(1)}d`;
}

const same = (a: number | null, b: number | null) => a === b || (a !== null && b !== null && Math.abs(a - b) <= Math.abs(b) * 1e-12);
/** full precision: a rounded display could hide the difference the user is being told about */
const exact = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 10 });

/** Under SL / TP: where the value came from, and a way back to the exchange value. */
export function ProtectionHint({
  field,
  value,
  state,
  tz,
  entryTime,
  onRevert,
}: {
  field: "stopLoss" | "takeProfit";
  value: number | null;
  state: ProtectionState;
  tz: string;
  entryTime: number | null;
  onRevert: (f: ProtectionField) => Promise<void>;
}) {
  const [pending, start] = useTransition();
  const det = state.detected?.[field] ?? null;
  if (!det) return null;
  const what = field === "stopLoss" ? "stop" : "take-profit";
  const matches = same(value, det.price);
  const auto = state.sources[field] === "auto" && matches;
  const late = field === "stopLoss" && entryTime !== null && det.placedAt - entryTime > LATE_STOP_MS ? det.placedAt - entryTime : null;
  return (
    <p className="text-muted-foreground flex items-start gap-1 text-[11px] leading-4" data-testid={`${field}-auto`}>
      <Zap className="mt-0.5 size-3 shrink-0 text-sky-400" />
      {auto ? (
        <span>
          Auto from your {what} order ·{" "}
          {late !== null ? (
            <span className="text-amber-400" title={`Placed ${fmtDateTime(det.placedAt, tz)}`} data-testid="late-stop">
              placed {lateBy(late)} after entry
            </span>
          ) : (
            <>placed {fmtDateTime(det.placedAt, tz)}</>
          )}
        </span>
      ) : matches ? (
        <span>
          Matches your {what} order{late !== null && <span className="text-amber-400"> · placed {lateBy(late)} after entry</span>}
        </span>
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

/** Read-only timeline of stop orders: the initial (risk-side) stop and every move, in time order. */
export function StopMoves({ state, initial, tz }: { state: ProtectionState; initial: number | null; tz: string }) {
  if (!state.stopMoves.length) return null;
  const start = state.detected?.stopLoss ?? null;
  const rows = [
    ...(start ? [{ key: "initial", time: start.placedAt, price: start.price, initial: true, user: false }] : []),
    ...state.stopMoves.map((m) => ({ key: m.id, time: m.time, price: m.price, initial: false, user: m.source === "user" })),
  ].sort((a, b) => a.time - b.time);
  return (
    <div className="mt-3 border-t pt-3" data-testid="stop-moves">
      <p className="text-muted-foreground mb-1.5 text-xs">Stop moves (from your exchange orders)</p>
      <ol className="grid gap-1 text-xs">
        {rows.map((r) => (
          <li key={r.key} className="flex gap-3">
            <span className="text-muted-foreground w-36 shrink-0">{fmtDateTime(r.time, tz)}</span>
            <span className="tabular-nums">{r.initial ? fmtPrice(r.price) : `→ ${fmtPrice(r.price)}`}</span>
            {r.initial && (
              <span className="text-muted-foreground">initial stop{initial !== null && !same(initial, r.price) ? " (your stop loss differs)" : ""}</span>
            )}
            {r.user && <span className="text-muted-foreground">added by you</span>}
          </li>
        ))}
      </ol>
      {!start && <p className="text-muted-foreground mt-1.5 text-[11px]">No stop on the risk side of entry, so no stop loss was set from these.</p>}
    </div>
  );
}
