/**
 * npm run debug:risk               — risk-adjusted metrics over your local database
 * npm run debug:risk -- --remote   — same, against the deployed Turso database (.env.production.local)
 *
 * READ-ONLY. For each account: all time, since 1 Jan 2026 and since 1 Mar 2026 (or --from YYYY-MM-DD). Prints ratios,
 * percentages, counts and R only: never an address or a $ amount, so the output is safe to paste back.
 */
import { loadEnvConfig } from "@next/env";

const remote = process.argv.includes("--remote");
loadEnvConfig(process.cwd(), !remote);
const fromArg = process.argv.indexOf("--from");

async function main() {
  const { getConfig } = await import("../src/server/config");
  if (remote && !getConfig().db.url.startsWith("libsql:")) {
    throw new Error(
      "--remote needs DATABASE_URL=libsql://… and DATABASE_AUTH_TOKEN in .env.production.local",
    );
  }
  const { getDb } = await import("../src/server/db/client");
  const s = await import("../src/server/db/schema");
  const { eq } = await import("drizzle-orm");
  const { closedTrades, balanceInputs } = await import("../src/server/db/queries/dashboard");
  const { computeRisk } = await import("../src/lib/risk");
  const { dayBoundsLocal } = await import("../src/lib/periods");
  const db = getDb();
  const tzRow = await db.query.settings.findFirst({ where: eq(s.settings.key, "timezone") });
  const tz = (tzRow?.value as string) ?? getConfig().timezone;
  const now = Date.now();
  const f2 = (x: number | null) => (x === null || !Number.isFinite(x) ? "—" : x.toFixed(2));
  const pc = (x: number | null) => (x === null || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(1)}%`);
  const starts = fromArg > -1 ? [process.argv[fromArg + 1]] : ["2026-01-01", "2026-03-01"];

  for (const [ai, acc] of (await db.select().from(s.accounts)).entries()) {
    const gaps: number[] = [];
    const [all, bal] = await Promise.all([closedTrades(db, acc.id, null), balanceInputs(db, acc.id, null)]);
    const js = acc.journalStart;
    if (js !== null) {
      // journal start: trades opened before + on/after it must add up to all closed trades, in count and net
      const before = all.filter((t) => t.entryTime === null || t.entryTime < js);
      const after = all.filter((t) => t.entryTime !== null && t.entryTime >= js);
      const sum = (xs: typeof all) => xs.reduce((x, t) => x + t.netPnl, 0);
      const total = sum(all);
      console.log(
        `
account ${ai + 1} · journal start ${new Date(js).toISOString()} · before ${before.length} (${pc(sum(before) / total)} of all-time net) + after ${after.length} (${pc(sum(after) / total)}) = ${before.length + after.length} of ${all.length} trades · net ${Math.abs(sum(before) + sum(after) - total) < 0.005 ? "adds up" : "DOES NOT add up"}`,
      );
    }
    for (const label of [...(js !== null ? ["start"] : []), "all", ...starts]) {
      const from = label === "all" ? null : label === "start" ? js : dayBoundsLocal(label, tz)!.start;
      // the "start" view: only trades opened on/after the journal start (what the app shows by default)
      const view = label === "start" ? all.filter((t) => t.entryTime !== null && t.entryTime >= js!) : all;
      const m = computeRisk(view, bal, acc.startingBalance, { from, to: null, tz, now });
      console.log(
        `\naccount ${ai + 1} · ${label === "all" ? "all time" : label === "start" ? "since journal start (default view)" : `since ${label}`} · basis ${m.basis} · ${m.days.length} days with capital · ${m.trades} trades`,
      );
      console.log(
        `  Sharpe ${f2(m.sharpe)} · Sortino ${f2(m.sortino)} · return ${pc(m.totalReturn)} (annualised ${pc(m.annualised)})`,
      );
      console.log(
        `  max DD ${pc(m.maxDrawdown)} · longest DD ${m.longestDrawdownDays ?? "—"} days · Calmar ${f2(m.calmar)} · recovery ${f2(m.recoveryFactor)}`,
      );
      console.log(
        `  expectancy ${f2(m.expectancyR)}R (${m.rCount} with a stop) · payoff ${f2(m.payoff)} · SQN ${f2(m.sqn)}`,
      );
      const net = view.filter((t) => from === null || t.exitTime >= from).reduce((x, t) => x + t.netPnl, 0);
      const gap = m.pnl - net;
      gaps.push(gap);
      console.log(
        `  check: daily trading P&L − closed-trade net = ${pc(gaps[0] ? gap / gaps[0] : null)} of the all-time gap (the same gap in every period = it reconciles)`,
      );
    }
  }
  // HIP-3 pair labels read "SPX/USD (xyz)" since migration 0011; a middle dot means an old label survived
  const { sql } = await import("drizzle-orm");
  const dotted = await db.all<{ n: number }>(
    sql`select count(*) as n from trades where market_type = 'hip3' and display_pair like '% · %'`,
  );
  console.log(`pair labels: ${dotted[0]?.n ?? 0} HIP-3 label(s) still with a middle dot (expect 0)`);
  console.log("\nRead-only. No addresses or amounts in this output.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
