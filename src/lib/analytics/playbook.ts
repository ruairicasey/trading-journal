/**
 * The strategy playbook: each strategy's record over a period, and how often you followed its rules. Pure.
 *
 * - Every closed trade lands in exactly one row (its strategy, or "No strategy"), so rows add up to the period's total
 *   in both trade count and net.
 * - Compliance uses the trade's "Rules followed" mark, scored like Scores → Compliance (yes 1, partial ½, no 0) over
 *   the trades you marked. The followed / not followed / not marked split also adds up to the row.
 * - Strategies you haven't archived show even with no trades in the period; an archived one shows only when it has some.
 */
import { bucketOf } from "./group";
import type { AnalyticsTrade, Bucket } from "./types";

export const NO_STRATEGY = "__none";

export type PlaybookStrategy = {
  id: string;
  label: string;
  description: string | null;
  rules: string | null;
  archived: boolean;
};

type Part = { n: number; net: number };
export type PlaybookRow = {
  id: string;
  label: string;
  description: string | null;
  /** the written rules, one per non-empty line */
  rules: string[];
  /** the rules as you wrote them (for editing) */
  rulesText: string | null;
  archived: boolean;
  stats: Bucket;
  compliance: {
    /** 0–100, null when no trade is marked */
    score: number | null;
    marked: number;
    followed: Part;
    partial: Part;
    broken: Part;
    unmarked: Part;
  };
};

/** The rules text as a list: one per line, trimmed, blank lines and leading bullets or numbers dropped. */
export function ruleLines(text: string | null | undefined): string[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map((l) =>
      l
        .trim()
        .replace(/^([-*•]|\d+[.)])\s+/, "")
        .trim(),
    )
    .filter(Boolean);
}

function compliance(list: AnalyticsTrade[]): PlaybookRow["compliance"] {
  const part = (): Part => ({ n: 0, net: 0 });
  const c = { followed: part(), partial: part(), broken: part(), unmarked: part() };
  for (const t of list) {
    const p =
      t.rulesFollowed === "yes"
        ? c.followed
        : t.rulesFollowed === "partial"
          ? c.partial
          : t.rulesFollowed === "no"
            ? c.broken
            : c.unmarked;
    p.n++;
    p.net += t.netPnl;
  }
  const marked = c.followed.n + c.partial.n + c.broken.n;
  return {
    score: marked ? ((c.followed.n + c.partial.n / 2) / marked) * 100 : null,
    marked,
    ...c,
  };
}

export function playbook(
  trades: AnalyticsTrade[],
  strategies: PlaybookStrategy[],
  minN?: number,
): { rows: PlaybookRow[]; none: PlaybookRow | null; total: { n: number; net: number } } {
  const by = new Map<string, AnalyticsTrade[]>();
  for (const t of trades) {
    const k = t.strategyId ?? NO_STRATEGY;
    const l = by.get(k);
    if (l) l.push(t);
    else by.set(k, [t]);
  }
  const row = (
    id: string,
    label: string,
    s: Pick<PlaybookStrategy, "description" | "rules" | "archived"> | null,
  ): PlaybookRow => {
    const list = by.get(id) ?? [];
    return {
      id,
      label,
      description: s?.description ?? null,
      rules: ruleLines(s?.rules),
      rulesText: s?.rules ?? null,
      archived: s?.archived ?? false,
      stats: bucketOf(id, label, list, minN),
      compliance: compliance(list),
    };
  };

  const known = new Set(strategies.map((s) => s.id));
  const rows = strategies.filter((s) => !s.archived || by.has(s.id)).map((s) => row(s.id, s.label, s));
  // a trade can point at a strategy that's no longer in the list (deleted): keep it so the rows still add up
  for (const [id, list] of by)
    if (id !== NO_STRATEGY && !known.has(id))
      rows.push(row(id, list[0].strategy ?? "Strategy", { description: null, rules: null, archived: true }));

  return {
    rows,
    none: by.has(NO_STRATEGY) ? row(NO_STRATEGY, "No strategy", null) : null,
    total: { n: trades.length, net: trades.reduce((a, t) => a + t.netPnl, 0) },
  };
}
