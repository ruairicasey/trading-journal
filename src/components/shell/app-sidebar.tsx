"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, LayoutDashboard, FileText, ListOrdered, Settings, type LucideIcon } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { AccountSwitcher, type AccountOption, type WalletPick } from "./account-switcher";
import { LogoutButton } from "./logout-button";
import { Logo } from "./logo";
import { SyncSlot } from "./sync-slot";

type NavItem = { href: string; label: string; icon: LucideIcon };

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/trades", label: "Trades", icon: ListOrdered },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/reports", label: "Reports", icon: FileText },
];

/** Nav items: plain text on the ground; the current page is a white pill with a hairline ring. */
const ITEM =
  "h-9 rounded-lg px-2.5 text-sm text-ink-2 data-active:bg-sheet data-active:text-ink data-active:shadow-[0_0_0_1px_var(--rule-ring)] data-active:hover:bg-sheet [&_svg]:text-muted-foreground data-active:[&_svg]:text-ink";

export function AppSidebar({
  accounts,
  activeId,
  wallets = [],
  walletId = null,
  authEnabled = false,
}: {
  accounts: AccountOption[];
  activeId: string | null;
  wallets?: WalletPick[];
  walletId?: string | null;
  authEnabled?: boolean;
}) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader className="px-3.5 pt-5 pb-2">
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 rounded-lg px-2 py-1"
          aria-label="Journal home"
        >
          <Logo className="shrink-0" />
          <span className="text-ink text-base font-semibold tracking-[-0.01em] group-data-[collapsible=icon]:hidden">
            Journal
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="gap-5 px-1.5">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {NAV.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.href)}
                    tooltip={item.label}
                    className={ITEM}
                  >
                    <Link href={item.href} aria-current={isActive(item.href) ? "page" : undefined}>
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-muted-foreground px-2.5 text-xs">Account</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <AccountSwitcher
                  accounts={accounts}
                  activeId={activeId}
                  wallets={wallets}
                  walletId={walletId}
                />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="px-3.5 pb-4">
        <SyncSlot where="sidebar" />
        <SidebarMenu className="gap-0.5">
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={isActive("/settings")} tooltip="Settings" className={ITEM}>
              <Link href="/settings" aria-current={isActive("/settings") ? "page" : undefined}>
                <Settings />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {authEnabled && (
            <SidebarMenuItem>
              <LogoutButton className={ITEM} />
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
