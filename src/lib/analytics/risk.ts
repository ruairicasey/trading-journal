/** Analytics → Risk & execution: how you size, place stops and targets, manage and follow your rules. */
import { groupBy } from "./group";
import { median } from "../stats";
import type { AnalyticsTrade, Breakdown } from "./types";

export type RiskWidgetId =
  | "risk-size"
  | "risk-multiplier"
  | "sl-reason"
  | "tp-reason"
  | "exit-by"
  | "loser-max-r"
  | "capture"
  | "retests"
  | "rules"
  | "process";

export const RISK_WIDGETS: { id: RiskWidgetId; title: string; description: string }[] = [
  { id: "risk-size", title: "By risk size", description: "Risk in $ (entry to stop × size) against your typical (median) risk" },
  { id: "risk-multiplier", title: "By risk multiplier", description: "The risk multiplier you set on the trade (Analysis tab)" },
  { id: "sl-reason", title: "Stop placement reasons", description: "Which stop placements hold up (a trade counts once per reason)" },
  { id: "tp-reason", title: "Target placement reasons", description: "Which target placements pay (a trade counts once per reason)" },
  { id: "exit-by", title: "How trades ended", description: "Your final exit: take-profit order, stop order, or by hand (set-and-forget vs early exits)" },
  { id: "loser-max-r", title: "Losers: max R reached first", description: "Losing trades by how far they ran in your favour before losing (entry quality)" },
  { id: "capture", title: "Winners: R captured of max R", description: "Realised R ÷ max R reached, for winners with max R recorded (target efficiency)" },
  { id: "retests", title: "By entry retests", description: "How many times price retested your entry" },
  { id: "rules", title: "Rules followed", description: "Your rules-followed answer against the result" },
  { id: "process", title: "Process compliant", description: "Whether you marked the trade as process compliant" },
];

const UNSET = { key: "__none", label: "Not recorded" };

export const RISK_SIZE_BUCKETS = [
  { key: "lt0.5", label: "< 0.5× typical", max: 0.5 },
  { key: "0.5-0.9", label: "0.5–0.9×", max: 0.9 },
  { key: "0.9-1.1", label: "≈ typical (0.9–1.1×)", max: 1.1 },
  { key: "1.1-1.5", label: "1.1–1.5×", max: 1.5 },
  { key: "1.5-2", label: "1.5–2×", max: 2 },
  { key: "2+", label: "2× +", max: Infinity },
] as const;

const MAXR_BUCKETS = [
  { key: "0", label: "Never in profit (0R)", max: 0 },
  { key: "0-0.5", label: "0–0.5R", max: 0.5 },
  { key: "0.5-1", label: "0.5–1R", max: 1 },
  { key: "1-2", label: "1–2R", max: 2 },
  { key: "2+", label: "2R +", max: Infinity },
] as const;

const CAPTURE_BUCKETS = [
  { key: "lt25", label: "< 25%", max: 0.25 },
  { key: "25-50", label: "25–50%", max: 0.5 },
  { key: "50-75", label: "50–75%", max: 0.75 },
  { key: "75-100", label: "75–100%", max: 1.0000001 },
  { key: "100+", label: "> 100% (beyond recorded max)", max: Infinity },
] as const;

const bucketBy = <B extends readonly { key: string; label: string; max: number }[]>(v: number, list: B, inclusiveFirst = false) =>
  (inclusiveFirst && v <= list[0].max ? list[0] : list.find((b) => v < b.max)) ?? list[list.length - 1];

