"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { AlertTriangle, ChevronDown, Info, Lock, Plus, Settings2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { fmtDateTime, fmtPct, fmtPrice, fmtR, fmtSignedUsd, fmtSize, fmtUsd, pnlClass } from "@/lib/format";
import { sessionFor } from "@/lib/sessions";
import { fromTzInput, toTzInput } from "@/lib/tz-input";
import {
  manualMetrics,
  rewardRisk,
  riskUsd,
  sizeFromRisk,
  stopOnCorrectSide,
  totalSize,
  tpAllocation,
  unitsToUsd,
  usdToUnits,
  weightedAvg,
} from "@/lib/trade-math";
import { displayPair } from "@/server/hyperliquid/markets";
import { createStrategyAction } from "@/app/(app)/trades/[id]/actions";
import { Field, Locked, NumberInput, Section, Segmented } from "./fields";
import type { Draft, FormProps, Row } from "./types";

const NONE = "__none";

type Props = FormProps & {
  draft: Draft;
  update: (p: Partial<Draft>) => void;
  updateManual: (p: Partial<NonNullable<Draft["manual"]>>) => void;
  errors: Record<string, string>;
};

export function BasicTab({ data, accounts, sessions, tz, draft, update, updateManual, errors }: Props) {
  const t = data.trade;
  const m = draft.manual;
  const manual = !!m;
  const dir = m?.direction ?? t.direction;
  const status = m?.status ?? t.status;

  // ── derived numbers (live previews; the server recomputes manual trades on save) ──
  const dcaRows = (m?.dca ?? []).map((r) => ({ price: r.price, size: r.size }));
  const dcaAvg = manual && dcaRows.length ? weightedAvg(dcaRows) : null;
  const entry = manual ? (dcaAvg ?? m!.entry) : t.avgEntry;
  const exit = manual ? m!.exit : t.avgExit;
  const riskMode = draft.sizeMode === "risk";
  const size = manual
    ? dcaRows.length
      ? totalSize(dcaRows)
      : riskMode
        ? (sizeFromRisk(draft.plannedRiskUsd, entry, draft.stopLoss) ?? m!.size)
        : m!.size
    : t.sizeUnits;
  const account = accounts.find((a) => a.id === draft.accountId) ?? accounts[0];
  const balance = account?.startingBalance ?? 0;
  const stdRisk = balance > 0 ? (balance * (account?.standardRiskPct ?? 0)) / 100 : null;
  const risk = riskUsd(entry, draft.stopLoss, size);
  const rr = rewardRisk(dir, entry, draft.stopLoss, draft.takeProfit);
  const slSide = stopOnCorrectSide(dir, entry, draft.stopLoss);
  const tpSide = draft.takeProfit !== null && entry !== null ? (dir === "long" ? draft.takeProfit > entry : draft.takeProfit < entry) : null;
  const net = manual
    ? manualMetrics({ direction: dir, entry, exit, size, fees: draft.feeOverride, entryTime: m!.entryTime, exitTime: m!.exitTime, closed: status === "closed" }).netPnl
    : t.netPnl;
  const realizedR = status === "closed" && risk && net !== null ? net / risk : null;
  const entryTime = m?.entryTime ?? t.entryTime;
  const suggestedSession = entryTime ? sessionFor(entryTime, sessions) : null;
  const tp = tpAllocation(draft.tpPartials);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* ── Setup ── */}
      <Section
        title="Setup"
        description={
          !manual ? (
            <span className="inline-flex items-center gap-1">
              <Lock className="size-3" /> Synced from Hyperliquid: pair, direction, status, prices, size, times and fees come from your fills and are read-only.
            </span>
          ) : (
            "Manual trade: every field is editable."
          )
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Account" error={errors.accountId}>
            <div className="flex gap-1">
              <Select value={draft.accountId} onValueChange={(v) => update({ accountId: v })}>
                <SelectTrigger className="h-8 w-full" aria-label="Account">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button asChild variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Manage accounts">
                <Link href="/settings/accounts">
                  <Settings2 className="size-4" />
                </Link>
              </Button>
            </div>
          </Field>

          <Field label="Pair">
            {manual ? (
              <div className="grid gap-1.5">
                <Input
                  value={m!.coin}
                  onChange={(e) => updateManual({ coin: e.target.value })}
                  placeholder="BTC, kPEPE, xyz:SPX…"
                  className="h-8"
                  aria-label="Pair"
                />
                {data.recentPairs.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {data.recentPairs.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => updateManual({ coin: c })}
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[11px]",
                          m!.coin === c ? "border-primary text-foreground" : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {displayPair(c)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <Locked>{t.displayPair}</Locked>
            )}
          </Field>

          <StrategyField
            strategies={data.strategies}
            value={draft.strategyId}
            onChange={(strategyId) => update({ strategyId })}
            error={errors.strategyId}
          />

          <Field label="Direction">
            {manual ? (
              <Segmented
                aria-label="Direction"
                value={m!.direction}
                onChange={(v) => v && updateManual({ direction: v })}
                options={[
                  { value: "long", label: "Long", className: "text-long" },
                  { value: "short", label: "Short", className: "text-short" },
                ]}
              />
            ) : (
              <Locked>
                <span className={dir === "long" ? "text-long" : "text-short"}>{dir.toUpperCase()}</span>
              </Locked>
            )}
          </Field>

          <Field label="Status" className="sm:col-span-2" error={errors.manual}>
            {manual ? (
              <Segmented
                aria-label="Status"
                value={m!.status}
                onChange={(v) => v && updateManual({ status: v })}
                options={[
                  { value: "planned", label: "Planned" },
                  { value: "open", label: "Open" },
                  { value: "closed", label: "Closed" },
                ]}
              />
            ) : (
              <Locked>{status === "open" ? "Open" : "Closed"}</Locked>
            )}
          </Field>
        </div>
      </Section>

      {/* ── Prices ── */}
      <Section title="Prices" description={draft.stopLoss === null ? undefined : rr !== null ? `Planned reward:risk ${rr.toFixed(2)} : 1` : undefined}>
        {draft.stopLoss === null && (
          <div className="mb-3 flex items-center gap-2 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-200" data-testid="sl-prompt">
            <Info className="size-3.5 shrink-0" /> Add a stop loss to unlock R:R analytics.
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={dcaAvg !== null ? "Entry (avg of partial entries)" : "Entry"}>
            {manual && dcaAvg === null ? (
              <NumberInput aria-label="Entry price" value={m!.entry} onChange={(v) => updateManual({ entry: v })} min={0} />
            ) : (
              <Locked title={manual ? "Weighted average of partial entries" : undefined}>{fmtPrice(entry)}</Locked>
            )}
          </Field>
          <Field label="Exit" hint={manual && status !== "closed" ? "Set when the trade is closed" : undefined}>
            {manual ? (
              <NumberInput aria-label="Exit price" value={m!.exit} onChange={(v) => updateManual({ exit: v })} min={0} disabled={status !== "closed"} />
            ) : (
              <Locked>{status === "open" ? "Open" : fmtPrice(exit)}</Locked>
            )}
          </Field>
          <Field
            label="Stop loss"
            error={slSide === false ? `A ${dir} stop should be ${dir === "long" ? "below" : "above"} entry` : null}
            hint={risk !== null ? `Risk ${fmtUsd(risk)}${balance > 0 ? ` (${fmtPct((risk / balance) * 100).replace("+", "")} of account)` : ""}` : undefined}
          >
            <NumberInput aria-label="Stop loss" value={draft.stopLoss} onChange={(v) => update({ stopLoss: v })} min={0} />
          </Field>
          <Field
            label="Take profit"
            error={tpSide === false ? `A ${dir} target should be ${dir === "long" ? "above" : "below"} entry` : null}
            hint={rr !== null ? `${rr.toFixed(2)}R target` : undefined}
          >
            <NumberInput aria-label="Take profit" value={draft.takeProfit} onChange={(v) => update({ takeProfit: v })} min={0} />
          </Field>
        </div>
        {(realizedR !== null || (!manual && status === "closed")) && (
          <div className="mt-3 flex items-baseline gap-4 border-t pt-3 text-sm">
            <span className="text-muted-foreground text-xs">Result</span>
            <span className={cn("tabular-nums", pnlClass(net))}>{fmtSignedUsd(net)}</span>
            <span className={cn("font-medium tabular-nums", pnlClass(realizedR))} data-testid="realized-r">
              {realizedR === null ? "add a stop for R" : fmtR(realizedR)}
            </span>
          </div>
        )}
      </Section>

      {/* ── Size ── */}
      <Section title="Size">
        <div className="mb-3">
          <Segmented
            aria-label="Size mode"
            value={draft.sizeMode}
            onChange={(v) => v && update({ sizeMode: v })}
            options={[
              { value: "position", label: "Position size" },
              { value: "risk", label: "Risk amount" },
            ]}
          />
        </div>
        <SizeFields
          manual={manual}
          riskMode={riskMode}
          hasDca={dcaRows.length > 0}
          entry={entry}
          size={size}
          stop={draft.stopLoss}
          plannedRisk={draft.plannedRiskUsd}
          stdRisk={stdRisk}
          stdRiskPct={account?.standardRiskPct ?? 0}
          balance={balance}
          actualRisk={risk}
          leverage={draft.leverageOverride}
          exchangeLeverage={t.leverage}
          onSize={(v) => updateManual({ size: v })}
          onRisk={(v) => update({ plannedRiskUsd: v })}
          onLeverage={(v) => update({ leverageOverride: v })}
        />
      </Section>

      {/* ── More details ── */}
      <MoreDetails defaultOpen={draft.tpPartials.length > 0 || (m?.dca.length ?? 0) > 0 || draft.checklist.length > 0 || !!draft.session}>
        <div className="grid gap-5">
          <PartialEntries
            manual={manual}
            rows={m?.dca ?? []}
            legs={data.entryLegs}
            tz={tz}
            onChange={(dca) => updateManual({ dca })}
          />
          <PartialTps rows={draft.tpPartials} onChange={(tpPartials) => update({ tpPartials })} total={tp.total} error={errors.tpPartials} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Fees" hint={manual ? "Total fees for this trade" : "From your fills (maker rebates reduce it)"}>
              {manual ? (
                <NumberInput aria-label="Fees" value={draft.feeOverride} onChange={(v) => update({ feeOverride: v })} />
              ) : (
                <Locked>{fmtUsd(t.fees)}</Locked>
              )}
            </Field>
            <Field label="Trade type">
              <Segmented
                aria-label="Trade type"
                value={draft.tradeType}
                onChange={(v) => update({ tradeType: v })}
                options={[
                  { value: "planned", label: "Planned" },
                  { value: "reactive", label: "Reactive" },
                ]}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={`Entry time (${tz})`}>
              {manual ? (
                <Input
                  type="datetime-local"
                  className="h-8"
                  aria-label="Entry time"
                  value={toTzInput(m!.entryTime, tz)}
                  onChange={(e) => updateManual({ entryTime: fromTzInput(e.target.value, tz) })}
                />
              ) : (
                <Locked>{fmtDateTime(t.entryTime, tz)}</Locked>
              )}
            </Field>
            <Field label={`Exit time (${tz})`}>
              {manual ? (
                <Input
                  type="datetime-local"
                  className="h-8"
                  aria-label="Exit time"
                  disabled={status !== "closed"}
                  value={toTzInput(m!.exitTime, tz)}
                  onChange={(e) => updateManual({ exitTime: fromTzInput(e.target.value, tz) })}
                />
              ) : (
                <Locked>{status === "open" ? "Open" : fmtDateTime(t.exitTime, tz)}</Locked>
              )}
            </Field>
            <Field
              label="Session"
              hint={
                suggestedSession && draft.session !== suggestedSession ? (
                  <button type="button" className="text-primary hover:underline" onClick={() => update({ session: suggestedSession })}>
                    Use {suggestedSession} (from entry time)
                  </button>
                ) : undefined
              }
            >
              <Select value={draft.session ?? NONE} onValueChange={(v) => update({ session: v === NONE ? null : v })}>
                <SelectTrigger className="h-8 w-full" aria-label="Session">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not set</SelectItem>
                  {sessions.map((s) => (
                    <SelectItem key={s.name} value={s.name}>
                      {s.name}
                    </SelectItem>
                  ))}
                  {draft.session && !sessions.some((s) => s.name === draft.session) && <SelectItem value={draft.session}>{draft.session}</SelectItem>}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Checklist items={data.checklistItems} checked={draft.checklist} onChange={(checklist) => update({ checklist })} />
        </div>
      </MoreDetails>
    </div>
  );
}

function StrategyField({
  strategies,
  value,
  onChange,
  error,
}: {
  strategies: { id: string; label: string }[];
  value: string | null;
  onChange: (v: string | null) => void;
  error?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [list, setList] = useState(strategies);
  const [pending, start] = useTransition();
  return (
    <Field label="Strategy" error={error}>
      {adding ? (
        <form
          className="flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (!label.trim()) return;
            start(async () => {
              const id = await createStrategyAction(label);
              if (!list.some((s) => s.id === id)) setList((l) => [...l, { id, label: label.trim() }]);
              onChange(id);
              setAdding(false);
              setLabel("");
            });
          }}
        >
          <Input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="New strategy" className="h-8" aria-label="New strategy name" />
          <Button type="submit" size="sm" className="h-8" disabled={pending}>
            Add
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex gap-1">
          <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
            <SelectTrigger className="h-8 w-full" aria-label="Strategy">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No strategy</SelectItem>
              {list.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Add strategy" onClick={() => setAdding(true)}>
            <Plus className="size-4" />
          </Button>
          <Button asChild variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Manage strategies">
            <Link href="/settings/journal?kind=strategy">
              <Settings2 className="size-4" />
            </Link>
          </Button>
        </div>
      )}
    </Field>
  );
}

function SizeFields(p: {
  manual: boolean;
  riskMode: boolean;
  hasDca: boolean;
  entry: number | null;
  size: number | null;
  stop: number | null;
  plannedRisk: number | null;
  stdRisk: number | null;
  stdRiskPct: number;
  balance: number;
  actualRisk: number | null;
  leverage: number | null;
  exchangeLeverage: number | null;
  onSize: (v: number | null) => void;
  onRisk: (v: number | null) => void;
  onLeverage: (v: number | null) => void;
}) {
  const usd = unitsToUsd(p.size, p.entry);
  const lev = p.leverage ?? p.exchangeLeverage;
  const sizeLocked = !p.manual || p.hasDca || p.riskMode;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {p.riskMode && (
        <Field
          label={p.manual ? "Risk amount ($)" : "Planned risk ($)"}
          className="sm:col-span-2"
          hint={
            <span className="flex flex-wrap items-center gap-x-3">
              {p.plannedRisk !== null && p.balance > 0 && <span>{((p.plannedRisk / p.balance) * 100).toFixed(2)}% of account</span>}
              {p.stdRisk !== null && (
                <button type="button" className="text-primary hover:underline" onClick={() => p.onRisk(Number(p.stdRisk!.toFixed(2)))}>
                  Use standard {p.stdRiskPct}% ({fmtUsd(p.stdRisk)})
                </button>
              )}
              {!p.manual && p.actualRisk !== null && <span>Actual risk from stop: {fmtUsd(p.actualRisk)}</span>}
              {p.manual && p.stop === null && <span className="text-amber-400">Set a stop loss to size from risk</span>}
            </span>
          }
        >
          <NumberInput aria-label="Risk amount" value={p.plannedRisk} onChange={p.onRisk} min={0} />
        </Field>
      )}
      <Field label="Size (units)" hint={p.hasDca && p.manual ? "Sum of partial entries" : p.riskMode && p.manual ? "Derived from risk ÷ stop distance" : undefined}>
        {sizeLocked ? <Locked title={p.manual ? "Derived" : undefined}>{fmtSize(p.size)}</Locked> : <NumberInput aria-label="Size in units" value={p.size} onChange={p.onSize} min={0} />}
      </Field>
      <Field label="Size (USD)" hint={p.manual && !sizeLocked && p.entry === null ? "Enter an entry price to use USD" : undefined}>
        {sizeLocked ? (
          <Locked title={p.manual ? "Derived" : undefined}>{fmtUsd(usd)}</Locked>
        ) : (
          <NumberInput aria-label="Size in USD" value={usd} onChange={(v) => p.onSize(usdToUnits(v, p.entry))} min={0} disabled={p.entry === null} />
        )}
      </Field>
      <Field
        label="Leverage"
        hint={lev && usd ? `Margin ≈ ${fmtUsd(usd / lev)}` : !p.manual && p.exchangeLeverage ? `Exchange: ${p.exchangeLeverage}×` : undefined}
      >
        <NumberInput aria-label="Leverage" value={p.leverage} onChange={p.onLeverage} min={0} placeholder={p.exchangeLeverage ? `${p.exchangeLeverage}` : "e.g. 10"} />
      </Field>
    </div>
  );
}

function MoreDetails({ children, defaultOpen }: { children: React.ReactNode; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-lg border lg:col-span-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium"
      >
        More details
        <span className="text-muted-foreground flex items-center gap-1 text-xs font-normal">
          Partial entries, take profits, fees, timing, session, trade type, checklist
          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open && <div className="border-t p-4">{children}</div>}
    </section>
  );
}

function RowsEditor<T extends string>({
  rows,
  cols,
  onChange,
  addLabel,
  testId,
}: {
  rows: Row<T>[];
  cols: { key: T; label: string; placeholder?: string }[];
  onChange: (rows: Row<T>[]) => void;
  addLabel: string;
  testId: string;
}) {
  const empty = Object.fromEntries(cols.map((c) => [c.key, null])) as Row<T>;
  return (
    <div className="grid gap-1.5" data-testid={testId}>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5">
          {cols.map((c) => (
            <NumberInput
              key={c.key}
              aria-label={`${c.label} ${i + 1}`}
              placeholder={c.placeholder ?? c.label}
              value={r[c.key]}
              min={0}
              onChange={(v) => onChange(rows.map((x, j) => (j === i ? { ...x, [c.key]: v } : x)))}
            />
          ))}
          <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label={`Remove row ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="secondary" size="sm" className="h-7 w-fit" onClick={() => onChange([...rows, empty])}>
        <Plus className="size-3.5" /> {addLabel}
      </Button>
    </div>
  );
}

function PartialEntries({
  manual,
  rows,
  legs,
  tz,
  onChange,
}: {
  manual: boolean;
  rows: Row<"price" | "size">[];
  legs: { time: number; price: number; size: number }[];
  tz: string;
  onChange: (rows: Row<"price" | "size">[]) => void;
}) {
  if (!manual) {
    return (
      <Field label={`Entries (${legs.length} fill${legs.length === 1 ? "" : "s"})`} hint="From the exchange. Your average entry is weighted by size.">
        <div className="rounded-md border text-xs">
          {legs.map((l, i) => (
            <div key={i} className="flex justify-between gap-3 border-b px-2.5 py-1.5 tabular-nums last:border-0">
              <span className="text-muted-foreground">{fmtDateTime(l.time, tz)}</span>
              <span>
                {fmtSize(l.size)} @ {fmtPrice(l.price)}
              </span>
            </div>
          ))}
          {legs.length === 0 && <div className="text-muted-foreground px-2.5 py-1.5">No entry fills in stored history</div>}
        </div>
      </Field>
    );
  }
  const avg = weightedAvg(rows);
  return (
    <Field label="Partial entries (DCA)" hint={avg !== null ? `Weighted entry ${fmtPrice(avg)} for ${fmtSize(totalSize(rows))} units` : "Add each fill to use a weighted entry"}>
      <RowsEditor
        testId="dca-rows"
        rows={rows}
        onChange={onChange}
        addLabel="Add entry"
        cols={[
          { key: "price", label: "Price" },
          { key: "size", label: "Size", placeholder: "Units" },
        ]}
      />
    </Field>
  );
}

function PartialTps({
  rows,
  onChange,
  total,
  error,
}: {
  rows: Row<"price" | "pct">[];
  onChange: (rows: Row<"price" | "pct">[]) => void;
  total: number;
  error?: string;
}) {
  const off = rows.length > 0 && Math.abs(total - 100) >= 0.01;
  return (
    <Field
      label="Partial take profits"
      error={error ?? (off ? `Allocations total ${Number(total.toFixed(2))}%; they must add up to 100%` : null)}
      hint={rows.length ? "Allocations total 100% ✓" : "Plan scaling out at several levels"}
    >
      <RowsEditor
        testId="tp-rows"
        rows={rows}
        onChange={onChange}
        addLabel="Add level"
        cols={[
          { key: "price", label: "Price" },
          { key: "pct", label: "%", placeholder: "% of position" },
        ]}
      />
    </Field>
  );
}

function Checklist({ items, checked, onChange }: { items: { id: string; label: string }[]; checked: string[]; onChange: (ids: string[]) => void }) {
  const set = new Set(checked);
  return (
    <Field
      label={`Pre-trade checklist (${items.filter((i) => set.has(i.id)).length}/${items.length})`}
      hint={
        <Link href="/settings/journal?kind=checklist" className="hover:underline">
          Edit checklist items
        </Link>
      }
    >
      {items.length === 0 ? (
        <p className="text-muted-foreground flex items-center gap-1 text-xs">
          <AlertTriangle className="size-3.5" /> No checklist items yet.
        </p>
      ) : (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {items.map((i) => (
            <label key={i.id} className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={set.has(i.id)}
                onCheckedChange={(v) => onChange(v ? [...checked, i.id] : checked.filter((x) => x !== i.id))}
                aria-label={i.label}
              />
              {i.label}
            </label>
          ))}
        </div>
      )}
    </Field>
  );
}
