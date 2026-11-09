"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveGeneralSettings } from "@/app/(app)/settings/actions";

type Session = { name: string; startUtc: number; endUtc: number };

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

export function GeneralForm({ timezone, sessions }: { timezone: string; sessions: Session[] }) {
  const [tz, setTz] = useState(timezone);
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
            await saveGeneralSettings({ timezone: tz, sessions: rows });
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
        <Label>Sessions (UTC hours)</Label>
        <p className="text-muted-foreground text-xs">
          A trade&apos;s session is suggested from its entry time. Start is inclusive, end exclusive; a range may wrap past
          midnight (e.g. 22 → 3).
        </p>
        <div className="space-y-1.5">
          {rows.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input value={s.name} onChange={(e) => update(i, { name: e.target.value })} className="h-8 w-40" />
              <Input
                type="number"
                min={0}
                max={24}
                value={s.startUtc}
                onChange={(e) => update(i, { startUtc: Number(e.target.value) })}
                className="h-8 w-20"
              />
              <span className="text-muted-foreground text-xs">to</span>
              <Input
                type="number"
                min={0}
                max={24}
                value={s.endUtc}
                onChange={(e) => update(i, { endUtc: Number(e.target.value) })}
                className="h-8 w-20"
              />
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
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setRows((r) => [...r, { name: "New session", startUtc: 0, endUtc: 1 }])}
        >
          <Plus className="size-4" /> Add session
        </Button>
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
