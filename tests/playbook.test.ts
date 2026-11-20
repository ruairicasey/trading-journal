import { beforeAll, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { useTempDb } from "./helpers/db";
import { getDb } from "@/server/db/client";
import { runMigrations, seedDefaults } from "@/server/db/bootstrap";
import * as s from "@/server/db/schema";
import { NO_STRATEGY, playbook, ruleLines, type PlaybookStrategy } from "@/lib/analytics/playbook";
import { listStrategies, savePlaybook } from "@/server/playbook/playbook";
import type { AnalyticsTrade } from "@/lib/analytics/types";
import { resolveView, wholeDays } from "@/lib/view-period";

let seq = 0;
function tr(
  net: number,
  strategyId: string | null,
  rulesFollowed: AnalyticsTrade["rulesFollowed"] = null,
  r: number | null = null,
): AnalyticsTrade {
  seq++;
  return {
    id: `t${seq}`,
    displayPair: "BTC",
    direction: "long",
    netPnl: net,
    fees: 0,
    notionalUsd: 10_000,
    entryTime: seq * 1000,
    exitTime: seq * 1000 + 500,
    r,
    coin: "BTC",
    tradeType: null,
    session: null,
    grade: null,
    strategyId,
    strategy: strategyId ? `S-${strategyId}` : null,
    htf: [],
    confluences: [],
    riskUsd: null,
    riskMultiplier: null,
    maxRReached: null,
    entryRetests: null,
    rulesFollowed,
    processCompliant: null,
    slReasons: [],
    tpReasons: [],
    exitBy: "manual",
    stopClass: null,
    reviewed: false,
    hasExitReason: false,
    hasEmotions: false,
    mistakes: [],
  };
}
const strat = (id: string, o: Partial<PlaybookStrategy> = {}): PlaybookStrategy => ({
  id,
  label: id.toUpperCase(),
  description: null,
  rules: null,
  archived: false,
  ...o,
});

describe("ruleLines", () => {
  test("one rule per line; blanks, bullets and numbers dropped", () => {
    expect(ruleLines("- Bias agrees\n\n2) Stop beyond the sweep\r\n  • 2R+  \n10. Size by risk")).toEqual([
      "Bias agrees",
      "Stop beyond the sweep",
      "2R+",
      "Size by risk",
    ]);
    expect(ruleLines(null)).toEqual([]);
    // a number that's part of the rule stays
    expect(ruleLines("2R minimum")).toEqual(["2R minimum"]);
  });
});

describe("playbook", () => {
  test("every trade in exactly one row: counts and net add up to the total", () => {
    const ts = [
      tr(100, "a", "yes", 1),
      tr(-50, "a", "no", -0.5),
      tr(30, "a", "partial"),
      tr(-20, "a"),
      tr(200, "b", "yes", 2),
      tr(-10, null),
      tr(5.55, "gone"), // a strategy deleted from the list
    ];
    const b = playbook(ts, [strat("a"), strat("b"), strat("c")]);
    expect(b.rows.map((r) => r.id)).toEqual(["a", "b", "c", "gone"]);
    const all = [...b.rows, b.none!];
    expect(all.reduce((x, r) => x + r.stats.n, 0)).toBe(ts.length);
    expect(all.reduce((x, r) => x + r.stats.net, 0)).toBeCloseTo(b.total.net, 9);
    expect(b.total).toMatchObject({ n: 7 });
    expect(b.none).toMatchObject({ id: NO_STRATEGY, stats: { n: 1, net: -10 } });
    // an empty strategy still shows, with nothing in it
    expect(b.rows[2].stats.n).toBe(0);
    expect(b.rows[2].compliance.score).toBeNull();
    // the deleted one keeps its label and can't be edited (archived)
    expect(b.rows[3]).toMatchObject({ label: "S-gone", archived: true });
  });

  test("compliance: yes 1, partial ½, no 0 over marked trades; the split adds up to the row", () => {
    const ts = [tr(100, "a", "yes"), tr(-50, "a", "no"), tr(30, "a", "partial"), tr(-20, "a")];
    const c = playbook(ts, [strat("a")]).rows[0].compliance;
    expect(c.marked).toBe(3);
    expect(c.score).toBeCloseTo(50, 9); // (1 + 0.5 + 0) / 3
    expect(c.followed).toEqual({ n: 1, net: 100 });
    expect(c.partial).toEqual({ n: 1, net: 30 });
    expect(c.broken).toEqual({ n: 1, net: -50 });
    expect(c.unmarked).toEqual({ n: 1, net: -20 });
    const parts = [c.followed, c.partial, c.broken, c.unmarked];
    expect(parts.reduce((x, p) => x + p.n, 0)).toBe(4);
    expect(parts.reduce((x, p) => x + p.net, 0)).toBe(60);
  });

  test("stats: win rate, avg trade and avg R over trades with R", () => {
    const ts = [tr(100, "a", null, 1), tr(-50, "a", null, -0.5), tr(1, "a")]; // the last is breakeven
    const st = playbook(ts, [strat("a")]).rows[0].stats;
    expect(st).toMatchObject({ n: 3, wins: 1, losses: 1, breakeven: 1, winRate: 0.5, rCount: 2 });
    expect(st.avgR).toBeCloseTo(0.25, 9);
    expect(st.avgTrade).toBeCloseTo(17, 9);
  });

  test("an archived strategy shows only when it has trades in the period", () => {
    const b1 = playbook([], [strat("a"), strat("old", { archived: true })]);
    expect(b1.rows.map((r) => r.id)).toEqual(["a"]);
    expect(b1.none).toBeNull();
    const b2 = playbook([tr(10, "old")], [strat("a"), strat("old", { archived: true })]);
    expect(b2.rows.map((r) => r.id)).toEqual(["a", "old"]);
  });
});

describe("savePlaybook", () => {
  let strategyId: string;
  let otherKind: string;
  beforeAll(async () => {
    useTempDb();
    const db = getDb();
    await runMigrations(db);
    await seedDefaults(db);
    strategyId = (await listStrategies(db))[0].id;
    otherKind = (await db.select().from(s.vocabItems).where(eq(s.vocabItems.kind, "mistake")))[0].id;
  });
  const get = async (id: string) =>
    (await getDb().select().from(s.vocabItems).where(eq(s.vocabItems.id, id)))[0];

  test("saves rules and description, trimmed; a field not sent is kept; empty clears", async () => {
    const db = getDb();
    expect(
      await savePlaybook(db, strategyId, { description: "  Sweep and reclaim ", rules: "A\r\nB\n" }),
    ).toEqual({
      ok: true,
    });
    expect(await get(strategyId)).toMatchObject({ description: "Sweep and reclaim", rules: "A\nB" });
    await savePlaybook(db, strategyId, { rules: "C" });
    expect(await get(strategyId)).toMatchObject({ description: "Sweep and reclaim", rules: "C" });
    await savePlaybook(db, strategyId, { description: "   " });
    expect(await get(strategyId)).toMatchObject({ description: null, rules: "C" });
  });

  test("refuses other vocab kinds, unknown ids, unknown fields and over-long text", async () => {
    const db = getDb();
    const before = await get(otherKind);
    expect((await savePlaybook(db, otherKind, { rules: "x" })).ok).toBe(false);
    expect(await get(otherKind)).toEqual(before);
    expect((await savePlaybook(db, "nope", { rules: "x" })).ok).toBe(false);
    expect((await savePlaybook(db, strategyId, { label: "renamed" })).ok).toBe(false);
    expect((await savePlaybook(db, strategyId, { rules: "x".repeat(4001) })).ok).toBe(false);
    expect((await get(strategyId)).label).not.toBe("renamed");
  });
});

describe("wholeDays (the card count and its Trades link)", () => {
  const now = Date.UTC(2026, 10, 20, 15, 30); // mid-afternoon UTC
  test("30 days: counted over whole local days by exit, linked as exit dates with All time's floor", () => {
    const v = resolveView({ period: "30d" }, now, "UTC", null);
    const d = wholeDays(v, "UTC");
    const from = new Date(v.start!).toISOString().slice(0, 10);
    expect(d.filters).toEqual({ from, dateBy: "exit", period: "all" });
    // a trade that closed early on the first day (before the rolling start) still counts, like on the Trades page
    const dayStart = Date.parse(`${from}T00:00:00Z`);
    expect(dayStart).toBeLessThan(v.start!);
    expect(d.inPeriod({ exitTime: dayStart })).toBe(true);
    expect(d.inPeriod({ exitTime: dayStart - 1 })).toBe(false);
  });
  test("since start keeps the Trades page's own floor (no period sent); a custom range sends both dates", () => {
    const js = Date.UTC(2026, 2, 31, 13); // 1 Apr 00:00 in Melbourne
    const d = wholeDays(resolveView({}, now, "Australia/Melbourne", js), "Australia/Melbourne");
    expect(d.filters).toEqual({ from: "2026-04-01", dateBy: "exit" });
    const c = wholeDays(
      resolveView({ period: "custom", from: "2026-05-01", to: "2026-05-31" }, now, "UTC", js),
      "UTC",
    );
    expect(c.filters).toEqual({ from: "2026-05-01", to: "2026-05-31", dateBy: "exit", period: "all" });
    expect(c.inPeriod({ exitTime: Date.UTC(2026, 4, 31, 23, 59) })).toBe(true);
    expect(c.inPeriod({ exitTime: Date.UTC(2026, 5, 1) })).toBe(false);
  });
});
