import { AppSidebar } from "@/components/shell/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { getActiveAccount } from "@/server/db/queries/settings";

// Everything under (app) reads the private database per request.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { accounts, active } = await getActiveAccount();
  return (
    <SidebarProvider>
      <AppSidebar
        accounts={accounts.map((a) => ({ id: a.id, name: a.name, type: a.type }))}
        activeId={active?.id ?? null}
      />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
          <div className="flex-1" />
          {/* Sync status + balance arrive in step 5. */}
          <span className="text-muted-foreground text-xs">Not synced</span>
        </header>
        <div className="flex-1 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
