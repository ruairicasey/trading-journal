/**
 * npm run debug:playbook               — the Playbook page's rows over your local database
 * npm run debug:playbook -- --remote   — same, against the deployed Turso database (.env.production.local)
 *
 * READ-ONLY. For every account and period (since start, all time, 30 days), prints each strategy row's trade count,
 * win rate, net as a % of the period's |net|, how many trades have rules marked and the rules-followed score, then
 * checks the rows add up to the period (count and net). Counts and percentages only: never an address or a $ amount.
 * It counts every wallet of the account, like the page with "All wallets" picked (pick that before comparing).
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
  const { playbook } = await import("../src/lib/analytics/playbook");
  const { listStrategies } = await import("../src/server/playbook/playbook");
  const { resolveView, wholeDays } = await import("../src/lib/view-period");
  const { fromFloor } = await import("../src/lib/journal-start");
  const db = getDb();
  const tzRow = await db.query.settings.findFirst({ where: eq(s.settings.key, "timezone") });
  const tz = (tzRow?.value as string) ?? getConfig().timezone;
  const pct = (x: number, of: number) => (of === 0 ? "—" : `${((x / of) * 100).toFixed(1)}%`);
  const strategies = await listStrategies(db);
  console.log(
    `${strategies.length} strategies (${strategies.filter((x) => x.archived).length} archived), ${strategies.filter((x) => x.rules).length} with rules written`,
  );

  for (const [ai, acc] of (await db.select().from(s.accounts)).entries()) {
    const all = await analyticsTrades(db, acc.id, null, { light: true });
    for (const period of ["start", "all", "30d"]) {
      if (period === "start" && acc.journalStart === null) continue;
      const v = resolveView({ period }, Date.now(), tz, acc.journalStart);
      const trades = fromFloor(all, v.floor).filter(wholeDays(v, tz).inPeriod);
      const b = playbook(trades, strategies);
      const abs = Math.abs(b.total.net);
      console.log(
        `\naccount ${ai + 1} · ${period}: ${b.total.n} closed trades, net ${b.total.net < 0 ? "loss" : "profit"}`,
      );
      const rows = b.none ? [...b.rows, b.none] : b.rows;
      for (const [k, r] of rows.entries()) {
        const wr = r.stats.winRate === null ? "—" : `${Math.round(r.stats.winRate * 100)}%`;
        const sc = r.compliance.score === null ? "—" : String(Math.round(r.compliance.score));
        console.log(
          `  ${r.id === "__none" ? "none" : `S${k + 1}`}${r.archived ? " (archived)" : ""}  n=${String(r.stats.n).padStart(4)}  win ${wr.padStart(4)}  ${pct(r.stats.net, abs).padStart(7)}  rules marked ${r.compliance.marked}, followed ${sc}  rules written ${r.rules.length}`,
        );
      }
      const n = rows.reduce((a, r) => a + r.stats.n, 0);
      const net = rows.reduce((a, r) => a + r.stats.net, 0);
      console.log(
        `  rows add up: count ${n === b.total.n ? "✓" : "✗"} (${n} of ${b.total.n}), net ${Math.abs(net - b.total.net) < 0.005 ? "✓" : "✗"} (${pct(net, b.total.net)})`,
      );
    }
  }
  console.log("\nRead-only. No addresses or amounts in this output.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
