import { describe, expect, it } from "vitest";
import { periodPhrase } from "@/lib/dashboard-params";

describe("periodPhrase", () => {
  it("words for presets, no middle dots or arrows", () => {
    expect(periodPhrase({ period: "30d" })).toBe("30 days");
    expect(periodPhrase({ period: "all" })).toBe("all time");
    expect(periodPhrase({ period: "start" })).toBe("since start");
  });
  it("custom ranges read 'from to to', open-ended to now", () => {
    expect(periodPhrase({ period: "custom", from: "2026-09-01", to: "2026-09-30" })).toBe(
      "2026-09-01 to 2026-09-30",
    );
    expect(periodPhrase({ period: "custom", from: "2026-09-01" })).toBe("2026-09-01 to now");
  });
});
