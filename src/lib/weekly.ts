/**
 * Weekly reflection: Monday-first weeks in the account timezone, scored by EXIT time (realised P&L),
 * the same convention as the P&L calendar.
 */
import { TZDate } from "@date-fns/tz";
import { addDays, startOfWeek } from "date-fns";
import { dayBoundsLocal, localDateKey } from "./periods";
import { computeKpis, type ClosedTrade, type Kpis } from "./stats";

export type Week = {
  /** Monday, "YYYY-MM-DD" */
  monday: string;
  /** Sunday, "YYYY-MM-DD" */
  sunday: string;
  start: number;
  end: number;
  prev: string;
  /** null when the next week hasn't started yet */
  next: string | null;
  isCurrent: boolean;
  days: string[];
};

const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The week containing `date` ("YYYY-MM-DD", any day of it), or the current week. */
export function weekOf(date: string | undefined, now: number, tz: string): Week {
  const anchor = (date && dayBoundsLocal(date, tz)?.start) || now;
  const monday = startOfWeek(new TZDate(anchor, tz), { weekStartsOn: 1 });
  const nextMonday = addDays(monday, 7);
  const currentMonday = startOfWeek(new TZDate(now, tz), { weekStartsOn: 1 });
  return {
    monday: key(monday),
    sunday: key(addDays(monday, 6)),
    start: monday.getTime(),
    end: nextMonday.getTime(),
    prev: key(addDays(monday, -7)),
    next: nextMonday.getTime() <= now ? key(nextMonday) : null,
    isCurrent: monday.getTime() === currentMonday.getTime(),
    days: Array.from({ length: 7 }, (_, i) => key(addDays(monday, i))),
  };
}

export type WeekScore = {
  kpis: Kpis;
  days: { date: string; net: number; count: number }[];
  bestDay: { date: string; net: number } | null;
  worstDay: { date: string; net: number } | null;
  bestTrade: Pick<ClosedTrade, "id" | "displayPair" | "netPnl" | "r"> | null;
  worstTrade: Pick<ClosedTrade, "id" | "displayPair" | "netPnl" | "r"> | null;
};

export function weekScore(all: ClosedTrade[], week: Week, tz: string): WeekScore {
  const trades = all.filter((t) => t.exitTime >= week.start && t.exitTime < week.end);
  const byDay = new Map(week.days.map((d) => [d, { date: d, net: 0, count: 0 }]));
  for (const t of trades) {
    const d = byDay.get(localDateKey(t.exitTime, tz));
    if (d) {
      d.net += t.netPnl;
      d.count++;
    }
  }
  const days = [...byDay.values()];
  const traded = days.filter((d) => d.count > 0);
  const best = traded.reduce<(typeof days)[number] | null>((a, d) => (!a || d.net > a.net ? d : a), null);
  const worst = traded.reduce<(typeof days)[number] | null>((a, d) => (!a || d.net < a.net ? d : a), null);
  const pick = (t: ClosedTrade | null) => (t ? { id: t.id, displayPair: t.displayPair, netPnl: t.netPnl, r: t.r } : null);
  const bestTrade = trades.reduce<ClosedTrade | null>((a, t) => (!a || t.netPnl > a.netPnl ? t : a), null);
  const worstTrade = trades.reduce<ClosedTrade | null>((a, t) => (!a || t.netPnl < a.netPnl ? t : a), null);
  return {
    kpis: computeKpis(trades),
    days,
    bestDay: best && { date: best.date, net: best.net },
    // with a single traded day (or trade) "worst" would just repeat "best"
    worstDay: traded.length > 1 && worst ? { date: worst.date, net: worst.net } : null,
    bestTrade: pick(bestTrade),
    worstTrade: trades.length > 1 ? pick(worstTrade) : null,
  };
}
