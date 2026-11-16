import { outcomeOf } from "../outcome";
import { DEFAULT_MIN_N, type Bucket } from "./types";
import type { ClosedTrade } from "../stats";

type Key = { key: string; label: string };

/**
 * Group trades into buckets. `keys` returns zero, one or several keys per trade (a trade with 3 confluences
 * counts in 3 buckets). `order` fixes the bucket order (e.g. grades A+…D); otherwise sorted by n, then label.
 */
export function groupBy<T extends ClosedTrade>(
  trades: T[],
  keys: (t: T) => Key[] | Key | null,
  opts: { minN?: number; order?: string[]; keepEmpty?: Key[] } = {},
): Bucket[] {
  const minN = opts.minN ?? DEFAULT_MIN_N;
  const acc = new Map<string, { label: string; list: T[] }>();
  for (const k of opts.keepEmpty ?? []) acc.set(k.key, { label: k.label, list: [] });
  for (const t of trades) {
    const ks = keys(t);
    for (const k of ks === null ? [] : Array.isArray(ks) ? ks : [ks]) {
      const b = acc.get(k.key) ?? { label: k.label, list: [] };
      b.list.push(t);
      acc.set(k.key, b);
    }
  }
  const buckets = [...acc.entries()].map(([key, { label, list }]) => bucketOf(key, label, list, minN));
  if (opts.order) {
    const pos = (k: string) => {
      const i = opts.order!.indexOf(k);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return buckets.sort((a, b) => pos(a.key) - pos(b.key) || a.label.localeCompare(b.label));
  }
  return buckets.sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}

export function bucketOf(key: string, label: string, list: ClosedTrade[], minN = DEFAULT_MIN_N): Bucket {
  let wins = 0;
  let losses = 0;
  let be = 0;
  let net = 0;
  let rSum = 0;
  let rCount = 0;
  for (const t of list) {
    net += t.netPnl;
    const o = outcomeOf(t.netPnl, t.notionalUsd);
    if (o === "win") wins++;
    else if (o === "loss") losses++;
    else be++;
    if (t.r !== null && Number.isFinite(t.r)) {
      rSum += t.r;
      rCount++;
    }
  }
  const n = list.length;
  return {
    key,
    label,
    n,
    wins,
    losses,
    breakeven: be,
    winRate: wins + losses ? wins / (wins + losses) : null,
    net,
    avgTrade: n ? net / n : null,
    rCount,
    avgR: rCount ? rSum / rCount : null,
    totalR: rCount ? rSum : null,
    small: n < minN,
  };
}
