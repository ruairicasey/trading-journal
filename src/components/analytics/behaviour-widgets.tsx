"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { axisDateFormat, fmtR, fmtSignedUsd, fmtUsd } from "@/lib/format";
import { WidgetFrame } from "./widget-frame";

const LINE = "var(--gold)"; // single series: the calm accent used by the equity curve
type Common = {
  id: string;
  title: string;
  description: string;
  hidden: string[];
  unit: "usd" | "r";
  tz: string;
};

type RunView = { kind: "win" | "loss"; n: number; from: number; to: number } | null;
type TradeView = { id: string; displayPair: string; netPnl: number; r: number | null } | null;

export function StreaksWidget(
  p: Common & {
    current: RunView;
    longestWin: RunView;
    longestLoss: RunView;
    best: TradeView;
    worst: TradeView;
  },
) {
  const r = p.unit === "r";
  const d = new Intl.DateTimeFormat("en-AU", {
    timeZone: p.tz,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const run = (x: RunView) =>
    x ? `${x.n} ${x.kind === "win" ? (x.n === 1 ? "win" : "wins") : x.n === 1 ? "loss" : "losses"}` : "—";
  const span = (x: RunView) =>
    x ? (x.from === x.to ? d.format(x.to) : `${d.format(x.from)} to ${d.format(x.to)}`) : undefined;
  const trade = (t: TradeView) =>
    t ? (
      <Link
        href={`/trades/${t.id}`}
        className={cn("hover:underline", t.netPnl > 0 ? "text-profit" : "text-loss", !r && "money")}
      >
        {r ? fmtR(t.r) : fmtSignedUsd(t.netPnl)}
      </Link>
    ) : (
      "—"
    );
  return (
    <WidgetFrame {...p}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
        <Stat
          label="Current run"
          sub={p.current ? `since ${d.format(p.current.from)}` : undefined}
          testId="streak-current"
        >
          <span className={p.current?.kind === "win" ? "text-profit" : p.current ? "text-loss" : ""}>
            {run(p.current)}
          </span>
        </Stat>
        <Stat label="Longest winning run" sub={span(p.longestWin)} testId="streak-win">
          {run(p.longestWin)}
        </Stat>
        <Stat label="Longest losing run" sub={span(p.longestLoss)} testId="streak-loss">
          {run(p.longestLoss)}
        </Stat>
        <Stat label="Largest win" sub={p.best?.displayPair}>
          {trade(p.best)}
        </Stat>
        <Stat label="Largest loss" sub={p.worst?.displayPair}>
          {trade(p.worst)}
        </Stat>
      </dl>
    </WidgetFrame>
  );
}

function Stat({
  label,
  sub,
  children,
  testId,
}: {
  label: string;
  sub?: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-0.5 truncate font-semibold tabular-nums">{children}</dd>
      {sub && <dd className="text-muted-foreground truncate text-[11px]">{sub}</dd>}
    </div>
  );
}

type Point = { t: number; date: string; net: number; r: number; count?: number };

const seg = (on: boolean) =>
  cn("rounded px-2 py-0.5 text-[11px]", on ? "bg-background shadow-sm" : "text-muted-foreground");

export function RollingWidget(p: Common & { series7: Point[]; series30: Point[] }) {
  const [win, setWin] = useState<7 | 30>(30);
  const r = p.unit === "r";
  const data = (win === 7 ? p.series7 : p.series30).map((x) => ({ t: x.t, v: r ? x.r : x.net }));
  const axis = axisDateFormat(data.length ? data[data.length - 1].t - data[0].t : 0, p.tz);
  const full = new Intl.DateTimeFormat("en-AU", {
    timeZone: p.tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const last = data.at(-1)?.v ?? null;
  return (
    <WidgetFrame
      {...p}
      controls={
        <div
          className="bg-muted/40 inline-flex shrink-0 rounded-md border p-0.5"
          role="group"
          aria-label="Window"
        >
          <button type="button" className={seg(win === 7)} aria-pressed={win === 7} onClick={() => setWin(7)}>
            7D
          </button>
          <button
            type="button"
            className={seg(win === 30)}
            aria-pressed={win === 30}
            onClick={() => setWin(30)}
          >
            30D
          </button>
        </div>
      }
    >
      {data.length < 2 ? (
        <p className="text-muted-foreground py-6 text-center text-sm">Not enough days yet.</p>
      ) : (
        <>
          <p className="mb-1 text-xs" data-testid="rolling-now">
            Trailing {win} days now:{" "}
            <span
              className={cn(
                "font-medium tabular-nums",
                !r && "money", // a trailing average: ink, red/green is for realised money
              )}
            >
              {r ? fmtR(last) : fmtSignedUsd(last)}
            </span>
          </p>
          <div
            className={cn("h-44 w-full", !r && "money-axis")}
            role="img"
            aria-label={`Rolling ${win}-day P&L over time`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={(t) => axis.format(t)}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={40}
                />
                <YAxis
                  tickFormatter={(v) => (r ? `${v.toFixed(1)}R` : fmtUsd(v, 0))}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={60}
                />
                <ReferenceLine
                  y={0}
                  stroke="var(--muted-foreground)"
                  strokeDasharray="4 4"
                  strokeOpacity={0.6}
                />
                <Tooltip
                  cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
                  content={({ active, payload }) => {
                    const x = active && payload?.[0]?.payload;
                    if (!x) return null;
                    return (
                      <div className="bg-popover text-popover-foreground rounded-md border px-2.5 py-1.5 text-xs shadow-md">
                        <div className="text-muted-foreground">{full.format(x.t)}</div>
                        <div className={cn("font-medium tabular-nums", !r && "money")}>
                          {r ? fmtR(x.v) : fmtSignedUsd(x.v)}
                        </div>
                        <div className="text-muted-foreground">over the {win} days to here</div>
                      </div>
                    );
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="v"
                  stroke={LINE}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </WidgetFrame>
  );
}

export function DailyWidget(p: Common & { days: Point[] }) {
  const r = p.unit === "r";
  const data = p.days.map((x) => ({ t: x.t, date: x.date, v: r ? x.r : x.net, count: x.count ?? 0 }));
  const day = new Intl.DateTimeFormat("en-AU", { timeZone: p.tz, day: "numeric", month: "short" });
  const full = new Intl.DateTimeFormat("en-AU", {
    timeZone: p.tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const traded = data.filter((d) => d.count > 0);
  const green = traded.filter((d) => d.v > 0).length;
  return (
    <WidgetFrame {...p}>
      {traded.length === 0 ? (
        <p className="text-muted-foreground py-6 text-center text-sm">No trades closed in these days.</p>
      ) : (
        <>
          <p className="text-muted-foreground mb-1 text-xs" data-testid="daily-summary">
            {green} green / {traded.length - green} red of {traded.length} trading days
          </p>
          <div
            className={cn("h-44 w-full", !r && "money-axis")}
            role="img"
            aria-label="Daily P&L, last 30 days"
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="t"
                  tickFormatter={(t: number) => day.format(t)}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={24}
                />
                <YAxis
                  tickFormatter={(v) => (r ? `${v.toFixed(1)}R` : fmtUsd(v, 0))}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={60}
                />
                <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.6} />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                  content={({ active, payload }) => {
                    const x = active && payload?.[0]?.payload;
                    if (!x) return null;
                    return (
                      <div className="bg-popover text-popover-foreground rounded-md border px-2.5 py-1.5 text-xs shadow-md">
                        <div className="text-muted-foreground">{full.format(x.t)}</div>
                        <div className={cn("font-medium tabular-nums", !r && "money")}>
                          {x.count ? (r ? fmtR(x.v) : fmtSignedUsd(x.v)) : "no trades"}
                        </div>
                        {x.count > 0 && (
                          <div className="text-muted-foreground">
                            {x.count} trade{x.count === 1 ? "" : "s"} closed
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
                <Bar dataKey="v" radius={[3, 3, 3, 3]} isAnimationActive={false}>
                  {data.map((x) => (
                    <Cell key={x.t} fill={x.v >= 0 ? "var(--profit)" : "var(--loss)"} fillOpacity={0.75} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </WidgetFrame>
  );
}
