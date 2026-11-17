/**
 * npm run seed:demo — (re)build a fake demo account in ./data/demo/journal.db.
 * Synthetic data only. Refuses to run against any other database.
 */
import fs from "node:fs";
import { applyDemoEnv, DEMO_DATA_DIR, DEMO_DB_FILE } from "./demo-env";

applyDemoEnv();

async function main() {
  const { getConfig } = await import("../src/server/config");
  const cfg = getConfig();
  if (cfg.db.url !== `file:${DEMO_DB_FILE}`) throw new Error(`Refusing to seed demo data into ${cfg.db.url}`);

  fs.mkdirSync(DEMO_DATA_DIR, { recursive: true });
  for (const f of fs.readdirSync(DEMO_DATA_DIR)) if (f.startsWith("journal.db")) fs.rmSync(`${DEMO_DATA_DIR}/${f}`);
  // demo screenshots live in data/demo/uploads (never the real uploads folder)
  if (cfg.uploadsDir.startsWith(DEMO_DATA_DIR)) fs.rmSync(cfg.uploadsDir, { recursive: true, force: true });

  const { getDb } = await import("../src/server/db/client");
  const { runMigrations, seedDefaults } = await import("../src/server/db/bootstrap");
  const s = await import("../src/server/db/schema");
  const { DEFAULT_SESSIONS } = await import("../src/server/db/seed-data");
  const { generateDemoHistory, DEMO_ADDRESS, DEMO_SEED } = await import("../src/server/demo/generate");
  const { seedDemoJournal } = await import("../src/server/demo/journal");
  const { createRng } = await import("../src/server/demo/rng");
  const { insertFills, rebuildTrades } = await import("../src/server/reconstruct/persist");

  const db = getDb();
  await runMigrations(db);
  await seedDefaults(db, { accountName: "Demo account" });
  const [account] = await db.select().from(s.accounts);
  const { eq } = await import("drizzle-orm");
  await db.update(s.accounts).set({ startingBalance: 25_000, standardRiskPct: 1 }).where(eq(s.accounts.id, account.id));
  const [wallet] = await db
    .insert(s.wallets)
    .values({ accountId: account.id, address: DEMO_ADDRESS, label: "Demo", autoSync: false })
    .returning();

  const history = generateDemoHistory({ end: Date.now() });
  const { inserted } = await insertFills(db, wallet.id, history.fills);
  const rebuilt = await rebuildTrades(db, { walletId: wallet.id, accountId: account.id });

  // a synthetic spot round trip (unified account: spot stablecoins are the collateral, so spot P&L moves the
  // balance). The buy's fee is charged in the base token, as on Hyperliquid; the balance values it at the fill price.
  const { createSim } = await import("../src/server/demo/hl-sim");
  const spotAt = (history.fills[0]?.time ?? Date.now()) + (Date.now() - (history.fills[0]?.time ?? Date.now())) * 0.5;
  let spotTid = 9_000_000;
  const spot = createSim("PURR/USDC", { startTime: Math.round(spotAt), nextTid: () => spotTid++ })
    .step({ side: "B", sz: 10_000, px: "0.2", fee: "3.5", feeToken: "PURR" })
    .step({ side: "A", sz: 10_000, px: "0.23", fee: "1.035", feeToken: "USDC" });
  await insertFills(db, wallet.id, spot.fills);
  await db.update(s.wallets).set({ accountMode: "unifiedAccount" }).where(eq(s.wallets.id, wallet.id));
  const last = history.fills.at(-1)?.time ?? null;
  await db
    .update(s.wallets)
    .set({ lastFillTime: last, oldestFillTime: history.fills[0]?.time ?? null, backfillCompletedAt: Date.now() })
    .where(eq(s.wallets.id, wallet.id));
  const journal = await seedDemoJournal(db, createRng(DEMO_SEED + 1), {
    walletId: wallet.id,
    plans: history.plans,
    sessions: DEFAULT_SESSIONS,
  });

  // synthetic chart screenshots for ~30% of journaled trades
  const { demoChartPng } = await import("../src/server/demo/chart-png");
  const { addScreenshot } = await import("../src/server/screenshots");
  const { LocalStorage } = await import("../src/server/storage/local");
  const storage = new LocalStorage(cfg.uploadsDir);
  const shotRng = createRng(DEMO_SEED + 2);
  const journaled = new Set((await db.select({ id: s.tradeJournal.tradeId }).from(s.tradeJournal)).map((r) => r.id));
  const byKey = new Map((await db.select().from(s.trades)).map((t) => [t.externalKey, t]));
  let shots = 0;
  for (const plan of history.plans) {
    const t = byKey.get(`${wallet.id}:${plan.coin}:${plan.firstTid}${plan.keySuffix}`);
    if (!t || !journaled.has(t.id) || !shotRng.chance(0.3)) continue;
    const png = demoChartPng(shotRng, { entry: plan.entryPx, stop: plan.stopLoss, target: plan.takeProfit, direction: plan.direction });
    await addScreenshot(db, storage, { accountId: account.id, tradeId: t.id, bytes: png, width: 960, height: 540, caption: "Entry (demo chart)" });
    shots++;
  }

  // synthetic hourly funding while each position was open (longs mostly pay, shorts mostly receive)
  const { attributeFunding } = await import("../src/server/funding/attribute");
  const fundRng = createRng(DEMO_SEED + 4);
  const HOUR = 3_600_000;
  const fundingRows: (typeof s.fundingEvents.$inferInsert)[] = [];
  for (const t of byKey.values()) {
    if (t.entryTime === null || !t.sizeUnits || !t.avgEntry) continue;
    const until = t.exitTime ?? Date.now();
    const sign = t.direction === "long" ? 1 : -1;
    for (let h = Math.ceil(t.entryTime / HOUR) * HOUR; h <= until && fundingRows.length < 20_000; h += HOUR) {
      const rate = fundRng.between(-0.000004, 0.000016); // per hour, usually positive (longs pay)
      fundingRows.push({
        walletId: wallet.id,
        hash: "0x" + "0".repeat(64),
        coin: t.coin,
        time: h,
        usdc: (-sign * rate * t.sizeUnits * t.avgEntry).toFixed(6),
        szi: String(sign * t.sizeUnits),
        fundingRate: rate.toFixed(8),
      });
    }
  }
  for (let i = 0; i < fundingRows.length; i += 200) await db.insert(s.fundingEvents).values(fundingRows.slice(i, i + 200)).onConflictDoNothing();
  const fundingResult = await attributeFunding(db, wallet.id);

  // synthetic ledger: the starting deposit, a top-up, a withdrawal and a transfer out → the balance view
  const t0 = history.fills[0]?.time ?? Date.now();
  const span = Date.now() - t0;
  const ledger = [
    { at: t0 - 86_400_000, type: "deposit", kind: "deposit", usd: 25_000 },
    { at: t0 + span * 0.35, type: "deposit", kind: "deposit", usd: 5_000 },
    { at: t0 + span * 0.6, type: "withdraw", kind: "withdraw", usd: -3_001 },
    { at: t0 + span * 0.8, type: "send", kind: "transfer_out", usd: -750 },
  ];
  await db.insert(s.ledgerEvents).values(
    ledger.map((l, i) => ({
      walletId: wallet.id,
      uid: `demo-ledger-${i}`,
      time: Math.round(l.at),
      hash: "0x" + "0".repeat(64),
      type: l.type,
      delta: { type: l.type, usdc: String(Math.abs(l.usd)) },
      kind: l.kind,
      usd: l.usd,
    })),
  ).onConflictDoNothing();
  await db.update(s.wallets).set({ ledgerCompletedAt: Date.now(), fundingCompletedAt: Date.now() }).where(eq(s.wallets.id, wallet.id));

  // a second wallet on the same account (a sub-account with its own, shorter history), funded by a transfer from
  // the main wallet: both sides of the transfer are in the ledger, so "All wallets" folds them into one internal move
  const sub = await seedSubWallet(db, s, { accountId: account.id, mainWalletId: wallet.id, generateDemoHistory, insertFills, rebuildTrades, eq });

  // synthetic trigger orders (stops, moves, targets) → SL/TP auto-detection, exactly as a real sync would
  const { demoOrders } = await import("../src/server/demo/orders");
  const { historyRows } = await import("../src/server/demo/hl-orders");
  const { storeOrders } = await import("../src/server/hyperliquid/orders");
  const { applyProtection } = await import("../src/server/protection/apply");
  const synth = demoOrders(createRng(DEMO_SEED + 3), history.plans, (plan) => byKey.get(`${wallet.id}:${plan.coin}:${plan.firstTid}${plan.keySuffix}`), journaled);
  await storeOrders(db, wallet.id, historyRows(synth) as Parameters<typeof storeOrders>[2]);
  // the order that fired closes the trade: give the final exit fill that order's id, as on Hyperliquid
  const { and: andOp, desc: descOp } = await import("drizzle-orm");
  const tradeByExit = new Map([...byKey.values()].filter((t) => t.exitTime !== null).map((t) => [`${t.coin}|${t.exitTime}`, t]));
  const linkedTrades = new Set<string>();
  for (const o of synth) {
    if (o.end?.status !== "triggered") continue;
    const t = tradeByExit.get(`${o.coin}|${o.end.at}`);
    if (!t || linkedTrades.has(t.id)) continue;
    const [leg] = await db
      .select()
      .from(s.tradeFills)
      .where(andOp(eq(s.tradeFills.tradeId, t.id), eq(s.tradeFills.role, "exit")))
      .orderBy(descOp(s.tradeFills.time))
      .limit(1);
    if (!leg) continue;
    await db.update(s.fills).set({ oid: o.oid }).where(andOp(eq(s.fills.walletId, wallet.id), eq(s.fills.tid, leg.tid)));
    linkedTrades.add(t.id);
  }
  const prot = await applyProtection(db, wallet.id);

  // synthetic stop moves of your own (sync never touches these): a widen, a move to breakeven and a trail,
  // each on an older closed trade that has a stop and no moves yet
  const { sql: rawSql } = await import("drizzle-orm");
  const candidates = await db.all<{ id: string; direction: "long" | "short"; entry: number; sl: number; entryTime: number; exitTime: number }>(
    rawSql`select t.id, t.direction, t.avg_entry as entry, j.stop_loss as sl, t.entry_time as entryTime, t.exit_time as exitTime
      from trades t join trade_journal j on j.trade_id = t.id
      where t.status = 'closed' and t.deleted_at is null and j.stop_loss is not null and t.avg_entry is not null
        and t.exit_time - t.entry_time > 3600000
        and not exists (select 1 from stop_moves m where m.trade_id = t.id)
      order by t.entry_time limit 3`,
  );
  const userMoves = candidates.map((c, i) => {
    const sign = c.direction === "long" ? 1 : -1;
    const risk = Math.abs(c.entry - c.sl);
    const price = [c.sl - sign * risk * 0.5, c.entry, c.entry + sign * risk * 0.5][i]; // widen, breakeven, trail
    const note = ["gave it more room", "risk off at breakeven", "trailed under structure"][i];
    return { tradeId: c.id, time: c.entryTime + Math.round((c.exitTime - c.entryTime) / 2), price, note, source: "user" as const };
  });
  if (userMoves.length) await db.insert(s.stopMoves).values(userMoves);

  console.log(
    `seed:demo → ${DEMO_DB_FILE}\n  ${inserted} fills, ${rebuilt.created} trades, ${journal.journaled} journaled (${journal.total - journal.journaled} left blank), ${shots} screenshots\n  ${synth.length} trigger orders → auto SL/TP on ${prot.trades} trades\n  ${fundingResult.payments} funding payments, ${fundingResult.attributed} attributed\n  sub-account wallet: ${sub.fills} fills, ${sub.trades} trades`,
  );
}

