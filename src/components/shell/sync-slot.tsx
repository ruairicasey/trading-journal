"use client";

import { useSidebar } from "@/components/ui/sidebar";
import { SyncStatus } from "@/components/sync/sync-status";

/**
 * Where the sync status shows: the sidebar footer on desktop (an icon button when the sidebar is collapsed), the top
 * bar on phones, where the sidebar is a sheet that is closed most of the time. The state and the auto-sync loop live
 * in SyncProvider, so these views can mount and unmount freely.
 */
export function SyncSlot({ where }: { where: "sidebar" | "topbar" }) {
  const { isMobile, state } = useSidebar();
  if (where === "topbar") return isMobile ? <SyncStatus layout="row" /> : null;
  if (isMobile) return null;
  return <SyncStatus layout={state === "collapsed" ? "icon" : "stack"} />;
}
