"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";
import { axisDateFormat, fmtR, fmtSignedUsd, fmtUsd } from "@/lib/format";
import type { DrawdownStats, UnderwaterPoint } from "@/lib/drawdown";
import { H2, SECTION } from "@/lib/ui";

// single series: the same calm accent as the equity curve (red/green stay reserved for P&L text)
const LINE = "var(--gold)";

const pct = (v: number | null | undefined, signed = true) =>
  v == null ? "—" : `${signed && v > 0 ? "+" : ""}${v.toFixed(1)}%`;

export function DrawdownCard({
  stats,
  points,
  unit,
  tz,
  periodLabel,
}: {
  stats: DrawdownStats | null;
  points: UnderwaterPoint[];
  unit: "usd" | "r";
  tz: string;
  periodLabel: string;
}) {
  const r = unit === "r";
  const dateFmt = new Intl.DateTimeFormat("en-AU", {
    timeZone: tz,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const d = (t: number | null | undefined) => (t == null ? "—" : dateFmt.format(t));
  if (!stats) {
    return (
      <section className={SECTION} aria-label="Drawdown">
        <h2 className={H2}>Drawdown</h2>
        <p className="text-muted-foreground py-6 text-center text-sm">No closed trades yet.</p>
      </section>
    );
  }
  const c = stats.current;
  const usePct = !r && points.length > 0 && points.every((p) => p.ddPct !== null);
  const value = (p: UnderwaterPoint) => (r ? p.ddR : usePct ? p.ddPct! : p.dd);
  const data = points.map((p) => ({ t: p.t, v: value(p), dd: p.dd, ddPct: p.ddPct, ddR: p.ddR }));
  const axisFmt = axisDateFormat(data.length ? data[data.length - 1].t - data[0].t : 0, tz);
  const yFmt = (v: number) => (r ? `${v.toFixed(1)}R` : usePct ? `${v.toFixed(0)}%` : fmtUsd(v, 0));
  const fullFmt = new Intl.DateTimeFormat("en-AU", {
    timeZone: tz,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return (
    <section className={SECTION} aria-label="Drawdown" data-testid="drawdown-card">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className={H2}>Drawdown</h2>
        <span className="text-muted-foreground text-xs">trading P&L only, deposits excluded</span>
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div data-testid="dd-current">
          <dt className="text-muted-foreground text-xs">Current</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">
            {r ? (
              fmtR(c.ddR)
            ) : (
              <>
                <span className="money">{fmtSignedUsd(c.dd)}</span>{" "}
                <span className="text-muted-foreground text-xs font-normal">{pct(c.ddPct)}</span>
              </>
            )}
          </dd>
          <dd className="text-muted-foreground text-[11px]">
            {c.dd < 0 ? `from the peak on ${d(c.peakAt)}` : "at an equity high"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">To recover</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">
            {c.dd < 0 ? (c.recoverPct === null ? "—" : `+${c.recoverPct.toFixed(1)}%`) : "—"}
          </dd>
          <dd className="text-muted-foreground text-[11px]">
            {c.dd < 0
              ? `${c.daysInDrawdown} day${c.daysInDrawdown === 1 ? "" : "s"}, ${c.tradesSincePeak} trade${c.tradesSincePeak === 1 ? "" : "s"} since the peak`
              : "nothing to recover"}
          </dd>
        </div>
        <div className="col-span-2" data-testid="dd-max">
          <dt className="text-muted-foreground text-xs">Max drawdown, {periodLabel}</dt>
          {r ? (
            <>
              <dd className="mt-0.5 font-semibold tabular-nums">{stats.maxR ? fmtR(stats.maxR.ddR) : "—"}</dd>
              {stats.maxR && (
                <dd className="text-muted-foreground text-[11px]">
                  peak {d(stats.maxR.peakAt)}, trough {d(stats.maxR.troughAt)}
                </dd>
              )}
            </>
          ) : (
            <>
              <dd className="mt-0.5 font-semibold tabular-nums">
                {stats.max ? (
                  <>
                    <span className="money">{fmtSignedUsd(stats.max.dd)}</span>{" "}
                    <span className="text-muted-foreground text-xs font-normal">{pct(stats.max.ddPct)}</span>
                  </>
                ) : (
                  "—"
                )}
              </dd>
              {stats.max && (
                <dd className="text-muted-foreground text-[11px]">
                  peak {d(stats.max.peakAt)}, trough {d(stats.max.troughAt)},{" "}
                  {stats.max.recoveredAt ? `recovered ${d(stats.max.recoveredAt)}` : "not recovered yet"}
                  {stats.maxPct !== null &&
                    stats.max.ddPct !== null &&
                    stats.maxPct < stats.max.ddPct - 0.05 &&
                    `, deepest in %: ${pct(stats.maxPct)}`}
                </dd>
              )}
            </>
          )}
        </div>
      </dl>

      {data.length >= 2 ? (
        <div
          className={cn("mt-3 h-36 w-full", !r && !usePct && "money-axis")}
          role="img"
          aria-label="Underwater chart: distance below the running equity peak over time"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="dd-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={LINE} stopOpacity={0} />
                  <stop offset="100%" stopColor={LINE} stopOpacity={0.3} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(t) => axisFmt.format(t)}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                minTickGap={40}
              />
              <YAxis
                tickFormatter={yFmt}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={52}
                domain={["auto", 0]}
              />
              <Tooltip
                cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
                content={({ active, payload }) => {
                  const p = active && payload?.[0]?.payload;
                  if (!p) return null;
                  return (
                    <div className="bg-popover text-popover-foreground rounded-md border px-2.5 py-1.5 text-xs shadow-md">
                      <div className="text-muted-foreground">{fullFmt.format(p.t)}</div>
                      <div className="font-medium tabular-nums">
                        {r ? (
                          fmtR(p.ddR)
                        ) : (
                          <>
                            <span className="money">{fmtSignedUsd(p.dd)}</span>{" "}
                            {p.ddPct !== null && (
                              <span className="text-muted-foreground">{pct(p.ddPct)}</span>
                            )}
                          </>
                        )}
                      </div>
                      <div className="text-muted-foreground">below the peak</div>
                    </div>
                  );
                }}
              />
              <Area
                type="stepAfter"
                dataKey="v"
                stroke={LINE}
                strokeWidth={2}
                fill="url(#dd-fill)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }}
                isAnimationActive={false}
                baseValue={0}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </section>
  );
}
