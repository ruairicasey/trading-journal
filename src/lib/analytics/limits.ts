/**
 * Risk rules: per-account daily limits (Settings → Accounts). Pure: no DB, no I/O.
 *
 * Days are local (your timezone), midnight to midnight, and a trade belongs to the day it was OPENED. A trade breaks
 * a rule when, at the moment you opened it, that day already had:
 * - loss: realised net from trades exited that day (at or before the entry) at or below −dailyLossLimit;
 * - trades: maxTradesPerDay entries before it (so it's entry number max + 1 or later);
 * - streak: maxLossStreak or more losses in a row among that day's exits (breakevens neither extend nor break a run).
 * Like Insights, only what you had SEEN at entry counts, never the trade itself.
 */
import { localDateKey } from "../periods";
import { outcomeOf } from "../outcome";
import type { ClosedTrade } from "../stats";

export type RiskLimits = {
  dailyLossLimit: number | null;
  maxTradesPerDay: number | null;
  maxLossStreak: number | null;
};
export type LimitRule = "loss" | "trades" | "streak";

/**
 * The rules plus what to judge them over. Rules are per ACCOUNT, so `context` is every closed trade of the account
 * (any wallet) and a wallet filter can't hide a breach; `open` adds the open trades' entries to each day's count.
 * Without them, limitBreaches falls back to the context it is given.
 */
export type LimitScope = RiskLimits & {
  context?: T[];
  open?: { id: string; entryTime: number | null }[];
};

const on = (x: number | null): x is number => x !== null && Number.isFinite(x) && x > 0;
/** money compared in cents: 0.70 + 0.10 is a 0.80 loss, not −0.7999… */
const cents = (x: number) => Math.round(x * 100);
const reached = (net: number, limit: number) => cents(net) <= -cents(limit);
export function limitsSet(l: RiskLimits | null | undefined): l is RiskLimits {
  return !!l && (on(l.dailyLossLimit) || on(l.maxTradesPerDay) || on(l.maxLossStreak));
}

type T = Pick<ClosedTrade, "id" | "netPnl" | "notionalUsd" | "entryTime" | "exitTime">;

/** What a day looked like just before `at`: realised net, losses in a row, from that day's exits only. */
function daySoFar(exits: T[], at: number, selfId: string | null) {
  let net = 0;
  let run = 0;
  for (const x of exits) {
    if (x.exitTime > at) break;
    if (x.id === selfId) continue;
    net += x.netPnl;
    const o = outcomeOf(x.netPnl, x.notionalUsd);
    if (o === "loss") run++;
    else if (o === "win") run = 0;
  }
  return { net, run };
}

function exitsByDay(context: T[], tz: string) {
  const by = new Map<string, T[]>();
  for (const x of [...context].sort((a, b) => a.exitTime - b.exitTime || a.id.localeCompare(b.id))) {
    const d = localDateKey(x.exitTime, tz);
    by.set(d, [...(by.get(d) ?? []), x]);
  }
  return by;
}

/**
 * The trades in `period` that broke a rule, per rule and in total, judged over `context` (every closed trade, a
 * superset of `period`, so a day that started before the period still counts).
 */
export function limitBreaches(period: T[], context: T[], tz: string, limits: LimitScope | null | undefined) {
  const out: Record<LimitRule, Set<string>> & { any: Set<string> } = {
    loss: new Set(),
    trades: new Set(),
    streak: new Set(),
    any: new Set(),
  };
  if (!limitsSet(limits)) return out;
  const ctx = limits.context ?? context;
  const exits = exitsByDay(ctx, tz);
  // entry number within the day, over all trades, open ones included
  const nth = new Map<string, number>();
  const perDay = new Map<string, number>();
  const entries: { id: string; entryTime: number | null }[] = [...ctx, ...(limits.open ?? [])];
  for (const t of entries
    .filter((x) => x.entryTime !== null)
    .sort((a, b) => a.entryTime! - b.entryTime! || a.id.localeCompare(b.id))) {
    const d = localDateKey(t.entryTime!, tz);
    perDay.set(d, (perDay.get(d) ?? 0) + 1);
    nth.set(t.id, perDay.get(d)!);
  }
  for (const t of period) {
    if (t.entryTime === null) continue;
    const day = daySoFar(exits.get(localDateKey(t.entryTime, tz)) ?? [], t.entryTime, t.id);
    if (on(limits.dailyLossLimit) && reached(day.net, limits.dailyLossLimit)) out.loss.add(t.id);
    if (on(limits.maxTradesPerDay) && (nth.get(t.id) ?? 0) > limits.maxTradesPerDay) out.trades.add(t.id);
    if (on(limits.maxLossStreak) && day.run >= limits.maxLossStreak) out.streak.add(t.id);
  }
  for (const r of ["loss", "trades", "streak"] as const) for (const id of out[r]) out.any.add(id);
  return out;
}

export type LimitState = "ok" | "near" | "hit";
export type TodayLimits = {
  day: string;
  /** realised net of trades closed today */
  net: number;
  /** trades opened today, closed or still open */
  trades: number;
  /** losses in a row among today's exits */
  streak: number;
  loss: { limit: number; used: number; state: LimitState } | null;
  count: { limit: number; state: LimitState } | null;
  run: { limit: number; state: LimitState } | null;
  /** the worst of the three */
  state: LimitState;
};

/**
 * Where today stands against the rules. Near: 75% of the loss limit, or one trade / one loss away. Hit: the next
 * trade today would break a rule.
 */
export function todayLimits(
  closed: T[],
  openEntries: (number | null)[],
  tz: string,
  limits: RiskLimits,
  now = Date.now(),
): TodayLimits {
  const day = localDateKey(now, tz);
  const todays = exitsByDay(closed, tz).get(day) ?? [];
  const { net, run } = daySoFar(todays, now, null);
  const trades =
    closed.filter((t) => t.entryTime !== null && localDateKey(t.entryTime, tz) === day).length +
    openEntries.filter((e) => e !== null && localDateKey(e, tz) === day).length;
  const loss = on(limits.dailyLossLimit)
    ? {
        limit: limits.dailyLossLimit,
        used: Math.max(0, -net) / limits.dailyLossLimit,
        state: (reached(net, limits.dailyLossLimit)
          ? "hit"
          : -cents(net) >= 0.75 * cents(limits.dailyLossLimit)
            ? "near"
            : "ok") as LimitState,
      }
    : null;
  const step = (n: number, max: number): LimitState =>
    n >= max ? "hit" : max > 1 && n === max - 1 ? "near" : "ok";
  const count = on(limits.maxTradesPerDay)
    ? { limit: limits.maxTradesPerDay, state: step(trades, limits.maxTradesPerDay) }
    : null;
  const r = on(limits.maxLossStreak)
    ? { limit: limits.maxLossStreak, state: step(run, limits.maxLossStreak) }
    : null;
  const states = [loss?.state, count?.state, r?.state];
  const state: LimitState = states.includes("hit") ? "hit" : states.includes("near") ? "near" : "ok";
  return { day, net, trades, streak: run, loss, count, run: r, state };
}
