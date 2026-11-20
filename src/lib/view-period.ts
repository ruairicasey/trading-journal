/**
 * The period a page shows (Analytics, Playbook): parsed from its URL, with the journal start's floor applied.
 * Trades count in the period by exit time; the floor keeps only trades opened on/after the journal start.
 */
import type { DashParams } from "./dashboard-params";
import { clampStart, journalFloor, SINCE_START } from "./journal-start";
import { dayBoundsLocal, periodRange, PERIODS, type Period } from "./periods";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function resolveView(sp: SP, now: number, tz: string, journalStart: number | null) {
  // with a journal start, the default view is "Since start"; All time still looks further back
  const defaultPeriod = journalStart !== null ? SINCE_START : "all";
  const rawPeriod = one(sp.period) ?? defaultPeriod;
  const from = one(sp.from);
  const to = one(sp.to);
  const custom = rawPeriod === "custom" && !!from && DATE.test(from);
  const period = custom
    ? "custom"
    : (PERIODS as readonly string[]).includes(rawPeriod)
      ? rawPeriod
      : defaultPeriod;
  const params: DashParams = {
    period,
    from: custom ? from : undefined,
    to: custom && to && DATE.test(to) ? to : undefined,
    unit: one(sp.unit) === "r" ? "r" : "usd",
  };

  let start: number | null = null;
  let end: number | null = null;
  if (custom) {
    start = dayBoundsLocal(from!, tz)!.start;
    end = params.to ? (dayBoundsLocal(params.to, tz)?.end ?? null) : null;
  } else {
    start = periodRange(period as Period, now, tz).from;
  }
  const floor = journalFloor(journalStart, period);
  start = clampStart(start, floor);
  const inPeriod = (t: { exitTime: number }) =>
    (start === null || t.exitTime >= start) && (end === null || t.exitTime < end);
  return { defaultPeriod, params, custom, start, end, floor, inPeriod };
}

/**
 * The view widened to whole local days, and the Trades-page filters that open exactly those closed trades (exit date
 * from/to in your timezone; All time and custom ranges skip the journal start's floor, so they send period=all).
 * A rolling 7/30 days starts mid-day; counting over its whole first day keeps a page's count equal to its link's.
 */
export function wholeDays(v: ReturnType<typeof resolveView>, tz: string) {
  const localDay = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(ms);
  const fromDay = v.start === null ? undefined : localDay(v.start);
  const toDay = v.end === null ? undefined : localDay(v.end - 1);
  const fromMs = fromDay ? dayBoundsLocal(fromDay, tz)!.start : null;
  const toMs = toDay ? dayBoundsLocal(toDay, tz)!.end : null;
  return {
    inPeriod: (t: { exitTime: number }) =>
      (fromMs === null || t.exitTime >= fromMs) && (toMs === null || t.exitTime < toMs),
    filters: {
      ...(fromDay ? { from: fromDay } : {}),
      ...(toDay ? { to: toDay } : {}),
      ...(fromDay || toDay ? { dateBy: "exit" as const } : {}),
      ...(v.floor === null ? { period: "all" as const } : {}),
    },
  };
}
