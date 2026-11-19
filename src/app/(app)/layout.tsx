import { AppSidebar } from "@/components/shell/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { getConfig } from "@/server/config";
import { getActiveScope } from "@/server/db/queries/settings";
import { getSyncStatus } from "@/server/db/queries/sync";
import { SyncStatus } from "@/components/sync/sync-status";
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
    <SidebarProvider>
      <AppSidebar
        accounts={accounts.map((a) => ({ id: a.id, name: a.name, type: a.type }))}
        activeId={active?.id ?? null}
        wallets={wallets}
        walletId={wallet?.id ?? null}
        authEnabled={readAuthEnv().authEnabled}
      />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
          {getConfig().isDemo && (
            <Badge variant="outline" className="border-rule text-gold-ink">
              Demo data
            </Badge>
          )}
          {wallet && (
            <Badge variant="outline" className="max-w-40 truncate" data-testid="wallet-scope" title="Every page shows this wallet only. Change it in the sidebar.">
              Wallet: {wallet.label}
            </Badge>
          )}
          <CommandPalette tz={tz} />
          <PrivacyToggle defaultOn={privacyDefault} />
          <div className="flex-1" />
          <SyncStatus initial={syncStatus} isDemo={getConfig().isDemo} />
        </header>
        <div className="flex-1 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
