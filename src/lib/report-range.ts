/**
 * The period a report or export covers: the same `period` / `from` / `to` params (and the same exit-time range) as the
 * dashboard and analytics, so a report always matches what those pages show for the same period.
 */
import { DASH_PERIODS, type DashParams } from "./dashboard-params";
import { dayBoundsLocal, periodRange, PERIODS, type Period } from "./periods";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function reportRange(sp: SP, now: number, tz: string, defaultPeriod: Period = "month") {
  const raw = one(sp.period) ?? defaultPeriod;
  const from = one(sp.from);
  const to = one(sp.to);
  const custom = raw === "custom" && !!from && DATE.test(from) && !!dayBoundsLocal(from, tz);
  const period = custom ? "custom" : (PERIODS as readonly string[]).includes(raw) ? raw : defaultPeriod;
  const params: DashParams = {
    period,
    from: custom ? from : undefined,
    to: custom && to && DATE.test(to) ? to : undefined,
    unit: "usd",
  };
  let start: number | null;
  let end: number | null = null;
  if (custom) {
    start = dayBoundsLocal(from!, tz)!.start;
    end = params.to ? (dayBoundsLocal(params.to, tz)?.end ?? null) : null;
  } else start = periodRange(period as Period, now, tz).from;
  const label = custom
    ? `${from} → ${params.to ?? "now"}`
    : (DASH_PERIODS.find((p) => p.id === period)?.label ?? period);
  /** query string for the export links (empty for the default) */
  const qs = new URLSearchParams(
    Object.entries({
      period: period === defaultPeriod ? undefined : period,
      from: params.from,
      to: params.to,
    }).filter((e): e is [string, string] => !!e[1]),
  ).toString();
  return {
    params,
    start,
    end,
    label,
    qs,
    /** the report is as of `now`: exits after it (e.g. a sync between the page and a download) are left out */
    inRange: (t: { exitTime: number }) =>
      (start === null || t.exitTime >= start) && (end === null || t.exitTime < end) && t.exitTime <= now,
  };
}
