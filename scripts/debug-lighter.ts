/**
 * npm run debug:lighter               — Lighter sync health over your local database
 * npm run debug:lighter -- --remote   — same, against the deployed Turso database (.env.production.local)
 *
 * READ-ONLY. Prints counts and percentages only: never a token, address, account index or $ amount. It checks what
 * docs/lighter.md lists as assumed: P&L against entry and exit prices, the funding sign against the rate, and the books
 * against the exchange's collateral (a public read, so no token is needed).
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
  const { getLighterClient } = await import("../src/server/lighter");
  const { openPositions, reconciliation } = await import("../src/server/lighter/sync");
  const db = getDb();
  const now = Date.now();
  const pc = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(2)}%` : "—");
  const wallets = await db.select().from(s.wallets).where(eq(s.wallets.exchange, "lighter"));
  console.log(`Lighter wallets: ${wallets.length}`);
  for (const [i, w] of wallets.entries()) {
    const st = await db.query.lighterState.findFirst({ where: eq(s.lighterState.walletId, w.id) });
    const days = st?.tokenExpiresAt ? Math.round((st.tokenExpiresAt - now) / 86_400_000) : null;
    console.log(
      `\n=== wallet ${i + 1} · ${w.enabled ? "enabled" : "disabled"} · token ${st?.tokenEnc ? `${days} d left` : "none"} · backfill ${w.backfillCompletedAt ? "done" : "pending"}`,
    );
    const fills = await db.select().from(s.fills).where(eq(s.fills.walletId, w.id));
    const trades = (
      await db
        .select()
        .from(s.trades)
        .where(and(eq(s.trades.walletId, w.id), isNull(s.trades.deletedAt)))
    ).filter((t) => !t.flags?.superseded);
    const closed = trades.filter((t) => t.status === "closed");
    const flag = (k: "gap" | "partialHistory") => trades.filter((t) => t.flags?.[k]).length;
    console.log(
      `fills ${fills.length} · trades ${trades.length} (${closed.length} closed) · gap ${flag("gap")} · partial ${flag("partialHistory")}`,
    );

    // 1. each closed trade's gross P&L from its own average prices
    let same = 0;
    let checked = 0;
    for (const t of closed) {
      if (t.avgEntry === null || t.avgExit === null || !t.exitUnitsTotal || t.grossPnl === null) continue;
      checked++;
      const exp = (t.avgExit - t.avgEntry) * t.exitUnitsTotal * (t.direction === "long" ? 1 : -1);
      if (Math.abs(exp - t.grossPnl) <= Math.max(0.05, Math.abs(exp) * 0.005)) same++;
    }
    console.log(`P&L agrees with entry and exit prices: ${same}/${checked}`);
    // 2. fees as a share of notional
    const notional = fills.reduce((a, f) => a + Number(f.px) * Number(f.sz), 0);
    const fees = fills.reduce((a, f) => a + Number(f.fee), 0);
    console.log(
      `fees / notional: ${notional ? ((fees / notional) * 1e4).toFixed(3) : "—"} bps (a Standard account should read 0.000)`,
    );
    // 3. funding sign: a long pays when the rate is positive
    const pays = await db.select().from(s.fundingEvents).where(eq(s.fundingEvents.walletId, w.id));
    const signed = pays.filter(
      (p) => Number(p.usdc) !== 0 && Number(p.fundingRate) !== 0 && Number(p.szi) !== 0,
    );
    const agree = signed.filter(
      (p) => Math.sign(Number(p.usdc)) === -Math.sign(Number(p.szi) * Number(p.fundingRate)),
    ).length;
    console.log(
      `funding ${pays.length} rows, ${pays.filter((p) => p.tradeId).length} on a trade · sign as expected: ${agree}/${signed.length} (near 0 means it is inverted)`,
    );
    // 4. orders and stops
    const orders = await db.select().from(s.orders).where(eq(s.orders.walletId, w.id));
    const trig = orders.filter((o) => o.isTrigger);
    console.log(
      `orders ${orders.length} · triggers ${trig.length} (${trig.filter((o) => o.reduceOnly).length} reduce-only, ${trig.filter((o) => o.isPositionTpsl).length} whole position, ${trig.filter((o) => o.status === "modified").length} edited versions)`,
    );
    // 5. the books
    const ledger = await db.select().from(s.ledgerEvents).where(eq(s.ledgerEvents.walletId, w.id));
    const kinds = new Map<string, number>();
    for (const l of ledger) kinds.set(l.kind, (kinds.get(l.kind) ?? 0) + 1);
    console.log(`ledger ${ledger.length}: ${[...kinds].map(([k, n]) => `${k} ${n}`).join(", ") || "none"}`);
    const account = await getLighterClient().account(w.accountIndex);
    const r = await reconciliation(db, w.id, account);
    console.log(`books / exchange collateral: ${pc(r.expected, r.actual)} (${r.ok ? "match" : "NO MATCH"})`);
    const live = openPositions(account)
      .map((p) => p.symbol)
      .sort()
      .join();
    const mine = trades
      .filter((t) => t.status === "open")
      .map((t) => t.coin)
      .sort()
      .join();
    console.log(`open positions match the journal: ${live === mine ? "yes" : "NO"}`);
  }
  console.log("\nDone. Safe to paste back: counts and percentages only.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("debug:lighter failed:", e instanceof Error ? e.message : "unknown error");
    process.exit(1);
  });
