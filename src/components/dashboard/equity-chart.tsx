"use client";

import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";
import { axisDateFormat, fmtR, fmtSignedUsd, fmtUsd } from "@/lib/format";
import type { BalancePoint, EquityPoint } from "@/lib/stats";

const FLOW_LABEL: Record<string, string> = {
  deposit: "Deposit",
  withdraw: "Withdrawal",
  transfer_in: "Transfer in",
  transfer_out: "Transfer out",
  spot_perp: "Spot ↔ perp",
  vault: "Vault",
  internal: "Internal transfer fee",
};

const LINE = "oklch(0.72 0.14 250)"; // single series: one calm accent; P&L sign is shown as text

/** `points` with `deposited` (BalancePoint) draw the real account balance with a dashed net-deposited line. */
export function EquityChart({ points, unit, baseline, tz }: { points: (EquityPoint | BalancePoint)[]; unit: "usd" | "r"; baseline: number; tz: string }) {
  const r = unit === "r";
  const balance = !r && points.some((p) => "deposited" in p);
  const data = points.map((p) => ({
    t: p.t,
    v: r ? p.cumR : p.equity,
    dep: "deposited" in p ? p.deposited : undefined,
    trade: p.trade,
    flow: "flow" in p ? p.flow : undefined,
  }));
  const dateFmt = axisDateFormat(data.length ? data[data.length - 1].t - data[0].t : 0, tz);
  const fullFmt = new Intl.DateTimeFormat("en-AU", { timeZone: tz, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  const yFmt = (v: number) => (r ? `${v.toFixed(1)}R` : Math.abs(v) >= 10_000 ? `$${(v / 1000).toFixed(1)}k` : fmtUsd(v, 0));

  if (data.length < 2) {
    return <div className="text-muted-foreground flex h-64 items-center justify-center text-sm">No closed trades in this period.</div>;
  }
  return (
    <div className={cn("h-64 w-full lg:h-[22rem]", !r && "money-axis")} data-testid="equity-chart" role="img" aria-label={r ? "Cumulative R over time" : balance ? "Account balance and net deposits over time" : "Account equity over time"}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="eq-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={LINE} stopOpacity={0.25} />
              <stop offset="100%" stopColor={LINE} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(t) => dateFmt.format(t)}
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
            width={64}
            domain={["auto", "auto"]}
          />
          {!balance && <ReferenceLine y={r ? 0 : baseline} stroke="var(--muted-foreground)" strokeDasharray="4 4" strokeOpacity={0.6} />}
          <Tooltip
            cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              const d = active && payload?.[0]?.payload;
              if (!d) return null;
              return (
                <div className="bg-popover text-popover-foreground rounded-md border px-2.5 py-1.5 text-xs shadow-md">
                  <div className="text-muted-foreground">{fullFmt.format(d.t)}</div>
                  <div className={cn("font-medium tabular-nums", !r && "money")}>{r ? fmtR(d.v) : fmtUsd(d.v)}</div>
                  {d.flow && (
                    <div className="text-muted-foreground tabular-nums">
                      {FLOW_LABEL[d.flow.kind] ?? "Ledger"}: <span className="money">{fmtSignedUsd(d.flow.usd)}</span>
                    </div>
                  )}
                  {balance && d.dep !== undefined && (
                    <div className="text-muted-foreground tabular-nums">
                      Net deposited: <span className="money">{fmtUsd(d.dep)}</span>
                    </div>
                  )}
                  {d.trade && (
                    <div className="text-muted-foreground tabular-nums">
                      {d.trade.pair}: <span className={cn(!r && "money")}>{r ? fmtR(d.trade.r) : fmtSignedUsd(d.trade.net)}</span>
                    </div>
                  )}
                </div>
              );
            }}
          />
          <Area type="monotone" dataKey="v" stroke={LINE} strokeWidth={2} fill="url(#eq-fill)" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }} isAnimationActive={false} />
          {balance && (
            <Line type="stepAfter" dataKey="dep" stroke="var(--muted-foreground)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} activeDot={false} isAnimationActive={false} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
