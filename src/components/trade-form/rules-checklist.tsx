"use client";

import Link from "next/link";
import { Check, X } from "lucide-react";
import { ruleLines } from "@/lib/analytics/playbook";
import { judge, keptFor, type RulesCheck, type RulesVerdict } from "@/lib/rules-check";
import { cn } from "@/lib/utils";
import { Field, Segmented } from "./fields";

export type RulesValue = { rulesCheck: RulesCheck | null; rulesFollowed: RulesVerdict | null };

/**
 * "Rules followed?" with the strategy's playbook rules. Mark each rule Kept or Broke (click again to unmark; an
 * unmarked rule isn't judged). Once every rule is marked, the answer follows: all kept Yes, none No, else Partial.
 * You can still pick Yes / Partial / No yourself. Without a strategy or rules, only the answer.
 */
export function RulesChecklist({
  strategy,
  value,
  onChange,
}: {
  strategy: { id: string; label: string; rules: string | null } | null;
  value: RulesValue;
  onChange: (v: Partial<RulesValue>) => void;
}) {
  const rules = ruleLines(strategy?.rules);
  const kept = strategy ? keptFor(value.rulesCheck, strategy.id, rules) : null;
  const mark = (i: number, to: boolean) => {
    if (!strategy) return;
    onChange(judge(strategy.id, rules, kept, i, kept?.[i] === to ? null : to, value.rulesFollowed));
  };
  const judged = kept?.filter((k) => k !== null).length ?? 0;

  return (
    <Field
      label="Rules followed?"
      hint={
        rules.length ? `${strategy!.label}: mark each rule; ${judged} of ${rules.length} marked` : undefined
      }
    >
      {rules.length > 0 && (
        <ul className="mb-2 grid gap-1.5" data-testid="rules-checklist">
          {rules.map((r, i) => (
            <li key={r} className="flex items-start justify-between gap-3 text-sm" data-rule={r}>
              <span className="pt-0.5">{r}</span>
              <span className="flex shrink-0 gap-1" role="group" aria-label={r}>
                <Mark on={kept?.[i] === true} onClick={() => mark(i, true)} label="Kept" />
                <Mark on={kept?.[i] === false} onClick={() => mark(i, false)} label="Broke" />
              </span>
            </li>
          ))}
        </ul>
      )}
      <Segmented
        aria-label="Rules followed"
        value={value.rulesFollowed}
        onChange={(v) => onChange({ rulesFollowed: v })}
        options={[
          { value: "yes", label: "Yes", className: "text-profit" },
          { value: "partial", label: "Partial", className: "text-gold-ink" },
          { value: "no", label: "No", className: "text-loss" },
        ]}
      />
      {strategy && rules.length === 0 && (
        <p className="text-muted-foreground mt-1.5 text-xs">
          {strategy.label} has no rules yet.{" "}
          <Link href="/playbook" className="link">
            Write them in the Playbook
          </Link>
        </p>
      )}
    </Field>
  );
}

function Mark({ on, onClick, label }: { on: boolean; onClick: () => void; label: "Kept" | "Broke" }) {
  const Icon = label === "Kept" ? Check : X;
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors",
        on ? "bg-subtle text-ink border-ink/40" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" /> {label}
    </button>
  );
}
