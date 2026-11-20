"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Check, ChevronLeft, ChevronRight, ClipboardCheck, Loader2 } from "lucide-react";
import { EmptyState } from "@/components/shell/empty-state";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Direction } from "@/components/trades/direction";
import { StrategyField } from "@/components/trade-form/basic-tab";
import { Field } from "@/components/trade-form/fields";
import { RulesChecklist } from "@/components/trade-form/rules-checklist";
import { Screenshots } from "@/components/trade-form/screenshots";
import { initialDraft } from "@/components/trade-form/types";
import { ChipSelect, VocabPicker } from "@/components/trade-form/vocab-picker";
import { GRADES } from "@/lib/enums";
import { fmtDateTime, fmtDuration, fmtPct, fmtR, fmtSignedUsd, pnlClass } from "@/lib/format";
import { rMultiple } from "@/lib/outcome";
import { afterStrategyChange } from "@/lib/rules-check";
import { cn } from "@/lib/utils";
import type { TradeEditData } from "@/server/trades/journal";
import type { ReviewFields } from "@/server/trades/review";
import { loadReviewTradeAction, saveReviewAction } from "@/app/(app)/review/actions";

const NONE = "__none";
/** Keys typed into a field, or into an open select, menu or dialog (e.g. a screenshot), are not shortcuts. */
const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) ||
    el.getAttribute("role") === "combobox" ||
    !!el.closest("[role=listbox],[role=option],[role=menu],[role=dialog],[role=alertdialog]"));

/** The review fields as the trade has them now. */
function fieldsOf(d: TradeEditData): ReviewFields {
  const dr = initialDraft(d);
  return {
    grade: dr.analysis.grade,
    strategyId: dr.strategyId,
    emotionBeforeId: dr.analysis.emotionBeforeId,
    emotionAfterId: dr.notes.emotionAfterId,
    exitReasonId: dr.notes.exitReasonId,
    mistakes: dr.notes.mistakes,
    postNotes: dr.notes.postNotes,
    rulesFollowed: dr.notes.rulesFollowed,
    rulesCheck: dr.notes.rulesCheck ?? null,
  };
}

/**
 * The review queue: one trade at a time with its chart, key figures and the review fields. Saving writes only the
 * review fields you changed (src/server/trades/review.ts) and marks the trade reviewed. Edits made before moving on
 * are kept per trade until saved, so nothing is lost by stepping back and forth. The queue is pinned on mount: a
 * save re-renders the page with a shorter queue, which this ignores.
 */
