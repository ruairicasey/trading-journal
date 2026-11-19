"use client";

import Link from "next/link";
import { useTransition } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { setActiveAccount, setActiveWallet } from "@/app/(app)/settings/actions";

const TYPE_LABEL: Record<string, string> = { crypto: "Crypto", prop: "Prop firm", other: "Other" };

export type AccountOption = { id: string; name: string; type: string };
export type WalletPick = { id: string; label: string; kind: string; enabled: boolean };

export function AccountSwitcher({
  accounts,
  activeId,
  wallets = [],
  walletId = null,
}: {
  accounts: AccountOption[];
  activeId: string | null;
  /** the active account's wallets: the picker shows only when there are two or more */
  wallets?: WalletPick[];
  walletId?: string | null;
}) {
  const [pending, start] = useTransition();
  const active = accounts.find((a) => a.id === activeId);
  const wallet = wallets.find((w) => w.id === walletId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton
          size="lg"
          tooltip={active?.name ?? "Account"}
          aria-label={`Account: ${active?.name ?? "No account"}${wallet ? `, ${wallet.label}` : ""}`}
          data-testid="account-switcher"
          className="data-[state=open]:bg-sidebar-accent h-auto rounded-lg px-2.5 py-2"
          disabled={pending}
        >
          <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
            <span className="text-ink truncate text-sm font-medium">{active?.name ?? "No account"}</span>
            <span className="text-muted-foreground truncate text-xs" data-testid="scope-label">
              {active ? (TYPE_LABEL[active.type] ?? active.type) : "Add one in Settings"}
              {wallet ? ` · ${wallet.label}` : ""}
            </span>
          </div>
          <ChevronsUpDown className="ml-auto size-4 opacity-60 group-data-[collapsible=icon]:ml-0" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel className="text-muted-foreground text-xs">Accounts</DropdownMenuLabel>
        {accounts.map((a) => (
          <DropdownMenuItem key={a.id} onSelect={() => start(() => setActiveAccount(a.id))}>
            <span className="flex-1 truncate">{a.name}</span>
            <span className="text-muted-foreground text-xs capitalize">{a.type}</span>
            {a.id === activeId && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
        {wallets.length > 1 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup aria-labelledby="wallets-label">
              <DropdownMenuLabel id="wallets-label" className="text-muted-foreground text-xs">
                Wallets
              </DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => start(() => setActiveWallet(null))}>
                <span className="flex-1 truncate">All wallets</span>
                {!wallet && <Check className="size-4" />}
              </DropdownMenuItem>
              {wallets.map((w) => (
                <DropdownMenuItem key={w.id} onSelect={() => start(() => setActiveWallet(w.id))}>
                  <span className="flex-1 truncate">{w.label}</span>
                  <span className="text-muted-foreground text-xs capitalize">
                    {w.enabled ? w.kind : "disabled"}
                  </span>
                  {w.id === walletId && <Check className="size-4" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/accounts">
            <Plus className="size-4" /> Manage accounts
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
