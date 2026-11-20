/**
 * A trade's rules check: which of its strategy's playbook rules you kept. Stored on the journal as a snapshot (the
 * strategy and each rule's text when you ticked it), so editing the playbook later never rewrites old trades. A rule
 * is matched by its text; a check made for another strategy doesn't apply.
 */
import { z } from "zod";

export const RulesCheckSchema = z.object({
  strategyId: z.string().min(1).max(64),
  rules: z
    .array(z.object({ text: z.string().min(1).max(1_000), kept: z.boolean() }))
    .min(1)
    .max(100),
});
export type RulesCheck = z.infer<typeof RulesCheckSchema>;
export type RulesVerdict = "yes" | "partial" | "no";

/** Kept flags for the strategy's current rules (null = not ticked), or null when there's no check for it. */
export function keptFor(
  check: RulesCheck | null | undefined,
  strategyId: string | null,
  rules: string[],
): (boolean | null)[] | null {
  if (!check || !strategyId || check.strategyId !== strategyId) return null;
  const by = new Map(check.rules.map((r) => [r.text, r.kept]));
  return rules.map((r) => by.get(r) ?? null);
}

/**
 * The check after judging one rule (true kept, false broke, null not judged). Only judged rules are stored; nothing
 * judged is no check. The answer follows only once every rule is judged; until then it's left as it was.
 */
export function judge(
  strategyId: string,
  rules: string[],
  current: (boolean | null)[] | null,
  i: number,
  to: boolean | null,
  answer: RulesVerdict | null,
): { rulesCheck: RulesCheck | null; rulesFollowed: RulesVerdict | null } {
  const next = rules.map((_, j) => (j === i ? to : (current?.[j] ?? null)));
  const judged = rules.flatMap((text, j) => {
    const v = next[j];
    return v === null ? [] : [{ text, kept: v }];
  });
  return {
    rulesCheck: judged.length ? { strategyId, rules: judged } : null,
    rulesFollowed: judged.length === rules.length ? verdict(judged.map((r) => r.kept)) : answer,
  };
}

/** After a strategy change: a check for another strategy no longer applies, nor the answer it gave. */
export function afterStrategyChange<
  T extends { rulesCheck: RulesCheck | null; rulesFollowed: RulesVerdict | null },
>(v: T, strategyId: string | null): T {
  return v.rulesCheck && v.rulesCheck.strategyId !== strategyId
    ? { ...v, rulesCheck: null, rulesFollowed: null }
    : v;
}

/** All kept → yes, none → no, otherwise partial. */
export function verdict(kept: boolean[]): RulesVerdict | null {
  if (kept.length === 0) return null;
  const n = kept.filter(Boolean).length;
  return n === kept.length ? "yes" : n === 0 ? "no" : "partial";
}

/** Each rule's record over trades of one strategy: how many checks covered it and how many kept it. */
export function ruleRecord(
  trades: { strategyId: string | null; rulesCheck: RulesCheck | null }[],
  strategyId: string,
  rules: string[],
): { text: string; kept: number; of: number }[] {
  const rec = rules.map((text) => ({ text, kept: 0, of: 0 }));
  for (const t of trades) {
    const k = keptFor(t.rulesCheck, t.strategyId, rules);
    if (!k) continue;
    k.forEach((v, i) => {
      if (v === null) return;
      rec[i].of++;
      if (v) rec[i].kept++;
    });
  }
  return rec;
}
