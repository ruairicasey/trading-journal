"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Activity, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtPct, fmtPrice, fmtSignedUsd, fmtSize, pnlClass } from "@/lib/format";
import type { OpenTradeRow } from "@/server/db/queries/dashboard";
import type { LivePosition } from "@/app/api/positions/route";

type Live = { live: boolean; reason?: string; at?: number; positions: LivePosition[] };
const REFRESH_MS = 30_000;

/** Open positions with live unrealised P&L from Hyperliquid (refreshed every 30s while visible). */
export function OpenTradesBanner({ trades, demo }: { trades: OpenTradeRow[]; demo: boolean }) {
  const [live, setLive] = useState<Live | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (demo) return;
    let stop = false;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/positions", { cache: "no-store" });
        const json = (await res.json()) as Live;
        if (!stop) setLive(json);
      } catch {
        if (!stop) setLive({ live: false, reason: "Could not reach Hyperliquid", positions: [] });
      }
    };
    void load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [demo]);

  const rows = useMemo(() => {
    const pos = new Map((live?.positions ?? []).map((p) => [p.coin, p]));
    const out = trades.map((t) => ({ trade: t, pos: pos.get(t.coin) ?? null }));
    const known = new Set(trades.map((t) => t.coin));
    for (const p of live?.positions ?? []) if (!known.has(p.coin)) out.push({ trade: null as unknown as OpenTradeRow, pos: p });
    return out;
  }, [trades, live]);

  if (rows.length === 0) return null;
  const upnl = live?.live ? (live.positions ?? []).reduce((a, p) => a + (p.unrealizedPnl ?? 0), 0) : null;

  return (
    <section className="rounded-lg border border-sky-500/30 bg-sky-500/5" aria-label="Open positions" data-testid="open-banner">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm">
        <Activity className="size-4 text-sky-300" />
        <span className="font-medium">
          {rows.length} open position{rows.length === 1 ? "" : "s"}
        </span>
        <span className="text-muted-foreground text-xs">
          {upnl !== null ? (
            <>
              unrealised <span className={cn("money font-medium tabular-nums", pnlClass(upnl))}>{fmtSignedUsd(upnl)}</span>
            </>
          ) : demo ? (
            "live P&L unavailable for demo data"
          ) : live ? (
            live.reason ?? "live P&L unavailable"
          ) : (
            "loading live P&L…"
          )}
        </span>
        <div className="flex-1" />
        <ChevronDown className={cn("text-muted-foreground size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="overflow-x-auto border-t border-sky-500/20">
          <table className="w-full min-w-[640px] text-xs">
            <thead className="text-muted-foreground text-left">
              <tr>
                {["Pair", "Size", "Entry", "Unrealised", "ROE", "Liq.", "Stop", ""].map((h) => (
                  <th key={h} className="px-4 py-1.5 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-sky-500/10 tabular-nums">
              {rows.map(({ trade, pos }, i) => {
                const dir = trade?.direction ?? (pos && pos.size < 0 ? "short" : "long");
                return (
                  <tr key={trade?.id ?? `pos-${i}`}>
                    <td className="px-4 py-1.5">
                      {trade?.displayPair ?? pos?.displayPair}{" "}
                      <span className={cn("text-[10px] font-semibold uppercase", dir === "long" ? "text-long" : "text-short")}>{dir}</span>
                    </td>
                    <td className="px-4 py-1.5">{fmtSize(pos ? Math.abs(pos.size) : trade?.sizeUnits)}</td>
                    <td className="px-4 py-1.5">{fmtPrice(pos?.entryPx ?? trade?.avgEntry)}</td>
                    <td className={cn("money px-4 py-1.5", pnlClass(pos?.unrealizedPnl))}>{pos ? fmtSignedUsd(pos.unrealizedPnl) : "—"}</td>
                    <td className={cn("px-4 py-1.5", pnlClass(pos?.returnOnEquity))}>{pos?.returnOnEquity != null ? fmtPct(pos.returnOnEquity * 100) : "—"}</td>
                    <td className="px-4 py-1.5">{fmtPrice(pos?.liquidationPx ?? trade?.liqPx)}</td>
                    <td className="px-4 py-1.5">{trade?.stopLoss ? fmtPrice(trade.stopLoss) : <span className="text-amber-400">none</span>}</td>
                    <td className="px-4 py-1.5 text-right">
                      {trade ? (
                        <Link href={`/trades/${trade.id}`} className="text-primary hover:underline">
                          Journal →
                        </Link>
                      ) : (
                        <span className="text-amber-400" title="Not in your journal yet: run Sync now">
                          not synced
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
