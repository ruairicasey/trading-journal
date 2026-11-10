"use client";

import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GRADES, HTF_TIMEFRAMES, MARKET_CONDITIONS, TIMEFRAMES, TIMEFRAME_CLASSES } from "@/lib/enums";
import { MARKET_CONDITION_LABELS, MAX_R_CHOICES, RISK_MULTIPLIERS } from "@/lib/journal-options";
import { Field, NumberInput, Section, Segmented } from "./fields";
import type { AnalysisDraft, FormProps } from "./types";
import { ChipMulti, ChipSelect, VocabPicker } from "./vocab-picker";

type Props = Pick<FormProps, "data"> & {
  value: AnalysisDraft;
  onChange: (p: Partial<AnalysisDraft>) => void;
  standardRiskPct: number | null;
};

export function AnalysisTab({ data, value: a, onChange, standardRiskPct }: Props) {
  const cats = (kind: string) => data.categories.filter((c) => c.kind === kind);
  const customMaxR = a.maxRReached !== null && !(MAX_R_CHOICES as readonly number[]).includes(a.maxRReached);
  const customMult = a.riskMultiplier !== null && !(RISK_MULTIPLIERS as readonly number[]).includes(a.riskMultiplier);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Context">
        <div className="grid gap-3">
          <Field label="Entry timeframe">
            <ChipSelect aria-label="Entry timeframe" options={TIMEFRAMES.map((t) => ({ value: t, label: t }))} value={a.entryTimeframe} onChange={(v) => onChange({ entryTimeframe: v })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Timeframe class">
              <Segmented
                aria-label="Timeframe class"
                value={a.timeframeClass}
                onChange={(v) => onChange({ timeframeClass: v })}
                options={TIMEFRAME_CLASSES.map((c) => ({ value: c, label: c }))}
              />
            </Field>
            <Field label="Market condition">
              <ChipSelect
                aria-label="Market condition"
                options={MARKET_CONDITIONS.map((c) => ({ value: c, label: MARKET_CONDITION_LABELS[c] }))}
                value={a.marketCondition}
                onChange={(v) => onChange({ marketCondition: v })}
              />
            </Field>
          </div>
          <Field label="Higher-timeframe confluence" hint="Timeframes that agreed with the trade">
            <ChipMulti aria-label="Higher-timeframe confluence" options={HTF_TIMEFRAMES} value={a.htfTimeframes} onChange={(v) => onChange({ htfTimeframes: v })} />
          </Field>
        </div>
      </Section>

      <Section title="Confluences" description="What lined up for this entry. Star favourites in Settings to pin them here.">
        <VocabPicker
          testId="confluence-picker"
          label="Confluences"
          kind="confluence"
          items={data.vocab.confluence}
          categories={cats("confluence")}
          selected={a.confluences}
          onChange={(confluences) => onChange({ confluences })}
          placeholder="Search confluences (VWAP, POC, sweep…)"
        />
      </Section>

      <Section title="Stop & target placement" description="Why the stop and target sat where they did.">
        <div className="grid gap-4">
          <VocabPicker
            testId="sl-picker"
            label="Stop-loss reasoning"
            kind="sl_reason"
            items={data.vocab.sl_reason}
            categories={cats("sl_reason")}
            selected={a.slReasons}
            onChange={(slReasons) => onChange({ slReasons })}
          />
          <VocabPicker
            testId="tp-picker"
            label="Take-profit reasoning"
            kind="tp_reason"
            items={data.vocab.tp_reason}
            categories={cats("tp_reason")}
            selected={a.tpReasons}
            onChange={(tpReasons) => onChange({ tpReasons })}
          />
        </div>
      </Section>

      <Section title="Review">
        <div className="grid gap-4">
          <Field label="Emotional state at entry">
            <ChipSelect
              aria-label="Emotional state at entry"
              options={data.vocab.emotion.map((e) => ({ value: e.id, label: e.label }))}
              value={a.emotionBeforeId}
              onChange={(v) => onChange({ emotionBeforeId: v })}
            />
          </Field>
          <Field label="Trade grade" hint="How well the trade followed your plan, not how much it made">
            <ChipSelect aria-label="Trade grade" options={GRADES.map((g) => ({ value: g, label: g }))} value={a.grade} onChange={(v) => onChange({ grade: v })} />
          </Field>
          <Field label="Entry retests" hint="Times price came back to your entry before moving">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="size-8"
                aria-label="Fewer retests"
                disabled={!a.entryRetests}
                onClick={() => onChange({ entryRetests: Math.max(0, (a.entryRetests ?? 0) - 1) })}
              >
                <Minus className="size-3.5" />
              </Button>
              <span className="w-10 text-center text-sm tabular-nums" data-testid="retests">
                {a.entryRetests ?? "—"}
              </span>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="size-8"
                aria-label="More retests"
                onClick={() => onChange({ entryRetests: Math.min(20, (a.entryRetests ?? -1) + 1) })}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
          </Field>
          <Field label="Max R reached before exit">
            <div className="flex flex-wrap items-center gap-2">
              <ChipSelect
                aria-label="Max R reached"
                options={MAX_R_CHOICES.map((r) => ({ value: r, label: `${r}R` }))}
                value={customMaxR ? null : a.maxRReached}
                onChange={(v) => onChange({ maxRReached: v })}
              />
              <NumberInput
                aria-label="Custom max R"
                className="w-24"
                placeholder="Custom"
                value={customMaxR ? a.maxRReached : null}
                min={0}
                onChange={(v) => onChange({ maxRReached: v })}
              />
            </div>
          </Field>
          <Field
            label="Risk multiplier"
            hint={`Size vs your standard risk${standardRiskPct !== null ? ` (${standardRiskPct}%)` : ""}. Leave blank for standard.`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <ChipSelect
                aria-label="Risk multiplier"
                options={RISK_MULTIPLIERS.map((r) => ({ value: r, label: `${r}×` }))}
                value={customMult ? null : a.riskMultiplier}
                onChange={(v) => onChange({ riskMultiplier: v })}
              />
              <NumberInput
                aria-label="Custom risk multiplier"
                className="w-24"
                placeholder="Custom"
                value={customMult ? a.riskMultiplier : null}
                min={0.05}
                onChange={(v) => onChange({ riskMultiplier: v })}
              />
            </div>
          </Field>
        </div>
      </Section>
    </div>
  );
}
