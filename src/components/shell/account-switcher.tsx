"use client";

import Link from "next/link";
import { useTransition } from "react";
import { BookOpenText, Check, ChevronsUpDown, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { setActiveAccount } from "@/app/(app)/settings/actions";

export type AccountOption = { id: string; name: string; type: string };

export function AccountSwitcher({ accounts, activeId }: { accounts: AccountOption[]; activeId: string | null }) {
  const [pending, start] = useTransition();
  const active = accounts.find((a) => a.id === activeId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent" disabled={pending}>
          <div className="bg-sidebar-primary text-sidebar-primary-foreground flex size-8 items-center justify-center rounded-md">
            <BookOpenText className="size-4" />
          </div>
          <div className="grid flex-1 text-left leading-tight">
            <span className="truncate text-sm font-semibold">Trading Journal</span>
            <span className="text-muted-foreground truncate text-xs">{active?.name ?? "No account"}</span>
          </div>
          <ChevronsUpDown className="ml-auto size-4 opacity-60" />
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