export function ReviewFlow({
  ids: given,
  initial,
  tz,
}: {
  ids: string[];
  initial: TradeEditData | null;
  tz: string;
}) {
  const [ids] = useState(given);
  const [index, setIndex] = useState(0);
  const [data, setData] = useState<Record<string, TradeEditData>>(
    initial ? { [initial.trade.id]: initial } : {},
  );
  const [drafts, setDrafts] = useState<Record<string, ReviewFields>>({});
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const loading = useRef(new Set<string>());

  const id = ids[index];
  const d = id ? data[id] : undefined;
  const draft = d ? (drafts[id] ?? fieldsOf(d)) : null;
  const dirty = !!drafts[id];
  const done = ids.length > 0 && reviewed.size === ids.length;

  const load = useCallback(
    async (tid: string | undefined) => {
      if (!tid || data[tid] || loading.current.has(tid)) return;
      loading.current.add(tid);
      const res = await loadReviewTradeAction(tid);
      loading.current.delete(tid);
      if (res) setData((m) => ({ ...m, [tid]: res }));
    },
    [data],
  );
  // the current trade, and the next one ready before you get there
  useEffect(() => {
    void load(ids[index]);
    void load(ids[index + 1]);
  }, [index, ids, load]);

  const go = useCallback(
    (to: number) => {
      if (to < 0 || to >= ids.length) return;
      setError(null);
      setIndex(to);
      window.scrollTo({ top: 0 });
    },
    [ids.length],
  );

  const patch = (p: Partial<ReviewFields>) => draft && setDrafts((m) => ({ ...m, [id]: { ...draft, ...p } }));

  const save = useCallback(
    (thenNext: boolean) => {
      if (!d || !draft || saving) return;
      const saved = draft;
      const at = index;
      startSave(async () => {
        const res = await saveReviewAction(id, saved, fieldsOf(d));
        if (!res.ok) return setError(res.error);
        setError(null);
        setReviewed((x) => new Set(x).add(id));
        // the stored values are now the base for a later save of this trade
        const fresh = await loadReviewTradeAction(id);
        if (fresh) setData((m) => ({ ...m, [id]: fresh }));
        // keep anything typed while the save was in flight
        setDrafts((m) => {
          if (m[id] !== saved) return m;
          const n = { ...m };
          delete n[id];
          return n;
        });
        if (thenNext && at < ids.length - 1) {
          setIndex((i) => (i === at ? at + 1 : i));
          window.scrollTo({ top: 0 });
        }
      });
    },
    [d, draft, saving, id, index, ids.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save(false);
      } else if (mod && e.key === "Enter") {
        e.preventDefault();
        save(true);
      } else if (!mod && !e.altKey && !typing(e.target)) {
        if (e.key === "ArrowRight" || e.key === "j") go(index + 1);
        else if (e.key === "ArrowLeft" || e.key === "k") go(index - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, go, index]);

  const t = d?.trade;
  const stop = d?.journal?.stopLoss ?? null;
  const r = useMemo(
    () =>
      t
        ? rMultiple({ netPnl: t.netPnl, avgEntry: t.avgEntry, sizeUnits: t.sizeUnits, stopLoss: stop })
        : null,
    [t, stop],
  );

  if (ids.length === 0)
    return (
      <EmptyState
        icon={ClipboardCheck}
        title="Nothing left to review"
        body="Every closed trade in this range has a review. Pick another week from the dashboard or the Trades page."
      />
    );

  return (
    <div className="flex flex-col gap-7">
      {/* progress */}
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-15 font-medium" data-testid="review-progress" aria-live="polite">
            {index + 1} of {ids.length}
            <span className="text-muted-foreground font-normal">, {reviewed.size} reviewed</span>
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-field"
              onClick={() => go(index - 1)}
              disabled={index === 0}
              aria-label="Previous trade (←)"
            >
              <ChevronLeft className="size-4" /> Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-field"
              onClick={() => go(index + 1)}
              disabled={index === ids.length - 1}
              aria-label="Next trade (→)"
            >
              Next <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
        <div className="bg-hover flex h-1.5 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
          {ids.map((x, i) => (
            <span
              key={x}
              className={cn(
                "h-full flex-1",
                reviewed.has(x) ? "bg-ink" : i === index ? "bg-gold" : "bg-transparent",
              )}
            />
          ))}
        </div>
      </div>

      {done && (
        <p className="bg-subtle rounded-[10px] px-4 py-3 text-sm" data-testid="review-done">
          All {ids.length} reviewed.{" "}
          <Link href="/dashboard" className="link">
            Back to the dashboard
          </Link>
        </p>
      )}

      {!d || !t || !draft ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" /> Loading trade
        </p>
      ) : (
        <div
          className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
          data-testid="review-trade"
          data-trade-id={t.id}
        >
          <div className="flex min-w-0 flex-col gap-6">
            <header className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-22 font-semibold">{t.displayPair}</h2>
                  <Direction dir={t.direction} />
                  {reviewed.has(t.id) && (
                    <span className="text-ink-2 text-13 flex items-center gap-1" data-testid="review-saved">
                      <Check className="size-3.5" /> Reviewed
                    </span>
                  )}
                </div>
                <p className="condensed text-ink-2 text-13">
                  {fmtDateTime(t.entryTime, tz)} to {fmtDateTime(t.exitTime, tz)}
                </p>
              </div>
              <Link href={`/trades/${t.id}`} className="link text-sm">
                Open full trade
              </Link>
            </header>

            <dl className="border-rule grid grid-cols-2 gap-x-5 gap-y-4 border-y py-4 sm:grid-cols-4">
              <Figure label="Net P&L">
                <span className={cn("money", pnlClass(t.netPnl))}>{fmtSignedUsd(t.netPnl)}</span>
              </Figure>
              <Figure label="R">
                {r === null ? <span className="text-muted-foreground text-15">no stop</span> : fmtR(r)}
              </Figure>
              <Figure label="Return">{fmtPct(t.returnPct)}</Figure>
              <Figure label="Held">{fmtDuration(t.durationMs)}</Figure>
            </dl>

            <section className="flex flex-col gap-3" aria-label="Chart">
              <h3 className="text-17 font-semibold tracking-[-0.01em]">Chart</h3>
              <Screenshots key={t.id} tradeId={t.id} initial={d.screenshots} pasteEnabled />
            </section>
          </div>

          <form
            className="flex min-w-0 flex-col gap-5"
            aria-label="Review"
            onSubmit={(e) => {
              e.preventDefault();
              save(true);
            }}
          >
            <Field label="Grade" hint="How well you followed your plan, not how much it made">
              <ChipSelect
                aria-label="Trade grade"
                options={GRADES.map((g) => ({ value: g, label: g }))}
                value={draft.grade}
                onChange={(grade) => patch({ grade })}
              />
            </Field>
            <StrategyField
              key={`s-${t.id}`}
              strategies={d.strategies}
              value={draft.strategyId}
              onChange={(strategyId) => patch(afterStrategyChange({ ...draft, strategyId }, strategyId))}
            />
            <RulesChecklist
              strategy={d.strategies.find((x) => x.id === draft.strategyId) ?? null}
              value={{ rulesCheck: draft.rulesCheck, rulesFollowed: draft.rulesFollowed }}
              onChange={patch}
            />
            <Field label="Emotion before entry">
              <ChipSelect
                aria-label="Emotion before entry"
                options={d.vocab.emotion.map((e) => ({ value: e.id, label: e.label }))}
                value={draft.emotionBeforeId}
                onChange={(emotionBeforeId) => patch({ emotionBeforeId })}
              />
            </Field>
            <Field label="Emotion after exit">
              <ChipSelect
                aria-label="Emotion after exit"
                options={d.vocab.emotion.map((e) => ({ value: e.id, label: e.label }))}
                value={draft.emotionAfterId}
                onChange={(emotionAfterId) => patch({ emotionAfterId })}
              />
            </Field>
            <Field label="Exit reason">
              <Select
                value={draft.exitReasonId ?? NONE}
                onValueChange={(v) => patch({ exitReasonId: v === NONE ? null : v })}
              >
                <SelectTrigger className="h-9 w-full" aria-label="Exit reason">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not set</SelectItem>
                  {d.vocab.exit_reason.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Mistakes">
              <VocabPicker
                testId="review-mistakes"
                label="Mistakes"
                kind="mistake"
                items={d.vocab.mistake}
                categories={d.categories.filter((c) => c.kind === "mistake")}
                selected={draft.mistakes}
                onChange={(mistakes) => patch({ mistakes })}
              />
            </Field>
            <Field label="Notes">
              <Textarea
                aria-label="Review notes"
                rows={5}
                value={draft.postNotes ?? ""}
                onChange={(e) => patch({ postNotes: e.target.value })}
                placeholder="What went right or wrong, and what you'd do differently"
              />
            </Field>

            {error && (
              <p className="text-destructive text-13" role="alert">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                className="bg-ink hover:bg-ink/90 h-10 rounded-[9px] text-white"
                disabled={saving}
                data-testid="review-save-next"
              >
                {saving && <Loader2 className="size-4 animate-spin" />}
                {index === ids.length - 1 ? "Save review" : "Save and next"}
                <kbd className="ml-1 hidden rounded border border-current/30 px-1 text-[10px] opacity-70 sm:inline">
                  ⌘↵
                </kbd>
              </Button>
              <Button type="button" variant="ghost" onClick={() => save(false)} disabled={saving}>
                Save{" "}
                <kbd className="ml-1 hidden rounded border border-current/30 px-1 text-[10px] opacity-70 sm:inline">
                  ⌘S
                </kbd>
              </Button>
              {dirty && <span className="text-gold-ink text-13">Unsaved changes</span>}
            </div>
            <p className="text-muted-foreground text-13">
              Keys: ← and → (or K and J) move between trades when you&apos;re not typing.
            </p>
          </form>
        </div>
      )}
    </div>
  );
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground text-13">{label}</dt>
      <dd className="text-22 font-medium tracking-[-0.015em] tabular-nums">{children}</dd>
    </div>
  );
}