type Mods = {
  accountId: string;
  mainWalletId: string;
  generateDemoHistory: typeof import("../src/server/demo/generate").generateDemoHistory;
  insertFills: typeof import("../src/server/reconstruct/persist").insertFills;
  rebuildTrades: typeof import("../src/server/reconstruct/persist").rebuildTrades;
  eq: typeof import("drizzle-orm").eq;
};
async function seedSubWallet(
  db: ReturnType<typeof import("../src/server/db/client").getDb>,
  s: typeof import("../src/server/db/schema"),
  m: Mods,
) {
  const { DEMO_SEED } = await import("../src/server/demo/generate");
  const [w] = await db
    .insert(s.wallets)
    .values({ accountId: m.accountId, address: "0x0000000000000000000000000000000000000de1", label: "Scalps", kind: "sub", autoSync: false })
    .returning();
  const h = m.generateDemoHistory({ seed: DEMO_SEED + 10, end: Date.now(), days: 45 });
  const { inserted } = await m.insertFills(db, w.id, h.fills);
  const rebuilt = await m.rebuildTrades(db, { walletId: w.id, accountId: m.accountId });
  const at = (h.fills[0]?.time ?? Date.now()) - 3_600_000;
  const hash = "0x" + "5".repeat(64);
  const delta = { type: "subAccountTransfer", usdc: "4000" };
  await db.insert(s.ledgerEvents).values([
    { walletId: m.mainWalletId, uid: "demo-sub-out", time: at, hash, type: "subAccountTransfer", delta, kind: "transfer_out", usd: -4000 },
    { walletId: w.id, uid: "demo-sub-in", time: at, hash, type: "subAccountTransfer", delta, kind: "transfer_in", usd: 4000 },
  ]);
  const now = Date.now();
  await db
    .update(s.wallets)
    .set({
      accountMode: "unifiedAccount",
      lastFillTime: h.fills.at(-1)?.time ?? null,
      oldestFillTime: h.fills[0]?.time ?? null,
      backfillCompletedAt: now,
      ledgerCompletedAt: now,
      fundingCompletedAt: now,
    })
    .where(m.eq(s.wallets.id, w.id));
  return { fills: inserted, trades: rebuilt.created };
}

main().catch((err) => {
  console.error("seed:demo failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
