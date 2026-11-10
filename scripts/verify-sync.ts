/**
 * npm run verify:sync                 — summary + last 10 closed trades
 * npm run verify:sync -- --trade 3    — every fill of trade #3 from that list
 *
 * Compare the output with Hyperliquid's UI (Trade History / Portfolio). Never prints an address,
 * so you can paste the output back without revealing your wallet.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const pad = (v: unknown, n: number) => String(v ?? "—").padEnd(n).slice(0, n);
const padL = (v: unknown, n: number) => String(v ?? "—").padStart(n).slice(-n);
const usd = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(2));
const num = (n: number | null | undefined) => (n == null ? "—" : Number(n.toPrecision(8)).toString());

async function main() {
  const tradeArg = process.argv.indexOf("--trade");
  const pick = tradeArg > -1 ? Number(process.argv[tradeArg + 1]) : null;

  const { getConfig } = await import("../src/server/config");
  const { getDb } = await import("../src/server/db/client");
  const s = await import("../src/server/db/schema");
  const { and, desc, eq, isNull, sql } = await import("drizzle-orm");
  const { runMigrations } = await import("../src/server/db/bootstrap");
  const db = getDb();
  await runMigrations(db);

  const tzRow = await db.query.settings.findFirst({ where: eq(s.settings.key, "timezone") });
  const tz = (tzRow?.value as string) ?? getConfig().timezone;
  const dt = (ts: number | null) =>
    ts == null
      ? "—"
      : new Intl.DateTimeFormat("en-AU", { timeZone: tz, dateStyle: "medium", timeStyle: "medium", hour12: false }).format(ts);

  const wallets = await db.select().from(s.wallets);
  if (!wallets.length) throw new Error("No wallets yet. Run npm run sync:backfill first.");

  console.log(`Timezone: ${tz}\n`);
  for (const w of wallets) {
    const [fc] = await db.select({ n: sql<number>`count(*)` }).from(s.fills).where(eq(s.fills.walletId, w.id));
    const byType = await db
      .select({ t: s.fills.marketType, n: sql<number>`count(*)` })
      .from(s.fills)
      .where(eq(s.fills.walletId, w.id))
      .groupBy(s.fills.marketType);
    const builder = await db
      .select({ n: sql<number>`count(*)` })
      .from(s.fills)
      .where(and(eq(s.fills.walletId, w.id), sql`${s.fills.builderFee} is not null`));
    const nonUsdc = await db
      .select({ t: s.fills.marketType, token: s.fills.feeToken, n: sql<number>`count(*)` })
      .from(s.fills)
      .where(and(eq(s.fills.walletId, w.id), sql`${s.fills.feeToken} not in ('USDC', 'USDH', 'USDT0', 'USDT', 'USDE')`))
      .groupBy(s.fills.marketType, s.fills.feeToken);
    // Fills that took part in a liquidation: ours (we were liquidated) vs counterparty (someone else was).
    const liqFills = await db
      .select({ liquidation: s.fills.liquidation, marketType: s.fills.marketType })
      .from(s.fills)
      .where(and(eq(s.fills.walletId, w.id), sql`${s.fills.liquidation} is not null`));
    const ownLiq = liqFills.filter(
      (f) => ((f.liquidation as { liquidatedUser?: string } | null)?.liquidatedUser ?? "").toLowerCase() === w.address,
    ).length;
    const tr = await db
      .select({ status: s.trades.status, n: sql<number>`count(*)`, net: sql<number>`sum(${s.trades.netPnl})` })
      .from(s.trades)
      .where(
        and(
          eq(s.trades.walletId, w.id),
          isNull(s.trades.deletedAt),
          sql`coalesce(json_extract(${s.trades.flags}, '$.superseded'), 0) = 0`,
        ),
      )
      .groupBy(s.trades.status);
    const flags = await db
      .select({
        gap: sql<number>`sum(coalesce(json_extract(${s.trades.flags}, '$.gap'), 0))`,
        partial: sql<number>`sum(coalesce(json_extract(${s.trades.flags}, '$.partialHistory'), 0))`,
        superseded: sql<number>`sum(coalesce(json_extract(${s.trades.flags}, '$.superseded'), 0))`,
        liq: sql<number>`sum(coalesce(json_extract(${s.trades.flags}, '$.liquidated'), 0))`,
        liqCp: sql<number>`sum(coalesce(json_extract(${s.trades.flags}, '$.liquidationCounterparty'), 0))`,
        nonUsd: sql<number>`sum(coalesce(json_extract(${s.trades.flags}, '$.nonUsdcFee'), 0))`,
      })
      .from(s.trades)
      .where(eq(s.trades.walletId, w.id));
    const [fund] = await db.select({ n: sql<number>`count(*)` }).from(s.fundingEvents).where(eq(s.fundingEvents.walletId, w.id));

    console.log(`Wallet "${w.label}" (${w.kind})`);
    console.log(`  fills stored:      ${fc.n}  (${byType.map((b) => `${b.t} ${b.n}`).join(", ")})`);
    console.log(`  coverage:          ${dt(w.oldestFillTime)}  →  ${dt(w.lastFillTime)}`);
    console.log(`  backfill complete: ${w.backfillCompletedAt ? "yes" : "NO (run sync:backfill again)"}`);
    console.log(`  history truncated: ${w.historyTruncated ? "POSSIBLY (≥10,000 fills; HL serves only the most recent 10,000)" : "no"}`);
    for (const t of tr) console.log(`  trades ${pad(t.status, 7)}    ${t.n}  (net P&L sum ${usd(t.net)})`);
    console.log(
      `  trade flags:       gap ${flags[0].gap ?? 0}, partial history ${flags[0].partial ?? 0}, superseded ${flags[0].superseded ?? 0}, ` +
        `liquidated ${flags[0].liq ?? 0}, liquidation counterparty ${flags[0].liqCp ?? 0}, non-USD fee ${flags[0].nonUsd ?? 0}`,
    );
    console.log(`  builder-fee fills: ${builder[0].n};  funding rows: ${fund.n}`);
    console.log(
      `  non-USD fee fills: ${nonUsdc.reduce((a, r) => a + Number(r.n), 0)}` +
        (nonUsdc.length ? `  (${nonUsdc.map((r) => `${r.t} fee in ${r.token}: ${r.n}`).join(", ")})` : ""),
    );
    console.log(
      `  liquidation fills: ${liqFills.length}  (we were liquidated: ${ownLiq}, counterparty to someone else's: ${liqFills.length - ownLiq}; ` +
        `spot ${liqFills.filter((f) => f.marketType === "spot").length})\n`,
    );
  }

  const closed = await db
    .select()
    .from(s.trades)
    .where(
      and(
        eq(s.trades.status, "closed"),
        isNull(s.trades.deletedAt),
        sql`coalesce(json_extract(${s.trades.flags}, '$.superseded'), 0) = 0`,
      ),
    )
    .orderBy(desc(s.trades.exitTime))
    .limit(10);

  console.log("Last 10 closed trades (newest first). gross = Σ closedPnl, net = gross − fees (funding not yet included)");
  console.log(
    `${padL("#", 2)}  ${pad("pair", 16)} ${pad("dir", 5)} ${pad("entry", 22)} ${pad("exit", 22)} ${padL("avg entry", 11)} ${padL("avg exit", 11)} ${padL("size", 10)} ${padL("gross", 10)} ${padL("fees", 8)} ${padL("net", 10)} ${padL("fills", 5)}`,
  );
  closed.forEach((t, i) =>
    console.log(
      `${padL(i + 1, 2)}  ${pad(t.displayPair, 16)} ${pad(t.direction, 5)} ${pad(dt(t.entryTime), 22)} ${pad(dt(t.exitTime), 22)} ${padL(num(t.avgEntry), 11)} ${padL(num(t.avgExit), 11)} ${padL(num(t.sizeUnits), 10)} ${padL(usd(t.grossPnl), 10)} ${padL(usd(t.fees), 8)} ${padL(usd(t.netPnl), 10)} ${padL(t.fillCount, 5)}${Object.keys(t.flags ?? {}).length ? "  flags: " + Object.keys(t.flags).join(",") : ""}`,
    ),
  );

  if (pick) {
    const t = closed[pick - 1];
    if (!t) throw new Error(`No trade #${pick} in the list above.`);
    const legs = await db
      .select({ leg: s.tradeFills, fill: s.fills })
      .from(s.tradeFills)
      .innerJoin(s.fills, and(eq(s.fills.walletId, s.tradeFills.walletId), eq(s.fills.tid, s.tradeFills.tid)))
      .where(eq(s.tradeFills.tradeId, t.id))
      .orderBy(s.tradeFills.time);
    console.log(`\nFills of trade #${pick} (${t.displayPair} ${t.direction}). Compare each row with HL → Trade History:`);
    console.log(
      `${pad("time", 22)} ${pad("dir", 13)} ${padL("px", 11)} ${padL("sz", 10)} ${padL("closedPnl", 11)} ${padL("fee", 10)} ${padL("builderFee", 10)} ${pad("feeToken", 8)} role`,
    );
    let gross = 0;
    let fees = 0;
    for (const { leg, fill } of legs) {
      gross += leg.closedPnl;
      fees += leg.fee;
      console.log(
        `${pad(dt(fill.time), 22)} ${pad(fill.dir, 13)} ${padL(fill.px, 11)} ${padL(fill.sz, 10)} ${padL(fill.closedPnl, 11)} ${padL(fill.fee, 10)} ${padL(fill.builderFee ?? "-", 10)} ${pad(fill.feeToken, 8)} ${leg.role}${Number(fill.sz) !== leg.sz ? ` (${leg.sz} of this fill: flip split)` : ""}`,
      );
    }
    console.log(`\n  Σ closedPnl (gross) = ${usd(gross)}   Σ fee = ${usd(fees)}   net = gross − fee = ${usd(gross - fees)}`);
    console.log(`  stored on trade:      gross ${usd(t.grossPnl)}, fees ${usd(t.fees)}, net ${usd(t.netPnl)}`);
  }

  const [latestBuilder] = await db
    .select()
    .from(s.fills)
    .where(sql`${s.fills.builderFee} is not null`)
    .orderBy(desc(s.fills.time))
    .limit(1);
  if (latestBuilder) {
    console.log(
      `\nMost recent fill with a builder fee: ${latestBuilder.coin} at ${dt(latestBuilder.time)}: fee ${latestBuilder.fee} ${latestBuilder.feeToken}, builderFee ${latestBuilder.builderFee}, px ${latestBuilder.px}, sz ${latestBuilder.sz}`,
    );
  } else {
    console.log("\nNo fills with a builder fee found (expected if you only trade on the Hyperliquid UI).");
  }
}

main().catch((err) => {
  console.error("verify:sync failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
