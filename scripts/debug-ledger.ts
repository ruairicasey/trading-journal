/**
 * npm run debug:ledger                 — local database
 * npm run debug:ledger -- --remote     — the deployed (Turso) database, via .env.production.local
 *
 * READ-ONLY probe of Hyperliquid's non-funding ledger (deposits, withdrawals, transfers, vault flows) before
 * Phase 2 item 4 stores it. Prints entry types, how each is classified for your account mode, and reconciles
 *   ledger flows + realised P&L (perp and, for unified accounts, spot) + funding + open P&L  vs  what you hold,
 * with every component as a signed % of current holdings. No addresses, no amounts, no hashes: safe to paste.
 */
import { loadEnvConfig } from "@next/env";

const remote = process.argv.includes("--remote");
loadEnvConfig(process.cwd(), !remote);

const pad = (v: unknown, n: number) => String(v ?? "—").padEnd(n).slice(0, n);
const padL = (v: unknown, n: number) => String(v ?? "—").padStart(n).slice(-n);
const pct = (x: number | null) => (x === null || !Number.isFinite(x) ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`);
const day = (t: number | null | undefined) => (t ? new Date(t).toISOString().slice(0, 10) : "—");
const STABLES = new Set(["USDC", "USDH", "USDT0", "USDT", "USDE"]);
const isStable = (tok: string) => STABLES.has(tok.trim().split(":")[0].toUpperCase());

async function main() {
  const { getConfig } = await import("../src/server/config");
  if (remote && !getConfig().db.url.startsWith("libsql:")) throw new Error("--remote needs DATABASE_URL=libsql://… and DATABASE_AUTH_TOKEN in .env.production.local");
  const { getDb } = await import("../src/server/db/client");
  const s = await import("../src/server/db/schema");
  const { and, eq, min } = await import("drizzle-orm");
  const { getHlClient } = await import("../src/server/hyperliquid");
  const { classifyLedger } = await import("../src/server/hyperliquid/ledger");
  const { LEDGER_PAGE_LIMIT } = await import("../src/server/hyperliquid/schemas");
  const { fetchPositions } = await import("../src/server/hyperliquid/sync");
  const db = getDb();
  const client = getHlClient();

  const wallets = await db.select().from(s.wallets).where(and(eq(s.wallets.enabled, true), eq(s.wallets.exchange, "hyperliquid")));
  if (!wallets.length) throw new Error("No enabled wallets in this database.");
  for (const w of wallets) {
    console.log(`\n=== Wallet "${w.label}" (${remote ? "deployed database" : "local database"}) ===`);
    const mode = await client.userAbstraction(w.address).catch(() => null);
    const unified = mode === "unifiedAccount";
    console.log(`account mode: ${mode ?? "unknown"}${unified ? " (spot stablecoins are the collateral for perps)" : ""}`);

    // ── ledger, paginated (≤2000 per page, ascending, inclusive start) ──
    const seen = new Set<string>();
    const rows: Awaited<ReturnType<typeof client.userNonFundingLedgerUpdates>> = [];
    let start = 0;
    let pages = 0;
    for (;;) {
      const page = await client.userNonFundingLedgerUpdates(w.address, start);
      pages++;
      for (const r of page) {
        const k = `${r.time}|${r.hash}|${JSON.stringify(r.delta)}`;
        if (!seen.has(k)) {
          seen.add(k);
          rows.push(r);
        }
      }
      if (page.length < LEDGER_PAGE_LIMIT || pages > 50) break;
      const last = page[page.length - 1].time;
      start = last > start ? last : start + 1;
    }

    // ── classify; signed totals per type ──
    const byType = new Map<string, { n: number; kinds: Map<string, number>; usd: number; fields: string }>();
    const tokens = new Map<string, number>();
    let flows = 0;
    let withdrawFees = 0;
    let nonStableFees = 0;
    let unknown = 0;
    for (const r of rows) {
      const d = r.delta as Record<string, unknown>;
      const c = classifyLedger(r, w.address, { unified });
      const t = String(d.type);
      const e = byType.get(t) ?? { n: 0, kinds: new Map(), usd: 0, fields: Object.keys(d).filter((k) => k !== "type").sort().join(",") };
      e.n++;
      e.usd += c.perpUsd;
      e.kinds.set(c.kind, (e.kinds.get(c.kind) ?? 0) + 1);
      byType.set(t, e);
      flows += c.perpUsd;
      if (c.kind === "unknown") unknown++;
      if (t === "withdraw") withdrawFees += Number(d.fee ?? 0);
      if ((t === "send" || t === "spotTransfer") && d.feeToken && !isStable(String(d.feeToken)) && Number(d.fee ?? 0) !== 0) nonStableFees++;
      if (t === "send" || t === "spotTransfer") {
        const dex = (x: unknown) => (x === undefined ? "" : x === "" ? "main" : String(x));
        const k = `${t} ${dex(d.sourceDex)}${d.sourceDex !== undefined ? "→" : ""}${dex(d.destinationDex)} ${String(d.token ?? "—")} ${String(d.user ?? "").toLowerCase() === w.address ? "out" : "in"}`;
        tokens.set(k, (tokens.get(k) ?? 0) + 1);
      }
    }

    // ── P&L components from the stored fills and funding ──
    const fills = await db
      .select({ marketType: s.fills.marketType, closedPnl: s.fills.closedPnl, fee: s.fills.fee, feeToken: s.fills.feeToken, px: s.fills.px })
      .from(s.fills)
      .where(eq(s.fills.walletId, w.id));
    let perpPnl = 0;
    let perpFees = 0;
    let spotPnl = 0;
    let spotFees = 0;
    let perpN = 0;
    let spotN = 0;
    for (const f of fills) {
      // a fee in a non-stable token (spot buys pay it in the base token) is valued at the fill price
      const feeUsd = isStable(f.feeToken) ? Number(f.fee) : Number(f.fee) * Number(f.px);
      if (f.marketType === "spot") {
        spotN++;
        spotPnl += Number(f.closedPnl);
        spotFees += feeUsd;
      } else {
        perpN++;
        perpPnl += Number(f.closedPnl);
        perpFees += feeUsd;
      }
    }
    const funding = (await db.select({ usdc: s.fundingEvents.usdc }).from(s.fundingEvents).where(eq(s.fundingEvents.walletId, w.id))).reduce(
      (a, f) => a + Number(f.usdc),
      0,
    );
    const [firstFill] = await db.select({ t: min(s.fills.time) }).from(s.fills).where(eq(s.fills.walletId, w.id));

    // ── what you hold now ──
    const dexes = await client.perpDexNames();
    let perpValue = 0;
    for (const dex of dexes) perpValue += Number((await client.clearinghouseState(w.address, dex)).marginSummary.accountValue);
    const unrealised = (await fetchPositions(client, w.address)).reduce((a, p) => a + Number(p.unrealizedPnl ?? 0), 0);
    const spot = await client.spotClearinghouseState(w.address);
    const spotStable = spot.balances.filter((b) => isStable(b.coin)).reduce((a, b) => a + Number(b.total), 0);
    const otherSpot = spot.balances.filter((b) => !isStable(b.coin) && Number(b.total) !== 0).length;
    // unified: the spot stablecoin balance is the collateral and already includes open P&L (verified live: it
    // moves with unrealised P&L); standard: the perp account value (which also includes open P&L)
    const target = unified ? spotStable : perpValue;
    const targetName = unified ? "spot stablecoins" : "perp account value";
    const of = (x: number) => (target !== 0 ? (x / Math.abs(target)) * 100 : null);

    console.log(`ledger: ${rows.length} entries in ${pages} page(s), oldest ${day(rows[0]?.time)}; oldest stored fill ${day(firstFill?.t)}`);
    if (rows[0] && firstFill?.t && rows[0].time > firstFill.t) console.log("  ⚠ the ledger starts AFTER your first fill: an earlier deposit may be missing from it");
    console.log("\nEntry types → classification, signed total as % of what you hold now");
    for (const [t, e] of [...byType].sort((a, b) => b[1].n - a[1].n)) {
      console.log(`  ${padL(e.n, 4)}  ${pad(t, 22)} ${padL(pct(of(e.usd)), 11)}  ${pad([...e.kinds].map(([k, v]) => `${k}×${v}`).join(" "), 30)} fields: ${e.fields}`);
    }
    if (tokens.size) {
      console.log("\nTransfers by route, token and direction");
      for (const [k, v] of tokens) console.log(`  ${padL(v, 4)}  ${k}`);
    }
    if (unknown) console.log(`\n⚠ ${unknown} entr${unknown === 1 ? "y" : "ies"} not classified`);
    if (nonStableFees) console.log(`note: ${nonStableFees} transfer fee(s) paid in a non-stable token are left out`);

    const comps: [string, number][] = [
      ["ledger flows (all types above)", flows],
      [`perp realised P&L (${perpN} fills)`, perpPnl],
      ["perp fees", -perpFees],
      ...(unified ? ([[`spot realised P&L (${spotN} fills)`, spotPnl], ["spot fees", -spotFees]] as [string, number][]) : []),
      ["funding", funding],
      ["open P&L", unrealised],
    ];
    const expected = comps.reduce((a, [, v]) => a + v, 0);
    console.log(`\nReconciliation against ${targetName} (= 100%)`);
    for (const [name, v] of comps) console.log(`  ${pad(name, 36)} ${padL(pct(of(v)), 11)}`);
    console.log(`  ${pad("= expected", 36)} ${padL(pct(of(expected)), 11)}`);
    const gap = of(expected - target);
    console.log(`  ${pad("difference", 36)} ${padL(pct(gap), 11)}${gap !== null && Math.abs(gap) <= 2 ? "  ✓ within 2%" : ""}`);
    console.log(`  (if withdraw fees are already inside the amount: ${pct(of(expected + withdrawFees - target))})`);
    if (!unified) console.log(`  for reference, vs perp account value + spot stablecoins: ${pct(target + spotStable !== 0 ? ((expected - target - spotStable) / Math.abs(target + spotStable)) * 100 : null)}`);
    console.log(`  other spot tokens held: ${otherSpot}${otherSpot ? " (not valued: they make holdings look smaller than they are)" : ""}; perp dexes checked: ${dexes.length}`);
    if (w.historyTruncated) console.log("  ⚠ fill history is TRUNCATED (Hyperliquid's 10k-fill limit): older P&L is missing");
    console.log("  A negative difference means ledger + P&L add up to LESS than you hold (a missing inflow); positive, more.");

    // ── what sync has stored (Phase 2 item 4, parts 1 and 2) ──
    const stored = await db.select().from(s.ledgerEvents).where(eq(s.ledgerEvents.walletId, w.id)).catch(() => null);
    console.log("\nStored in this database");
    if (stored === null) {
      console.log("  ledger_events table not found yet (deploy, then run a sync)");
    } else {
      const storedUsd = stored.reduce((a, r) => a + r.usd, 0);
      console.log(`  ledger entries: ${stored.length} stored vs ${rows.length} from the API${stored.length === rows.length ? " ✓" : ""}`);
      console.log(`  stored ledger flows: ${pct(of(storedUsd))} of holdings (API classification above: ${pct(of(flows))})${Math.abs(storedUsd - flows) < 0.01 ? " ✓" : ""}`);
      const fresh = await db.query.wallets.findFirst({ where: eq(s.wallets.id, w.id) });
      console.log(`  stored account mode: ${fresh?.accountMode ?? "not set yet"}`);
    }
    const fundRows = await db.select({ usdc: s.fundingEvents.usdc, tradeId: s.fundingEvents.tradeId }).from(s.fundingEvents).where(eq(s.fundingEvents.walletId, w.id));
    const attributed = fundRows.filter((r) => r.tradeId);
    const tradeFunding = (await db.select({ f: s.trades.funding }).from(s.trades).where(eq(s.trades.walletId, w.id))).reduce((a, t) => a + (t.f ?? 0), 0);
    const attributedUsd = attributed.reduce((a, r) => a + Number(r.usdc), 0);
    console.log(`  funding payments attributed to a trade: ${attributed.length} of ${fundRows.length}`);
    console.log(`  funding on trades: ${pct(of(tradeFunding))} of holdings; attributed payments: ${pct(of(attributedUsd))}${Math.abs(tradeFunding - attributedUsd) < 0.01 ? " ✓" : ""}; all payments: ${pct(of(funding))}`);

    // the dashboard's account-balance view, computed exactly as the page does (whole account)
    const { balanceInputs } = await import("../src/server/db/queries/dashboard");
    const { balanceCurve } = await import("../src/lib/stats");
    const bal = await balanceInputs(db, w.accountId);
    if (!bal) {
      console.log("  balance view: off (an enabled wallet on this account hasn't finished its fill, funding or ledger backfill, or its history is truncated)");
    } else {
      const last = balanceCurve([], bal.flows, bal.cash, { from: null, to: null }).at(-1);
      const shown = last?.equity ?? 0;
      const gapB = of(shown + unrealised - target);
      console.log(`  balance view: ${pct(of(shown))} of holdings; + open P&L = ${pct(of(shown + unrealised))}; difference ${pct(gapB)}${gapB !== null && Math.abs(gapB) <= 2 ? "  ✓ within 2%" : ""}`);
      console.log(`  net deposited (dashed line): ${pct(of(last?.deposited ?? 0))} of holdings`);
    }
  }
  console.log("\nRead-only. No addresses or amounts in this output.");
}

main().catch((e) => {
  console.error("debug:ledger failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
