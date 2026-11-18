import { describe, expect, test } from "vitest";
import { insights, MIN_BUCKET, MIN_TRADES, REVENGE_MS, type InsightId } from "@/lib/analytics/insights";
import type { AnalyticsTrade } from "@/lib/analytics/types";
import { runBefore } from "@/lib/analytics/behaviour";

const TZ = "UTC";
const H = 3_600_000;
const D0 = Date.UTC(2026, 0, 5); // a Monday
let seq = 0;
function tr(entry: number, exit: number, net: number, o: Partial<AnalyticsTrade> = {}): AnalyticsTrade {
  seq++;
  return {
    id: `t${String(seq).padStart(3, "0")}`,
    displayPair: "BTC",
    direction: "long",
    netPnl: net,
    fees: 0,
    notionalUsd: 10_000,
    entryTime: entry,
    exitTime: exit,
    r: 1,
    coin: "BTC",
    tradeType: null,
    session: null,
    grade: "A",
    strategyId: null,
    strategy: null,
    htf: [],
    confluences: [],
    riskUsd: 100,
    riskMultiplier: null,
    maxRReached: null,
    entryRetests: null,
    rulesFollowed: "yes",
    processCompliant: null,
    slReasons: [],
    tpReasons: [],
    exitBy: "manual",
    stopClass: "never_moved",
    reviewed: false,
    hasExitReason: false,
    hasEmotions: false,
    mistakes: [],
    ...o,
  };
}
const get = (list: ReturnType<typeof insights>["list"], id: InsightId) => list.find((i) => i.id === id);

