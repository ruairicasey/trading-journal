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
    for (const label of ["all", ...starts]) {
      const from = label === "all" ? null : dayBoundsLocal(label, tz)!.start;
      const m = computeRisk(all, bal, acc.startingBalance, { from, to: null, tz, now });
      console.log(
        `\naccount ${ai + 1} · ${label === "all" ? "all time" : `since ${label}`} · basis ${m.basis} · ${m.days.length} days with capital · ${m.trades} trades`,
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
      const net = all.filter((t) => from === null || t.exitTime >= from).reduce((x, t) => x + t.netPnl, 0);
      const gap = m.pnl - net;
      gaps.push(gap);
      console.log(
        `  check: daily trading P&L − closed-trade net = ${pc(gaps[0] ? gap / gaps[0] : null)} of the all-time gap (the same gap in every period = it reconciles)`,
      );
    }
  }
  console.log("\nRead-only. No addresses or amounts in this output.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
