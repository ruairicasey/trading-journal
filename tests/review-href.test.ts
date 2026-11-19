import { describe, expect, it } from "vitest";
import { reviewHref } from "@/server/trades/filters";

describe("reviewHref", () => {
  it("is the Trades filters, always closed and unreviewed, on /review", () => {
    const href = reviewHref({ from: "2026-11-16", to: "2026-11-22", dateBy: "exit" });
    expect(href.startsWith("/review?")).toBe(true);
    const q = new URLSearchParams(href.split("?")[1]);
    expect(Object.fromEntries(q)).toEqual({
      from: "2026-11-16",
      to: "2026-11-22",
      dateBy: "exit",
      tab: "closed",
      missing: "review",
    });
  });
  it("keeps other filters and overrides tab and missing", () => {
    const q = new URLSearchParams(reviewHref({ tab: "open", missing: "stop", period: "all" }).split("?")[1]);
    expect(q.get("tab")).toBe("closed");
    expect(q.get("missing")).toBe("review");
    expect(q.get("period")).toBe("all");
  });
});
