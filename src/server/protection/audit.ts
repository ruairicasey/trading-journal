/**
 * R-multiple audit (pure): the logic behind `npm run debug:r`, shared with the tests so a detection
 * change is checked the same way the real data was.
 */
import { median } from "../../lib/stats";
import { LATE_STOP_MS } from "./detect";

export const AUDIT = { TIGHT_PCT: 0.2, BE_PCT: 0.05, LATE_MS: LATE_STOP_MS } as const;
export const AUDIT_FLAGS = ["profit-side", "breakeven", "tight", "late", "added-after", "beyond-stop"] as const;
export type AuditFlag = (typeof AUDIT_FLAGS)[number];

export type AuditInput = {
  direction: "long" | "short";
  avgEntry: number | null;
  sizeUnits: number | null;
  netPnl: number | null;
  entryTime: number | null;
  stopLoss: number | null;
  stopLossSource: string | null;
  /** when the detected initial stop order was placed (null = no stop order) */
  stopPlaced: number | null;
  /** entry units added after that stop was placed */
  addedAfterStop: number;
};
export type AuditRow = { r: number; risk: number; distPct: number; flags: AuditFlag[] };

export function auditTrade(x: AuditInput): AuditRow | null {
  if (x.stopLoss == null || x.avgEntry == null || !x.sizeUnits || x.netPnl == null || x.entryTime == null) return null;
  const risk = Math.abs(x.avgEntry - x.stopLoss) * x.sizeUnits;
  if (!(risk > 0)) return null;
  const r = x.netPnl / risk;
  const distPct = (Math.abs(x.avgEntry - x.stopLoss) / x.avgEntry) * 100;
  const flags: AuditFlag[] = [];
  const profitSide = x.direction === "long" ? x.stopLoss >= x.avgEntry : x.stopLoss <= x.avgEntry;
  if (profitSide) flags.push("profit-side");
  else if (distPct < AUDIT.BE_PCT) flags.push("breakeven");
  else if (distPct < AUDIT.TIGHT_PCT) flags.push("tight");
  const auto = x.stopLossSource === "auto";
  if (auto && x.stopPlaced !== null && x.stopPlaced - x.entryTime > AUDIT.LATE_MS) flags.push("late");
  if (auto && x.addedAfterStop > 0) flags.push("added-after");
  if (r < -1.5 && !flags.length) flags.push("beyond-stop");
  return { r, risk, distPct, flags };
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export { median };

export function summarize(rows: AuditRow[]) {
  const rs = rows.map((x) => x.r);
  const byFlag = Object.fromEntries(
    AUDIT_FLAGS.map((f) => {
      const hit = rows.filter((x) => x.flags.includes(f));
      return [f, { n: hit.length, avg: mean(hit.map((x) => x.r)), avgWithout: mean(rows.filter((x) => !x.flags.includes(f)).map((x) => x.r)) }];
    }),
  ) as Record<AuditFlag, { n: number; avg: number | null; avgWithout: number | null }>;
  const clean = rows.filter((x) => !x.flags.length).map((x) => x.r);
  return { n: rows.length, avg: mean(rs), median: median(rs), byFlag, unflagged: { n: clean.length, avg: mean(clean), median: median(clean) } };
}
