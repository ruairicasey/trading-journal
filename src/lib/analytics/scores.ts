/**
 * Scores for a period: discipline, review coverage and compliance (0–100) and mistake cost ($). Pure: no DB, no I/O.
 *
 * - Discipline: each trade is checked on five habits (a stop was set, it wasn't widened, not a revenge / tilt /
 *   overtrading entry: the Insights rules), plus "within your limits" when the account has risk rules
 *   (src/lib/analytics/limits.ts); the score is the share of all checks passed.
 * - Review coverage: share of closed trades marked reviewed, the same definition as the weekly card's
 *   "Not reviewed" count (src/lib/missing.ts), so the two reconcile.
 * - Compliance: rules followed (yes 1, partial ½, no 0) and process compliant (yes 1, no 0), averaged over the
 *   trades where you marked them. null when nothing is marked.
 * - Mistake cost: Σ net of trades tagged with at least one mistake, plus each mistake's own total (a trade with
 *   two mistakes counts in both, so those don't add up to the total).
 */
import { habitFlags } from "./insights";
import { limitBreaches, limitsSet, type LimitScope } from "./limits";
import type { AnalyticsTrade } from "./types";

export const DISCIPLINE_CHECKS = [
  { id: "stop", label: "Had a stop" },
  { id: "not-widened", label: "Stop not widened" },
  { id: "not-revenge", label: "Not a revenge trade" },
  { id: "not-tilt", label: "Not on tilt" },
  { id: "not-overtrading", label: "Not overtrading" },
  /** counted only when the account has a risk rule set (of = 0 otherwise) */
  { id: "within-limits", label: "Within your limits" },
] as const;
export type DisciplineCheck = (typeof DISCIPLINE_CHECKS)[number]["id"];

export type Scores = {
  n: number;
  discipline: { score: number | null; checks: Record<DisciplineCheck, { passed: number; of: number }> };
  coverage: { score: number | null; reviewed: number; exitReason: number; process: number; emotions: number };
  compliance: {
    score: number | null;
    rulesMarked: number;
    rulesScore: number | null;
    processMarked: number;
    processScore: number | null;
  };
  mistakes: { cost: number; n: number; top: { id: string; label: string; n: number; net: number }[] };
};

const pct = (x: number, of: number) => (of ? (x / of) * 100 : null);

export function scores(
  period: AnalyticsTrade[],
  context: AnalyticsTrade[],
  tz: string,
  limits?: LimitScope | null,
): Scores {
  const n = period.length;
  const { revenge, tilt, overtrading } = habitFlags(period, context, tz);
  const ruled = limitsSet(limits);
  const breaches = limitBreaches(period, context, tz, limits);

  const checks = Object.fromEntries(
    DISCIPLINE_CHECKS.map((c) => [c.id, { passed: 0, of: c.id === "within-limits" && !ruled ? 0 : n }]),
  ) as Scores["discipline"]["checks"];
  for (const t of period) {
    if (t.riskUsd !== null) checks.stop.passed++;
    if (t.stopClass !== "widened") checks["not-widened"].passed++;
    if (!revenge.has(t.id)) checks["not-revenge"].passed++;
    if (!tilt.has(t.id)) checks["not-tilt"].passed++;
    if (!overtrading.has(t.id)) checks["not-overtrading"].passed++;
    if (ruled && !breaches.any.has(t.id)) checks["within-limits"].passed++;
  }
  const passed = Object.values(checks).reduce((a, c) => a + c.passed, 0);
  const of = Object.values(checks).reduce((a, c) => a + c.of, 0);

  let rulesSum = 0;
  let rulesMarked = 0;
  let processSum = 0;
  let processMarked = 0;
  for (const t of period) {
    if (t.rulesFollowed) {
      rulesMarked++;
      rulesSum += t.rulesFollowed === "yes" ? 1 : t.rulesFollowed === "partial" ? 0.5 : 0;
    }
    if (t.processCompliant !== null) {
      processMarked++;
      if (t.processCompliant) processSum++;
    }
  }

  const tagged = period.filter((t) => t.mistakes.length > 0);
  const per = new Map<string, { id: string; label: string; n: number; net: number }>();
  for (const t of tagged)
    for (const m of t.mistakes) {
      const e = per.get(m.id) ?? { id: m.id, label: m.label, n: 0, net: 0 };
      e.n++;
      e.net += t.netPnl;
      per.set(m.id, e);
    }

  return {
    n,
    discipline: { score: pct(passed, of), checks },
    coverage: {
      score: pct(period.filter((t) => t.reviewed).length, n),
      reviewed: period.filter((t) => t.reviewed).length,
      exitReason: period.filter((t) => t.hasExitReason).length,
      process: processMarked,
      emotions: period.filter((t) => t.hasEmotions).length,
    },
    compliance: {
      score: pct(rulesSum + processSum, rulesMarked + processMarked),
      rulesMarked,
      rulesScore: pct(rulesSum, rulesMarked),
      processMarked,
      processScore: pct(processSum, processMarked),
    },
    mistakes: {
      cost: tagged.reduce((a, t) => a + t.netPnl, 0),
      n: tagged.length,
      top: [...per.values()].sort((a, b) => a.net - b.net || a.label.localeCompare(b.label)).slice(0, 3),
    },
  };
}
