"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { LayoutDashboard, ListOrdered, NotebookPen, Search, Settings, Wallet } from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar";
import { fmtDateTime, fmtSignedUsd, pnlClass } from "@/lib/format";
import { commandSearchAction } from "@/app/(app)/trades/actions";
import { Direction } from "@/components/trades/direction";

type Results = Awaited<ReturnType<typeof commandSearchAction>>;

const NAV = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Trades", href: "/trades", icon: ListOrdered },
  { label: "Notes", href: "/trades?tab=notes", icon: NotebookPen },
  { label: "Settings", href: "/settings", icon: Settings },
  { label: "Wallets & sync", href: "/settings/wallets", icon: Wallet },
];

const OPEN_SEARCH = "tj:open-search";

/** The sidebar's Search item: opens the palette (mounted once in the layout) and closes the phone sheet. */
export function SearchItem({ className }: { className?: string }) {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <SidebarMenuButton
      onClick={() => {
        if (isMobile) setOpenMobile(false);
        window.dispatchEvent(new Event(OPEN_SEARCH));
      }}
      tooltip="Search (⌘K)"
      aria-label="Search (Ctrl+K)"
      className={className}
    >
      <Search />
      <span>Search</span>
      <kbd className="text-muted-foreground border-rule-ring ml-auto rounded border px-1 text-[11px] group-data-[collapsible=icon]:hidden">
        ⌘K
      </kbd>
    </SidebarMenuButton>
  );
}

/** Global ⌘K / Ctrl+K palette: navigation plus live trade and note search. Mounted once, in the app layout. */
export function CommandPalette({ tz, disabled = false }: { tz: string; disabled?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Results>({ trades: [], notes: [] });
  const [, start] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SEARCH, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SEARCH, onOpen);
    };
  }, []);

  useEffect(() => {
    if (disabled || !q.trim()) {
      setResults({ trades: [], notes: [] });
      return;
    }
    const t = setTimeout(() => start(async () => setResults(await commandSearchAction(q))), 180);
    return () => clearTimeout(t);
  }, [q, disabled]);

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };

  return (
    <>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search"
        description="Search trades and notes, or jump to a page"
      >
        <Command>
          <CommandInput placeholder="Search trades, tags, notes…" value={q} onValueChange={setQ} />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            {q.trim() && (
              <CommandGroup heading="Search">
                <CommandItem
                  value={`search ${q}`}
                  onSelect={() => go(`/trades?q=${encodeURIComponent(q.trim())}`)}
                >
                  <Search /> Search trades for “{q.trim()}”
                </CommandItem>
              </CommandGroup>
            )}
            {results.trades.length > 0 && (
              <CommandGroup heading="Trades">
                {results.trades.map((t) => (
                  <CommandItem
                    key={t.id}
                    value={`trade ${t.id} ${t.displayPair} ${q}`}
                    onSelect={() => go(`/trades/${t.id}`)}
                  >
                    <ListOrdered />
                    <span className="flex-1 truncate">
                      {t.displayPair} <Direction dir={t.direction} />{" "}
                      <span className="text-muted-foreground">
                        {t.entryTime ? fmtDateTime(t.entryTime, tz) : t.status}
                      </span>
                    </span>
                    <span className={cn("tabular-nums", pnlClass(t.netPnl))}>
                      {t.status === "planned" ? "planned" : fmtSignedUsd(t.netPnl)}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {results.notes.length > 0 && (
              <CommandGroup heading="Notes">
                {results.notes.map((n) => (
                  <CommandItem
                    key={n.id}
                    value={`note ${n.id} ${n.title ?? ""} ${q}`}
                    onSelect={() => go(`/trades?tab=notes&q=${encodeURIComponent(q.trim())}`)}
                  >
                    <NotebookPen /> <span className="flex-1 truncate">{n.title || "Untitled note"}</span>
                    <span className="text-muted-foreground text-xs">{fmtDateTime(n.date, tz)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandSeparator />
            <CommandGroup heading="Go to">
              {NAV.map((n) => (
                <CommandItem key={n.href} value={`go ${n.label}`} onSelect={() => go(n.href)}>
                  <n.icon /> {n.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
