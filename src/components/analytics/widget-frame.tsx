"use client";

import { useTransition } from "react";
import { EyeOff } from "lucide-react";
import { setAnalyticsHiddenAction } from "@/app/(app)/analytics/actions";

/** Card chrome for non-breakdown analytics widgets: title, description, optional controls, hide button. */
export function WidgetFrame({
  id,
  title,
  description,
  hidden,
  controls,
  children,
}: {
  id: string;
  title: string;
  description: string;
  hidden: string[];
  controls?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [pending, start] = useTransition();
  return (
    <section className="rounded-lg border p-4" aria-label={title} data-testid={`widget-${id}`}>
      <header className="mb-3 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium">{title}</h2>
          <p className="text-muted-foreground text-xs">{description}</p>
        </div>
        {controls}
        <button
          type="button"
          aria-label={`Hide ${title}`}
          title="Hide this widget"
          disabled={pending}
          className="text-muted-foreground hover:text-foreground shrink-0 rounded p-1"
          onClick={() => start(() => setAnalyticsHiddenAction([...hidden, id]))}
        >
          <EyeOff className="size-3.5" />
        </button>
      </header>
      {children}
    </section>
  );
}
