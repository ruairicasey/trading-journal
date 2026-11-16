/** Analytics → Setup: what you trade and how you set it up. Pure functions over closed trades. */
import { GRADES, HTF_TIMEFRAMES } from "../enums";
import { groupBy } from "./group";
import type { AnalyticsTrade, Breakdown } from "./types";

const UNSET = { key: "__none", label: "Not set" };

export type SetupWidgetId =
  | "pair"
  | "direction"
  | "trade-type"
  | "grade"
  | "strategy"
  | "confluence-count"
  | "confluence"
  | "htf-count"
  | "htf"
  | "htf-combo";

export const SETUP_WIDGETS: { id: SetupWidgetId; title: string; description: string }[] = [
  { id: "pair", title: "By pair", description: "Which markets pay you" },
  { id: "direction", title: "Long vs short", description: "Is one side your edge?" },
  { id: "trade-type", title: "Planned vs reactive", description: "Setups you planned against trades taken on the fly" },
  { id: "grade", title: "By grade", description: "Do your A+ setups really outperform?" },
  { id: "strategy", title: "By strategy", description: "Each strategy's record" },
  { id: "confluence-count", title: "By number of confluences", description: "Does more confluence mean better trades?" },
  { id: "confluence", title: "By confluence", description: "Each confluence's record (a trade counts once per confluence)" },
  { id: "htf-count", title: "By number of HTF confluences", description: "How many higher timeframes agreed" },
  { id: "htf", title: "By HTF timeframe", description: "Which higher timeframes matter (a trade counts once per HTF)" },
  { id: "htf-combo", title: "Best HTF combinations", description: "Exact sets of higher timeframes, most traded first" },
];

const countLabel = (n: number, cap: number, unit: string) => (n >= cap ? `${cap}+ ${unit}` : `${n} ${unit}`);

export function setupBreakdowns(trades: AnalyticsTrade[], opts: { minN?: number; topN?: number } = {}): Record<SetupWidgetId, Breakdown> {
  const minN = opts.minN ?? 5;
  const topN = opts.topN ?? 12;
  const total = trades.length;
  const bd = (id: SetupWidgetId, buckets: Breakdown["buckets"]): Breakdown => ({ id, buckets, total, minN });
  const g = <K>(fn: (t: AnalyticsTrade) => K, o: Parameters<typeof groupBy>[2] = {}) =>
    groupBy(trades, fn as never, { minN, ...o });

  const confCount = (t: AnalyticsTrade) => Math.min(t.confluences.length, 5);
  const htfCount = (t: AnalyticsTrade) => Math.min(t.htf.length, 4);
  const htfOrder = (a: string, b: string) => HTF_TIMEFRAMES.indexOf(a as never) - HTF_TIMEFRAMES.indexOf(b as never);

  return {
    pair: bd("pair", g((t) => ({ key: t.coin, label: t.displayPair })).slice(0, topN)),
    direction: bd("direction", g((t) => ({ key: t.direction, label: t.direction === "long" ? "Long" : "Short" }), { order: ["long", "short"] })),
    "trade-type": bd(
      "trade-type",
      g((t) => (t.tradeType ? { key: t.tradeType, label: t.tradeType === "planned" ? "Planned" : "Reactive" } : UNSET), {
        order: ["planned", "reactive", UNSET.key],
      }),
    ),
    grade: bd("grade", g((t) => (t.grade ? { key: t.grade, label: t.grade } : UNSET), { order: [...GRADES, UNSET.key] })),
    strategy: bd("strategy", g((t) => (t.strategyId ? { key: t.strategyId, label: t.strategy ?? "Strategy" } : UNSET)).slice(0, topN)),
    "confluence-count": bd(
      "confluence-count",
      g((t) => ({ key: String(confCount(t)), label: countLabel(confCount(t), 5, "confluences").replace(/^1 confluences/, "1 confluence") }), {
        order: ["0", "1", "2", "3", "4", "5"],
      }),
    ),
    confluence: bd("confluence", g((t) => t.confluences.map((c) => ({ key: c.id, label: c.label }))).slice(0, topN)),
    "htf-count": bd(
      "htf-count",
      g((t) => ({ key: String(htfCount(t)), label: countLabel(htfCount(t), 4, "HTFs").replace(/^1 HTFs/, "1 HTF") }), { order: ["0", "1", "2", "3", "4"] }),
    ),
    htf: bd("htf", g((t) => t.htf.map((h) => ({ key: h, label: h })), { order: [...HTF_TIMEFRAMES] })),
    "htf-combo": bd(
      "htf-combo",
      g((t) => {
        if (!t.htf.length) return null;
        const set = [...new Set(t.htf)].sort(htfOrder);
        return { key: set.join("+"), label: set.join(" + ") };
      }).slice(0, topN),
    ),
  };
}
