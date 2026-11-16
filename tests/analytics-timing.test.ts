import { describe, expect, test } from "vitest";
import { holdBucket, sequenceInfo, timingBreakdowns } from "@/lib/analytics/timing";
import { atr } from "./fixtures/analytics";

const TZ = "Australia/Melbourne";
const H = 3_600_000;
const M = 60_000;
// Melbourne is UTC+11 (AEDT) in Nov 2026. Mon 9 Nov 2026 00:00 local = Sun 8 Nov 13:00 UTC.
const MON = Date.UTC(2026, 10, 8, 13);
const SESSIONS = [
  { name: "Asia", start: 0, end: 8, tz: "UTC" },
  { name: "London", start: 7, end: 13, tz: "UTC" },
  { name: "New York", start: 13, end: 21, tz: "UTC" },
];
const trade = (entry: number, hold: number, net: number, o = {}) => atr(net, { entryTime: entry, exitTime: entry + hold, ...o });

describe("timing", () => {
  test("day of week and 2-hour blocks use the entry time in the account timezone", () => {
    const trades = [
      trade(MON + 23 * H + 30 * M, H, 10), // Mon 23:30 local (still Monday, though Monday 12:30 UTC)
      trade(MON + 24 * H + 30 * M, H, -10), // Tue 00:30 local
      trade(MON + 6 * 24 * H + 9 * H, H, 5), // Sun 09:00
    ];
    const b = timingBreakdowns(trades, { tz: TZ, sessions: SESSIONS, minN: 1 });
    expect(b.weekday.buckets.map((x) => [x.label, x.n])).toEqual([
      ["Mon", 1],
      ["Tue", 1],
      ["Sun", 1],
    ]);
    expect(b.hour.buckets.map((x) => x.label)).toEqual(["00:00–02:00", "08:00–10:00", "22:00–24:00"]);
  });

  test("session: the trade's own session wins, else your session hours, else 'Outside your sessions'", () => {
    const utc = (h: number) => Date.UTC(2026, 10, 10, h);
    const trades = [trade(utc(2), H, 1), trade(utc(2), H, 1, { session: "London" }), trade(utc(14), H, 1), trade(utc(22), H, 1)];
    const b = timingBreakdowns(trades, { tz: TZ, sessions: SESSIONS, minN: 1 });
    expect(b.session.buckets.map((x) => [x.key, x.n])).toEqual([
      ["Asia", 1],
      ["London", 1],
      ["New York", 1],
      ["__none", 1],
    ]);
  });

  test("time in trade buckets and average hold of winners vs losers", () => {
    expect(holdBucket(59 * M).key).toBe("scalp");
    expect(holdBucket(H).key).toBe("intraday");
    expect(holdBucket(24 * H).key).toBe("swing");
    expect(holdBucket(80 * H).key).toBe("position");
    const b = timingBreakdowns([trade(MON, 30 * M, 100), trade(MON + 10 * H, 3 * H, 50), trade(MON + 20 * H, 10 * H, -80)], { tz: TZ, sessions: SESSIONS, minN: 1 });
    expect(b.hold.buckets.map((x) => x.key)).toEqual(["scalp", "intraday", "day"]);
    expect(b.holdWin).toBe((30 * M + 3 * H) / 2);
    expect(b.holdLoss).toBe(10 * H);
  });

  test("nth trade of the (local) day, and the gap since the previous exit (overlap when still in a trade)", () => {
    const t1 = trade(MON + 9 * H, H, 10); // 09:00–10:00
    const t2 = trade(MON + 10 * H + 5 * M, 2 * H, -10); // 5 min after t1's exit
    const t3 = trade(MON + 11 * H, H, 5); // while t2 is open
    const t4 = trade(MON + 30 * H, H, 5); // next day, 18h after t2's exit (12:05)
    const seq = sequenceInfo([t4, t2, t1, t3], TZ);
    expect([t1, t2, t3, t4].map((t) => seq.nth.get(t.id))).toEqual([1, 2, 3, 1]);
    expect(seq.gap.get(t1.id)).toBeNull();
    expect(seq.gap.get(t2.id)).toBe(5 * M);
    expect(seq.gap.get(t3.id)).toBeLessThanOrEqual(0);
    expect(seq.gap.get(t4.id)).toBe(30 * H - (12 * H + 5 * M));
    const b = timingBreakdowns([t1, t2, t3, t4], { tz: TZ, sessions: SESSIONS, minN: 1 });
    expect(b.gap.buckets.map((x) => [x.key, x.n])).toEqual([
      ["first", 1],
      ["overlap", 1],
      ["15m", 1],
      ["24h", 1],
    ]);
    // every trade is in exactly one bucket, so the widget reconciles to the trade count
    expect(b.gap.buckets.reduce((a, x) => a + x.n, 0)).toBe(4);
    expect(b["nth-of-day"].buckets.map((x) => [x.label, x.n])).toEqual([
      ["1st", 2],
      ["2nd", 1],
      ["3rd", 1],
    ]);
  });

  test("a period view still counts trades from before the period (context)", () => {
    const before = trade(MON + 9 * H, H, 10);
    const inPeriod = trade(MON + 10 * H + 10 * M, H, 10);
    const b = timingBreakdowns([inPeriod], { tz: TZ, sessions: SESSIONS, minN: 1, context: [before, inPeriod] });
    expect(b["nth-of-day"].buckets[0].label).toBe("2nd");
    expect(b.gap.buckets[0].key).toBe("15m");
  });
});

