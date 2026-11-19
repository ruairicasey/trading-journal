/**
 * Insights: rule-based patterns in your closed trades, ranked by what they cost you. Pure: no DB, no I/O.
 *
 * Each rule picks the trades (exited in the period) that match a pattern; its impact is their summed net P&L.
 * Only patterns that LOST money over at least MIN_TRADES trades are reported, worst first. Rules overlap (a
 * revenge trade can also be a no-stop trade), so impacts are not additive: each one answers "what did trades like
 * this make or lose", not "what would I have without them".
 *
 * Sequences (previous exit, losing run, nth trade of the day) are computed over ALL trades, so a pattern that
 * starts before the period still counts. Revenge and tilt use the results known AT ENTRY (exits at or before it),
 * so a trade held while others closed is judged by what had happened when you took it.
 */
import { TZDate } from "@date-fns/tz";
import { localDateKey } from "../periods";
import { outcomeOf } from "../outcome";
import type { AnalyticsTrade } from "./types";
import { limitBreaches, limitsSet, type LimitScope } from "./limits";

export const MIN_TRADES = 3;
/** a bucket rule (worst hour, worst day) needs this many trades in the bucket to be judged */
export const MIN_BUCKET = 5;
export const REVENGE_MS = 30 * 60_000;
export const TILT_RUN = 3;
export const OVERTRADE_NTH = 4;

export type InsightId =
  | "revenge"
  | "tilt"
  | "overtrading"
  | "worst-hour"
  | "worst-day"
  | "no-stop"
  | "widened"
  | "rules-broken"
  | "low-grade"
  | "limits";

export type Insight = {
  id: InsightId;
  title: string;
  /** one sentence: what the rule matched */
  detail: string;
  /** what to do about it */
  advice: string;
  n: number;
  /** Σ net P&L of the matching trades (negative = it cost you) */
  impact: number;
  /** of those, wins / (wins + losses) */
  winRate: number | null;
  /** Σ R over matching trades that have a stop, and how many have one */
  totalR: number | null;
  rCount: number;
  /** average net of the matching trades vs every other trade in the period */
  avg: number;
  avgOthers: number | null;
  /** the worst few matching trades, for links */
  worst: { id: string; displayPair: string; netPnl: number; exitTime: number }[];
  /** the matching ids (for counts and tests) */
  ids: string[];
};

export const INSIGHT_RULES: { id: InsightId; title: string; rule: string }[] = [
  {
    id: "revenge",
    title: "Revenge trades",
    rule: `Entered within ${REVENGE_MS / 60_000} minutes of a losing exit`,
  },
  { id: "tilt", title: "Trading on tilt", rule: `Entered after ${TILT_RUN}+ losses in a row` },
  { id: "overtrading", title: "Overtrading", rule: `Your ${OVERTRADE_NTH}th or later trade of the day` },
  {
    id: "worst-hour",
    title: "Worst time of day",
    rule: `The 2-hour entry block with the lowest net (${MIN_BUCKET}+ trades)`,
  },
  {
    id: "worst-day",
    title: "Worst day of the week",
    rule: `The entry weekday with the lowest net (${MIN_BUCKET}+ trades)`,
  },
  { id: "no-stop", title: "No stop loss", rule: "Closed trades with no stop loss" },
  { id: "widened", title: "Widened stops", rule: "You moved the stop further away" },
  { id: "rules-broken", title: "Rules broken", rule: "You marked rules followed as Partial or No" },
  { id: "low-grade", title: "C and D setups", rule: "Trades you graded C or D" },
  {
    id: "limits",
    title: "Past your limits",
    rule: "Opened after one of your risk rules (Settings → Accounts) said stop for the day",
  },
];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hh = (x: number) => String(x).padStart(2, "0");

