/**
 * npm run debug:insights               — the Insights rules and Scores over your local database
 * npm run debug:insights -- --remote   — same, against the deployed Turso database (.env.production.local)
 *
 * READ-ONLY. For every account and period (all time, 30 days), prints each rule's trade count, win rate and its
 * net as a % of that period's total |net|, ranked like the Insights page. Counts and percentages only: never an
 * address or a $ amount, so the output is safe to paste back. Use it to reconcile the page's counts.
 */
import { loadEnvConfig } from "@next/env";

const remote = process.argv.includes("--remote");
loadEnvConfig(process.cwd(), !remote);

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
  const { analyticsTrades } = await import("../src/server/db/queries/analytics");
  const { insights, INSIGHT_RULES } = await import("../src/lib/analytics/insights");
  const { periodRange } = await import("../src/lib/periods");
  const { scores } = await import("../src/lib/analytics/scores");
  const db = getDb();
  const tzRow = await db.query.settings.findFirst({ where: eq(s.settings.key, "timezone") });
  const tz = (tzRow?.value as string) ?? getConfig().timezone;
  const pct = (x: number, of: number) => (of === 0 ? "—" : `${((x / of) * 100).toFixed(1)}%`);

  for (const [ai, acc] of (await db.select().from(s.accounts)).entries()) {
    const all = await analyticsTrades(db, acc.id, null);
    for (const period of ["all", "30d"] as const) {
      const from = periodRange(period, Date.now(), tz).from;
      const trades = all.filter((t) => from === null || t.exitTime >= from);
      const net = trades.reduce((a, t) => a + t.netPnl, 0);
      const { list, checked } = insights(trades, all, tz);
      console.log(
        `\naccount ${ai + 1} · ${period}: ${trades.length} closed trades, ${checked} of ${INSIGHT_RULES.length} rules applied (worst hour/day only when a 5+ trade bucket lost), ${list.length} losing patterns`,
      );
      console.log(
        `  net of the period: ${net < 0 ? "loss" : "profit"}; each pattern's net as % of |period net|:`,
      );
      const sc = scores(trades, all, tz);
      const r = (x: number | null) => (x === null ? "—" : String(Math.round(x)));
      console.log(
        `  scores: discipline ${r(sc.discipline.score)} · coverage ${r(sc.coverage.score)} (reviewed ${sc.coverage.reviewed} of ${sc.n}) · compliance ${r(sc.compliance.score)} (rules marked ${sc.compliance.rulesMarked}, process marked ${sc.compliance.processMarked}) · mistakes: ${sc.mistakes.n} tagged, ${pct(sc.mistakes.cost, Math.abs(net))}`,
      );
      for (const [k, i] of list.entries()) {
        const wr = i.winRate === null ? "—" : `${Math.round(i.winRate * 100)}%`;
        console.log(
          `  ${k + 1}. ${i.title.padEnd(22)} n=${String(i.n).padStart(4)}  win ${wr.padStart(4)}  ${pct(i.impact, Math.abs(net)).padStart(7)}`,
        );
      }
    }
  }
  console.log("\nRead-only. No addresses or amounts in this output.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
