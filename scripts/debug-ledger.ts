/**
 * npm run debug:ledger                 — local database
 * npm run debug:ledger -- --remote     — the deployed (Turso) database, via .env.production.local
 *
 * READ-ONLY probe of Hyperliquid's non-funding ledger (deposits, withdrawals, transfers, vault flows) before
 * Phase 2 item 4 stores it. Prints entry types, how each would be classified, and a reconciliation of
 *   ledger flows + realised trading P&L + funding + unrealised P&L  vs  Hyperliquid's account value now,
 * as a PERCENTAGE only. No addresses, no amounts, no hashes: safe to paste back.
 */
import { loadEnvConfig } from "@next/env";

const remote = process.argv.includes("--remote");
loadEnvConfig(process.cwd(), !remote);

const pad = (v: unknown, n: number) => String(v ?? "—").padEnd(n).slice(0, n);
const padL = (v: unknown, n: number) => String(v ?? "—").padStart(n).slice(-n);
const pct = (x: number | null) => (x === null || !Number.isFinite(x) ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`);

async function main() {
  const { getConfig } = await import("../src/server/config");
  if (remote && !getConfig().db.url.startsWith("libsql:")) throw new Error("--remote needs DATABASE_URL=libsql://… and DATABASE_AUTH_TOKEN in .env.production.local");
  const { getDb } = await import("../src/server/db/client");
  const s = await import("../src/server/db/schema");
  const { and, eq, ne } = await import("drizzle-orm");
  const { getHlClient } = await import("../src/server/hyperliquid");
  const { classifyLedger } = await import("../src/server/hyperliquid/ledger");
  const { LEDGER_PAGE_LIMIT } = await import("../src/server/hyperliquid/schemas");
  const { fetchPositions } = await import("../src/server/hyperliquid/sync");
  const db = getDb();
  const client = getHlClient();

  const wallets = await db.select().from(s.wallets).where(eq(s.wallets.enabled, true));
  if (!wallets.length) throw new Error("No enabled wallets in this database.");
  for (const w of wallets) {
    console.log(`\n=== Wallet "${w.label}" (${remote ? "deployed database" : "local database"}) ===`);

    // ── ledger, paginated (≤2000 per page, ascending, inclusive start) ──
    const seen = new Set<string>();
    const rows: Awaited<ReturnType<typeof client.userNonFundingLedgerUpdates>> = [];
    let start = 0;
    let pages = 0;
    for (;;) {
      const page = await client.userNonFundingLedgerUpdates(w.address, start);
      pages++;
      for (const r of page) {
        const k = `${r.time}|${r.hash}|${r.delta.type}|${JSON.stringify(r.delta)}`;
        if (!seen.has(k)) {
          seen.add(k);
          rows.push(r);
        }
      }
      if (page.length < LEDGER_PAGE_LIMIT) break;
      const last = page[page.length - 1].time;
      start = last > start ? last : start + 1;
      if (pages > 50) break;
    }
    const first = rows[0]?.time;
    console.log(`ledger: ${rows.length} entries in ${pages} page(s)${first ? `, oldest ${new Date(first).toISOString().slice(0, 10)}` : ""}`);

    // ── types → classification ──
    const byType = new Map<string, { n: number; kinds: Map<string, number>; fields: string }>();
    const sendDex = new Map<string, number>();
    let flows = 0;
    let flowsFeeInside = 0; // alternative assumption: withdraw fee already inside `usdc`
    const kindCount = new Map<string, number>();
    for (const r of rows) {
      const c = classifyLedger(r, w.address);
      const t = String(r.delta.type);
      const e = byType.get(t) ?? { n: 0, kinds: new Map(), fields: Object.keys(r.delta).filter((k) => k !== "type").sort().join(",") };
      e.n++;
      e.kinds.set(c.kind, (e.kinds.get(c.kind) ?? 0) + 1);
      byType.set(t, e);
      kindCount.set(c.kind, (kindCount.get(c.kind) ?? 0) + 1);
      flows += c.perpUsd;
      flowsFeeInside += t === "withdraw" ? c.perpUsd + Number((r.delta as Record<string, unknown>).fee ?? 0) : c.perpUsd;
      if (t === "send") {
        const d = r.delta as Record<string, unknown>;
        const dex = (x: unknown) => (x === "" ? "main" : String(x ?? "—"));
        const k = `${dex(d.sourceDex)} → ${dex(d.destinationDex)} | token ${String(d.token ?? "—")}`;
        sendDex.set(k, (sendDex.get(k) ?? 0) + 1);
      }
    }
    console.log("\nEntry types → classification");
    for (const [t, e] of [...byType].sort((a, b) => b[1].n - a[1].n)) {
      console.log(`  ${padL(e.n, 5)}  ${pad(t, 24)} ${pad([...e.kinds].map(([k, v]) => `${k}×${v}`).join(" "), 34)} fields: ${e.fields}`);
    }
    if (sendDex.size) {
      console.log("\n`send` entries by dex (source → destination) and token");
      for (const [k, v] of sendDex) console.log(`  ${padL(v, 5)}  ${k}`);
    }
    const unknown = kindCount.get("unknown") ?? 0;
    if (unknown) console.log(`\n⚠ ${unknown} entr${unknown === 1 ? "y" : "ies"} not classified (see types marked unknown above)`);

    // ── reconciliation (percentages only) ──
    const fills = await db
      .select({ closedPnl: s.fills.closedPnl, fee: s.fills.fee, feeToken: s.fills.feeToken })
      .from(s.fills)
      .where(and(eq(s.fills.walletId, w.id), ne(s.fills.marketType, "spot")));
    const realised = fills.reduce((a, f) => a + Number(f.closedPnl) - Number(f.fee), 0);
    const funding = (await db.select({ usdc: s.fundingEvents.usdc }).from(s.fundingEvents).where(eq(s.fundingEvents.walletId, w.id))).reduce(
      (a, f) => a + Number(f.usdc),
      0,
    );
    const dexes = await client.perpDexNames();
    let perpValue = 0;
    for (const dex of dexes) perpValue += Number((await client.clearinghouseState(w.address, dex)).marginSummary.accountValue);
    const unrealised = (await fetchPositions(client, w.address)).reduce((a, p) => a + Number(p.unrealizedPnl ?? 0), 0);
    const STABLES = new Set(["USDC", "USDH", "USDT0", "USDT", "USDE"]);
    const spot = await client.spotClearinghouseState(w.address);
    const spotStable = spot.balances.filter((b) => STABLES.has(b.coin.toUpperCase())).reduce((a, b) => a + Number(b.total), 0);
    const otherSpot = spot.balances.filter((b) => !STABLES.has(b.coin.toUpperCase()) && Number(b.total) !== 0).length;
    const mode = await client.userAbstraction(w.address).catch(() => null);

    const expected = flows + realised + funding + unrealised;
    const expectedAlt = flowsFeeInside + realised + funding + unrealised;
    const vs = (target: number, exp: number) => (target !== 0 ? ((exp - target) / Math.abs(target)) * 100 : null);
    // in a unified account the spot stablecoin balance is the collateral, and open P&L shows in the perp view
    const unifiedTarget = spotStable + unrealised;
    const targets: [string, number][] = [
      ["perp account value", perpValue],
      ["spot stablecoins + open P&L", unifiedTarget],
      ["perp account value + spot stablecoins", perpValue + spotStable],
    ];
    console.log("\nReconciliation: ledger flows + realised P&L (fills, net of fees) + funding + open P&L, against what you hold now");
    console.log(`  account mode: ${mode ?? "unknown"}${mode === "unifiedAccount" ? " (spot USDC is the collateral for perps)" : ""}`);
    console.log(`  stored perp fills: ${fills.length}${w.historyTruncated ? " (fill history TRUNCATED: older P&L missing, expect a gap)" : ""}; perp dexes checked: ${dexes.length}; other spot tokens held: ${otherSpot}`);
    let best: { name: string; d: number } | null = null;
    for (const [name, t] of targets) {
      const d = vs(t, expected);
      const alt = vs(t, expectedAlt);
      if (d !== null && (!best || Math.abs(d) < Math.abs(best.d))) best = { name, d };
      console.log(`  vs ${pad(name, 38)} ${padL(pct(d), 10)}   (withdraw fee inside the amount: ${pct(alt)})`);
    }
    if (best) console.log(`  closest: ${best.name} (${pct(best.d)})${Math.abs(best.d) < 1 ? "  ✓ within 1%" : ""}`);
    console.log("  A positive difference means the ledger + P&L add up to MORE than you hold (a missing outflow); negative, less.");
  }
  console.log("\nRead-only. No addresses or amounts in this output.");
}

main().catch((e) => {
  console.error("debug:ledger failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
