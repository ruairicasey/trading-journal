/**
 * npm run debug:r                 — R-multiple audit of your local database
 * npm run debug:r -- --remote     — same, against the deployed Turso database (.env.production.local)
 *
 * READ-ONLY. Shows the R distribution, flags trades whose stop makes R misleading (stop very close to entry,
 * stop placed late, stop on the profit side of entry, size added after the stop), what average R would be
 * without each group, and the most negative R trades with their stop timing. Prints counts, R multiples and
 * percentages only: never an address, a price, a size or a $ amount, so the output is safe to paste back.
 */
import { loadEnvConfig } from "@next/env";

const remote = process.argv.includes("--remote");
loadEnvConfig(process.cwd(), !remote);
const topArg = process.argv.indexOf("--top");
const TOP = topArg > -1 ? Math.max(1, Number(process.argv[topArg + 1]) || 5) : 5;


const pad = (v: unknown, n: number) => String(v ?? "—").padEnd(n).slice(0, n);
const padL = (v: unknown, n: number) => String(v ?? "—").padStart(n).slice(-n);
const r2 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : n.toFixed(2));
const mins = (ms: number) => {
  const m = ms / 60_000;
  if (Math.abs(m) < 1) return `${Math.round(ms / 1000)}s`;
  if (Math.abs(m) < 120) return `${m.toFixed(0)}m`;
  return `${(m / 60).toFixed(1)}h`;
};

