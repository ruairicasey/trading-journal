"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { KeepActiveVisible } from "@/components/shell/keep-active-visible";

const LINKS: { href: string; label: string; soon?: boolean }[] = [
  { href: "/settings", label: "General" },
  { href: "/settings/accounts", label: "Accounts" },
  { href: "/settings/journal", label: "Journal lists" },
  { href: "/settings/wallets", label: "Wallets & sync" },
  { href: "/settings/ctrader", label: "cTrader" },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Settings sections"
      className="flex gap-6 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--rule)]"
    >
      {LINKS.map((l) =>
        l.soon ? (
          <span key={l.href} className="text-muted-foreground/50 px-3 py-2 text-sm" title="Coming in step 5">
            {l.label}
          </span>
        ) : (
          <Link
            key={l.href}
            href={l.href}
            aria-current={pathname === l.href ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-sm pb-3 text-sm transition-colors focus-visible:outline-offset-[-2px]",
              pathname === l.href
                ? "text-ink font-medium shadow-[inset_0_-2px_0_var(--ink)]"
                : "text-ink-2 hover:text-ink",
            )}
          >
            {l.label}
          </Link>
        ),
      )}
      <KeepActiveVisible dep={pathname} />
    </nav>
  );
}
