/**
 * npm run debug:ordering                         — scan all stored fills: position jumps, old vs new ordering
 * npm run debug:ordering -- --trade 2            — fills around trade #2 of `npm run verify:sync`'s last-10 list
 * npm run debug:ordering -- --coin BTC --at "2026-11-05 22:45" [--minutes 30]
 *
 * READ-ONLY: no migrations, no writes. Run it BEFORE rebuilding to see why trades were split.
 * Prints no addresses. "old" = sort by (time, tid); "new" = same-ms fills chained by startPosition.
 * A JUMP means a fill's startPosition ≠ the previous fill's end position → the trade gets split.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const pad = (v: unknown, n: number) => String(v ?? "—").padEnd(n).slice(0, n);
const padL = (v: unknown, n: number) => String(v ?? "—").padStart(n).slice(-n);

async function main() {
  const Decimal = (await import("decimal.js")).default;
  const { getConfig } = await import("../src/server/config");
  const { getDb } = await import("../src/server/db/client");
  const s = await import("../src/server/db/schema");
  const { orderByTimeTid, orderFills, samePosition } = await import("../src/server/reconstruct/reconstruct");
  const { and, desc, eq, gte, isNull, lte, sql } = await import("drizzle-orm");
  const db = getDb();

  const tzRow = await db.query.settings.findFirst({ where: eq(s.settings.key, "timezone") });
  const tz = (tzRow?.value as string) ?? getConfig().timezone;
  const dt = (ts: number) =>
    new Intl.DateTimeFormat("en-AU", { timeZone: tz, dateStyle: "short", timeStyle: "medium", hour12: false }).format(ts) +
    "." +
    String(ts % 1000).padStart(3, "0");

  type Row = typeof s.fills.$inferSelect;
  const toFill = (r: Row) => ({ ...r, builderFee: r.builderFee, liquidation: r.liquidation ?? undefined });
  const endOf = (f: Row) => new Decimal(f.startPosition).plus(f.side === "B" ? f.sz : new Decimal(f.sz).neg());
  const jumps = (xs: Row[], tolerant: boolean) => {
    let n = 0;
    for (let i = 1; i < xs.length; i++) {
      const a = endOf(xs[i - 1]);
      const b = new Decimal(xs[i].startPosition);
      if (tolerant ? !samePosition(a, b) : !a.eq(b)) n++;
    }
    return n;
  };

  // ── scan ──
  const all = (await db
    .select()
    .from(s.fills)
    .where(sql`${s.fills.marketType} != 'spot'`)
    .orderBy(s.fills.coin, s.fills.time)) as Row[];
  const byCoin = new Map<string, Row[]>();
  for (const r of all) byCoin.set(r.coin, [...(byCoin.get(r.coin) ?? []), r]);
  let oldJ = 0;
  let newExact = 0;
  let newTol = 0;
  let groups = 0;
  const perCoin: [string, number, number][] = [];
  for (const [coin, xs] of byCoin) {
    const o = orderByTimeTid(xs.map(toFill)) as unknown as Row[];
    const n = orderFills(xs.map(toFill)) as unknown as Row[];
    const a = jumps(o, false);
    const b = jumps(n, true);
    oldJ += a;
    newExact += jumps(n, false);
    newTol += b;
    const times = new Map<number, number>();
    for (const r of xs) times.set(r.time, (times.get(r.time) ?? 0) + 1);
    groups += [...times.values()].filter((c) => c > 1).length;
    perCoin.push([coin, a, b]);
  }
  console.log(`Perp fills: ${all.length} across ${byCoin.size} coins; same-millisecond multi-fill groups: ${groups}`);
  console.log(`Position jumps  old (time, tid):            ${oldJ}`);
  console.log(`                new (chained, exact compare): ${newExact}   ← any left here are float dust`);
  console.log(`                new (chained, with dust tolerance): ${newTol}   ← should be 0 unless fills are truly missing`);
  console.log("Top coins by old jumps:", perCoin.sort((x, y) => y[1] - x[1]).slice(0, 8).map(([c, a, b]) => `${c} ${a}→${b}`).join(", "));

  // ── detail window ──
  let coin = arg("coin");
  let from: number | undefined;
  let to: number | undefined;
  const tradeN = arg("trade");
  if (tradeN) {
    const closed = await db
      .select()
      .from(s.trades)
      .where(and(eq(s.trades.status, "closed"), isNull(s.trades.deletedAt), sql`coalesce(json_extract(${s.trades.flags}, '$.superseded'), 0) = 0`))
      .orderBy(desc(s.trades.exitTime))
      .limit(10);
    const t = closed[Number(tradeN) - 1];
    if (!t) throw new Error(`No trade #${tradeN} in verify:sync's last-10 list.`);
    coin = t.coin;
    from = t.entryTime! - 30 * 60_000;
    to = (t.exitTime ?? t.entryTime!) + 30 * 60_000;
    console.log(`\nTrade #${tradeN}: ${t.displayPair} ${t.direction}, flags: ${Object.keys(t.flags ?? {}).join(",") || "none"}`);
  } else if (coin && arg("at")) {
    const at = new Date(arg("at")!.replace(" ", "T")).getTime(); // interpreted in this machine's local time
    const mins = Number(arg("minutes") ?? 30);
    from = at - mins * 60_000;
    to = at + mins * 60_000;
  }
  if (!coin || from === undefined || to === undefined) return;

  const win = (await db
    .select()
    .from(s.fills)
    .where(and(eq(s.fills.coin, coin), gte(s.fills.time, from), lte(s.fills.time, to)))) as Row[];
  const show = (label: string, xs: Row[]) => {
    console.log(`\n${label}: ${coin}, ${xs.length} fills (times in ${tz})`);
    console.log(`${pad("time", 24)} ${padL("tid", 16)} ${padL("startPos", 16)} ${padL("signed sz", 14)} ${padL("end pos", 16)}  check`);
    let prev: Row | null = null;
    for (const f of xs) {
      const signed = f.side === "B" ? f.sz : `-${f.sz}`;
      const same = prev ? prev.time === f.time : false;
      const jump = prev && !samePosition(endOf(prev), new Decimal(f.startPosition));
      console.log(
        `${pad(dt(f.time), 24)} ${padL(f.tid, 16)} ${padL(f.startPosition, 16)} ${padL(signed, 14)} ${padL(endOf(f).toString(), 16)}  ${jump ? `JUMP (expected start ${endOf(prev!).toString()})` : ""}${same ? " [same ms]" : ""}`,
      );
      prev = f;
    }
  };
  show("OLD order (time, tid)", orderByTimeTid(win.map(toFill)) as unknown as Row[]);
  show("NEW order (same-ms chained by startPosition)", orderFills(win.map(toFill)) as unknown as Row[]);
}

main().catch((err) => {
  console.error("debug:ordering failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
