import { AppSidebar } from "@/components/shell/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { getConfig } from "@/server/config";
import { getActiveScope } from "@/server/db/queries/settings";
import { getSyncStatus } from "@/server/db/queries/sync";
import { SyncSlot } from "@/components/shell/sync-slot";
import { SyncProvider } from "@/components/sync/sync-status";
import { readAuthEnv } from "@/server/auth/env";
import { CommandPalette } from "@/components/shell/command-palette";
import { PrivacyToggle } from "@/components/shell/privacy-toggle";
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
      <SidebarProvider style={{ "--sidebar-width": "14.5rem" } as React.CSSProperties}>
        <AppSidebar
          accounts={accounts.map((a) => ({ id: a.id, name: a.name, type: a.type }))}
          activeId={active?.id ?? null}
          wallets={wallets}
          walletId={wallet?.id ?? null}
          authEnabled={readAuthEnv().authEnabled}
        />
        {/* the page is a white sheet inset from the ground, with a hairline ring instead of a shadow */}
        <SidebarInset className="min-w-0 md:peer-data-[variant=inset]:m-3 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-2xl md:peer-data-[variant=inset]:shadow-[0_0_0_1px_var(--rule-ring)] md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-3">
          <header className="flex h-12 shrink-0 items-center gap-2 px-3 md:px-6 md:pt-2">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
            {getConfig().isDemo && (
              <Badge variant="outline" className="border-rule text-gold-ink">
                Demo data
              </Badge>
            )}
            {wallet && (
              <Badge
                variant="outline"
                className="max-w-40 truncate"
                data-testid="wallet-scope"
                title="Every page shows this wallet only. Change it in the sidebar."
              >
                Wallet: {wallet.label}
              </Badge>
            )}
            <CommandPalette tz={tz} />
            <PrivacyToggle defaultOn={privacyDefault} />
            <div className="flex-1" />
            <SyncSlot where="topbar" />
          </header>
          <div className="flex-1 px-4 pt-2 pb-8 md:px-10 md:pt-3 md:pb-12">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </SyncProvider>
  );
}
