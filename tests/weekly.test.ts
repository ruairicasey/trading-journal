import { describe, expect, test } from "vitest";
import { weekOf, weekScore } from "@/lib/weekly";
import type { ClosedTrade } from "@/lib/stats";

const TZ = "Australia/Melbourne";

describe("weeks (Monday-first, account timezone)", () => {
  test("any day maps to its Monday; prev/next; no next for the current week", () => {
    const now = Date.UTC(2026, 10, 18, 3); // Wed 18 Nov 2026, 14:00 Melbourne
    const w = weekOf("2026-11-15", now, TZ); // a Sunday
    expect(w).toMatchObject({ monday: "2026-11-09", sunday: "2026-11-15", prev: "2026-11-02", next: "2026-11-16", isCurrent: false });
    expect(w.end - w.start).toBe(7 * 86_400_000);
    const cur = weekOf(undefined, now, TZ);
    expect(cur).toMatchObject({ monday: "2026-11-16", next: null, isCurrent: true });
  });

  test("Monday 00:00 is local time, and a DST week is 167 or 169 hours long", () => {
    const now = Date.UTC(2026, 11, 1);
    // Melbourne DST starts Sun 4 Oct 2026 (clocks forward) and ends Sun 5 Apr 2026 (clocks back)
    const spring = weekOf("2026-10-01", now, TZ);
    expect(spring.monday).toBe("2026-09-28");
    expect((spring.end - spring.start) / 3_600_000).toBe(167);
    const autumn = weekOf("2026-04-01", now, TZ);
    expect((autumn.end - autumn.start) / 3_600_000).toBe(169);
    // a trade at 23:30 local Sunday belongs to that week, 00:30 Monday to the next
    const sunLate = Date.UTC(2026, 10, 15, 12, 30); // 23:30 Sun 15 Nov (UTC+11)
    const w = weekOf("2026-11-10", now, TZ);
    expect(sunLate >= w.start && sunLate < w.end).toBe(true);
    expect(sunLate + 3_600_000 >= w.end).toBe(true);
  });
});

describe("weekly scorecard", () => {
  const now = Date.UTC(2026, 10, 30);
  const w = weekOf("2026-11-09", now, TZ);
  const at = (day: number, h: number) => w.start + day * 86_400_000 + h * 3_600_000;
  const t = (id: string, exit: number, net: number, r: number | null = null): ClosedTrade => ({
    id,
    displayPair: "BTC/USD",
    direction: "long",
    netPnl: net,
    fees: 1,
    notionalUsd: 10_000,
    entryTime: exit - 3_600_000,
    exitTime: exit,
    r,
  });

  test("best/worst day and trade, KPIs only for trades exited this week", () => {
    const s = weekScore(
      [t("a", at(0, 10), 100, 1), t("b", at(0, 12), -40, -0.5), t("c", at(2, 9), -120, -1.2), t("d", at(4, 9), 300, 2), t("x", at(7, 1), 999)],
      w,
      TZ,
    );
    expect(s.kpis.count).toBe(4);
    expect(s.kpis.net).toBe(240);
    expect(s.bestDay).toEqual({ date: "2026-11-13", net: 300 });
    expect(s.worstDay).toEqual({ date: "2026-11-11", net: -120 });
    expect(s.bestTrade?.id).toBe("d");
    expect(s.worstTrade?.id).toBe("c");
    expect(s.days.map((d) => d.count)).toEqual([2, 0, 1, 0, 1, 0, 0]);
  });

  test("an empty week", () => {
    const s = weekScore([], w, TZ);
    expect(s).toMatchObject({ bestDay: null, worstDay: null, bestTrade: null, worstTrade: null });
    expect(s.kpis.count).toBe(0);
  });
});
