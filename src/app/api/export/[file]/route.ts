/**
 * GET /api/export/trades.csv | /api/export/monthly.csv  (?period=…&from=…&to=…, like the Reports page).
 * Session-protected by middleware; scoped to the active account and wallet. Never cached.
 */
import { NextResponse } from "next/server";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { getActiveScope, getSetting } from "@/server/db/queries/settings";
import { reportRange } from "@/lib/report-range";
import { monthly, monthlyCsv, reportTrades, tradesCsv } from "@/server/reports/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILES = { "trades.csv": "trades", "monthly.csv": "monthly" } as const;

export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const kind = FILES[file as keyof typeof FILES];
  if (!kind) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { active, walletId } = await getActiveScope();
  if (!active) return NextResponse.json({ error: "No account" }, { status: 400 });
  const tz = await getSetting("timezone", getConfig().timezone);
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  // `at`: the time the Reports page was built (so a rolling period matches the page); never in the future
  const at = Number(sp.at);
  const now = Number.isInteger(at) && at > 0 && at <= Date.now() ? at : Date.now();
  const range = reportRange(sp, now, tz, "month", active.journalStart);
  const trades = (await reportTrades(getDb(), active.id, walletId)).filter(range.inRange);
  const body = kind === "trades" ? tradesCsv(trades, tz) : monthlyCsv(monthly(trades, tz));
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `journal-${kind}-${range.params.period === "custom" ? `${range.params.from}_${range.params.to ?? "now"}` : range.params.period}-${stamp}.csv`;
  return new NextResponse("﻿" + body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
