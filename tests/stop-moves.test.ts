import { describe, expect, test } from "vitest";
import { classifyStopMoves, STOP_CLASSES, type StopClass } from "@/lib/stop-moves";

const t = (n: number) => Date.UTC(2026, 9, 1) + n * 60_000;

describe("classifyStopMoves", () => {
  test("long: tighten, breakeven, trail; locked R from the initial risk", () => {
    const { moves, cls } = classifyStopMoves("long", 100, 95, [
      { time: t(1), price: 97 },
      { time: t(2), price: 100.02 }, // within 0.05% of entry
      { time: t(3), price: 104 },
    ]);
    expect(moves.map((m) => m.kind)).toEqual(["tighten", "breakeven", "trail"]);
    expect(moves.map((m) => m.lockedR)).toEqual([-0.6, expect.closeTo(0.004, 6), expect.closeTo(0.8, 9)]);
    expect(moves[0].riskPct).toBeCloseTo(3, 9);
    expect(moves[2].riskPct).toBeCloseTo(-4, 9);
    expect(cls).toBe("trailed");
  });

  test("short mirrors long", () => {
    const { moves, cls } = classifyStopMoves("short", 100, 105, [
      { time: t(1), price: 103 },
      { time: t(2), price: 106 },
    ]);
    expect(moves.map((m) => m.kind)).toEqual(["tighten", "widen"]);
    expect(moves[1].lockedR).toBeCloseTo(-1.2, 9);
    expect(cls).toBe("widened");
  });

  test("widen wins over everything else, even after a trail", () => {
    expect(classifyStopMoves("long", 100, 95, [{ time: t(1), price: 102 }, { time: t(2), price: 94 }]).cls).toBe("widened");
  });

  test("a widen judged against the previous stop, not the initial one", () => {
    // 95 → 98 (tighten) → 96 (wider than 98, still tighter than the initial 95): that is a widen
    const r = classifyStopMoves("long", 100, 95, [{ time: t(1), price: 98 }, { time: t(2), price: 96 }]);
    expect(r.moves.map((m) => m.kind)).toEqual(["tighten", "widen"]);
  });

  test("moves are taken in time order; unchanged re-placements; no moves = never moved", () => {
    const r = classifyStopMoves("long", 100, 95, [{ time: t(2), price: 97 }, { time: t(1), price: 97 }]);
    expect(r.moves.map((m) => m.kind)).toEqual(["tighten", "unchanged"]);
    expect(classifyStopMoves("long", 100, 95, []).cls).toBe("never_moved");
  });

  test("no initial stop: no R, and a first risk-side stop counts as tightening", () => {
    const r = classifyStopMoves("long", 100, null, [{ time: t(1), price: 97 }]);
    expect(r.moves[0]).toMatchObject({ kind: "tighten", lockedR: null });
    expect(r.cls).toBe("tightened");
  });

  test("loosening a stop that is already in profit is a widen, even when it lands at breakeven or still in profit", () => {
    const a = classifyStopMoves("long", 100, 95, [{ time: t(1), price: 106 }, { time: t(2), price: 102 }]);
    expect(a.moves.map((m) => m.kind)).toEqual(["trail", "widen"]);
    expect(a.moves[1].lockedR).toBeCloseTo(0.4, 9); // gave back 0.8R of locked profit
    expect(a.cls).toBe("widened");
    const b = classifyStopMoves("short", 100, 105, [{ time: t(1), price: 94 }, { time: t(2), price: 99.98 }]);
    expect(b.moves.map((m) => m.kind)).toEqual(["trail", "widen"]);
    expect(b.cls).toBe("widened");
  });

  test("moves at the same time are ordered by id, whatever order they arrive in", () => {
    const moves = [{ id: "b", time: t(1), price: 94 }, { id: "a", time: t(1), price: 97 }];
    const fwd = classifyStopMoves("long", 100, 95, moves);
    const rev = classifyStopMoves("long", 100, 95, [...moves].reverse());
    expect(fwd).toEqual(rev);
    expect(fwd.moves.map((m) => [m.price, m.kind])).toEqual([[97, "tighten"], [94, "widen"]]);
  });

  test("property: every trade gets exactly one class, and it follows the precedence of its moves' kinds", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const seen = new Set<StopClass>();
    for (let i = 0; i < 2000; i++) {
      const dir = rnd() < 0.5 ? "long" : "short";
      const sign = dir === "long" ? 1 : -1;
      const entry = 50 + rnd() * 100;
      const initial = entry - sign * entry * (0.002 + rnd() * 0.05);
      const n = Math.floor(rnd() * 5);
      const moves = Array.from({ length: n }, (_, k) => ({ time: t(k), price: entry + sign * entry * (rnd() * 0.12 - 0.06) * (rnd() < 0.1 ? 0 : 1) }));
      const { moves: out, cls } = classifyStopMoves(dir, entry, initial, moves);
      expect(STOP_CLASSES).toContain(cls);
      seen.add(cls);
      const kinds = new Set(out.map((m) => m.kind));
      const expected: StopClass = kinds.has("widen") ? "widened" : kinds.has("trail") ? "trailed" : kinds.has("breakeven") ? "breakeven" : kinds.has("tighten") ? "tightened" : "never_moved";
      expect(cls).toBe(expected);
      // a widen is exactly a move against the profit direction
      let prev = initial;
      for (const m of out) {
        expect(m.kind === "widen").toBe((m.price - prev) * sign < -Math.abs(entry) * 1e-12);
        prev = m.price;
      }
    }
    expect(seen.size).toBe(5); // the generator reaches every class
  });
});
