import { describe, expect, it } from "vitest";
import { balanceDomain } from "@/lib/chart-domain";

describe("balanceDomain", () => {
  it("scales to the balance and hides deposits far above it (the squashed-chart case)", () => {
    const d = balanceDomain([12_000, 11_000, 12_500], [83_000, 83_000], false);
    expect(d.drawDeposits).toBe(false);
    expect(d.hasDeposits).toBe(true);
    expect(d.domain[0]).toBeGreaterThan(10_000);
    expect(d.domain[1]).toBeLessThan(13_500);
  });
  it("the toggle draws deposits and widens the axis to fit them", () => {
    const d = balanceDomain([12_000, 11_000], [83_000], true);
    expect(d.drawDeposits).toBe(true);
    expect(d.domain[1]).toBeGreaterThan(83_000);
    expect(d.domain[0]).toBeLessThan(11_000);
  });
  it("draws deposits without asking when all of them fit the balance's range", () => {
    const d = balanceDomain([20_000, 30_000], [25_000, 26_000], false);
    expect(d.depositsInRange).toBe(true);
    expect(d.drawDeposits).toBe(true);
    expect(d.domain[1]).toBeLessThan(31_000);
  });
  it("deposits partly in range stay behind the toggle", () => {
    const d = balanceDomain([20_000, 30_000], [25_000, 40_000], false);
    expect(d.depositsInRange).toBe(false);
    expect(d.drawDeposits).toBe(false);
  });
  it("no deposit values: nothing to toggle", () => {
    const d = balanceDomain([1, 2], [], true);
    expect(d.hasDeposits).toBe(false);
    expect(d.drawDeposits).toBe(false);
  });
  it("a single point or equal values still get a non-empty axis; negatives are fine", () => {
    for (const v of [[500], [500, 500], [-300, -200]]) {
      const [lo, hi] = balanceDomain(v, [], false).domain;
      expect(hi).toBeGreaterThan(lo);
      expect(lo).toBeLessThanOrEqual(Math.min(...v));
      expect(hi).toBeGreaterThanOrEqual(Math.max(...v));
    }
  });
});
