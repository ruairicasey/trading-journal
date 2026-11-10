"use client";

import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function Section({ title, description, children, className }: { title: string; description?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border p-4", className)}>
      <header className="mb-3">
        <h2 className="text-sm font-medium">{title}</h2>
        {description && <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>}
      </header>
      {children}
    </section>
  );
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: React.ReactNode; error?: string | null; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <Label className="text-muted-foreground text-xs">{label}</Label>
      {children}
      {error ? <p className="text-destructive text-[11px]">{error}</p> : hint ? <p className="text-muted-foreground text-[11px]">{hint}</p> : null}
    </div>
  );
}

/** Read-only exchange value with a lock icon. */
export function Locked({ children, title = "Synced from exchange" }: { children: React.ReactNode; title?: string }) {
  return (
    <div title={title} className="bg-muted/40 text-foreground/90 flex h-8 items-center gap-1.5 rounded-md border border-dashed px-2.5 text-sm tabular-nums">
      <Lock className="text-muted-foreground size-3 shrink-0" />
      <span className="truncate">{children}</span>
    </div>
  );
}

/**
 * Number input that keeps the user's text while typing ("0.", "1e") and reports a number or null.
 * External value changes (e.g. linked USD↔units fields) update the text when not focused.
 */
export function NumberInput({
  value,
  onChange,
  placeholder,
  disabled,
  className,
  min,
  step = "any",
  "aria-label": ariaLabel,
  id,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  min?: number;
  step?: string;
  "aria-label"?: string;
  id?: string;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value === null || !Number.isFinite(value) ? "" : String(Number(value.toPrecision(12))));
  }, [value, focused]);
  return (
    <Input
      id={id}
      inputMode="decimal"
      type="text"
      aria-label={ariaLabel}
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      className={cn("h-8 tabular-nums", className)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        const t = e.target.value.replace(/,/g, "");
        setText(e.target.value);
        if (t.trim() === "") return onChange(null);
        const n = Number(t);
        if (Number.isFinite(n) && (min === undefined || n >= min)) onChange(n);
      }}
      step={step}
    />
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  "aria-label": ariaLabel,
}: {
  value: T | null;
  options: { value: T; label: string; className?: string }[];
  onChange: (v: T | null) => void;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="bg-muted/40 inline-flex h-8 rounded-md border p-0.5">
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(on ? null : o.value)}
            className={cn(
              "rounded px-3 text-xs font-medium transition-colors disabled:opacity-50",
              on ? cn("bg-background shadow-sm", o.className) : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
