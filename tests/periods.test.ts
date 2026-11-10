import { describe, expect, test } from "vitest";
import { dayBoundsLocal, localDateKey, periodRange } from "@/lib/periods";

const TZ = "Australia/Melbourne";

describe("periods in the account timezone", () => {
  test("weeks start Monday 00:00 local", () => {
    // Wed 11 Nov 2026 10:00 AEDT = 10 Nov 23:00 UTC
    const now = Date.parse("2026-11-10T23:00:00Z");
    expect(new Date(periodRange("week", now, TZ).from!).toISOString()).toBe("2026-11-08T13:00:00.000Z"); // Mon 9 Nov 00:00 AEDT
    expect(new Date(periodRange("month", now, TZ).from!).toISOString()).toBe("2026-10-31T13:00:00.000Z"); // 1 Nov 00:00 AEDT
    expect(new Date(periodRange("year", now, TZ).from!).toISOString()).toBe("2025-12-31T13:00:00.000Z");
    expect(periodRange("all", now, TZ)).toEqual({ from: null, to: null });
    expect(periodRange("7d", now, TZ).from).toBe(now - 7 * 86_400_000);
  });

  test("day bounds survive the DST switch (23-hour day)", () => {
    const b = dayBoundsLocal("2026-10-04", TZ)!;
    expect(new Date(b.start).toISOString()).toBe("2026-10-03T14:00:00.000Z");
    expect(new Date(b.end).toISOString()).toBe("2026-10-04T13:00:00.000Z");
    expect((b.end - b.start) / 3_600_000).toBe(23);
    expect(dayBoundsLocal("nope", TZ)).toBeNull();
    expect(localDateKey(Date.parse("2026-10-04T12:59:00Z"), TZ)).toBe("2026-10-04");
    expect(localDateKey(Date.parse("2026-10-04T13:00:00Z"), TZ)).toBe("2026-10-05");
  });
});
