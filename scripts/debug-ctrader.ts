/**
 * npm run debug:ctrader               — cTrader sync health over your local database
 * npm run debug:ctrader -- --remote   — same, against the deployed Turso database (.env.production.local)
 *
 * READ-ONLY. Prints counts and percentages only: never a token, login, account id or $ amount.
 *
 * The key check, once real deals exist: cTrader stamps every closing deal with the account balance after it. Between
 * two consecutive closing deals with nothing else in between, the balance change must equal the second deal's
 * realised net (gross + swap + commission + conversion fee). If it doesn't, either money moved (a deposit or
 * withdrawal) or commission is charged differently from how positions.ts assumes (e.g. at the open): a mismatch
 * rate near 100% points at the assumption, not the data.
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
  const { and, eq, isNull } = await import("drizzle-orm");
  const { isExecuted } = await import("../src/server/ctrader/positions");
  const db = getDb();
  const now = Date.now();
  const pc = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");
  const cfg = getConfig().ctrader;

  console.log(
    `configured (env): ${remote ? "n/a with --remote (Vercel holds it)" : cfg.configured ? "yes" : "no"}`,
  );
  const conn = await db.query.ctraderConnections.findFirst();
  console.log(
    conn
      ? `connection: yes · token renews in ${Math.max(0, Math.round((conn.accessExpiresAt - now) / 86_400_000) - 7)} d · error: ${conn.lastError ? "yes" : "no"}`
      : "connection: none",
  );
  const accts = await db.select().from(s.ctraderAccounts);
  console.log(
    `accounts: ${accts.length} (${accts.filter((a) => !a.isLive).length} demo, ${accts.filter((a) => a.isLive).length} live, ${accts.filter((a) => a.enabled).length} syncing)`,
  );

  for (const [i, a] of accts.entries()) {
    const deals = await db.select().from(s.ctraderDeals).where(eq(s.ctraderDeals.ctid, a.ctid));
    const ex = deals.filter(isExecuted);
    const closes = ex.filter((d) => d.close).sort((x, y) => x.time - y.time || x.dealId - y.dealId);
    const positions = new Set(ex.map((d) => d.positionId));
    const keyPrefix = `ctrader:${a.traderLogin ?? a.ctid}:`;
    const trades = (
      await db
        .select()
        .from(s.trades)
        .where(and(eq(s.trades.source, "ctrader"), isNull(s.trades.deletedAt)))
    ).filter((t) => t.externalKey?.startsWith(keyPrefix));
    const apiTrades = trades.filter((t) => !t.flags?.imported);
    const closed = trades.filter((t) => t.status === "closed");

    // Σ realised net from closing deals vs Σ net on the API trades (funding in net) — should be 100%
    const dealNet = closes.reduce(
      (x, d) => x + d.close!.gross + d.close!.swap + d.close!.commission + d.close!.conversionFee,
      0,
    );
    const tradeNet = apiTrades
      .filter((t) => t.status === "closed")
      .reduce((x, t) => x + (t.grossPnl ?? 0) - (t.fees ?? 0) + (t.funding ?? 0), 0);

    // balance chain
    let pairs = 0;
    let match = 0;
    for (let k = 1; k < closes.length; k++) {
      const c = closes[k].close!;
      pairs++;
      const delta = c.balance - closes[k - 1].close!.balance;
      if (Math.abs(delta - (c.gross + c.swap + c.commission + c.conversionFee)) < 0.011) match++;
    }
    const openDealCommission = ex.filter((d) => !d.close && d.commission !== 0).length;

    console.log(
      `\naccount ${i + 1} (${a.isLive ? "live" : "demo"}, ${a.enabled ? "syncing" : "off"}, ${a.currency ?? "?"})`,
    );
    console.log(
      `  history to: ${a.dealsSyncedTo ? `${((now - a.dealsSyncedTo) / 3_600_000).toFixed(1)} h ago` : "never"} · last error: ${a.lastError ? "yes" : "no"}`,
    );
    console.log(
      `  deals: ${deals.length} (${ex.length} executed, ${closes.length} closing) · positions: ${positions.size}`,
    );
    console.log(
      `  trades: ${trades.length} (${apiTrades.length} from the API, ${trades.length - apiTrades.length} imported) · closed ${closed.length}, open ${trades.length - closed.length}`,
    );
    console.log(`  positions with a trade: ${pc(apiTrades.length, positions.size)}`);
    console.log(
      `  closed-trade net ÷ closing-deal net: ${dealNet ? pc(tradeNet, dealNet) : "— (no closes yet)"}`,
    );
    console.log(
      `  balance chain: ${pairs ? `${match} of ${pairs} consecutive closes match (${pc(match, pairs)})` : "— (needs 2+ closing deals)"}`,
    );
    console.log(
      `  opening deals that carry a commission: ${openDealCommission} of ${ex.length - closes.length}`,
    );
  }
}

main().catch((e) => {
  // the SQL error's cause (e.g. "no such table" before the migration has run), never a value
  const cause = e instanceof Error && e.cause ? ` (${String(e.cause).slice(0, 160)})` : "";
  console.error(e instanceof Error ? e.message.split("\n")[0] + cause : e);
  process.exit(1);
});
