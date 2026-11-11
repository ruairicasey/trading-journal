import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtR, fmtSignedUsd } from "@/lib/format";
import type { CalendarMonth } from "@/lib/stats";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Background tint by magnitude, sign by hue; the signed number is always printed (never colour alone). */
function tint(v: number, max: number) {
  if (!v || !max) return undefined;
  const pct = Math.round(8 + 32 * Math.min(1, Math.abs(v) / max));
  return { backgroundColor: `color-mix(in oklch, var(${v > 0 ? "--profit" : "--loss"}) ${pct}%, transparent)` };
}

export function PnlCalendar({
  cal,
  unit,
  prevHref,
  nextHref,
}: {
  cal: CalendarMonth;
  unit: "usd" | "r";
  prevHref: string;
  nextHref: string;
}) {
  const r = unit === "r";
  const val = (net: number, rv: number) => (r ? rv : net);
  const fmt = (v: number) => (r ? fmtR(v) : fmtSignedUsd(v, Math.abs(v) >= 1000 ? 0 : 2));
  const max = r ? cal.maxAbsR : cal.maxAbs;
  const title = new Date(Date.UTC(cal.year, cal.month - 1, 15)).toLocaleString("en-AU", { month: "long", year: "numeric", timeZone: "UTC" });
  const monthTotal = val(cal.net, cal.r);

  return (
    <section className="rounded-lg border p-4" aria-label="P&L calendar" data-testid="pnl-calendar">
      <header className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-medium">P&L calendar</h2>
        <div className="flex items-center">
          <Link href={prevHref} aria-label="Previous month" className="hover:bg-muted rounded p-1">
            <ChevronLeft className="size-4" />
          </Link>
          <span className="w-32 text-center text-sm tabular-nums" data-testid="calendar-month">
            {title}
          </span>
          <Link href={nextHref} aria-label="Next month" className="hover:bg-muted rounded p-1">
            <ChevronRight className="size-4" />
          </Link>
        </div>
        <div className="flex-1" />
        <span className="text-muted-foreground text-xs tabular-nums">
          {cal.count} trade{cal.count === 1 ? "" : "s"} ·{" "}
          <span className={cn(!r && "money", monthTotal > 0 ? "text-profit" : monthTotal < 0 ? "text-loss" : "")}>{fmt(monthTotal)}</span>
        </span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] table-fixed border-separate border-spacing-1 text-xs">
          <thead>
            <tr className="text-muted-foreground">
              {DOW.map((d) => (
                <th key={d} className="pb-1 text-left font-normal">
                  {d}
                </th>
              ))}
              <th className="w-24 pb-1 text-right font-normal">Week</th>
            </tr>
          </thead>
          <tbody>
            {cal.weeks.map((w) => {
              const wv = val(w.net, w.r);
              return (
                <tr key={w.days[0].date}>
                  {w.days.map((d) => {
                    const v = val(d.net, d.r);
                    const has = d.inMonth && d.count > 0;
                    const showR = r && d.rCount === 0;
                    const body = (
                      <>
                        <span className="text-muted-foreground">{d.day}</span>
                        {has && (
                          <>
                            <span className={cn("block font-medium tabular-nums", !r && "money")}>{showR ? "—" : fmt(v)}</span>
                            <span className="text-muted-foreground block text-[10px]">
                              {d.count} trade{d.count === 1 ? "" : "s"}
                            </span>
                          </>
                        )}
                      </>
                    );
                    return (
                      <td key={d.date} className="p-0 align-top">
                        {has ? (
                          <Link
                            href={`/trades?tab=closed&from=${d.date}&to=${d.date}&dateBy=exit`}
                            className="hover:ring-foreground/30 block h-16 rounded-md border p-1.5 hover:ring-1"
                            style={tint(v, max)}
                            title={`${d.date}: ${d.count} trade${d.count === 1 ? "" : "s"}`}
                            data-testid="calendar-day"
                          >
                            {body}
                          </Link>
                        ) : (
                          <div className={cn("h-16 rounded-md border p-1.5", !d.inMonth && "border-transparent opacity-30")}>{body}</div>
                        )}
                      </td>
                    );
                  })}
                  <td className="p-0 align-top">
                    <div className="bg-muted/30 flex h-16 flex-col items-end justify-center rounded-md px-2" data-testid="calendar-week-total">
                      <span className={cn("font-medium tabular-nums", !r && "money", wv > 0 ? "text-profit" : wv < 0 ? "text-loss" : "text-muted-foreground")}>
                        {w.count ? fmt(wv) : "—"}
                      </span>
                      <span className="text-muted-foreground text-[10px]">{w.count} trades</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
