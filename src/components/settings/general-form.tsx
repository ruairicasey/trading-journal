"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveGeneralSettings } from "@/app/(app)/settings/actions";
import { DEFAULT_SESSIONS, SESSION_ZONES, sessionHoursIn, type SessionDef } from "@/lib/sessions";

type Session = SessionDef;
const toTime = (h: number) => `${String(Math.floor(h) % 24).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
const fromTime = (v: string) => {
  const [hh, mm] = v.split(":").map(Number);
  return Number.isFinite(hh) && Number.isFinite(mm) ? hh + mm / 60 : 0;
};

const COMMON_TZ = [
  "Australia/Melbourne",
  "Australia/Sydney",
  "Australia/Perth",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Europe/London",
  "America/New_York",
  "UTC",
];

export function GeneralForm({ timezone, sessions, includeFunding }: { timezone: string; sessions: Session[]; includeFunding: boolean }) {
  const [tz, setTz] = useState(timezone);
  const [funding, setFunding] = useState(includeFunding);
  const [rows, setRows] = useState<Session[]>(sessions);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const update = (i: number, patch: Partial<Session>) => setRows((r) => r.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setMsg(null);
          try {
            await saveGeneralSettings({ timezone: tz, sessions: rows, includeFunding: funding });
            setMsg("Saved");
          } catch (err) {
            setMsg(err instanceof Error ? err.message : "Could not save");
          }
        });
      }}
    >
      <section className="space-y-2">
        <Label htmlFor="tz">Timezone</Label>
        <p className="text-muted-foreground text-xs">
          Used for calendar days, day-of-week and hour-of-day stats. Exchange times are stored in UTC.
        </p>
        <Input id="tz" list="tz-list" value={tz} onChange={(e) => setTz(e.target.value)} className="max-w-xs" />
        <datalist id="tz-list">
          {COMMON_TZ.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
      </section>

      <section className="space-y-2">
        <Label htmlFor="include-funding">Funding</Label>
        <label className="flex items-start gap-2 text-sm">
          <input
            id="include-funding"
            type="checkbox"
            className="mt-1"
            checked={funding}
            onChange={(e) => setFunding(e.target.checked)}
          />
          <span>
            Include funding in net P&amp;L
            <span className="text-muted-foreground block text-xs">
              Each funding payment is attributed to the trade that was open at the time. Turn this off to compare net P&amp;L with
              tools that leave funding out (it stays visible on each trade).
            </span>
          </span>
        </label>
      </section>

      <section className="space-y-2">
        <Label>Sessions</Label>
        <p className="text-muted-foreground text-xs">
          Hours are in the session&apos;s own time zone, so they follow daylight saving (New York&apos;s session moves an hour in
          UTC when the US changes clocks). Start is inclusive, end exclusive; a range may wrap past midnight (22:00 → 03:00), and
          00:00 as the end means midnight. Sessions are checked in order and the first match wins.
        </p>
        <div className="space-y-1.5" data-testid="sessions">
          {rows.map((s, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Input aria-label="Session name" value={s.name} onChange={(e) => update(i, { name: e.target.value })} className="h-8 w-36" />
              <Input aria-label="Start" type="time" step={900} value={toTime(s.start)} onChange={(e) => update(i, { start: fromTime(e.target.value) })} className="h-8 w-32" />
              <span className="text-muted-foreground text-xs">to</span>
              <Input aria-label="End" type="time" step={900} value={toTime(s.end)} onChange={(e) => update(i, { end: fromTime(e.target.value) })} className="h-8 w-32" />
              <select
                aria-label="Time zone"
                value={s.tz}
                onChange={(e) => update(i, { tz: e.target.value })}
                className="border-input bg-background h-8 rounded-md border px-2 text-sm"
              >
                {[...SESSION_ZONES.map((z) => z.tz), ...(SESSION_ZONES.some((z) => z.tz === s.tz) ? [] : [s.tz])].map((z) => (
                  <option key={z} value={z}>
                    {SESSION_ZONES.find((x) => x.tz === z)?.label ?? z}
                  </option>
                ))}
              </select>
              <span className="text-muted-foreground text-xs tabular-nums" title="Today, in UTC and in your timezone">
                now {sessionHoursIn(s, Date.now(), "UTC")} UTC · {sessionHoursIn(s, Date.now(), tz)} yours
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Remove session"
                onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setRows((r) => [...r, { name: "New session", start: 0, end: 1, tz: "UTC" }])}>
            <Plus className="size-4" /> Add session
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setRows(DEFAULT_SESSIONS)}>
            Reset to market-hours defaults
          </Button>
        </div>
      </section>

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {msg && <span className="text-muted-foreground text-xs">{msg}</span>}
      </div>
    </form>
  );
}
