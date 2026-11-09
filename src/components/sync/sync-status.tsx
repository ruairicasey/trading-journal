"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";
import type { SyncStatus as Status } from "@/server/db/queries/sync";
import { runSync } from "./run-sync";

export function SyncStatus({ initial, isDemo }: { initial: Status; isDemo: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const lastAuto = useRef<number>(Date.now());
  const syncingRef = useRef(false);

  useEffect(() => setStatus(initial), [initial]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const sync = useCallback(
    async (trigger: "manual" | "auto") => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      setSyncing(true);
      setError(null);
      try {
        const r = await runSync({ trigger }, (p) => setStatus(p.status));
        const failed = r.results.find((x) => x.status === "error");
        if (failed) setError(failed.error ?? "Sync failed");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Sync failed");
      } finally {
        syncingRef.current = false;
        setSyncing(false);
        lastAuto.current = Date.now();
      }
    },
    [router],
  );

  const autoMs = status.autoSyncMinutes * 60_000;
  const autoEnabled = !isDemo && status.hasWallets && status.autoSync;

  // Auto-sync while the tab is visible. (Deployed instances also get a server-side cron in step 6.)
  useEffect(() => {
    if (!autoEnabled) return;
    if (document.visibilityState === "visible" && now - lastAuto.current >= autoMs) void sync("auto");
  }, [now, autoEnabled, autoMs, sync]);

  if (isDemo) {
    return <span className="text-muted-foreground text-xs">Demo: sync disabled</span>;
  }
  if (!status.hasWallets) {
    return (
      <Link href="/settings/wallets" className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline">
        Add a wallet to sync
      </Link>
    );
  }

  const nextIn = Math.max(0, Math.ceil((lastAuto.current + autoMs - now) / 1000));
  const warnings: string[] = [];
  if (status.stale) warnings.push(status.lastSuccessAt ? `Last successful sync ${timeAgo(status.lastSuccessAt, now)}` : "Never synced");
  if (status.backfillPending) warnings.push("Initial import still in progress");
  if (status.historyTruncated) warnings.push("Hyperliquid only serves your 10,000 most recent fills; older history may be missing");
  if (status.gapTrades) warnings.push(`${status.gapTrades} trade(s) with a coverage gap`);
  if (status.lastRun?.status === "error") warnings.push("Last sync failed");

  return (
    <div className="flex items-center gap-2 text-xs">
      {warnings.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href="/settings/wallets"
              className={cn(
                "flex items-center gap-1 rounded-md px-1.5 py-0.5",
                status.stale || status.lastRun?.status === "error" ? "bg-amber-500/15 text-amber-400" : "text-amber-400/80",
              )}
            >
              <AlertTriangle className="size-3.5" />
              {status.stale ? "Stale" : warnings.length}
            </Link>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <ul className="space-y-0.5">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </TooltipContent>
        </Tooltip>
      )}
      <span className="text-muted-foreground hidden sm:inline" title={error ?? undefined}>
        {syncing ? "Syncing…" : error ? <span className="text-destructive">Sync failed</span> : <>Synced {timeAgo(status.lastSyncedAt, now)}</>}
        {!syncing && autoEnabled && <span className="opacity-60"> · next in {Math.floor(nextIn / 60)}:{String(nextIn % 60).padStart(2, "0")}</span>}
      </span>
      <Button size="sm" variant="ghost" className="h-7 gap-1 px-2" onClick={() => sync("manual")} disabled={syncing}>
        <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
        Sync now
      </Button>
    </div>
  );
}