export function riskBreakdowns(trades: AnalyticsTrade[], opts: { minN?: number } = {}) {
  const minN = opts.minN ?? 5;
  const total = trades.length;
  const bd = (id: RiskWidgetId, buckets: Breakdown["buckets"]): Breakdown => ({ id, buckets, total, minN });
  const g = (list: AnalyticsTrade[], fn: (t: AnalyticsTrade) => { key: string; label: string }[] | { key: string; label: string } | null, o: Parameters<typeof groupBy>[2] = {}) =>
    groupBy(list, fn as never, { minN, ...o });

  const risks = trades.map((t) => t.riskUsd).filter((x): x is number => x !== null && x > 0);
  const typicalRisk = median(risks);

  const losers = trades.filter((t) => t.netPnl < 0);
  const losersWithMax = losers.filter((t) => t.maxRReached !== null);
  const winners = trades.filter((t) => t.netPnl > 0 && t.r !== null && t.r > 0 && t.maxRReached !== null && t.maxRReached > 0);
  const captures = winners.map((t) => t.r! / t.maxRReached!);

  const breakdowns: Record<RiskWidgetId, Breakdown> = {
    "risk-size": bd(
      "risk-size",
      g(
        trades,
        (t) => {
          if (t.riskUsd === null || !(t.riskUsd > 0) || !typicalRisk) return null;
          const b = bucketBy(t.riskUsd / typicalRisk, RISK_SIZE_BUCKETS);
          return { key: b.key, label: b.label };
        },
        { order: RISK_SIZE_BUCKETS.map((b) => b.key) },
      ),
    ),
    "risk-multiplier": bd(
      "risk-multiplier",
      g(
        trades,
        (t) =>
          t.riskMultiplier === null
            ? UNSET
            : t.riskMultiplier < 1
              ? { key: "lt1", label: "Reduced (< 1×)" }
              : t.riskMultiplier === 1
                ? { key: "1", label: "Standard (1×)" }
                : { key: "gt1", label: "Sized up (> 1×)" },
        { order: ["lt1", "1", "gt1", UNSET.key] },
      ),
    ),
    "sl-reason": bd("sl-reason", g(trades, (t) => t.slReasons.map((x) => ({ key: x.id, label: x.label }))).slice(0, 12)),
    "tp-reason": bd("tp-reason", g(trades, (t) => t.tpReasons.map((x) => ({ key: x.id, label: x.label }))).slice(0, 12)),
    "exit-by": bd(
      "exit-by",
      g(
        trades,
        (t) =>
          ({
            tp: { key: "tp", label: "Take-profit order" },
            stop: { key: "stop", label: "Stop order" },
            manual: { key: "manual", label: "By hand / limit order" },
            liquidated: { key: "liquidated", label: "Liquidated" },
          })[t.exitBy],
        { order: ["tp", "stop", "manual", "liquidated"] },
      ),
    ),
    "loser-max-r": bd(
      "loser-max-r",
      g(
        losers,
        (t) => {
          if (t.maxRReached === null) return UNSET;
          const b = bucketBy(t.maxRReached, MAXR_BUCKETS, true);
          return { key: b.key, label: b.label };
        },
        { order: [...MAXR_BUCKETS.map((b) => b.key), UNSET.key] },
      ),
    ),
    capture: bd(
      "capture",
      g(
        winners,
        (t) => {
          const b = bucketBy(t.r! / t.maxRReached!, CAPTURE_BUCKETS);
          return { key: b.key, label: b.label };
        },
        { order: CAPTURE_BUCKETS.map((b) => b.key) },
      ),
    ),
    retests: bd(
      "retests",
      g(
        trades,
        (t) => (t.entryRetests === null ? UNSET : t.entryRetests >= 3 ? { key: "3", label: "3 +" } : { key: String(t.entryRetests), label: String(t.entryRetests) }),
        { order: ["0", "1", "2", "3", UNSET.key] },
      ),
    ),
    rules: bd(
      "rules",
      g(
        trades,
        (t) => (t.rulesFollowed ? { key: t.rulesFollowed, label: { yes: "Yes", partial: "Partly", no: "No" }[t.rulesFollowed] } : UNSET),
        { order: ["yes", "partial", "no", UNSET.key] },
      ),
    ),
    process: bd(
      "process",
      g(trades, (t) => (t.processCompliant === null ? UNSET : t.processCompliant ? { key: "yes", label: "Compliant" } : { key: "no", label: "Not compliant" }), {
        order: ["yes", "no", UNSET.key],
      }),
    ),
  };
  return {
    breakdowns,
    typicalRisk,
    withStop: risks.length,
    losers: losers.length,
    losersWithMax: losersWithMax.length,
    /** share of losers (with max R recorded) that were ≥ 1R in profit before losing */
    losersReached1R: losersWithMax.length ? losersWithMax.filter((t) => t.maxRReached! >= 1).length / losersWithMax.length : null,
    avgCapture: captures.length ? captures.reduce((a, b) => a + b, 0) / captures.length : null,
    winnersWithMax: winners.length,
  };
}