function summarise(
  id: InsightId,
  detail: string,
  advice: string,
  matched: AnalyticsTrade[],
  period: AnalyticsTrade[],
): Insight {
  const set = new Set(matched.map((t) => t.id));
  const others = period.filter((t) => !set.has(t.id));
  let wins = 0;
  let losses = 0;
  let impact = 0;
  let totalR = 0;
  let rCount = 0;
  for (const t of matched) {
    impact += t.netPnl;
    const o = outcomeOf(t.netPnl, t.notionalUsd);
    if (o === "win") wins++;
    if (o === "loss") losses++;
    if (t.r !== null) {
      totalR += t.r;
      rCount++;
    }
  }
  const sum = (xs: AnalyticsTrade[]) => xs.reduce((a, t) => a + t.netPnl, 0);
  return {
    id,
    title: INSIGHT_RULES.find((r) => r.id === id)!.title,
    detail,
    advice,
    n: matched.length,
    impact,
    winRate: wins + losses ? wins / (wins + losses) : null,
    totalR: rCount ? totalR : null,
    rCount,
    avg: matched.length ? impact / matched.length : 0,
    avgOthers: others.length ? sum(others) / others.length : null,
    worst: [...matched]
      .sort((a, b) => a.netPnl - b.netPnl || a.id.localeCompare(b.id))
      .slice(0, 3)
      .map((t) => ({ id: t.id, displayPair: t.displayPair, netPnl: t.netPnl, exitTime: t.exitTime })),
    ids: matched.map((t) => t.id).sort(),
  };
}

/** The bucket (≥ MIN_BUCKET trades) with the lowest net, if it lost money. */
function worstBucket(period: AnalyticsTrade[], key: (t: AnalyticsTrade) => string | null) {
  const by = new Map<string, AnalyticsTrade[]>();
  for (const t of period) {
    const k = key(t);
    if (k === null) continue;
    by.set(k, [...(by.get(k) ?? []), t]);
  }
  let worst: { key: string; list: AnalyticsTrade[]; net: number } | null = null;
  for (const [k, list] of [...by.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (list.length < MIN_BUCKET) continue;
    const net = list.reduce((a, t) => a + t.netPnl, 0);
    if (!worst || net < worst.net) worst = { key: k, list, net };
  }
  return worst && worst.net < 0 ? worst : null;
}

/**
 * The sequence habits per trade in `period`, judged over `context` (all trades). Shared by Insights and Scores.
 * Revenge and tilt look at the results you had SEEN when you entered: the exits at or before the entry time (≤ so
 * a position flipped in the same millisecond counts), never the trade itself.
 */
export function habitFlags(period: AnalyticsTrade[], context: AnalyticsTrade[], tz: string) {
  const exits = [...context].sort((a, b) => a.exitTime - b.exitTime || a.id.localeCompare(b.id));
  const res = exits.map((x) => outcomeOf(x.netPnl, x.notionalUsd) ?? "be");
  // losses in a row after each exit (breakevens neither extend nor break a run; ties in the same ms go by id)
  const lossRun: number[] = [];
  let run = 0;
  for (const o of res) {
    if (o === "loss") run++;
    else if (o === "win") run = 0;
    lossRun.push(run);
  }
  /** index of the last exit at or before t's entry, excluding t itself (and anything after it in the same ms) */
  const lastSeen = (t: AnalyticsTrade) => {
    let lo = 0;
    let hi = exits.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (exits[mid].exitTime <= t.entryTime!) lo = mid + 1;
      else hi = mid;
    }
    const self = t.exitTime <= t.entryTime! ? exits.findIndex((x) => x.id === t.id) : -1;
    return self >= 0 ? Math.min(lo, self) - 1 : lo - 1;
  };
  const revenge = new Set<string>();
  const tilt = new Set<string>();
  for (const t of period) {
    if (t.entryTime === null) continue;
    const i = lastSeen(t);
    if (i < 0) continue;
    // revenge: any exit in the latest millisecond before the entry lost (one fill can close several trades at once)
    const ms = exits[i].exitTime;
    let lost = false;
    for (let k = i; k >= 0 && exits[k].exitTime === ms; k--)
      if (res[k] === "loss" && exits[k].id !== t.id) lost = true;
    if (lost && t.entryTime - ms < REVENGE_MS) revenge.add(t.id);
    if (lossRun[i] >= TILT_RUN) tilt.add(t.id);
  }
  // nth trade of the entry day (local), over all trades
  const byEntry = context
    .filter((t) => t.entryTime !== null)
    .sort((a, b) => a.entryTime! - b.entryTime! || a.id.localeCompare(b.id));
  const nth = new Map<string, number>();
  const perDay = new Map<string, number>();
  for (const t of byEntry) {
    const d = localDateKey(t.entryTime!, tz);
    perDay.set(d, (perDay.get(d) ?? 0) + 1);
    nth.set(t.id, perDay.get(d)!);
  }
  return {
    revenge,
    tilt,
    nth,
    overtrading: new Set(period.filter((t) => (nth.get(t.id) ?? 0) >= OVERTRADE_NTH).map((t) => t.id)),
  };
}