describe("sessions are anchored to their own time zone (daylight-saving safe)", () => {
  test("default New York session: 07:00 Melbourne in November (20:00 UTC = 15:00 EST) is New York, not Late Night", async () => {
    const { DEFAULT_SESSIONS, sessionFor } = await import("@/lib/sessions");
    const melb7am = Date.UTC(2026, 10, 10, 20); // Wed 11 Nov 07:00 AEDT
    expect(sessionFor(melb7am, DEFAULT_SESSIONS)).toBe("New York");
    // the same Melbourne wall-clock time in July (21:00 UTC = 17:00 EDT) is after the NY close
    expect(sessionFor(Date.UTC(2026, 6, 15, 21), DEFAULT_SESSIONS)).toBe("Late Night");
    // NY 08:00 local opens at 13:00 UTC in winter and 12:00 UTC in summer
    expect(sessionFor(Date.UTC(2026, 0, 12, 13, 0), DEFAULT_SESSIONS)).toBe("New York");
    expect(sessionFor(Date.UTC(2026, 0, 12, 12, 30), DEFAULT_SESSIONS)).toBe("London");
    expect(sessionFor(Date.UTC(2026, 6, 13, 12, 0), DEFAULT_SESSIONS)).toBe("New York");
  });

  test("the defaults cover every 30 minutes of the day, winter and summer", async () => {
    const { DEFAULT_SESSIONS, sessionFor } = await import("@/lib/sessions");
    for (const day of [Date.UTC(2026, 0, 14), Date.UTC(2026, 6, 15)])
      for (let m = 0; m < 24 * 60; m += 30) expect(sessionFor(day + m * 60_000, DEFAULT_SESSIONS)).not.toBeNull();
  });

  test("old fixed-UTC settings still work; untouched old defaults are upgraded", async () => {
    const { normalizeSessions, LEGACY_DEFAULT_SESSIONS, DEFAULT_SESSIONS, sessionFor } = await import("@/lib/sessions");
    expect(normalizeSessions(LEGACY_DEFAULT_SESSIONS)).toEqual(DEFAULT_SESSIONS);
    const custom = normalizeSessions([{ name: "Overnight", startUtc: 22, endUtc: 3 }]);
    expect(custom).toEqual([{ name: "Overnight", start: 22, end: 3, tz: "UTC" }]);
    expect(sessionFor(Date.UTC(2026, 0, 1, 23), custom)).toBe("Overnight");
    expect(normalizeSessions([{ name: "x", start: 1, end: 2, tz: "Not/AZone" }])[0].tz).toBe("UTC");
    expect(normalizeSessions(null)).toEqual(DEFAULT_SESSIONS);
  });

  test("hours shown in another zone follow daylight saving", async () => {
    const { sessionHoursIn, describeSession } = await import("@/lib/sessions");
    const ny = { name: "New York", start: 8, end: 16, tz: "America/New_York" };
    expect(describeSession(ny)).toBe("08:00–16:00 New York time");
    expect(sessionHoursIn(ny, Date.UTC(2026, 10, 16), "UTC")).toBe("13:00–21:00");
    expect(sessionHoursIn(ny, Date.UTC(2026, 6, 15), "UTC")).toBe("12:00–20:00");
    expect(sessionHoursIn(ny, Date.UTC(2026, 10, 16, 12), "Australia/Melbourne")).toBe("00:00–08:00");
  });
});
