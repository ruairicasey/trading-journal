/**
 * Analytics → Timing: when you trade and how long you hold. Pure functions over closed trades.
 * Day, hour and session use the ENTRY time in the account timezone (when you made the decision);
 * the P&L is the trade's realised result.
 */
import { TZDate } from "@date-fns/tz";
import { localDateKey } from "../periods";
import { sessionFor, type SessionDef } from "../sessions";
import { groupBy } from "./group";
import type { AnalyticsTrade, Breakdown } from "./types";

export type TimingWidgetId = "weekday" | "hour" | "session" | "hold" | "nth-of-day" | "gap";

export const TIMING_WIDGETS: { id: TimingWidgetId; title: string; description: string }[] = [
  { id: "weekday", title: "By day of week", description: "Entry day, in your timezone" },
  { id: "hour", title: "By time of day", description: "Entry time in 2-hour blocks, your timezone" },
  { id: "session", title: "By session", description: "The session on the trade, else your session hours" },
  { id: "hold", title: "Time in trade", description: "How long you held, entry to final exit" },
  { id: "nth-of-day", title: "Nth trade of the day", description: "Do later trades in a day do worse?" },
  { id: "gap", title: "Time since your last trade", description: "From your previous exit to this entry: quick re-entries can be revenge trades" },
];

const HOUR = 3_600_000;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const HOLD_BUCKETS = [
  { key: "scalp", label: "Scalp (< 1h)", max: HOUR },
  { key: "intraday", label: "Intraday (1–4h)", max: 4 * HOUR },
  { key: "day", label: "Day (4–24h)", max: 24 * HOUR },
  { key: "swing", label: "Swing (1–3d)", max: 72 * HOUR },
  { key: "position", label: "Position (3d+)", max: Infinity },
] as const;

export const GAP_BUCKETS = [
  { key: "overlap", label: "Overlapping a trade", max: 0 },
  { key: "15m", label: "< 15 min", max: 15 * 60_000 },
  { key: "1h", label: "15 min – 1h", max: HOUR },
  { key: "4h", label: "1–4h", max: 4 * HOUR },
  { key: "24h", label: "4–24h", max: 24 * HOUR },
  { key: "1d+", label: "1 day +", max: Infinity },
] as const;

export function holdBucket(ms: number) {
  return HOLD_BUCKETS.find((b) => ms < b.max) ?? HOLD_BUCKETS[HOLD_BUCKETS.length - 1];
}

/** Each trade's position among the trades ENTERED that local day (1-based) and the gap since the previous exit. */
export function sequenceInfo(trades: AnalyticsTrade[], tz: string) {
  const byEntry = trades.filter((t) => t.entryTime !== null).sort((a, b) => a.entryTime! - b.entryTime! || a.id.localeCompare(b.id));
  const nth = new Map<string, number>();
  const gap = new Map<string, number | null>(); // null = first trade; ≤ 0 = entered while another was open
  const perDay = new Map<string, number>();
  let lastExit: number | null = null;
  for (const t of byEntry) {
    const day = localDateKey(t.entryTime!, tz);
    const k = (perDay.get(day) ?? 0) + 1;
    perDay.set(day, k);
    nth.set(t.id, k);
    gap.set(t.id, lastExit === null ? null : t.entryTime! - lastExit);
    lastExit = lastExit === null ? t.exitTime : Math.max(lastExit, t.exitTime);
  }
  return { nth, gap };
}

export function timingBreakdowns(
  trades: AnalyticsTrade[],
  opts: { tz: string; sessions: SessionDef[]; minN?: number; /** all trades, so the sequence before the period counts */ context?: AnalyticsTrade[] },
): Record<TimingWidgetId, Breakdown> & { holdWin: number | null; holdLoss: number | null } {
  const minN = opts.minN ?? 5;
  const total = trades.length;
  const bd = (id: TimingWidgetId, buckets: Breakdown["buckets"]): Breakdown => ({ id, buckets, total, minN });
  const g = (fn: (t: AnalyticsTrade) => { key: string; label: string } | null, o: Parameters<typeof groupBy>[2] = {}) =>
    groupBy(trades, fn as never, { minN, ...o });
  const withEntry = (fn: (t: AnalyticsTrade, entry: number) => { key: string; label: string } | null) => (t: AnalyticsTrade) =>
    t.entryTime === null ? null : fn(t, t.entryTime);

  const { nth, gap } = sequenceInfo(opts.context ?? trades, opts.tz);

  const holds = trades.filter((t) => t.entryTime !== null).map((t) => ({ t, ms: t.exitTime - t.entryTime! }));
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const holdWin = avg(holds.filter((h) => h.t.netPnl > 0).map((h) => h.ms));
  const holdLoss = avg(holds.filter((h) => h.t.netPnl < 0).map((h) => h.ms));

  return {
    weekday: bd(
      "weekday",
      g(
        withEntry((_, e) => {
          const d = (new TZDate(e, opts.tz).getDay() + 6) % 7; // Monday = 0
          return { key: String(d), label: DAYS[d] };
        }),
        { order: ["0", "1", "2", "3", "4", "5", "6"] },
      ),
    ),
    hour: bd(
      "hour",
      g(
        withEntry((_, e) => {
          const h = Math.floor(new TZDate(e, opts.tz).getHours() / 2) * 2;
          const hh = (x: number) => String(x).padStart(2, "0");
          return { key: hh(h), label: `${hh(h)}:00–${hh(h + 2)}:00` };
        }),
        { order: Array.from({ length: 12 }, (_, i) => String(i * 2).padStart(2, "0")) },
      ),
    ),
    session: bd(
      "session",
      g(
        withEntry((t, e) => {
          const name = t.session ?? sessionFor(e, opts.sessions);
          return name ? { key: name, label: name } : { key: "__none", label: "Outside your sessions" };
        }),
        { order: [...opts.sessions.map((s) => s.name), "__none"] },
      ),
    ),
    hold: bd(
      "hold",
      g(
        withEntry((t, e) => {
          const b = holdBucket(t.exitTime - e);
          return { key: b.key, label: b.label };
        }),
        { order: HOLD_BUCKETS.map((b) => b.key) },
      ),
    ),
    "nth-of-day": bd(
      "nth-of-day",
      g(
        (t) => {
          const k = nth.get(t.id);
          if (!k) return null;
          const c = Math.min(k, 5);
          return { key: String(c), label: c === 5 ? "5th +" : ["1st", "2nd", "3rd", "4th"][c - 1] };
        },
        { order: ["1", "2", "3", "4", "5"] },
      ),
    ),
    gap: bd(
      "gap",
      g(
        (t) => {
          const ms = gap.get(t.id);
          if (ms === undefined || ms === null) return null;
          const b = ms <= 0 ? GAP_BUCKETS[0] : GAP_BUCKETS.slice(1).find((x) => ms < x.max)!;
          return { key: b.key, label: b.label };
        },
        { order: GAP_BUCKETS.map((b) => b.key) },
      ),
    ),
    holdWin,
    holdLoss,
  };
}
