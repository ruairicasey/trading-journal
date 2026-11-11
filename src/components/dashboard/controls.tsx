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
  cn("rounded px-2.5 py-1 text-xs font-medium transition-colors", on ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground");

export function DashboardControls({ params }: { params: DashParams }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(params.from ?? "");
  const [to, setTo] = useState(params.to ?? "");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav aria-label="Period" className="bg-muted/40 inline-flex rounded-md border p-0.5">
        {DASH_PERIODS.map((p) => (
          <Link key={p.id} href={dashHref(params, { period: p.id })} aria-current={params.period === p.id ? "true" : undefined} className={seg(params.period === p.id)}>
            {p.label}
          </Link>
        ))}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button type="button" className={cn(seg(params.period === "custom"), "flex items-center gap-1")} aria-current={params.period === "custom" ? "true" : undefined}>
              <CalendarRange className="size-3.5" />
              {params.period === "custom" && params.from ? `${params.from} → ${params.to || "now"}` : "Custom"}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72">
            <form
              className="grid gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!from) return;
                setOpen(false);
                router.push(dashHref(params, { period: "custom", from, to: to || undefined }));
              }}
            >
              <label className="grid gap-1 text-xs">
                From
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8" required />
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
      <nav aria-label="Units" className="bg-muted/40 inline-flex rounded-md border p-0.5">
        <Link href={dashHref(params, { unit: "usd" })} aria-current={params.unit === "usd" ? "true" : undefined} className={seg(params.unit === "usd")}>
          $
        </Link>
        <Link href={dashHref(params, { unit: "r" })} aria-current={params.unit === "r" ? "true" : undefined} className={seg(params.unit === "r")}>
          R
        </Link>
      </nav>
    </div>
  );
}
