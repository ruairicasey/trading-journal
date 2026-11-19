"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { DASH_PERIODS, dashHref, type DashParams } from "@/lib/dashboard-params";

const seg = (on: boolean) =>
  cn(
    "rounded-[7px] px-2.5 py-1.5 text-13 whitespace-nowrap transition-colors",
    on
      ? "bg-sheet text-ink font-medium shadow-[0_1px_2px_rgba(21,24,28,.08)]"
      : "text-muted-foreground hover:text-ink",
  );

export function DashboardControls({
  params,
  base = "/dashboard",
  defaultPeriod = "30d",
  showUnit = true,
  hasStart = false,
}: {
  params: DashParams;
  base?: string;
  defaultPeriod?: string;
  /** off where the page has no R view (Reports) */
  showUnit?: boolean;
  /** the account has a journal start: show "Since start" (else it would be the same as All time) */
  hasStart?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(params.from ?? "");
  const [to, setTo] = useState(params.to ?? "");
  return (
    <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">
      <nav
        aria-label="Period"
        className="bg-subtle inline-flex max-w-full overflow-x-auto rounded-[9px] p-[3px]"
      >
        {DASH_PERIODS.filter((p) => hasStart || p.id !== "start").map((p) => (
          <Link
            key={p.id}
            href={dashHref(params, { period: p.id }, base, defaultPeriod)}
            aria-current={params.period === p.id ? "true" : undefined}
            className={seg(params.period === p.id)}
          >
            {p.label}
          </Link>
        ))}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(seg(params.period === "custom"), "flex items-center gap-1")}
              aria-current={params.period === "custom" ? "true" : undefined}
            >
              <CalendarRange className="size-3.5" />
              {params.period === "custom" && params.from
                ? `${params.from} → ${params.to || "now"}`
                : "Custom"}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72">
            <form
              className="grid gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!from) return;
                setOpen(false);
                router.push(
                  dashHref(params, { period: "custom", from, to: to || undefined }, base, defaultPeriod),
                );
              }}
            >
              <label className="grid gap-1 text-xs">
                From
                <Input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="h-8"
                  required
                />
              </label>
              <label className="grid gap-1 text-xs">
                To (optional)
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8" />
              </label>
              <Button type="submit" size="sm">
                Apply
              </Button>
            </form>
          </PopoverContent>
        </Popover>
      </nav>
      {showUnit && (
        <nav aria-label="Units" className="bg-subtle inline-flex rounded-[9px] p-[3px]">
          <Link
            href={dashHref(params, { unit: "usd" }, base, defaultPeriod)}
            aria-current={params.unit === "usd" ? "true" : undefined}
            className={seg(params.unit === "usd")}
          >
            $
          </Link>
          <Link
            href={dashHref(params, { unit: "r" }, base, defaultPeriod)}
            aria-current={params.unit === "r" ? "true" : undefined}
            className={seg(params.unit === "r")}
          >
            R
          </Link>
        </nav>
      )}
    </div>
  );
}
