/**
 * Date helpers in the ACCOUNT timezone (default Australia/Melbourne). Exchange times are UTC ms;
 * "this week", calendar days and date filters are about the trader's local day. Weeks start Monday.
 */
import { TZDate } from "@date-fns/tz";
import { addDays, startOfMonth, startOfWeek, startOfYear } from "date-fns";

export const PERIODS = ["7d", "30d", "week", "month", "year", "all"] as const;
export type Period = (typeof PERIODS)[number];
export const PERIOD_LABELS: Record<Period, string> = {
  "7d": "7D",
  "30d": "30D",
  week: "This week",
  month: "This month",
  year: "This year",
  all: "All",
};

/** [from, to) in UTC ms; null = unbounded. */
export function periodRange(period: Period, now: number, tz: string): { from: number | null; to: number | null } {
  const local = new TZDate(now, tz);
  switch (period) {
    case "7d":
      return { from: now - 7 * 86_400_000, to: null };
    case "30d":
      return { from: now - 30 * 86_400_000, to: null };
    case "week":
      return { from: startOfWeek(local, { weekStartsOn: 1 }).getTime(), to: null };
    case "month":
      return { from: startOfMonth(local).getTime(), to: null };
    case "year":
      return { from: startOfYear(local).getTime(), to: null };
    case "all":
      return { from: null, to: null };
  }
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "YYYY-MM-DD" in `tz` → [start of that local day, start of the next local day) in UTC ms. DST-safe. */
export function dayBoundsLocal(date: string, tz: string): { start: number; end: number } | null {
  const m = DATE_RE.exec(date);
  if (!m) return null;
  const start = new TZDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]), tz);
  if (Number.isNaN(start.getTime())) return null;
  return { start: start.getTime(), end: addDays(start, 1).getTime() };
}

/** UTC ms → "YYYY-MM-DD" of the local day in `tz`. */
export function localDateKey(ts: number, tz: string): string {
  const d = new TZDate(ts, tz);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
