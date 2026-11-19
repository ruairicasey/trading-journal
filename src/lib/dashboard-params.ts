/** Dashboard URL params (shared by the server page and the client controls). */
export const DASH_PERIODS = [
  { id: "7d", label: "7D", phrase: "7 days" },
  { id: "30d", label: "30D", phrase: "30 days" },
  { id: "week", label: "Week", phrase: "this week" },
  { id: "month", label: "Month", phrase: "this month" },
  { id: "year", label: "Year", phrase: "this year" },
  { id: "start", label: "Since start", phrase: "since start" },
  { id: "all", label: "All time", phrase: "all time" },
] as const;

/** The period in words, for labels such as "Net P&L, 30 days" (no middle dots, no arrows). */
export function periodPhrase(p: Pick<DashParams, "period" | "from" | "to">): string {
  if (p.period === "custom") return `${p.from ?? ""} to ${p.to ?? "now"}`;
  return DASH_PERIODS.find((x) => x.id === p.period)?.phrase ?? p.period;
}

export type DashParams = {
  period: string;
  from?: string;
  to?: string;
  unit: "usd" | "r";
  month?: string;
  week?: string;
  section?: string;
};

/** `base` lets other pages (e.g. /analytics) reuse the same period and $/R controls. */
export function dashHref(
  p: DashParams,
  patch: Partial<DashParams>,
  base = "/dashboard",
  defaultPeriod = "30d",
) {
  const n = { ...p, ...patch };
  const sp = new URLSearchParams();
  if (n.period && n.period !== defaultPeriod) sp.set("period", n.period);
  if (n.period === "custom") {
    if (n.from) sp.set("from", n.from);
    if (n.to) sp.set("to", n.to);
  }
  if (n.unit === "r") sp.set("unit", "r");
  if (n.month) sp.set("month", n.month);
  if (n.week) sp.set("week", n.week);
  if (n.section) sp.set("section", n.section);
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}
