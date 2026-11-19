"use client";

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useState } from "react";
import { balanceDomain } from "@/lib/chart-domain";
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

const LINE = "var(--gold)"; // single series: one calm accent; P&L sign is shown as text

/**
 * `points` with `deposited` (BalancePoint) draw the real account balance. The y-axis is scaled to the balance; the
 * dashed net-deposited line shows when it falls inside that range, or when the legend toggle asks for it (which
 * widens the axis to fit both).
 */
export function EquityChart({
  points,
  unit,
  baseline,
  tz,
}: {
  points: (EquityPoint | BalancePoint)[];
  unit: "usd" | "r";
  baseline: number;
  tz: string;
}) {
  const r = unit === "r";
  const balance = !r && points.some((p) => "deposited" in p);
  const data = points.map((p) => ({
    t: p.t,
    v: r ? p.cumR : p.equity,
    dep: "deposited" in p ? p.deposited : undefined,
    trade: p.trade,
    flow: "flow" in p ? p.flow : undefined,
  }));
  const [showDep, setShowDep] = useState(false);
  const {
    domain: balDomain,
    hasDeposits,
    depositsInRange: depInRange,
    drawDeposits,
  } = balanceDomain(
    data.map((d) => d.v),
    data.map((d) => d.dep).filter((x): x is number => x !== undefined),
    showDep,
  );
  const drawDep = balance && drawDeposits;
  const domain = r ? (["auto", "auto"] as const) : balDomain;
  const dateFmt = axisDateFormat(data.length ? data[data.length - 1].t - data[0].t : 0, tz);
  const fullFmt = new Intl.DateTimeFormat("en-AU", {
    timeZone: tz,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const yFmt = (v: number) =>
    r ? `${v.toFixed(1)}R` : Math.abs(v) >= 10_000 ? `$${(v / 1000).toFixed(1)}k` : fmtUsd(v, 0);

  if (data.length < 2) {
    return (
      <div className="text-muted-foreground flex h-64 items-center justify-center text-sm">
        No closed trades in this period.
      </div>
    );
  }
  return (
    <figure className="m-0 flex flex-col gap-2">
      <div
        className={cn("h-64 w-full lg:h-[22rem]", !r && "money-axis")}
        data-testid="equity-chart"
        role="img"
        aria-label={
          r
            ? "Cumulative R over time"
            : balance
              ? "Account balance and net deposits over time"
              : "Account equity over time"
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
              domain={domain as [number, number]}
              allowDataOverflow
            />
            {!balance && (
              <ReferenceLine
                y={r ? 0 : baseline}
                stroke="var(--muted-foreground)"
                strokeDasharray="4 4"
                strokeOpacity={0.6}
              />
            )}
            <Tooltip
              cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
              content={({ active, payload }) => {
                const d = active && payload?.[0]?.payload;
                if (!d) return null;
                return (
                  <div className="bg-popover text-popover-foreground rounded-md border px-2.5 py-1.5 text-xs shadow-md">
                    <div className="text-muted-foreground">{fullFmt.format(d.t)}</div>
                    <div className={cn("font-medium tabular-nums", !r && "money")}>
                      {r ? fmtR(d.v) : fmtUsd(d.v)}
                    </div>
                    {d.flow && (
                      <div className="text-muted-foreground tabular-nums">
                        {FLOW_LABEL[d.flow.kind] ?? "Ledger"}:{" "}
                        <span className="money">{fmtSignedUsd(d.flow.usd)}</span>
                      </div>
                    )}
                    {balance && d.dep !== undefined && (
                      <div className="text-muted-foreground tabular-nums">
                        Net deposited: <span className="money">{fmtUsd(d.dep)}</span>
                      </div>
                    )}
                    {d.trade && (
                      <div className="text-muted-foreground tabular-nums">
                        {d.trade.pair}:{" "}
                        <span className={cn(!r && "money")}>
                          {r ? fmtR(d.trade.r) : fmtSignedUsd(d.trade.net)}
                        </span>
                      </div>
                    )}
                  </div>
                );
              }}
            />
            <Line
              type={balance ? "stepAfter" : "monotone"}
              dataKey="v"
              stroke={LINE}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }}
              isAnimationActive={false}
            />
            {drawDep && (
              <Line
                type="stepAfter"
                dataKey="dep"
                stroke="var(--muted-foreground)"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {balance && (
        <figcaption className="text-muted-foreground text-13 flex flex-wrap items-center gap-5">
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className="bg-gold h-0.5 w-4" />
            Balance
          </span>
          {!hasDeposits ? null : depInRange ? (
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="border-muted-foreground w-4 border-t-[1.5px] border-dashed"
              />
              Net deposits
            </span>
          ) : (
            <button
              type="button"
              aria-pressed={showDep}
              onClick={() => setShowDep((x) => !x)}
              className="hover:text-ink flex items-center gap-2 rounded-md"
              data-testid="toggle-deposits"
            >
              <span
                aria-hidden="true"
                className="border-muted-foreground w-4 border-t-[1.5px] border-dashed"
              />
              {showDep ? "Hide net deposits" : "Show net deposits"}
            </button>
          )}
        </figcaption>
      )}
    </figure>
  );
}
