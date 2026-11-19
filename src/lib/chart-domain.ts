/**
 * The balance chart's y-axis. It is scaled to the balance (or equity) line; net deposits are drawn only when every
 * deposit value already fits that range. Otherwise they sit behind a toggle, and turning it on widens the axis.
 */
export type BalanceDomain = {
  domain: [number, number];
  /** some deposit values exist */
  hasDeposits: boolean;
  /** all deposit values fit the balance's range, so the line is drawn without asking */
  depositsInRange: boolean;
  /** draw the dashed net-deposits line */
  drawDeposits: boolean;
};

const pad = (lo: number, hi: number): [number, number] => {
  const p = Math.max((hi - lo) * 0.06, Math.abs(hi) * 0.01, 1);
  return [lo - p, hi + p];
};

export function balanceDomain(values: number[], deposits: number[], showDeposits: boolean): BalanceDomain {
  if (values.length === 0)
    return { domain: [0, 1], hasDeposits: false, depositsInRange: false, drawDeposits: false };
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const hasDeposits = deposits.length > 0;
  const depositsInRange = hasDeposits && deposits.every((d) => d >= lo && d <= hi);
  const drawDeposits = hasDeposits && (depositsInRange || showDeposits);
  const domain =
    drawDeposits && !depositsInRange
      ? pad(Math.min(lo, ...deposits), Math.max(hi, ...deposits))
      : pad(lo, hi);
  return { domain, hasDeposits, depositsInRange, drawDeposits };
}
