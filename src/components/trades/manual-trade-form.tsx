"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, NumberInput, Segmented } from "@/components/trade-form/fields";
import { fmtSignedUsd, pnlClass } from "@/lib/format";
import { manualMetrics } from "@/lib/trade-math";
import { fromTzInput, toTzInput } from "@/lib/tz-input";
import { cn } from "@/lib/utils";
import { createManualTradeAction } from "@/app/(app)/trades/new/actions";

type Status = "closed" | "open" | "planned";
type Dir = "long" | "short";

/** cfd: a prop or other account, where pairs are cTrader symbols (EURUSD) and size is in units, not lots. */
export function ManualTradeForm({ tz, accountId, cfd }: { tz: string; accountId: string; cfd: boolean }) {
  const router = useRouter();
  const [coin, setCoin] = useState("");
  const [direction, setDirection] = useState<Dir>("long");
  const [status, setStatus] = useState<Status>("closed");
  const [entry, setEntry] = useState<number | null>(null);
  const [exit, setExit] = useState<number | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [fees, setFees] = useState<number | null>(null);
  const [stopLoss, setStopLoss] = useState<number | null>(null);
  const [entryTime, setEntryTime] = useState<number | null>(null);
  const [exitTime, setExitTime] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const closed = status === "closed";
  const planned = status === "planned";
  const preview = closed
    ? manualMetrics({ direction, entry, exit, size, fees, entryTime, exitTime, closed: true }).netPnl
    : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!coin.trim()) return setErrors({ coin: "Enter a pair" });
    start(async () => {
      const res = await createManualTradeAction(accountId, {
        coin,
        direction,
        status,
        entry,
        exit: closed ? exit : null,
        size,
        fees: planned ? null : fees,
        stopLoss,
        entryTime: planned ? null : entryTime,
        exitTime: closed ? exitTime : null,
      });
      if (!res.ok) return setErrors(res.errors);
      router.push(`/trades/${res.id}`);
    });
  };

  return (
    <form className="flex flex-col gap-6" onSubmit={submit} aria-label="Add trade" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Pair"
          hint={
            cfd
              ? "The symbol as cTrader names it: EURUSD, XAUUSD, US30"
              : "As Hyperliquid names it: BTC, kPEPE, xyz:SPX or PURR/USDC"
          }
          error={errors.coin}
        >
          <Input
            className="h-8"
            aria-label="Pair"
            autoFocus
            autoComplete="off"
            value={coin}
            onChange={(e) => setCoin(e.target.value)}
          />
        </Field>
        <Field label="Direction">
          <Segmented<Dir>
            aria-label="Direction"
            value={direction}
            onChange={(v) => v && setDirection(v)}
            options={[
              { value: "long", label: "Long" },
              { value: "short", label: "Short" },
            ]}
          />
        </Field>
        <Field label="Status" className="sm:col-span-2">
          <Segmented<Status>
            aria-label="Status"
            value={status}
            onChange={(v) => v && setStatus(v)}
            options={[
              { value: "closed", label: "Closed" },
              { value: "open", label: "Open" },
              { value: "planned", label: "Planned" },
            ]}
          />
        </Field>
      </div>

      <div className="border-rule grid gap-4 border-t pt-5 sm:grid-cols-2">
        <Field label={planned ? "Planned entry" : "Entry price"} error={errors.entry}>
          <NumberInput aria-label="Entry price" value={entry} onChange={setEntry} min={0} />
        </Field>
        <Field
          label="Exit price"
          error={errors.exit}
          hint={closed ? undefined : "Set when the trade is closed"}
        >
          <NumberInput aria-label="Exit price" value={exit} onChange={setExit} min={0} disabled={!closed} />
        </Field>
        <Field
          label="Size (units)"
          error={errors.size}
          hint={cfd ? "Units, not lots: 1 lot of EURUSD is 100,000" : undefined}
        >
          <NumberInput aria-label="Size" value={size} onChange={setSize} min={0} />
        </Field>
        <Field label="Stop loss" error={errors.stopLoss}>
          <NumberInput aria-label="Stop loss" value={stopLoss} onChange={setStopLoss} min={0} />
        </Field>
        <Field label={`Entry time (${tz})`} error={errors.entryTime}>
          <Input
            type="datetime-local"
            className="h-8"
            aria-label="Entry time"
            disabled={planned}
            value={toTzInput(entryTime, tz)}
            onChange={(e) => setEntryTime(fromTzInput(e.target.value, tz))}
          />
        </Field>
        <Field label={`Exit time (${tz})`} error={errors.exitTime}>
          <Input
            type="datetime-local"
            className="h-8"
            aria-label="Exit time"
            disabled={!closed}
            value={toTzInput(exitTime, tz)}
            onChange={(e) => setExitTime(fromTzInput(e.target.value, tz))}
          />
        </Field>
        <Field label="Fees ($)" hint="Total for the trade; leave empty for none">
          <NumberInput aria-label="Fees" value={fees} onChange={setFees} disabled={planned} />
        </Field>
        {closed && (
          <Field label="Net P&L">
            <p
              className={cn("money flex h-8 items-center text-sm tabular-nums", pnlClass(preview))}
              data-testid="manual-net"
            >
              {preview === null ? "Enter entry, exit and size" : fmtSignedUsd(preview)}
            </p>
          </Field>
        )}
      </div>

      {errors.form && (
        <p className="text-destructive text-13" role="alert">
          {errors.form}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button
          type="submit"
          className="bg-ink hover:bg-ink/90 h-10 rounded-[9px] text-white"
          disabled={pending}
          data-testid="manual-create"
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          Add trade
        </Button>
        <span className="text-muted-foreground text-13">Then add the setup, review and screenshots.</span>
      </div>
    </form>
  );
}
