"use client";

import { useMemo, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { MAX_TAGS, REFLECTION_PROMPTS } from "@/lib/journal-options";
import { Field, Section, Segmented } from "./fields";
import { Screenshots } from "./screenshots";
import type { FormProps, NotesDraft } from "./types";
import { ChipSelect, VocabPicker } from "./vocab-picker";

const NONE = "__none";

type Props = Pick<FormProps, "data"> & {
  value: NotesDraft;
  onChange: (p: Partial<NotesDraft>) => void;
  active: boolean;
};

export function NotesTab({ data, value: n, onChange, active }: Props) {
  const [reflect, setReflect] = useState(Object.keys(n.reflection ?? {}).length > 0);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Notes" className="lg:col-span-2">
        <div className="grid gap-3 lg:grid-cols-2">
          <Field label="Why did you take this trade?">
            <Textarea
              aria-label="Trade rationale"
              rows={6}
              value={n.rationale ?? ""}
              onChange={(e) => onChange({ rationale: e.target.value })}
              placeholder="Setup, context, what you were waiting for…"
            />
          </Field>
          <Field label="What went right / wrong?">
            <Textarea
              aria-label="Post-trade notes"
              rows={6}
              value={n.postNotes ?? ""}
              onChange={(e) => onChange({ postNotes: e.target.value })}
              placeholder="Execution, management, exit, what you learned…"
            />
          </Field>
        </div>
        <button
          type="button"
          onClick={() => setReflect((r) => !r)}
          aria-expanded={reflect}
          className="text-muted-foreground hover:text-foreground mt-3 flex items-center gap-1 text-xs"
        >
          <ChevronDown className={cn("size-3.5 transition-transform", reflect && "rotate-180")} /> Reflection prompts
        </button>
        {reflect && (
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {REFLECTION_PROMPTS.map((p) => (
              <Field key={p.key} label={p.label}>
                <Textarea
                  aria-label={p.label}
                  rows={3}
                  value={n.reflection?.[p.key] ?? ""}
                  onChange={(e) => onChange({ reflection: { ...n.reflection, [p.key]: e.target.value } })}
                />
              </Field>
            ))}
          </div>
        )}
        <div className="mt-4">
          <TagInput value={n.tags} suggestions={data.tagSuggestions} onChange={(tags) => onChange({ tags })} />
        </div>
      </Section>

      <Section title="Screenshots" className="lg:col-span-2">
        <Screenshots tradeId={data.trade.id} initial={data.screenshots} pasteEnabled={active} />
      </Section>

      <Section title="Review">
        <div className="grid gap-4">
          <Field label="Rules followed?">
            <Segmented
              aria-label="Rules followed"
              value={n.rulesFollowed}
              onChange={(v) => onChange({ rulesFollowed: v })}
              options={[
                { value: "yes", label: "Yes", className: "text-profit" },
                { value: "partial", label: "Partial", className: "text-amber-400" },
                { value: "no", label: "No", className: "text-loss" },
              ]}
            />
          </Field>
          <Field label="Exit reason">
            <Select value={n.exitReasonId ?? NONE} onValueChange={(v) => onChange({ exitReasonId: v === NONE ? null : v })}>
              <SelectTrigger className="h-8 w-full" aria-label="Exit reason">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not set</SelectItem>
                {data.vocab.exit_reason.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Emotion after exit">
            <ChipSelect
              aria-label="Emotion after exit"
              options={data.vocab.emotion.map((e) => ({ value: e.id, label: e.label }))}
              value={n.emotionAfterId}
              onChange={(v) => onChange({ emotionAfterId: v })}
            />
          </Field>
          <Field label="Process compliant?" hint="Did you execute your process, regardless of the outcome?">
            <Segmented
              aria-label="Process compliant"
              value={n.processCompliant === null ? null : n.processCompliant ? "yes" : "no"}
              onChange={(v) => onChange({ processCompliant: v === null ? null : v === "yes" })}
              options={[
                { value: "yes", label: "Yes", className: "text-profit" },
                { value: "no", label: "No", className: "text-loss" },
              ]}
            />
          </Field>
        </div>
      </Section>

      <Section title="Mistakes">
        <VocabPicker
          testId="mistake-picker"
          label="Mistakes"
          kind="mistake"
          items={data.vocab.mistake}
          categories={data.categories.filter((c) => c.kind === "mistake")}
          selected={n.mistakes}
          onChange={(mistakes) => onChange({ mistakes })}
        />
      </Section>
    </div>
  );
}

function TagInput({ value, suggestions, onChange }: { value: string[]; suggestions: string[]; onChange: (tags: string[]) => void }) {
  const [text, setText] = useState("");
  const lower = new Set(value.map((t) => t.toLowerCase()));
  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    return suggestions.filter((s) => !lower.has(s.toLowerCase()) && (!q || s.toLowerCase().includes(q))).slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, suggestions, value]);
  const add = (raw: string) => {
    const parts = raw
      .split(",")
      .map((t) => t.trim().replace(/^#/, ""))
      .filter(Boolean);
    const next = [...value];
    for (const p of parts) if (!next.some((t) => t.toLowerCase() === p.toLowerCase()) && next.length < MAX_TAGS) next.push(p.slice(0, 40));
    onChange(next);
    setText("");
  };
  return (
    <Field label={`Tags (${value.length}/${MAX_TAGS})`} hint="Press Enter or comma to add">
      <div className="flex flex-wrap items-center gap-1 rounded-md border px-2 py-1" data-testid="tags">
        {value.map((t) => (
          <span key={t} className="bg-secondary flex items-center gap-1 rounded-full px-2 py-0.5 text-xs">
            #{t}
            <button type="button" aria-label={`Remove tag ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}>
              <X className="size-3" />
            </button>
          </span>
        ))}
        <Input
          aria-label="Add tag"
          value={text}
          onChange={(e) => {
            if (e.target.value.endsWith(",")) add(e.target.value);
            else setText(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (text.trim()) add(text);
            } else if (e.key === "Backspace" && !text && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => text.trim() && add(text)}
          placeholder={value.length ? "" : "a-setup, news, fomc…"}
          className="h-7 min-w-32 flex-1 border-0 px-1 shadow-none focus-visible:ring-0"
          disabled={value.length >= MAX_TAGS}
        />
      </div>
      {text && matches.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {matches.map((m) => (
            <button key={m} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(m)} className="text-muted-foreground hover:text-foreground rounded-full border px-2 py-0.5 text-[11px]">
              #{m}
            </button>
          ))}
        </div>
      )}
    </Field>
  );
}
