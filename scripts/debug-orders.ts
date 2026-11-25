/**
 * npm run debug:orders — READ-ONLY probe of your Hyperliquid trigger orders (stop loss / take profit),
 * to confirm their exact shape before SL/TP auto-detection is built.
 *
 * Prints counts and patterns only: no addresses, no prices, no sizes. Safe to paste back.
 * Writes no data (it only applies pending schema migrations, like every other script).
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

type O = {
  coin: string;
  side: string;
  oid: number;
  timestamp: number;
  orderType: string;
  isTrigger: boolean;
  triggerCondition: string;
  isPositionTpsl: boolean;
  reduceOnly: boolean;
  tif?: string | null;
  children?: O[];
};

const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
const table = (title: string, m: Map<string, number>, limit = 20) => {
  console.log(`\n${title}`);
  if (!m.size) return console.log("  (none)");
  for (const [k, v] of [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)) console.log(`  ${String(v).padStart(5)}  ${k}`);
};
/** "Price below 2412.7" → "Price below <px>" so no prices are printed. */
const shape = (s: string) => s.replace(/-?\d+(\.\d+)?(e-?\d+)?/gi, "<px>");

async function main() {
  const { getDb } = await import("../src/server/db/client");
  const s = await import("../src/server/db/schema");
  const { eq, inArray, and, isNull } = await import("drizzle-orm");
  const { mergeOrderRows } = await import("../src/server/hyperliquid/orders");
  const { detectProtection } = await import("../src/server/protection/detect");
  type ProtectionOrder = import("../src/server/protection/detect").ProtectionOrder;
  const { getHlClient } = await import("../src/server/hyperliquid");
  const { parseCoin } = await import("../src/server/hyperliquid/markets");

  const db = getDb();
  const { runMigrations } = await import("../src/server/db/bootstrap");
  await runMigrations(db);
  const wallets = await db.select().from(s.wallets).where(and(eq(s.wallets.enabled, true), eq(s.wallets.exchange, "hyperliquid")));
  if (!wallets.length) throw new Error("No wallets. Run npm run sync:backfill first.");
  const client = getHlClient();

  for (const w of wallets) {
    console.log(`\n=== Wallet "${w.label}" ===`);
    const hist = await client.historicalOrders(w.address);
    const status = new Map<string, number>();
    const types = new Map<string, number>();
    const trig = new Map<string, number>();
    const conds = new Map<string, number>();
    const nesting = new Map<string, number>();
    const markets = new Map<string, number>();
    const triggerOids: number[] = [];
    let oldest = Infinity;
    let childCount = 0;

    const visit = (o: O, st: string, depth: number) => {
      inc(types, `${o.orderType}${o.isTrigger ? " (trigger)" : ""}`);
      if (o.isTrigger) {
        inc(trig, `${o.orderType} | positionTpsl=${o.isPositionTpsl} reduceOnly=${o.reduceOnly} tif=${o.tif ?? "-"} | status=${st}${depth ? " | child" : ""}`);
        inc(conds, shape(o.triggerCondition));
        inc(markets, parseCoin(o.coin).marketType);
        triggerOids.push(o.oid);
      }
      if (o.children?.length) {
        inc(nesting, `${o.orderType}${o.isTrigger ? " (trigger)" : ""} → ${o.children.map((c) => c.orderType).join(" + ")}`);
        childCount += o.children.length;
        for (const c of o.children) visit(c, "(child)", depth + 1);
      }
    };
    for (const h of hist) {
      inc(status, h.status);
      oldest = Math.min(oldest, h.order.timestamp);
      visit(h.order as O, h.status, 0);
    }

    console.log(`historicalOrders: ${hist.length} orders (API max 2000), ${childCount} nested children`);
    if (hist.length) console.log(`oldest order: ${new Date(oldest).toISOString().slice(0, 10)}`);
    table("Order types", types);
    table("Statuses", status);
    table("Trigger orders: type | flags | status", trig, 30);
    table("Trigger conditions (prices masked)", conds);
    table("Parent → children nesting", nesting);
    table("Trigger orders by market type (perp / hip3 / spot)", markets);

    // Rows → one record per order id (what sync stores). Nested children carry the parent's oid, so they
    // are not counted as orders of their own.
    const merged = mergeOrderRows(w.id, hist);
    const mTrig = merged.filter((o) => o.isTrigger);
    const finals = new Map<string, number>();
    for (const o of mTrig) inc(finals, `${o.orderType} | final status ${o.status}`);
    const childIds = new Set(hist.flatMap((h) => (h.order.children ?? []).map((c) => c.oid)));
    console.log(
      `\nAfter merging rows per order id: ${merged.length} orders, ${mTrig.length} trigger orders.` +
        `\n  (${triggerOids.length} trigger entries above = ${triggerOids.length - childCount} history rows + ${childCount} nested children;` +
        ` the children carry ${childIds.size} parent order ids, so they are not orders of their own)`,
    );
    table("Trigger orders by final status", finals);
    const oids = mTrig.map((o) => o.oid);
    let matched = 0;
    for (let i = 0; i < oids.length; i += 200) {
      const rows = await db
        .select({ oid: s.fills.oid })
        .from(s.fills)
        .where(and(eq(s.fills.walletId, w.id), inArray(s.fills.oid, oids.slice(i, i + 200))));
      matched += new Set(rows.map((r) => r.oid)).size;
    }
    const fired = mTrig.filter((o) => o.status === "triggered").length;
    console.log(`Trigger orders that fired: ${fired}; of those with fills stored locally: ${matched}`);

    // Preview of auto-detection on your stored trades (read-only: nothing is written).
    const trades = (
      await db
        .select()
        .from(s.trades)
        .where(and(eq(s.trades.walletId, w.id), eq(s.trades.source, "hyperliquid"), isNull(s.trades.deletedAt)))
    ).filter((t) => !t.flags?.superseded);
    const journals = new Map((await db.select().from(s.tradeJournal)).map((j) => [j.tradeId, j]));
    const orders = merged as unknown as ProtectionOrder[];
    const now = Date.now();
    let sl = 0, tp = 0, ladders = 0, moved = 0, yours = 0, differs = 0;
    for (const t of trades) {
      const d = detectProtection(t, orders, now);
      if (d.stopLoss) sl++;
      if (d.takeProfit) tp++;
      if (d.tpPartials.length) ladders++;
      if (d.stopMoves.length) moved++;
      const j = journals.get(t.id);
      if (d.stopLoss && j?.stopLoss != null && j.stopLossSource !== "auto") {
        yours++;
        if (Math.abs(j.stopLoss - d.stopLoss.price) > Math.abs(d.stopLoss.price) * 1e-9) differs++;
      }
    }
    console.log(`\nAuto-detection preview over ${trades.length} trades (nothing written):`);
    console.log(`  stop loss found: ${sl}   take profit found: ${tp}   TP ladders: ${ladders}   trades with stop moves: ${moved}`);
    console.log(`  your own stop losses kept as-is: ${yours} (${differs} differ from the order)`);

    // Live trigger orders on each dex (main + HIP-3)
    const dexes = await client.perpDexNames();
    const live = new Map<string, number>();
    for (const dex of dexes) {
      const open = await client.frontendOpenOrders(w.address, dex);
      for (const o of open as O[]) if (o.isTrigger) inc(live, `${dex || "main"} | ${o.orderType} | positionTpsl=${o.isPositionTpsl}`);
    }
    table("Open trigger orders now, by dex", live);
  }
  console.log("\nDone. Paste this output back: it contains no addresses or prices.");
}

main().catch((e) => {
  console.error("debug:orders failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
