"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";
import type { SyncStatus as Status } from "@/server/db/queries/sync";
import { runSync } from "./run-sync";

type SyncCtx = {
  status: Status;
  isDemo: boolean;
  syncing: boolean;
  error: string | null;
  now: number;
  nextIn: number;
  autoEnabled: boolean;
  warnings: string[];
  sync: (trigger: "manual" | "auto") => Promise<void>;
};

const Ctx = createContext<SyncCtx | null>(null);

/**
 * Owns the sync state and the auto-sync loop. Mounted once in the app layout, so however many SyncStatus views
 * render (sidebar on desktop, top bar on phones), and however often they remount, there is one loop and one
 * in-flight flag.
 */
export function SyncProvider({
  initial,
  isDemo,
  children,
}: {
  initial: Status;
  isDemo: boolean;
  children: React.ReactNode;
}) {
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
        const ctFailed = r.ctrader?.find((x) => x.status === "error");
        if (failed) setError(failed.error ?? "Sync failed");
        else if (ctFailed) setError(`cTrader: ${ctFailed.error ?? "sync failed"}`);
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

  // Auto-sync while the tab is visible. (Deployed instances also get a server-side cron.)
  useEffect(() => {
    if (!autoEnabled) return;
    if (document.visibilityState === "visible" && now - lastAuto.current >= autoMs) void sync("auto");
  }, [now, autoEnabled, autoMs, sync]);

  const nextIn = Math.max(0, Math.ceil((lastAuto.current + autoMs - now) / 1000));
  const warnings: string[] = [];
  if (status.stale)
    warnings.push(
      (status.staleWallets.length ? `${status.staleWallets.join(", ")}: ` : "") +
        (status.lastSuccessAt ? `Last successful sync ${timeAgo(status.lastSuccessAt, now)}` : "Never synced"),
    );
  if (status.backfillPending) warnings.push("Initial import still in progress");
  if (status.historyTruncated)
    warnings.push("Hyperliquid only serves your 10,000 most recent fills; older history may be missing");
  if (status.gapTrades) warnings.push(`${status.gapTrades} trade(s) with a coverage gap`);
  if (status.lastRun?.status === "error") warnings.push(status.failedWallets.length ? `Last sync failed: ${status.failedWallets.join(", ")}` : "Last sync failed");

  return (
    <Ctx.Provider value={{ status, isDemo, syncing, error, now, nextIn, autoEnabled, warnings, sync }}>
      {children}
    </Ctx.Provider>
  );
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function WarningList({ warnings }: { warnings: string[] }) {
  return (
    <ul className="space-y-0.5">
      {warnings.map((w) => (
        <li key={w}>{w}</li>
      ))}
    </ul>
  );
}

/**
 * A view of the shared sync state. "row": the phone top bar; "stack": the sidebar footer; "icon": the collapsed
 * sidebar (one button, status in its tooltip).
 */
export function SyncStatus({ layout = "row" }: { layout?: "row" | "stack" | "icon" }) {
  const c = useContext(Ctx);
  if (!c) throw new Error("SyncStatus needs a SyncProvider");
  const { status, isDemo, syncing, error, now, nextIn, autoEnabled, warnings, sync } = c;

  if (isDemo) {
    if (layout === "icon") return null;
    return (
      <span className={cn("text-muted-foreground", layout === "stack" ? "text-13 px-2.5 py-2" : "text-xs")}>
        Demo: sync disabled
      </span>
    );
  }
  if (!status.hasWallets) {
    if (layout === "icon") return null;
    return (
      <Link
        href="/settings/wallets"
        className={cn(
          "text-muted-foreground hover:text-foreground underline-offset-4 hover:underline",
          layout === "stack" ? "text-13 px-2.5 py-2" : "text-xs",
        )}
      >
        Add a wallet to sync
      </Link>
    );
  }

  const failed = !syncing && (error || status.lastRun?.status === "error");
  const dot = syncing ? "bg-gold" : failed || status.stale ? "bg-loss" : "bg-profit";
  const line = syncing ? "Syncing…" : error ? "Sync failed" : `Synced ${timeAgo(status.lastSyncedAt, now)}`;

  if (layout === "icon") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => sync("manual")}
            disabled={syncing}
            aria-label={`Sync now (${line})`}
            className="text-ink-2 hover:bg-sidebar-accent relative grid size-8 place-items-center rounded-md disabled:opacity-60"
          >
            <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
            <span aria-hidden="true" className={cn("absolute top-1 right-1 size-[7px] rounded-full", dot)} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-xs">
          <p>{line}</p>
          {warnings.length > 0 && <WarningList warnings={warnings} />}
        </TooltipContent>
      </Tooltip>
    );
  }

  if (layout === "stack") {
    return (
      <div className="flex flex-col gap-0.5" data-testid="sync-status">
        <div
          className="text-muted-foreground text-13 flex items-center gap-2 px-2.5 py-2"
          title={error ?? undefined}
        >
          <span aria-hidden="true" className={cn("size-[7px] shrink-0 rounded-full", dot)} />
          <span className={cn("truncate", error && !syncing && "text-destructive")}>{line}</span>
          {warnings.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href="/settings/wallets"
                  className="bg-gold-tint text-gold-ink ml-auto flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs"
                >
                  <AlertTriangle className="size-3.5" />
                  {status.stale ? "Stale" : warnings.length}
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs">
                <WarningList warnings={warnings} />
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <button
          type="button"
          onClick={() => sync("manual")}
          disabled={syncing}
          className="text-ink-2 hover:bg-sidebar-accent hover:text-ink flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm disabled:opacity-60"
        >
          <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
          Sync now
          {!syncing && autoEnabled && (
            <span className="text-muted-foreground ml-auto text-xs tabular-nums">{mmss(nextIn)}</span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs" data-testid="sync-status">
      {warnings.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href="/settings/wallets"
              className={cn(
                "flex items-center gap-1 rounded-md px-1.5 py-0.5",
                status.stale || status.lastRun?.status === "error"
                  ? "bg-gold-tint text-gold-ink"
                  : "text-gold-ink",
              )}
            >
              <AlertTriangle className="size-3.5" />
              {status.stale ? "Stale" : warnings.length}
            </Link>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <WarningList warnings={warnings} />
          </TooltipContent>
        </Tooltip>
      )}
      <span className="text-muted-foreground hidden sm:inline" title={error ?? undefined}>
        {error && !syncing ? <span className="text-destructive">Sync failed</span> : line}
        {!syncing && autoEnabled && <span className="opacity-60">, next in {mmss(nextIn)}</span>}
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 gap-1 px-2"
        onClick={() => sync("manual")}
        disabled={syncing}
      >
        <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
        Sync now
      </Button>
    </div>
  );
}
