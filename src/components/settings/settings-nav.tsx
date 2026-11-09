"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/settings", label: "General" },
  { href: "/settings/accounts", label: "Accounts" },
  { href: "/settings/journal", label: "Journal lists" },
  { href: "/settings/wallets", label: "Wallets & sync", soon: true },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 border-b">
      {LINKS.map((l) =>
        l.soon ? (
          <span key={l.href} className="text-muted-foreground/50 px-3 py-2 text-sm" title="Coming in step 5">
            {l.label}
          </span>
        ) : (
          <Link
            key={l.href}
            href={l.href}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              pathname === l.href
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {l.label}
          </Link>
        ),
      )}
    </nav>
  );
}