/**
 * @param period trades exited in the selected period (what is judged)
 * @param context every closed trade (for sequences), a superset of `period`
 */
export function insights(
  period: AnalyticsTrade[],
  context: AnalyticsTrade[],
  tz: string,
  /** the account's risk rules; "Past your limits" runs only when one is set */
  limits?: LimitScope | null,
): { list: Insight[]; checked: number } {
  const all: Insight[] = [];
  const add = (i: Insight | null) => i && all.push(i);
  const pick = (fn: (t: AnalyticsTrade) => boolean) => period.filter(fn);

  const { revenge, tilt, overtrading } = habitFlags(period, context, tz);
  add(
    summarise(
      "revenge",
      `Entered within ${REVENGE_MS / 60_000} minutes of closing a loser.`,
      "After a loss, step away for half an hour before the next entry.",
      pick((t) => revenge.has(t.id)),
      period,
    ),
  );
  add(
    summarise(
      "tilt",
      `Entered after ${TILT_RUN} or more losses in a row.`,
      `Stop for the day after ${TILT_RUN} straight losses.`,
      pick((t) => tilt.has(t.id)),
      period,
    ),
  );

  add(
    summarise(
      "overtrading",
      `Your ${OVERTRADE_NTH}th or later entry of the day.`,
      `Cap yourself at ${OVERTRADE_NTH - 1} trades a day.`,
      pick((t) => overtrading.has(t.id)),
      period,
    ),
  );

  const hour = worstBucket(period, (t) =>
    t.entryTime === null ? null : hh(Math.floor(new TZDate(t.entryTime, tz).getHours() / 2) * 2),
  );
  if (hour) {
    const h = Number(hour.key);
    add(
      summarise(
        "worst-hour",
        `Entries between ${hh(h)}:00 and ${hh(h + 2)}:00 (${tz}).`,
        "Skip this window, or trade it smaller.",
        hour.list,
        period,
      ),
    );
  }
  const day = worstBucket(period, (t) =>
    t.entryTime === null ? null : String((new TZDate(t.entryTime, tz).getDay() + 6) % 7),
  );
  if (day)
    add(
      summarise(
        "worst-day",
        `Entries on ${DAYS[Number(day.key)]}s (${tz}).`,
        "Review what goes wrong on this day, or sit it out.",
        day.list,
        period,
      ),
    );

  add(
    summarise(
      "no-stop",
      "Closed with no stop loss set.",
      "Put a stop on every trade before entry.",
      pick((t) => t.riskUsd === null),
      period,
    ),
  );
  add(
    summarise(
      "widened",
      "You moved the stop further from entry.",
      "Never widen a stop; take the loss you planned.",
      pick((t) => t.stopClass === "widened"),
      period,
    ),
  );
  add(
    summarise(
      "rules-broken",
      "Marked rules followed: Partial or No.",
      "Only take trades that pass your checklist.",
      pick((t) => t.rulesFollowed === "partial" || t.rulesFollowed === "no"),
      period,
    ),
  );
  add(
    summarise(
      "low-grade",
      "Setups you graded C or D.",
      "Pass on C and D setups, or size them down.",
      pick((t) => t.grade === "C" || t.grade === "D"),
      period,
    ),
  );

  if (limitsSet(limits)) {
    const b = limitBreaches(period, context, tz, limits);
    const when = [
      // no amount here: the detail is plain text, so it wouldn't blur in privacy mode
      limits.dailyLossLimit ? "the day's realised loss had reached your limit" : null,
      limits.maxTradesPerDay ? `you had already taken ${limits.maxTradesPerDay} trades` : null,
      limits.maxLossStreak ? `you had lost ${limits.maxLossStreak} in a row` : null,
    ].filter(Boolean);
    add(
      summarise(
        "limits",
        `Opened when ${when.join(", or ")} that day.`,
        "When a rule says stop, close the platform for the day.",
        pick((t) => b.any.has(t.id)),
        period,
      ),
    );
  }

  const list = all
    .filter((i) => i.n >= MIN_TRADES && i.impact < 0)
    .sort((a, b) => a.impact - b.impact || a.id.localeCompare(b.id));
  return { list, checked: all.length };
}
