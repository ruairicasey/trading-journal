"use client";

import { useTransition } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { setAnalyticsHiddenAction } from "@/app/(app)/analytics/actions";

export function CustomizeWidgets({ widgets, hidden }: { widgets: { id: string; title: string }[]; hidden: string[] }) {
  const [pending, start] = useTransition();
  const n = widgets.filter((w) => hidden.includes(w.id)).length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="secondary" className="h-8">
          <SlidersHorizontal className="size-4" /> Widgets{n ? ` (${n} hidden)` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <p className="text-muted-foreground mb-2 text-xs">Show on this page</p>
        <ul className="grid gap-1.5">
          {widgets.map((w) => (
            <li key={w.id}>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={!hidden.includes(w.id)}
                  disabled={pending}
                  onCheckedChange={(on) =>
                    start(() => setAnalyticsHiddenAction(on ? hidden.filter((h) => h !== w.id) : [...hidden, w.id]))
                  }
                />
                {w.title}
              </label>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