describe("each rule", () => {
  test("revenge: within 30 minutes of a LOSING exit only; a winning exit or a later entry doesn't count", () => {
    // notional 10,000 → breakeven band ±$5, so results here are clearly wins or losses
    const day = (d: number) => D0 + d * 24 * H;
    const m = 60_000;
    const ts: AnalyticsTrade[] = [];
    for (let d = 0; d < 3; d++) {
      ts.push(tr(day(d) + 1 * H, day(d) + 2 * H, -50)); // loser
      ts.push(tr(day(d) + 2 * H + 10 * m, day(d) + 3 * H, -20)); // 10 min after a loss: revenge
      ts.push(tr(day(d) + 5 * H, day(d) + 6 * H, 40)); // 2h after a loss: not revenge (a win)
      ts.push(tr(day(d) + 6 * H + 5 * m, day(d) + 7 * H, -30)); // 5 min after a WIN: not revenge
      ts.push(tr(day(d) + 7 * H + REVENGE_MS, day(d) + 8 * H, -15)); // exactly 30 min after a loss: not revenge
    }
    const r = get(insights(ts, ts, TZ).list, "revenge")!;
    expect(r.ids).toEqual(ts.filter((_, i) => i % 5 === 1).map((t) => t.id).sort());
    expect(r.impact).toBe(-60);
    expect(r.worst.map((w) => w.netPnl)).toEqual([-20, -20, -20]);
  });

  test("revenge edge cases: a flip in the same ms, two exits in the same ms, a zero-length trade, an open trade alongside", () => {
    const m = 60_000;
    const ids = (ts: AnalyticsTrade[]) => insights(ts, ts, TZ).list.find((i) => i.id === "revenge")?.ids ?? [];
    // a loser closes and the next trade opens in the same millisecond (a flip): revenge, ×3 to clear MIN_TRADES
    const flip = [0, 1, 2].flatMap((d) => {
      const at = D0 + d * 24 * H;
      return [tr(at, at + H, -50), tr(at + H, at + 2 * H, -10)];
    });
    expect(ids(flip)).toEqual([flip[1], flip[3], flip[5]].map((t) => t.id).sort());
    // a loser and a winner exit in the same ms (one fill closing two trades): revenge whichever id sorts last
    const tie = [0, 1, 2].flatMap((d) => {
      const at = D0 + d * 24 * H;
      return [tr(at, at + H, -50, { id: `z${d}` }), tr(at, at + H, 60, { id: `a${d}` }), tr(at + H + 5 * m, at + 2 * H, -10)];
    });
    expect(ids(tie)).toEqual([tie[2], tie[5], tie[8]].map((t) => t.id).sort());
    const tie2 = tie.map((t) => (t.id.startsWith("z") ? { ...t, id: `0${t.id}` } : t));
    expect(ids(tie2)).toEqual(ids(tie));
    // a zero-length loser doesn't make itself a revenge trade
    const zero = [0, 1, 2].map((d) => tr(D0 + d * 24 * H, D0 + d * 24 * H, -50));
    expect(ids(zero)).toEqual([]);
    // a trade held open the whole time doesn't change anything: the entry still follows a loser's exit
    const long = tr(D0 - H, D0 + 10 * 24 * H, 500);
    expect(ids([long, ...flip])).toEqual(ids(flip));
  });

  test("tilt counts trades after 3+ losses in a row (breakevens don't break the run), across the period start", () => {
    // run before each: -, L1, L2, L2 (be skipped), L3 → tilt, L4 → tilt, L5 → tilt
    const ts = [-10, -10, 0, -10, -20, -25, -30].map((n, i) => tr(D0 + i * 5 * H, D0 + i * 5 * H + H, n));
    const t = get(insights(ts, ts, TZ).list, "tilt")!;
    expect(t.ids).toEqual([ts[4].id, ts[5].id, ts[6].id].sort());
    expect(t.impact).toBe(-75);
    // judged only on trades 4..6, but the run that started before them still counts
    expect(get(insights(ts.slice(4), ts, TZ).list, "tilt")!.n).toBe(3);
    // a win resets it
    const reset = [-10, -10, -10, 50, -20, -20, -20].map((n, i) => tr(D0 + i * 5 * H, D0 + i * 5 * H + H, n));
    expect(get(insights(reset, reset, TZ).list, "tilt")).toBeUndefined(); // only the +50 followed 3 losses: it made money
  });

  test("tilt judges what you had seen at entry, not the exit order", () => {
    const at = (h: number) => D0 + h * H;
    // entered BEFORE three losses that closed while it was open: not tilt
    // (each day starts with a winner, so the previous day's losses don't carry over)
    const early = [0, 1, 2].flatMap((d) => [
      tr(at(d * 48 + 7), at(d * 48 + 8), 60),
      tr(at(d * 48 + 9), at(d * 48 + 30), -40),
      tr(at(d * 48 + 9.5), at(d * 48 + 10), -10),
      tr(at(d * 48 + 10.5), at(d * 48 + 11), -10),
      tr(at(d * 48 + 11.5), at(d * 48 + 12), -10),
    ]);
    const tiltIds = (ts: AnalyticsTrade[]) => insights(ts, ts, TZ).list.find((i) => i.id === "tilt")?.ids ?? [];
    expect(tiltIds(early)).toEqual([]);
    // by exit order the −40s close right after three losses: they would have counted
    const run = runBefore(early);
    expect(early.filter((_, i) => i % 5 === 1).every((t) => run.get(t.id)?.kind === "loss" && run.get(t.id)!.n >= 3)).toBe(true);
    // entered after three losses while an earlier winner was still open (it closes later): tilt
    const late = [0, 1, 2].flatMap((d) => [
      tr(at(d * 48 + 8), at(d * 48 + 14), 60),
      tr(at(d * 48 + 9), at(d * 48 + 10), -10),
      tr(at(d * 48 + 10.5), at(d * 48 + 11), -10),
      tr(at(d * 48 + 11.5), at(d * 48 + 12), -10),
      tr(at(d * 48 + 12.5), at(d * 48 + 15), -30),
      tr(at(d * 48 + 20), at(d * 48 + 21), 60), // ends the day on a win
    ]);
    expect(tiltIds(late)).toEqual(late.filter((_, i) => i % 6 === 4).map((t) => t.id).sort());
    // by exit order (the Behaviour section's runBefore) the 12:30 entries would follow the 14:00 win: not tilt
    const byExit = runBefore(late);
    expect(late.filter((_, i) => i % 6 === 4).every((t) => byExit.get(t.id)?.kind === "win")).toBe(true);
  });

  test("worst hour uses local time across a daylight-saving change", () => {
    // 09:00 Melbourne before (AEDT, UTC+11) and after (AEST, UTC+10) the change on 5 Apr 2026
    const before = [Date.UTC(2026, 2, 30, 22), Date.UTC(2026, 2, 31, 22), Date.UTC(2026, 3, 1, 22)];
    const after = [Date.UTC(2026, 3, 6, 23), Date.UTC(2026, 3, 7, 23)];
    const ts = [...before, ...after].map((e) => tr(e, e + 20 * 60_000, -10));
    const w = get(insights(ts, ts, "Australia/Melbourne").list, "worst-hour")!;
    expect(w.n).toBe(5);
    expect(w.detail).toContain("08:00 and 10:00");
  });

  test("overtrading: 4th+ entry of the local day", () => {
    const ts = [0, 1, 2, 3, 4, 5].map((k) => tr(D0 + k * H, D0 + k * H + 30 * 60_000, k >= 3 ? -10 : 5));
    // spaced an hour apart: the 30-minute gaps after a win aren't revenge
    const o = get(insights(ts, ts, TZ).list, "overtrading")!;
    expect(o.n).toBe(3);
    expect(o.impact).toBe(-30);
    expect(o.avgOthers).toBe(5);
    // another timezone moves the day boundary
    const late = [20, 21, 22, 23, 24, 25, 26, 27, 28].map((h) => tr(D0 + h * H, D0 + h * H + 30 * 60_000, -10));
    // UTC: 20–23 h on one day (the 23:00 is 4th), 00–04 h the next (03:00 and 04:00 are 4th and 5th)
    expect(get(insights(late, late, "UTC").list, "overtrading")!.n).toBe(3);
    // Melbourne (UTC+11 in January): all nine fall on one local day, so the 4th to 9th count
    expect(get(insights(late, late, "Australia/Melbourne").list, "overtrading")!.n).toBe(6);
  });

  test("worst hour and worst day need MIN_BUCKET trades and must have lost", () => {
    const ts: AnalyticsTrade[] = [];
    for (let w = 0; w < MIN_BUCKET; w++) {
      ts.push(tr(D0 + w * 7 * 24 * H + 9 * H, D0 + w * 7 * 24 * H + 10 * H, -20)); // Mondays 09:00
      ts.push(tr(D0 + w * 7 * 24 * H + 24 * H + 15 * H, D0 + w * 7 * 24 * H + 24 * H + 16 * H, 10)); // Tuesdays 15:00
    }
    ts.push(tr(D0 + 2 * 24 * H + 1 * H, D0 + 2 * 24 * H + 2 * H, -500)); // one awful Wednesday 01:00: too few to judge
    const list = insights(ts, ts, TZ).list;
    expect(get(list, "worst-hour")!.detail).toContain("08:00 and 10:00");
    expect(get(list, "worst-hour")!.n).toBe(MIN_BUCKET);
    expect(get(list, "worst-day")!.detail).toContain("Mon");
    expect(get(list, "worst-day")!.impact).toBe(-20 * MIN_BUCKET);
  });

  test("no stop, widened, rules broken, low grade", () => {
    const at = (k: number) => [D0 + k * 24 * H, D0 + k * 24 * H + H] as const;
    const ts = [
      ...[0, 1, 2].map((k) => tr(...at(k), -10, { riskUsd: null, r: null, stopClass: null })),
      ...[3, 4, 5].map((k) => tr(...at(k), -20, { stopClass: "widened" })),
      ...[6, 7, 8].map((k) => tr(...at(k), -30, { rulesFollowed: k === 6 ? "no" : "partial" })),
      ...[9, 10, 11].map((k) => tr(...at(k), -40, { grade: k === 9 ? "C" : "D" })),
      ...[12, 13, 14].map((k) => tr(...at(k), 100)),
    ];
    const list = insights(ts, ts, TZ).list;
    expect(list.map((i) => [i.id, i.n, i.impact])).toEqual(
      expect.arrayContaining([
        ["low-grade", 3, -120],
        ["rules-broken", 3, -90],
        ["widened", 3, -60],
        ["no-stop", 3, -30],
      ]),
    );
    // ranked worst first
    const ranked = list.map((i) => i.impact);
    expect(ranked).toEqual([...ranked].sort((a, b) => a - b));
    // R only from trades with a stop
    expect(get(list, "no-stop")!.totalR).toBeNull();
    expect(get(list, "widened")!.totalR).toBe(3);
  });

  test("hides patterns that made money or have fewer than MIN_TRADES trades", () => {
    const at = (k: number) => [D0 + k * 24 * H, D0 + k * 24 * H + H] as const;
    const ts = [
      ...Array.from({ length: MIN_TRADES - 1 }, (_, k) => tr(...at(k), -1000, { riskUsd: null, r: null, stopClass: null })),
      ...[5, 6, 7].map((k) => tr(...at(k), 50, { grade: "D" })),
    ];
    const list = insights(ts, ts, TZ).list;
    expect(get(list, "no-stop")).toBeUndefined();
    expect(get(list, "low-grade")).toBeUndefined();
  });

  test("only trades in the period are judged; sequences use the full history", () => {
    const loss = tr(D0, D0 + H, -100);
    const ts = [loss, ...[0, 1, 2].map((k) => tr(D0 + H + k * 24 * H + 60_000, D0 + 2 * H + k * 24 * H, -10))];
    // only the first follow-up is within 30 min of the loss
    const r = insights(ts.slice(1), ts, TZ).list.find((i) => i.id === "revenge");
    expect(r).toBeUndefined(); // 1 trade < MIN_TRADES
    const many = [loss, tr(D0 + H + 60_000, D0 + H + 2 * 60_000, -10), tr(D0 + H + 3 * 60_000, D0 + H + 4 * 60_000, -10), tr(D0 + H + 5 * 60_000, D0 + H + 6 * 60_000, -10)];
    const rv = get(insights(many.slice(1), many, TZ).list, "revenge")!;
    expect(rv.ids).not.toContain(loss.id);
    expect(rv.n).toBe(3);
  });
});