async function main() {
  const { getConfig } = await import("../src/server/config");
  if (remote && !getConfig().db.url.startsWith("libsql:")) {
    throw new Error("--remote needs DATABASE_URL=libsql://… and DATABASE_AUTH_TOKEN in .env.production.local");
  }
  const { getDb } = await import("../src/server/db/client");
  const s = await import("../src/server/db/schema");
  const { and, eq, inArray, isNull } = await import("drizzle-orm");
  const { detectProtection } = await import("../src/server/protection/detect");
  const { AUDIT, auditTrade, summarize, mean, median } = await import("../src/server/protection/audit");
  const TIGHT_PCT = AUDIT.TIGHT_PCT;
  const BE_PCT = AUDIT.BE_PCT;
  const LATE_MIN = AUDIT.LATE_MS / 60_000;
  type ProtectionOrder = import("../src/server/protection/detect").ProtectionOrder;
  const { fmtDateTime } = await import("../src/lib/format");
  const db = getDb();

  const tzRow = await db.query.settings.findFirst({ where: eq(s.settings.key, "timezone") });
  const tz = (tzRow?.value as string) ?? getConfig().timezone;

  const trades = (
    await db
      .select()
      .from(s.trades)
      .where(and(eq(s.trades.status, "closed"), isNull(s.trades.deletedAt)))
  ).filter((t) => !t.flags?.superseded);
  const ids = trades.map((t) => t.id);
  const journals = new Map<string, typeof s.tradeJournal.$inferSelect>();
  for (let i = 0; i < ids.length; i += 400)
    for (const j of await db.select().from(s.tradeJournal).where(inArray(s.tradeJournal.tradeId, ids.slice(i, i + 400)))) journals.set(j.tradeId, j);
  const orders = (await db.select().from(s.orders).where(eq(s.orders.isTrigger, true))) as (ProtectionOrder & { walletId: string; status: string })[];
  const ordersByWalletCoin = new Map<string, typeof orders>();
  for (const o of orders) {
    const k = `${o.walletId}|${o.coin}`;
    ordersByWalletCoin.set(k, [...(ordersByWalletCoin.get(k) ?? []), o]);
  }
  const statusByOid = new Map(orders.map((o) => [`${o.walletId}|${o.oid}`, o]));

  type Row = {
    t: (typeof trades)[number];
    sl: number;
    source: string;
    r: number;
    risk: number;
    distPct: number;
    stopPlaced: number | null; // detected initial stop order placement
    moves: number;
    addedAfterStop: number; // entry units added after the initial stop was placed
    exitBy: string;
    flags: import("../src/server/protection/audit").AuditFlag[];
  };
  const rows: Row[] = [];
  const now = Date.now();
  for (const t of trades) {
    const j = journals.get(t.id);
    if (j?.stopLoss == null || t.entryTime == null) continue;
    const det = t.walletId ? detectProtection(t, ordersByWalletCoin.get(`${t.walletId}|${t.coin}`) ?? [], now) : null;
    const stopPlaced = det?.stopLoss?.placedAt ?? null;

    // legs: which entries came after the stop was placed, and did a trigger order close it?
    const legs = await db
      .select({ role: s.tradeFills.role, sz: s.tradeFills.sz, time: s.tradeFills.time, oid: s.fills.oid })
      .from(s.tradeFills)
      .leftJoin(s.fills, and(eq(s.fills.walletId, s.tradeFills.walletId), eq(s.fills.tid, s.tradeFills.tid)))
      .where(eq(s.tradeFills.tradeId, t.id));
    const addedAfterStop = stopPlaced === null ? 0 : legs.filter((l) => l.role === "entry" && l.time > stopPlaced).reduce((a, l) => a + l.sz, 0);
    const exitOrders = legs
      .filter((l) => l.role === "exit" && l.oid != null)
      .map((l) => statusByOid.get(`${t.walletId}|${l.oid}`))
      .filter((o): o is NonNullable<typeof o> => !!o);
    const exitBy = exitOrders.length
      ? [...new Set(exitOrders.map((o) => (o.orderType.toLowerCase().includes("take profit") ? "TP order" : "stop order")))].join("+")
      : t.flags?.liquidated
        ? "liquidated"
        : "manual/limit";

    const a = auditTrade({ ...t, stopLoss: j.stopLoss, stopLossSource: j.stopLossSource, stopPlaced, addedAfterStop });
    if (!a) continue;
    const { r, risk, distPct, flags } = a;
    rows.push({ t, sl: j.stopLoss, source: j.stopLossSource ?? "user (pre-auto)", r, risk, distPct, stopPlaced, moves: det?.stopMoves.length ?? 0, addedAfterStop, exitBy, flags });
  }

  const avg = mean;
  const sum = summarize(rows);

  console.log(`\n=== R audit (${remote ? "deployed database" : "local database"}) ===`);
  console.log(`closed trades: ${trades.length}, with a stop loss (R computable): ${rows.length}`);
  const rs = rows.map((x) => x.r);
  console.log(`average R: ${r2(avg(rs))}   median R: ${r2(median(rs))}   (R = net / (|avg entry − stop| × max size))`);
  for (const src of [...new Set(rows.map((x) => x.source))]) {
    const sub = rows.filter((x) => x.source === src).map((x) => x.r);
    console.log(`  stop source ${pad(src, 16)} n=${padL(sub.length, 4)}  avg ${padL(r2(avg(sub)), 7)}  median ${padL(r2(median(sub)), 6)}`);
  }

  console.log("\nR distribution");
  const edges = [-Infinity, -10, -5, -3, -2, -1, 0, 1, 2, 3, 5, 10, Infinity];
  for (let i = 0; i < edges.length - 1; i++) {
    const n = rs.filter((r) => r >= edges[i] && r < edges[i + 1]).length;
    const label = `${edges[i] === -Infinity ? "" : edges[i]}…${edges[i + 1] === Infinity ? "" : edges[i + 1]}`;
    console.log(`  ${padL(label, 9)}R  ${padL(n, 4)}  ${"█".repeat(Math.round((n / Math.max(1, rows.length)) * 60))}`);
  }

  console.log(`\nFlags (thresholds: tight < ${TIGHT_PCT}% of entry, breakeven < ${BE_PCT}%, late > ${LATE_MIN} min after entry)`);
  const groups: [string, string][] = [
    ["profit-side", "stop on the profit side of entry (a trailing/BE stop, not a risk stop)"],
    ["breakeven", `stop within ${BE_PCT}% of entry`],
    ["tight", `stop ${BE_PCT}–${TIGHT_PCT}% from entry`],
    ["late", `auto stop first placed > ${LATE_MIN} min after entry`],
    ["added-after", "size added after the auto stop was placed (R uses the full size)"],
    ["beyond-stop", "R < −1.5 with none of the above (slippage, or a stop that wasn't the real exit)"],
  ];
  for (const [flag, what] of groups) {
    const g = sum.byFlag[flag as keyof typeof sum.byFlag];
    console.log(`  ${pad(flag, 12)} n=${padL(g.n, 4)}  their avg R ${padL(r2(g.avg), 8)}  avg R without them ${padL(r2(g.avgWithout), 6)}  ${what}`);
  }
  console.log(`  unflagged    n=${padL(sum.unflagged.n, 4)}  avg R ${r2(sum.unflagged.avg)}  median ${r2(sum.unflagged.median)}`);

  // share of the trade's total entry size that came after the stop was placed (a percentage, never units)
  const addedPct = (x: Row) => {
    const total = x.t.entryUnitsTotal ?? x.t.sizeUnits;
    return total ? `${Math.round((x.addedAfterStop / total) * 100)}%` : "some";
  };

  console.log(`\n${TOP} most negative R`);
  console.log(
    `  ${pad("#", 3)}${pad(`exit (${tz})`, 29)}${pad("pair", 17)}${pad("dir", 6)}${padL("R", 8)}${padL("dist%", 7)}  ${pad("source", 16)}${pad("stop placed", 22)}${padL("moves", 6)}  ${pad("closed by", 13)}flags`,
  );
  rows
    .sort((a, b) => a.r - b.r)
    .slice(0, TOP)
    .forEach((x, i) => {
      const placed = x.stopPlaced === null ? "no stop order" : x.stopPlaced >= x.t.entryTime! ? `${mins(x.stopPlaced - x.t.entryTime!)} after entry` : `${mins(x.t.entryTime! - x.stopPlaced)} before entry`;
      console.log(
        `  ${pad(i + 1, 3)}${pad(fmtDateTime(x.t.exitTime, tz), 29)}${pad(x.t.displayPair, 17)}${pad(x.t.direction, 6)}${padL(r2(x.r), 8)}${padL(x.distPct.toFixed(3), 7)}  ${pad(x.source, 16)}${pad(placed, 22)}${padL(x.moves, 6)}  ${pad(x.exitBy, 13)}${x.flags.join(", ") || "—"}${x.addedAfterStop ? `  (${addedPct(x)} of the size added after the stop)` : ""}`,
      );
    });
  console.log("\nRead-only: nothing was written. No addresses in this output.");
}

main().catch((e) => {
  console.error("debug:r failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
