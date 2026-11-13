/**
 * npm run debug:orders — READ-ONLY probe of your Hyperliquid trigger orders (stop loss / take profit),
 * to confirm their exact shape before SL/TP auto-detection is built.
 *
 * Prints counts and patterns only: no addresses, no prices, no sizes. Safe to paste back.
 * Writes nothing to the database.
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
  const { eq, inArray, and } = await import("drizzle-orm");
  const { getHlClient } = await import("../src/server/hyperliquid");
  const { parseCoin } = await import("../src/server/hyperliquid/markets");

  const db = getDb();
  const wallets = await db.select().from(s.wallets).where(eq(s.wallets.enabled, true));
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

    // Do executed trigger orders show up as the oid on our stored fills?
    const uniq = [...new Set(triggerOids)];
    let matched = 0;
    for (let i = 0; i < uniq.length; i += 200) {
      const rows = await db
        .select({ oid: s.fills.oid })
        .from(s.fills)
        .where(and(eq(s.fills.walletId, w.id), inArray(s.fills.oid, uniq.slice(i, i + 200))));
      matched += new Set(rows.map((r) => r.oid)).size;
    }
    console.log(`\nTrigger orders whose oid appears on a stored fill: ${matched} of ${uniq.length}`);

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
