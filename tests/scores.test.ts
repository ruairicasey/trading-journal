import { describe, expect, test } from "vitest";
import { scores } from "@/lib/analytics/scores";
import { atr, A_T0 } from "./fixtures/analytics";

const TZ = "UTC";
const H = 3_600_000;
const D = 24 * H;
/** one trade a day at noon, so no revenge / tilt / overtrading unless a test builds it */
const day = (k: number, net: number, o: Parameters<typeof atr>[1] = {}) =>
  atr(net, { entryTime: A_T0 + k * D, exitTime: A_T0 + k * D + H, ...o });

describe("scores", () => {
  test("discipline: average share of the five checks", () => {
    const ts = [
      day(0, 50, { riskUsd: 100, stopClass: "never_moved" }), // 5/5
      day(1, 50, { riskUsd: 100, stopClass: "widened" }), // 4/5
      day(2, 50), // no stop: 4/5 (not widened either)
      day(3, 50, { riskUsd: 100, stopClass: "trailed" }), // 5/5
    ];
    const s = scores(ts, ts, TZ);
    expect(s.discipline.checks.stop).toEqual({ passed: 3, of: 4 });
    expect(s.discipline.checks["not-widened"]).toEqual({ passed: 3, of: 4 });
    expect(s.discipline.checks["not-revenge"].passed).toBe(4);
    expect(s.discipline.score).toBeCloseTo((18 / 20) * 100);
  });

  test("discipline counts the Insights habits: revenge, tilt and overtrading", () => {
    const m = 60_000;
    // three losses in the morning, then a 4th entry 10 minutes after the 3rd loss: revenge + tilt + overtrading
    const ts = [0, 1, 2].map((k) =>
      atr(-50, {
        entryTime: A_T0 + k * H,
        exitTime: A_T0 + k * H + 30 * m,
        riskUsd: 100,
        stopClass: "never_moved",
      }),
    );
    ts.push(
      atr(-10, {
        entryTime: A_T0 + 2 * H + 40 * m,
        exitTime: A_T0 + 3 * H + 30 * m,
        riskUsd: 100,
        stopClass: "never_moved",
      }),
    );
    const s = scores(ts, ts, TZ);
    expect(s.discipline.checks["not-revenge"].passed).toBe(3);
    expect(s.discipline.checks["not-tilt"].passed).toBe(3);
    expect(s.discipline.checks["not-overtrading"].passed).toBe(3);
    expect(s.discipline.score).toBeCloseTo((17 / 20) * 100);
  });

  test("review coverage and its parts", () => {
    const ts = [
      day(0, 1, { reviewed: true, hasExitReason: true, hasEmotions: true, processCompliant: true }),
      day(1, 1, { reviewed: true }),
      day(2, 1),
      day(3, 1),
    ];
    const s = scores(ts, ts, TZ);
    expect(s.coverage).toEqual({ score: 50, reviewed: 2, exitReason: 1, process: 1, emotions: 1 });
  });

  test("compliance: yes 1, partial ½, no 0 and process yes/no, over marked trades only", () => {
    const ts = [
      day(0, 1, { rulesFollowed: "yes", processCompliant: true }),
      day(1, 1, { rulesFollowed: "partial", processCompliant: false }),
      day(2, 1, { rulesFollowed: "no" }),
      day(3, 1), // unmarked: ignored
    ];
    const s = scores(ts, ts, TZ);
    expect(s.compliance.rulesMarked).toBe(3);
    expect(s.compliance.rulesScore).toBeCloseTo(50);
    expect(s.compliance.processScore).toBe(50);
    expect(s.compliance.score).toBeCloseTo(((1.5 + 1) / 5) * 100);
    expect(scores([day(9, 1)], [day(9, 1)], TZ).compliance.score).toBeNull();
  });

  test("mistake cost: tagged trades once in the total, every mistake gets its own total", () => {
    const fomo = { id: "m1", label: "FOMO" };
    const size = { id: "m2", label: "Oversized" };
    const ts = [
      day(0, -100, { mistakes: [fomo, size] }),
      day(1, -40, { mistakes: [fomo] }),
      day(2, 30, { mistakes: [size] }),
      day(3, -500),
    ];
    const s = scores(ts, ts, TZ);
    expect(s.mistakes.cost).toBe(-110);
    expect(s.mistakes.n).toBe(3);
    expect(s.mistakes.top).toEqual([
      { id: "m1", label: "FOMO", n: 2, net: -140 },
      { id: "m2", label: "Oversized", n: 2, net: -70 },
    ]);
  });

  test("only trades in the period are scored, but sequences use all of them", () => {
    const m = 60_000;
    const before = [0, 1, 2].map((k) =>
      atr(-50, { entryTime: A_T0 + k * H, exitTime: A_T0 + k * H + 30 * m }),
    );
    const t = atr(20, { entryTime: A_T0 + 5 * H, exitTime: A_T0 + 6 * H, reviewed: true });
    const s = scores([t], [...before, t], TZ);
    expect(s.n).toBe(1);
    expect(s.discipline.checks["not-tilt"].passed).toBe(0);
    expect(s.coverage.score).toBe(100);
  });
});
