import { AppSidebar } from "@/components/shell/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { getConfig } from "@/server/config";
import { getActiveScope } from "@/server/db/queries/settings";
import { getSyncStatus } from "@/server/db/queries/sync";
import { SyncSlot } from "@/components/shell/sync-slot";
import { SyncProvider } from "@/components/sync/sync-status";
import { CommandPalette } from "@/components/shell/command-palette";
import { PrivacyInit } from "@/components/shell/privacy-toggle";
import { Badge } from "@/components/ui/badge";
import { readAuthEnv } from "@/server/auth/env";
import { getSetting } from "@/server/db/queries/settings";

// Everything under (app) reads the private database per request.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [{ accounts, active, wallets, wallet }, syncStatus, tz, privacyDefault] = await Promise.all([
    getActiveScope(),
    getSyncStatus(),
    getSetting("timezone", getConfig().timezone),
    getSetting("privacy_default", false),
  ]);
  return (
    <SyncProvider initial={syncStatus} isDemo={getConfig().isDemo}>
      <PrivacyInit defaultOn={privacyDefault} />
      <SidebarProvider style={{ "--sidebar-width": "14.5rem" } as React.CSSProperties}>
        <AppSidebar
          accounts={accounts.map((a) => ({ id: a.id, name: a.name, type: a.type }))}
          activeId={active?.id ?? null}
          wallets={wallets}
          walletId={wallet?.id ?? null}
          walletLabel={wallet?.label ?? null}
          authEnabled={readAuthEnv().authEnabled}
          isDemo={getConfig().isDemo}
        />
        {/* the page is a white sheet inset from the ground, with a hairline ring instead of a shadow */}
        <SidebarInset className="min-w-0 md:peer-data-[variant=inset]:m-3 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-2xl md:peer-data-[variant=inset]:shadow-[0_0_0_1px_var(--rule-ring)] md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-3">
          {/* phones only: the menu button and the sync status (desktop has no top bar) */}
          <header className="flex h-12 shrink-0 items-center gap-2 px-3 md:hidden">
            <SidebarTrigger className="-ml-1" />
            {getConfig().isDemo && (
              <Badge variant="outline" className="border-rule-ring text-gold-ink">
                Demo data
              </Badge>
            )}
            {wallet && (
              <Badge
                variant="outline"
                className="border-rule-ring max-w-32 truncate"
                data-testid="wallet-scope-phone"
                title="Every page shows this wallet only. Change it in the menu."
              >
                Wallet: {wallet.label}
              </Badge>
            )}
            <div className="flex-1" />
            <SyncSlot where="topbar" />
          </header>
          <div className="flex-1 px-4 pt-2 pb-8 md:px-10 md:pt-7 md:pb-12">{children}</div>
        </SidebarInset>
        <CommandPalette tz={tz} />
      </SidebarProvider>
    </SyncProvider>
  );
}
