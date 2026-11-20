import { describe, expect, test } from "vitest";
import {
  afterStrategyChange,
  judge,
  keptFor,
  ruleRecord,
  RulesCheckSchema,
  verdict,
} from "@/lib/rules-check";
import { playbook, ruleLines } from "@/lib/analytics/playbook";
import type { AnalyticsTrade } from "@/lib/analytics/types";

const check = (strategyId: string, kept: Record<string, boolean>) => ({
  strategyId,
  rules: Object.entries(kept).map(([text, k]) => ({ text, kept: k })),
});

describe("rules check", () => {
  test("verdict: all kept yes, none no, else partial; nothing ticked is no answer", () => {
    expect(verdict([true, true])).toBe("yes");
    expect(verdict([false, false])).toBe("no");
    expect(verdict([true, false])).toBe("partial");
    expect(verdict([])).toBeNull();
  });

  test("judge stores only marked rules; the answer follows only when every rule is marked", () => {
    const rules = ["Bias", "Stop", "Size"];
    // one rule marked: the earlier answer (from before the checklist) stays, the others aren't recorded as broken
    const a = judge("s", rules, null, 0, true, "yes");
    expect(a).toEqual({
      rulesCheck: { strategyId: "s", rules: [{ text: "Bias", kept: true }] },
      rulesFollowed: "yes",
    });
    const k1 = keptFor(a.rulesCheck, "s", rules);
    expect(k1).toEqual([true, null, null]);
    const b = judge("s", rules, k1, 1, false, a.rulesFollowed);
    const c = judge("s", rules, keptFor(b.rulesCheck, "s", rules), 2, true, b.rulesFollowed);
    expect(c.rulesFollowed).toBe("partial");
    // unmarking everything clears the check (and leaves the answer as it was)
    let k = keptFor(c.rulesCheck, "s", rules);
    let v = c;
    for (const i of [0, 1, 2]) {
      v = judge("s", rules, k, i, null, v.rulesFollowed);
      k = keptFor(v.rulesCheck, "s", rules);
    }
    expect(v).toEqual({ rulesCheck: null, rulesFollowed: "partial" });
  });

  test("afterStrategyChange drops another strategy's check with its answer; a manual answer stays", () => {
    const c = { strategyId: "a", rules: [{ text: "Bias", kept: true }] };
    expect(afterStrategyChange({ rulesCheck: c, rulesFollowed: "yes" as const }, "b")).toEqual({
      rulesCheck: null,
      rulesFollowed: null,
    });
    expect(afterStrategyChange({ rulesCheck: c, rulesFollowed: "yes" as const }, "a").rulesCheck).toBe(c);
    expect(afterStrategyChange({ rulesCheck: null, rulesFollowed: "no" as const }, "b").rulesFollowed).toBe(
      "no",
    );
  });

  test("a repeated rule is listed once, so each box maps to one rule", () => {
    expect(ruleLines("Wait for close\nSize 1%\n- Wait for close")).toEqual(["Wait for close", "Size 1%"]);
  });

  test("keptFor matches rules by text, ignores another strategy's check, null for a new rule", () => {
    const c = check("a", { Bias: true, Stop: false });
    expect(keptFor(c, "a", ["Stop", "Bias", "New rule"])).toEqual([false, true, null]);
    expect(keptFor(c, "b", ["Bias"])).toBeNull();
    expect(keptFor(null, "a", ["Bias"])).toBeNull();
    expect(keptFor(c, null, ["Bias"])).toBeNull();
  });

  test("ruleRecord counts per rule over the strategy's trades", () => {
    const ts = [
      { strategyId: "a", rulesCheck: check("a", { Bias: true, Stop: false }) },
      { strategyId: "a", rulesCheck: check("a", { Bias: true, Stop: true }) },
      { strategyId: "a", rulesCheck: check("a", { Bias: false }) }, // ticked before "Stop" was written
      { strategyId: "a", rulesCheck: null },
      { strategyId: "a", rulesCheck: check("b", { Bias: false, Stop: false }) }, // stale: another strategy
    ];
    expect(ruleRecord(ts, "a", ["Bias", "Stop"])).toEqual([
      { text: "Bias", kept: 2, of: 3 },
      { text: "Stop", kept: 1, of: 2 },
    ]);
  });

  test("the schema refuses an empty or oversized check", () => {
    expect(RulesCheckSchema.safeParse({ strategyId: "a", rules: [] }).success).toBe(false);
    expect(RulesCheckSchema.safeParse({ strategyId: "a", rules: [{ text: "", kept: true }] }).success).toBe(
      false,
    );
    expect(RulesCheckSchema.safeParse(check("a", { Bias: true })).success).toBe(true);
  });

  test("the playbook shows each rule's record for its strategy", () => {
    const base = {
      netPnl: 10,
      notionalUsd: 10_000,
      r: null,
      entryTime: 1,
      exitTime: 2,
    } as unknown as AnalyticsTrade;
    const ts = [
      { ...base, id: "1", strategyId: "a", rulesCheck: check("a", { Bias: true }) },
      { ...base, id: "2", strategyId: "a", rulesCheck: check("a", { Bias: false }) },
    ];
    const row = playbook(ts, [
      { id: "a", label: "A", description: null, rules: "Bias\nStop", archived: false },
    ]).rows[0];
    expect(row.ruleStats).toEqual([
      { text: "Bias", kept: 1, of: 2 },
      { text: "Stop", kept: 0, of: 0 },
    ]);
  });
});
