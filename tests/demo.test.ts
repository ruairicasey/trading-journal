import { describe, expect, test } from "vitest";
import { DEMO_ADDRESS, generateDemoHistory } from "@/server/demo/generate";
import { reconstructAll } from "@/server/reconstruct/reconstruct";
import { sessionFor } from "@/lib/sessions";
import { DEFAULT_SESSIONS } from "@/server/db/seed-data";

const END = Date.UTC(2026, 10, 9, 12);

describe("demo generator", () => {
  const a = generateDemoHistory({ end: END });

  test("is deterministic for a given seed and end time", () => {
    expect(generateDemoHistory({ end: END })).toEqual(a);
    expect(generateDemoHistory({ end: END, seed: 7 }).fills).not.toEqual(a.fills);
  });

  test("uses only placeholder addresses", () => {
    expect(DEMO_ADDRESS).toMatch(/^0x0{30}[0-9a-f]{10}$/);
    const addrs = JSON.stringify(a).match(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g) ?? [];
    for (const x of addrs) expect(x).toMatch(/^0x0{30}[0-9a-f]{10}$/i);
  });

  test("reconstructs into a realistic, clean history", () => {
    const trades = reconstructAll("w", a.fills);
    expect(trades.length).toBeGreaterThan(150);
    expect(trades.filter((t) => t.status === "open").length).toBeGreaterThanOrEqual(2);
    expect(trades.some((t) => t.externalKey.endsWith(":o"))).toBe(true); // flips
    expect(trades.some((t) => t.legs.filter((l) => l.role === "exit").length > 1)).toBe(true); // partials
    expect(trades.some((t) => t.legs.filter((l) => l.role === "entry").length > 1)).toBe(true); // scale-ins
    expect(trades.some((t) => t.marketType === "hip3")).toBe(true);
    expect(trades.some((t) => t.legs.some((l) => l.fee < 0))).toBe(true); // maker rebates
    expect(trades.every((t) => !t.flags.gap && !t.flags.partialHistory)).toBe(true);
    // every generator plan maps onto exactly one reconstructed trade
    const keys = new Set(trades.map((t) => t.externalKey));
    expect(a.plans.every((p) => keys.has(`w:${p.coin}:${p.firstTid}${p.keySuffix}`))).toBe(true);
    const closed = trades.filter((t) => t.status === "closed");
    const winRate = closed.filter((t) => t.metrics.netPnl > 0).length / closed.length;
    expect(winRate).toBeGreaterThan(0.3);
    expect(winRate).toBeLessThan(0.7);
  });
});

describe("sessionFor", () => {
  test("maps UTC hours to the default sessions", () => {
    expect(sessionFor(Date.UTC(2026, 0, 5, 3), DEFAULT_SESSIONS)).toBe("Asia");
    expect(sessionFor(Date.UTC(2026, 0, 5, 8), DEFAULT_SESSIONS)).toBe("London");
    expect(sessionFor(Date.UTC(2026, 0, 5, 14, 30), DEFAULT_SESSIONS)).toBe("New York");
    expect(sessionFor(Date.UTC(2026, 0, 5, 22), DEFAULT_SESSIONS)).toBe("Late Night");
  });

  test("handles ranges that wrap past midnight", () => {
    const s = [{ name: "Overnight", startUtc: 22, endUtc: 3 }];
    expect(sessionFor(Date.UTC(2026, 0, 5, 23), s)).toBe("Overnight");
    expect(sessionFor(Date.UTC(2026, 0, 5, 1), s)).toBe("Overnight");
    expect(sessionFor(Date.UTC(2026, 0, 5, 3), s)).toBeNull();
  });
});
