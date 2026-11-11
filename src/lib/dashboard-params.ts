/** Dashboard URL params (shared by the server page and the client controls). */
export const DASH_PERIODS = [
  { id: "7d", label: "7D" },
  { id: "30d", label: "30D" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
  { id: "all", label: "All" },
] as const;

export type DashParams = { period: string; from?: string; to?: string; unit: "usd" | "r"; month?: string };

export function dashHref(p: DashParams, patch: Partial<DashParams>) {
  const n = { ...p, ...patch };
  const sp = new URLSearchParams();
  if (n.period && n.period !== "30d") sp.set("period", n.period);
  if (n.period === "custom") {
    if (n.from) sp.set("from", n.from);
    if (n.to) sp.set("to", n.to);
  }
  if (n.unit === "r") sp.set("unit", "r");
  if (n.month) sp.set("month", n.month);
  const qs = sp.toString();
  return qs ? `/dashboard?${qs}` : "/dashboard";
}
